-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — public works warranty (defect liability period)
--
-- A government road, drain or building comes with a defect liability period:
-- for that long after completion, the contractor must make good any defect
-- at their own expense (West Bengal PWD, clause 17 of West Bengal Form 2911,
-- as substituted by notification 5784-PW/L&A/2M-175/2017, 12 Sep 2017).
-- The citizen information board at the site usually says who did the work.
--
-- Someone standing at the board takes a live photo of it (good GPS fix) and
-- copies what it says: the work, the agency, and if written, the contractor,
-- work order or tender number, cost, completion date and defect liability
-- period. It waits for a moderator, who checks the photo shows the same
-- board. Approved works are public (kasa_public_works) with warranty_until =
-- completion + DLP, only when the board gives both. A report filed within
-- work_warranty_radius_m of a work still under warranty says so
-- (kasa_report_warranty). The contractor's name is only what the board says.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

insert into kasa_private.settings (key, value, note) values
  ('works_per_day', '5', 'Public works boards one person can record per day'),
  ('work_warranty_radius_m', '50', 'A report this close to a work under warranty shows the warranty')
on conflict (key) do nothing;

create table if not exists kasa_private.public_works (
  id            bigint generated always as identity primary key,
  user_id       uuid not null,
  work_name     text not null,
  agency        text not null,
  contractor    text,
  work_order    text,
  cost_text     text,
  completed_on  date,
  dlp_years     numeric(4,2) check (dlp_years is null or (dlp_years > 0 and dlp_years <= 10)),
  lat           double precision not null,
  lng           double precision not null,
  accuracy_m    double precision,
  photo_path    text not null,
  photo_url     text not null,
  ward_no       integer,
  block_name    text,
  district      text,
  place         text,
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'removed')),
  created_at    timestamptz not null default now(),
  reviewed_at   timestamptz,
  review_note   text
);
create index if not exists kasa_public_works_status_idx on kasa_private.public_works (status, created_at);
create index if not exists kasa_public_works_user_idx on kasa_private.public_works (user_id, created_at desc);
create index if not exists kasa_public_works_pos_idx on kasa_private.public_works (lat, lng) where status = 'approved';
alter table kasa_private.public_works enable row level security;
revoke all on kasa_private.public_works from public, anon, authenticated;

-- Completion + DLP, only when the board gives both.
create or replace function kasa_private.work_warranty_until(p_completed date, p_years numeric) returns date
language sql immutable set search_path = '' as $$
  select case when p_completed is not null and p_years is not null
              then (p_completed + make_interval(months => round(p_years * 12)::integer))::date end
$$;

-- A board photo is in use once recorded, so it can't be sent again and the orphan cleanup keeps it.
create or replace function kasa_private.photo_in_use(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.reports r where r.photo_path = p_path)
      or exists (select 1 from kasa_private.report_photos rp where rp.photo_path = p_path)
      or exists (select 1 from kasa_private.claims c where c.photo_path = p_path)
      or exists (select 1 from kasa_private.votes v where v.photo_path = p_path)
      or (to_regclass('public.school_audits') is not null
          and exists (select 1 from public.school_audits a where a.photo_path = p_path))
      or exists (select 1 from kasa_private.school_report_cards rc where rc.photo_path = p_path)
      or exists (select 1 from kasa_private.school_suggestions ss where ss.photo_path = p_path)
      or exists (select 1 from kasa_private.snake_sightings sn where sn.photo_path = p_path)
      or exists (select 1 from kasa_private.public_works w where w.photo_path = p_path)
$$;

create or replace function public.kasa_add_public_work(p_work_name text, p_agency text, p_contractor text, p_work_order text,
    p_cost text, p_completed_on date, p_dlp_years numeric, p_lat double precision, p_lng double precision,
    p_accuracy double precision, p_photo_path text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me      kasa_private.profiles := kasa_private.me();
  v_name  text := regexp_replace(trim(coalesce(p_work_name, '')), '\s+', ' ', 'g');
  v_ag    text := regexp_replace(trim(coalesce(p_agency, '')), '\s+', ' ', 'g');
  v_con   text := nullif(regexp_replace(trim(coalesce(p_contractor, '')), '\s+', ' ', 'g'), '');
  v_wo    text := nullif(regexp_replace(trim(coalesce(p_work_order, '')), '\s+', ' ', 'g'), '');
  v_cost  text := nullif(regexp_replace(trim(coalesce(p_cost, '')), '\s+', ' ', 'g'), '');
  v_loc   jsonb;
  v_id    bigint;
begin
  if length(v_name) < 5 or length(v_name) > 200 then
    perform kasa_private.fail('KASA_BAD_FORM', 'Write the name of the work as it is on the board (5 to 200 characters).');
  end if;
  if length(v_ag) < 2 or length(v_ag) > 120 then
    perform kasa_private.fail('KASA_BAD_FORM', 'Write which office or body did the work, as on the board.');
  end if;
  if length(coalesce(v_con, '')) > 120 or length(coalesce(v_wo, '')) > 80 or length(coalesce(v_cost, '')) > 60 then
    perform kasa_private.fail('KASA_BAD_FORM', 'One of the fields is too long. Copy only what the board says.');
  end if;
  if p_completed_on is not null and (p_completed_on > current_date or p_completed_on < date '1990-01-01') then
    perform kasa_private.fail('KASA_BAD_DATE', 'Give the completion date only if the work is finished. Leave it empty if the board shows a future date.');
  end if;
  if p_dlp_years is not null and (p_dlp_years <= 0 or p_dlp_years > 10) then
    perform kasa_private.fail('KASA_BAD_FORM', 'Give the defect liability period as written on the board, or leave it empty.');
  end if;
  if kasa_private.text_verdict(concat_ws(' ', v_name, v_ag, v_con, v_wo, v_cost)) ->> 'level' = 'block' then
    perform kasa_private.fail('KASA_TEXT_BLOCKED', 'Please remove abusive words and try again.');
  end if;
  if p_lat is null or p_lng is null or p_accuracy is null or p_accuracy > kasa_private.cfg_num('max_gps_accuracy_m') then
    perform kasa_private.fail('KASA_GPS_WEAK', 'Your location isn''t precise enough yet. Wait a moment outdoors and try again.',
      jsonb_build_object('accuracy_m', round(coalesce(p_accuracy, 0)::numeric)));
  end if;
  v_loc := kasa_private.locate_any(p_lat, p_lng, null);
  if v_loc is null then perform kasa_private.fail('KASA_OUTSIDE_AREA', 'This location is outside the areas Parishkar covers.'); end if;
  if (select count(*) from kasa_private.public_works
      where user_id = me.user_id and created_at > now() - interval '1 day') >= kasa_private.cfg_num('works_per_day') then
    perform kasa_private.fail('KASA_RATE_LIMIT', 'You have recorded a lot of boards today. Try again tomorrow.');
  end if;
  perform kasa_private.rate_limit_actions(me.user_id);
  perform kasa_private.check_photo(p_photo_path, 'reports', me.user_id, null, p_lat, p_lng);

  insert into kasa_private.public_works (user_id, work_name, agency, contractor, work_order, cost_text, completed_on, dlp_years,
                                         lat, lng, accuracy_m, photo_path, photo_url, ward_no, block_name, district, place)
  values (me.user_id, v_name, v_ag, v_con, v_wo, v_cost, p_completed_on, p_dlp_years, p_lat, p_lng, p_accuracy,
          p_photo_path, (kasa_private.cfg('storage_public_base') #>> '{}') || p_photo_path,
          case when v_loc ->> 'kind' in ('town', 'place') then nullif(v_loc ->> 'ward', '')::integer end,
          v_loc ->> 'block', v_loc ->> 'district', v_loc ->> 'place')
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'status', 'pending');
end $$;

-- Approved works with the board photo. Who recorded it is never shown.
create or replace function public.kasa_public_works() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', w.id, 'work_name', w.work_name, 'agency', w.agency, 'contractor', w.contractor,
      'work_order', w.work_order, 'cost', w.cost_text, 'completed_on', w.completed_on, 'dlp_years', w.dlp_years,
      'warranty_until', u.until, 'under_warranty', coalesce(u.until >= current_date, false),
      'lat', round(w.lat::numeric, 5), 'lng', round(w.lng::numeric, 5), 'photo_url', w.photo_url,
      'ward_no', w.ward_no, 'block_name', w.block_name, 'district', w.district, 'place', w.place, 'since', w.reviewed_at)
    order by coalesce(u.until >= current_date, false) desc, u.until desc nulls last, w.reviewed_at desc), '[]'::jsonb)
  from kasa_private.public_works w
  cross join lateral (select kasa_private.work_warranty_until(w.completed_on, w.dlp_years) as until) u
  where w.status = 'approved'
$$;

-- The nearest approved work still under warranty within work_warranty_radius_m of a public report, or null.
create or replace function public.kasa_report_warranty(p_report_id text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', w.id, 'work_name', w.work_name, 'agency', w.agency, 'contractor', w.contractor,
                            'warranty_until', u.until, 'distance_m', round(kasa_private.distance_m(w.lat, w.lng, r.lat, r.lng)))
  from public.reports r
  join kasa_private.public_works w
    on w.status = 'approved'
   and w.lat between r.lat - 0.001 and r.lat + 0.001 and w.lng between r.lng - 0.0012 and r.lng + 0.0012
  cross join lateral (select kasa_private.work_warranty_until(w.completed_on, w.dlp_years) as until) u
  where r.id::text = p_report_id
    and (exists (select 1 from public.kasa_public_reports v where v.id::text = p_report_id)
         or exists (select 1 from public.kasa_public_place_reports v where v.id::text = p_report_id))
    and u.until >= current_date
    and kasa_private.distance_m(w.lat, w.lng, r.lat, r.lng) <= kasa_private.cfg_num('work_warranty_radius_m')
  order by kasa_private.distance_m(w.lat, w.lng, r.lat, r.lng)
  limit 1
$$;

create or replace function public.kasa_admin_works_queue() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', w.id, 'work_name', w.work_name, 'agency', w.agency, 'contractor', w.contractor, 'work_order', w.work_order,
      'cost', w.cost_text, 'completed_on', w.completed_on, 'dlp_years', w.dlp_years,
      'warranty_until', kasa_private.work_warranty_until(w.completed_on, w.dlp_years),
      'lat', w.lat, 'lng', w.lng, 'accuracy_m', round(w.accuracy_m::numeric), 'photo_url', w.photo_url,
      'ward_no', w.ward_no, 'block_name', w.block_name, 'district', w.district, 'place', w.place,
      'created_at', w.created_at) order by w.created_at)
    from kasa_private.public_works w where w.status = 'pending'), '[]'::jsonb);
end $$;

-- approve / reject a waiting board; remove an approved one (with a reason).
create or replace function public.kasa_admin_review_work(p_id bigint, p_action text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_note text := nullif(left(trim(coalesce(p_note, '')), 280), '');
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  if p_action in ('approve', 'reject') then
    update kasa_private.public_works
    set status = case when p_action = 'approve' then 'approved' else 'rejected' end, reviewed_at = now(), review_note = v_note
    where id = p_id and status = 'pending';
  elsif p_action = 'remove' then
    if v_note is null or length(v_note) < 3 then perform kasa_private.fail('KASA_REASON_NEEDED', 'Give a short reason.'); end if;
    update kasa_private.public_works set status = 'removed', review_note = v_note
    where id = p_id and status = 'approved';
  else
    perform kasa_private.fail('KASA_BAD_ACTION', 'Approve, reject or remove.');
  end if;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'No such public work waiting.'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- The daily moderator nudge counts waiting works boards too.
create or replace function kasa_private.queue_backlog() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(q, n) filter (where n > 0), '{}'::jsonb) from (
    select 'Reports held for review' q, count(*) n from public.reports
      where moderation_status in ('review', 'flagged') and created_at < now() - interval '72 hours'
    union all select 'School checks held for review', count(*) from public.school_audits
      where moderation_status in ('review', 'flagged') and created_at < now() - interval '72 hours'
    union all select 'Ward maps and places', count(*) from kasa_private.place_submissions
      where status = 'pending' and created_at < now() - interval '72 hours'
    union all select 'Officials', count(*) from kasa_private.official_suggestions
      where status = 'pending' and created_at < now() - interval '72 hours'
    union all select 'Schools', count(*) from kasa_private.school_suggestions
      where status = 'pending' and created_at < now() - interval '72 hours'
    union all select 'Translations', count(*) from kasa_private.translation_suggestions
      where status = 'pending' and created_at < now() - interval '72 hours'
    union all select 'Volunteer groups', count(*) from kasa_private.communities
      where status = 'pending' and created_at < now() - interval '72 hours'
    union all select 'Dog feeding spots', count(*) from kasa_private.feeding_spots
      where status = 'pending' and created_at < now() - interval '72 hours'
    union all select 'Snake rescuers', count(*) from kasa_private.snake_rescuers
      where status = 'pending' and created_at < now() - interval '72 hours'
    union all select 'Public works boards', count(*) from kasa_private.public_works
      where status = 'pending' and created_at < now() - interval '72 hours'
  ) t
$$;
revoke all on function kasa_private.queue_backlog() from public, anon, authenticated;
revoke all on function kasa_private.work_warranty_until(date, numeric) from public, anon, authenticated;

revoke all on function public.kasa_public_works() from public;
grant execute on function public.kasa_public_works() to anon, authenticated;
revoke all on function public.kasa_report_warranty(text) from public;
grant execute on function public.kasa_report_warranty(text) to anon, authenticated;
revoke all on function public.kasa_add_public_work(text, text, text, text, text, date, numeric, double precision, double precision, double precision, text) from public, anon;
revoke all on function public.kasa_admin_works_queue() from public, anon;
revoke all on function public.kasa_admin_review_work(bigint, text, text) from public, anon;
grant execute on function public.kasa_add_public_work(text, text, text, text, text, date, numeric, double precision, double precision, double precision, text),
  public.kasa_admin_works_queue(), public.kasa_admin_review_work(bigint, text, text) to authenticated;

commit;

notify pgrst, 'reload schema';
