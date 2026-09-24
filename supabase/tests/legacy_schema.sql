-- Replica of the live Kasa schema as of 24 Sep 2026 (read from the production
-- project with read-only queries): tables, constraints, trigger, policies,
-- every public function and view, verbatim. Used to test the v2 migration
-- against the real starting point, loopholes included.

create or replace function storage.extension(name text) returns text language sql immutable as
$$ select reverse(split_part(reverse(name), '.', 1)) $$;
grant execute on function storage.extension(text) to anon, authenticated, service_role;

insert into storage.buckets (id, name, public) values ('kasa-photos', 'kasa-photos', true) on conflict do nothing;
create policy kasa_photos_public_insert on storage.objects for insert to public with check (
  (bucket_id = 'kasa-photos'::text) AND ((storage.foldername(name))[1] = ANY (ARRAY['reports'::text, 'resolutions'::text]))
  AND (lower(storage.extension(name)) = ANY (ARRAY['jpg'::text, 'jpeg'::text, 'png'::text, 'webp'::text]))
  AND ((metadata ->> 'mimetype'::text) ~~ 'image/%'::text) AND (((metadata ->> 'size'::text))::integer < 5000000));
create policy kasa_photos_public_read on storage.objects for select to public using (bucket_id = 'kasa-photos'::text);

create table public.wards (
  ward_no         integer primary key,
  councillor_name text not null,
  party           text not null,
  created_at      timestamptz default now()
);
alter table public.wards enable row level security;
create policy wards_public_read on public.wards for select using (true);
insert into public.wards (ward_no, councillor_name, party)
select g, 'Councillor ' || g, case when g % 3 = 0 then 'BJP' else 'AITC' end from generate_series(1, 23) g;

create table public.admins (
  user_id    uuid primary key references auth.users(id),
  created_at timestamptz default now()
);
alter table public.admins enable row level security;
create policy admins_self_read on public.admins for select using (auth.uid() = user_id);

create table public.automation_log (
  id       bigserial primary key,
  job_name text not null,
  result   jsonb,
  ran_at   timestamptz default now()
);
alter table public.automation_log enable row level security;

create table public.reports (
  id                          uuid primary key default gen_random_uuid(),
  created_at                  timestamptz default now(),
  lat                         double precision not null,
  lng                         double precision not null,
  ward_no                     integer references public.wards(ward_no),
  description                 text,
  reporter_name               text,
  photo_url                   text not null,
  status                      text not null default 'open',
  severity                    text not null default 'minor',
  upvotes                     integer not null default 0,
  flags                       integer not null default 0,
  resolved_at                 timestamptz,
  resolved_photo_url          text,
  resolved_by                 text,
  verified_by                 text,
  sla_days                    integer default 7,
  escalated_at                timestamptz,
  escalation_level            integer default 0,
  parent_report_id            uuid references public.reports(id),
  is_duplicate                boolean default false,
  reporter_hash               text,
  sync_status                 text default 'synced',
  moderation_status           text default 'pending',
  moderation_score            numeric,
  moderation_labels           jsonb,
  moderated_at                timestamptz,
  auto_tweeted_at             timestamptz,
  email_digest_sent_at        timestamptz,
  resolution_status           text default 'none',
  resolution_submitted_at     timestamptz,
  resolution_submitted_by     text,
  resolution_reviewed_at      timestamptz,
  resolution_reviewed_by      text,
  resolution_rejection_reason text,
  resolution_attempts         integer default 0
);
alter table public.reports add constraint reports_moderation_labels_size CHECK (((moderation_labels IS NULL) OR (length((moderation_labels)::text) < 5000)));
alter table public.reports add constraint reports_moderation_status_check CHECK ((moderation_status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'flagged'::text])));
alter table public.reports add constraint reports_resolution_status_check CHECK ((resolution_status = ANY (ARRAY['none'::text, 'pending'::text, 'approved'::text, 'rejected'::text])));
alter table public.reports add constraint reports_severity_check CHECK ((severity = ANY (ARRAY['minor'::text, 'severe'::text, 'critical'::text])));
alter table public.reports add constraint reports_status_check CHECK ((status = ANY (ARRAY['open'::text, 'resolved'::text])));
alter table public.reports add constraint reports_sync_status_check CHECK ((sync_status = ANY (ARRAY['synced'::text, 'pending'::text])));
alter table public.reports enable row level security;

create table public.report_upvotes (
  report_id     uuid references public.reports(id),
  reporter_hash text,
  created_at    timestamptz default now(),
  primary key (report_id, reporter_hash)
);
alter table public.report_upvotes enable row level security;
create policy upvotes_public_insert on public.report_upvotes for insert with check (true);
create policy upvotes_public_read on public.report_upvotes for select using (true);

create table public.report_flags (
  report_id     uuid references public.reports(id),
  reporter_hash text,
  reason        text,
  created_at    timestamptz default now(),
  primary key (report_id, reporter_hash)
);
alter table public.report_flags enable row level security;
create policy flags_public_insert on public.report_flags for insert with check (true);
create policy flags_public_read on public.report_flags for select using (true);

CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  select exists (select 1 from public.admins where user_id = auth.uid());
$function$
;

create policy automation_log_admin_read on public.automation_log for select using (is_admin());
create policy reports_public_insert on public.reports for insert with check (true);
create policy reports_public_read on public.reports for select using (((moderation_status = 'approved'::text) OR ((auth.uid() IS NOT NULL) AND is_admin())));

CREATE OR REPLACE FUNCTION public.approve_report(p_report_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;
  update public.reports
  set moderation_status = 'approved',
      moderated_at = now()
  where id = p_report_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.approve_resolution(p_report_id uuid, p_reviewed_by text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;
  update public.reports
  set status = 'resolved',
      resolution_status = 'approved',
      resolved_at = now(),
      resolution_reviewed_at = now(),
      resolution_reviewed_by = coalesce(p_reviewed_by, 'admin'),
      verified_by = coalesce(p_reviewed_by, 'admin')
  where id = p_report_id
    and resolution_status = 'pending';
end;
$function$
;

CREATE OR REPLACE FUNCTION public.check_report_rate_limit()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  recent_count int;
begin
  if new.reporter_hash is null then
    return new;
  end if;
  select count(*) into recent_count
  from public.reports
  where reporter_hash = new.reporter_hash
    and created_at > now() - interval '1 hour';
  if recent_count >= 5 then
    raise exception 'Rate limit: max 5 reports per hour';
  end if;
  return new;
end;
$function$
;
CREATE TRIGGER reports_rate_limit BEFORE INSERT ON public.reports FOR EACH ROW EXECUTE FUNCTION check_report_rate_limit();

CREATE OR REPLACE FUNCTION public.cleanup_orphaned_photos()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  deleted_count int := 0;
  obj record;
  report_uuid uuid;
begin
  for obj in
    select id, name from storage.objects
    where bucket_id = 'kasa-photos'
      and (storage.foldername(name))[1] in ('reports','resolutions')
  loop
    begin
      report_uuid := (regexp_match(obj.name, '/([0-9a-f-]{36})'))[1]::uuid;
      if report_uuid is null or not exists (select 1 from public.reports where id = report_uuid) then
        delete from storage.objects where id = obj.id;
        deleted_count := deleted_count + 1;
      end if;
    exception when others then
    end;
  end loop;
  return deleted_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.escalate_overdue_reports()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  r record;
begin
  for r in
    select id, ward_no, created_at, sla_days, escalation_level
    from public.reports
    where status = 'open'
      and created_at < now() - (sla_days || ' days')::interval
      and (escalated_at is null or escalated_at < now() - interval '3 days')
  loop
    update public.reports
    set escalated_at = now(),
        escalation_level = coalesce(escalation_level, 0) + 1
    where id = r.id;
  end loop;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.find_nearby_report(p_lat double precision, p_lng double precision, p_radius_meters integer DEFAULT 20, p_hours integer DEFAULT 6)
 RETURNS uuid
 LANGUAGE sql
 STABLE
AS $function$
  select id
  from public.reports
  where status = 'open'
    and is_duplicate = false
    and created_at > now() - (p_hours || ' hours')::interval
    and (
      6371000 * 2 * asin(sqrt(
        power(sin(radians(lat - p_lat) / 2), 2) +
        cos(radians(p_lat)) * cos(radians(lat)) *
        power(sin(radians(lng - p_lng) / 2), 2)
      ))
    ) < p_radius_meters
  order by created_at desc
  limit 1;
$function$
;

CREATE OR REPLACE FUNCTION public.flag_report(p_report_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  update public.reports
  set flags = flags + 1
  where id = p_report_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.flag_report(p_report_id uuid, p_reporter_hash text, p_reason text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  inserted boolean;
begin
  insert into public.report_flags (report_id, reporter_hash, reason)
  values (p_report_id, p_reporter_hash, p_reason)
  on conflict do nothing
  returning true into inserted;
  if inserted then
    update public.reports
    set flags = flags + 1
    where id = p_report_id;
  end if;
  return coalesce(inserted, false);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.mark_resolved(p_report_id uuid, p_resolved_photo_url text, p_resolved_by text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  update public.reports
  set status = 'resolved',
      resolved_at = now(),
      resolved_photo_url = p_resolved_photo_url,
      resolved_by = p_resolved_by,
      verified_by = coalesce(p_resolved_by, 'citizen')
  where id = p_report_id
    and status = 'open';
end;
$function$
;

CREATE OR REPLACE FUNCTION public.reject_report(p_report_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;
  update public.reports
  set moderation_status = 'rejected',
      moderated_at = now(),
      status = 'resolved',
      resolution_status = 'rejected',
      resolution_rejection_reason = coalesce(p_reason, 'moderation rejection')
  where id = p_report_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.reject_resolution(p_report_id uuid, p_reason text DEFAULT NULL::text, p_reviewed_by text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;
  update public.reports
  set resolution_status = 'rejected',
      resolution_reviewed_at = now(),
      resolution_reviewed_by = coalesce(p_reviewed_by, 'admin'),
      resolution_rejection_reason = p_reason
  where id = p_report_id
    and resolution_status = 'pending';
end;
$function$
;

CREATE OR REPLACE FUNCTION public.run_auto_cleanup()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  orphaned_photos int := 0;
  archived_reports int := 0;
  result jsonb;
begin
  select public.cleanup_orphaned_photos() into orphaned_photos;

  update public.reports
  set moderation_status = 'rejected'
  where status = 'resolved'
    and resolved_at < now() - interval '90 days'
    and moderation_status != 'rejected';

  get diagnostics archived_reports = row_count;

  result := jsonb_build_object(
    'orphaned_photos', orphaned_photos,
    'archived_reports', archived_reports,
    'ran_at', now()
  );
  insert into public.automation_log (job_name, result, ran_at)
  values ('auto_cleanup', result, now());
  return result;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.run_auto_escalation()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  escalated_count int := 0;
  result jsonb;
begin
  with to_escalate as (
    select id from public.reports
    where status = 'open'
      and moderation_status = 'approved'
      and created_at < now() - (sla_days || ' days')::interval
      and (escalated_at is null or escalated_at < now() - interval '3 days')
  )
  update public.reports r
  set escalated_at = now(),
      escalation_level = coalesce(r.escalation_level, 0) + 1
  from to_escalate t
  where r.id = t.id;

  get diagnostics escalated_count = row_count;

  result := jsonb_build_object('escalated', escalated_count, 'ran_at', now());
  insert into public.automation_log (job_name, result, ran_at)
  values ('auto_escalation', result, now());
  return result;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.run_auto_moderation()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  approved_count int := 0;
  rejected_count int := 0;
  result jsonb;
begin
  update public.reports
  set moderation_status = 'approved',
      moderated_at = now()
  where moderation_status = 'pending'
    and created_at < now() - interval '1 hour'
    and (
      moderation_labels is null
      or (
        (moderation_labels->'vision'->>'adult') not in ('LIKELY','VERY_LIKELY')
        and (moderation_labels->'vision'->>'violence') not in ('LIKELY','VERY_LIKELY')
      )
    );

  get diagnostics approved_count = row_count;

  update public.reports
  set moderation_status = 'rejected',
      moderated_at = now(),
      status = 'resolved',
      resolution_status = 'rejected',
      resolution_rejection_reason = 'auto-moderation: content flag'
  where moderation_status = 'pending'
    and created_at < now() - interval '48 hours'
    and moderation_labels->'vision'->>'adult' in ('LIKELY','VERY_LIKELY','POSSIBLE');

  get diagnostics rejected_count = row_count;

  result := jsonb_build_object(
    'approved', approved_count,
    'rejected', rejected_count,
    'ran_at', now()
  );
  insert into public.automation_log (job_name, result, ran_at)
  values ('auto_moderation', result, now());
  return result;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.run_ward_health_check()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  silent_wards int[];
  overdue_wards int[];
  result jsonb;
begin
  select array_agg(w.ward_no) into silent_wards
  from public.wards w
  where not exists (
    select 1 from public.reports r
    where r.ward_no = w.ward_no
      and r.created_at > now() - interval '30 days'
  );

  select array_agg(distinct ward_no) into overdue_wards
  from public.reports
  where status = 'open'
    and created_at < now() - (sla_days || ' days')::interval;

  result := jsonb_build_object(
    'silent_wards', coalesce(silent_wards, array[]::int[]),
    'overdue_wards', coalesce(overdue_wards, array[]::int[]),
    'ran_at', now()
  );
  insert into public.automation_log (job_name, result, ran_at)
  values ('ward_health_check', result, now());
  return result;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.submit_resolution(p_report_id uuid, p_resolved_photo_url text, p_submitted_by text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  attempts int;
begin
  select resolution_attempts into attempts
  from public.reports
  where id = p_report_id;
  if attempts >= 3 then
    raise exception 'Max resubmission attempts reached';
  end if;
  update public.reports
  set resolution_status = 'pending',
      resolution_submitted_at = now(),
      resolution_submitted_by = coalesce(p_submitted_by, 'anonymous'),
      resolved_photo_url = p_resolved_photo_url,
      resolution_attempts = coalesce(resolution_attempts, 0) + 1
  where id = p_report_id
    and status = 'open'
    and resolution_status in ('none', 'rejected');
end;
$function$
;

CREATE OR REPLACE FUNCTION public.upvote_report(p_report_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  update public.reports
  set upvotes = upvotes + 1
  where id = p_report_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.upvote_report(p_report_id uuid, p_reporter_hash text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  inserted boolean;
begin
  insert into public.report_upvotes (report_id, reporter_hash)
  values (p_report_id, p_reporter_hash)
  on conflict do nothing
  returning true into inserted;
  if inserted then
    update public.reports
    set upvotes = upvotes + 1
    where id = p_report_id;
  end if;
  return coalesce(inserted, false);
end;
$function$
;

create view public.admin_all_reports as  SELECT id, created_at, lat, lng, ward_no, description, reporter_name, photo_url, status, severity,
    upvotes, flags, resolved_at, resolved_photo_url, resolved_by, verified_by, sla_days, escalated_at, escalation_level,
    parent_report_id, is_duplicate, reporter_hash, sync_status, moderation_status, moderation_score, moderation_labels,
    moderated_at, auto_tweeted_at, email_digest_sent_at, resolution_status, resolution_submitted_at, resolution_submitted_by,
    resolution_reviewed_at, resolution_reviewed_by, resolution_rejection_reason, resolution_attempts
   FROM reports
  ORDER BY created_at DESC
 LIMIT 1000;

create view public.analytics_reporters as  SELECT reporter_hash,
    count(*) AS reports_filed,
    count(*) FILTER (WHERE (status = 'resolved'::text)) AS resolved_by_others,
    count(*) FILTER (WHERE (is_duplicate = true)) AS duplicates,
    min(created_at) AS first_report,
    max(created_at) AS latest_report
   FROM reports
  WHERE ((reporter_hash IS NOT NULL) AND (moderation_status <> 'rejected'::text))
  GROUP BY reporter_hash
 HAVING (count(*) >= 2)
  ORDER BY (count(*)) DESC
 LIMIT 20;

create view public.analytics_moderation as  SELECT moderation_status,
    count(*) AS total,
    round(((100.0 * (count(*))::numeric) / NULLIF(sum(count(*)) OVER (), (0)::numeric)), 1) AS pct
   FROM reports
  GROUP BY moderation_status;

create view public.pending_resolutions as  SELECT r.id, r.ward_no, r.severity, r.description, r.photo_url AS original_photo,
    r.resolved_photo_url AS cleanup_photo, r.created_at AS reported_at, r.resolution_submitted_at,
    r.resolution_submitted_by, w.councillor_name, w.party
   FROM (reports r
     LEFT JOIN wards w ON ((w.ward_no = r.ward_no)))
  WHERE (r.resolution_status = 'pending'::text)
  ORDER BY r.resolution_submitted_at DESC;

create view public.ward_open_counts as  SELECT ward_no, count(*) AS open_count, max(created_at) AS latest_report
   FROM reports
  WHERE ((status = 'open'::text) AND (moderation_status = ANY (ARRAY['approved'::text, 'pending'::text])))
  GROUP BY ward_no;

-- Seed: the live data at the time of the audit, plus a few rows for tests.
insert into public.reports (id, lat, lng, ward_no, photo_url, status, severity, reporter_hash, moderation_status,
                            resolution_status, resolved_at, resolved_photo_url, created_at)
values ('d50ae5c6-19d2-4200-993c-cd0d6deefdf7', 23.3321, 86.3655, 5,
        'https://cnmikcyvyamplbldiivp.supabase.co/storage/v1/object/public/kasa-photos/reports/R1790248985771.jpg',
        'resolved', 'critical', 'h1', 'approved', 'approved', now() - interval '1 hour',
        'https://cnmikcyvyamplbldiivp.supabase.co/storage/v1/object/public/kasa-photos/resolved/d50ae5c6-19d2-4200-993c-cd0d6deefdf7-1790249054705.jpg',
        now() - interval '4 hours');
insert into public.reports (lat, lng, ward_no, photo_url, status, severity, reporter_hash, moderation_status, created_at)
values (23.3350, 86.3700, 12, 'https://x/b.jpg', 'open', 'severe', 'h2', 'pending', now() - interval '3 hours'),
       (23.3290, 86.3600, 5, 'https://x/c.jpg', 'open', 'minor', 'h3', 'rejected', now() - interval '2 hours');
insert into storage.objects (bucket_id, name, created_at) values
  ('kasa-photos', 'reports/.emptyFolderPlaceholder', now() - interval '5 hours'),
  ('kasa-photos', 'reports/R1790248985771.jpg', now() - interval '4 hours'),
  ('kasa-photos', 'resolved/d50ae5c6-19d2-4200-993c-cd0d6deefdf7-1790249054705.jpg', now() - interval '1 hour');
