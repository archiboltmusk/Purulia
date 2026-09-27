-- Add boundary_type column to reports table for Municipality/Gram Panchayat routing
-- This enables proper SLA and escalation routing based on administrative jurisdiction

begin;

-- Add boundary_type column to reports table
alter table public.reports
  add column if not exists boundary_type text;

-- Create check constraint for valid boundary types
do $$ begin
  alter table public.reports add constraint kasa_reports_boundary_type_chk
    check (boundary_type is null or boundary_type in ('municipality', 'gram_panchayat'));
exception when duplicate_object then null; end $$;

-- Create index for boundary-based queries (analytics, routing dashboards)
create index if not exists kasa_reports_boundary_type_idx on public.reports (boundary_type);

-- Update public view to include boundary_type for analytics and routing visibility
create or replace view public.kasa_public_reports as
select r.id,
       date_trunc('hour', r.created_at) as created_at,
       r.lat, r.lng, r.ward_no, r.category, r.severity, r.status, r.description, r.landmark, r.photo_url,
       coalesce(r.upvotes, 0) as upvotes, r.seen_on_site, coalesce(r.flags, 0) as flags, r.moderation_status,
       coalesce(r.is_duplicate, false) as is_duplicate, r.parent_report_id, r.recurrence_count, r.rejected_claims,
       date_trunc('hour', r.resolved_at) as resolved_at,
       r.resolved_photo_url, r.resolution_method, coalesce(r.sla_days, 7) as sla_days,
       (r.accuracy_m is not null) as gps_verified,
       c.id as claim_id, c.photo_url as claim_photo_url,
       date_trunc('hour', c.created_at) as claim_created_at,
       c.verify_count as claim_verify_count, c.dispute_count as claim_dispute_count,
       date_trunc('hour', c.quorum_reached_at) as claim_quorum_reached_at,
       date_trunc('hour', c.final_after + interval '59 minutes 59 seconds') as claim_finalize_after,
       round(c.distance_m::numeric) as claim_distance_m,
       r.rating_count, r.onsite_rating_count, r.authenticity_avg, r.severity_avg, r.neighbour_status, r.reply_count,
       c.needs_review as claim_needs_review,
       r.area_kind, r.block_name,
       (select (s.value #>> '{}')::integer from kasa_private.settings s
        where s.key = case when r.area_kind = 'rural' then 'rural_verify_quorum' else 'verify_quorum' end) as verify_needed,
       date_trunc('hour', c.reviewed_at) as claim_reviewed_at,
       r.boundary_type
from public.reports r
left join kasa_private.claims c on c.id = r.claim_id
where r.moderation_status in ('approved', 'flagged');

revoke all on public.kasa_public_reports from public, anon, authenticated;
grant select on public.kasa_public_reports to anon, authenticated;

notify pgrst, 'reload schema';

-- Update kasa_create_report function to accept and store boundary_type parameter
-- This is a modified version of the original function from 20260924120000_kasa_v2_accountability.sql
-- Only change: added p_boundary_type parameter and included it in the INSERT statement
drop function if exists public.kasa_create_report cascade;
create function public.kasa_create_report(
  p_category text, p_severity text, p_lat double precision, p_lng double precision,
  p_accuracy double precision, p_ward_no integer, p_description text, p_landmark text,
  p_photo_path text, p_client_id text default null, p_boundary_type text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me        kasa_private.profiles := kasa_private.me();
  v_bbox    jsonb := kasa_private.cfg('bbox');
  v_chk     kasa_private.photo_checks;
  v_existing public.reports;
  v_parent  public.reports;
  v_recur   public.reports;
  v_new     public.reports;
  v_mod     text := 'approved';
  v_url     text;
begin
  if p_client_id is not null then
    select * into v_existing from public.reports where user_id = me.user_id and client_id = p_client_id;
    if found then
      return jsonb_build_object('id', v_existing.id, 'moderation_status', v_existing.moderation_status, 'replayed', true);
    end if;
  end if;

  if p_category is null or p_category not in ('garbage', 'drain', 'road', 'streetlight', 'water', 'missing',
      'encroachment', 'illegal_construction', 'illegal_mining', 'illegal_other', 'other') then
    perform kasa_private.fail('KASA_BAD_CATEGORY', 'Choose what kind of problem this is.');
  end if;
  if coalesce(p_severity, '') not in ('minor', 'severe', 'critical') then
    perform kasa_private.fail('KASA_BAD_SEVERITY', 'Choose a severity.');
  end if;
  if p_lat is null or p_lng is null
     or p_lat not between (v_bbox ->> 'min_lat')::float8 and (v_bbox ->> 'max_lat')::float8
     or p_lng not between (v_bbox ->> 'min_lng')::float8 and (v_bbox ->> 'max_lng')::float8 then
    perform kasa_private.fail('KASA_OUTSIDE_AREA', 'This location is outside Purulia town.');
  end if;
  if p_ward_no is not null and p_ward_no not between 1 and 23 then
    perform kasa_private.fail('KASA_BAD_WARD', 'Ward must be between 1 and 23.');
  end if;
  if length(coalesce(p_description, '')) > 500 or length(coalesce(p_landmark, '')) > 140 then
    perform kasa_private.fail('KASA_TOO_LONG', 'Description is too long.');
  end if;

  if (select count(*) from public.reports where user_id = me.user_id and created_at > now() - interval '1 hour')
       >= kasa_private.cfg_num('reports_per_hour')
  or (select count(*) from public.reports where user_id = me.user_id and created_at > now() - interval '1 day')
       >= kasa_private.cfg_num('reports_per_day') then
    perform kasa_private.fail('KASA_RATE_LIMIT', 'You have filed a lot of reports. Try again later.');
  end if;

  v_chk := kasa_private.check_photo(p_photo_path, 'reports', me.user_id, null, p_lat, p_lng);
  v_url := (kasa_private.cfg('storage_public_base') #>> '{}') || p_photo_path;

  if p_category in (select jsonb_array_elements_text(kasa_private.cfg('review_categories')))
     or coalesce(v_chk.face_count, 0) > 0 then
    v_mod := 'review';
  end if;

  -- Same problem already reported nearby → link to it and count this person as a witness.
  select * into v_parent from public.reports r
  where r.category = p_category and r.status in ('open', 'claimed') and not coalesce(r.is_duplicate, false)
    and r.moderation_status <> 'hidden'
    and r.created_at > now() - make_interval(hours => kasa_private.cfg_num('duplicate_hours')::integer)
    and kasa_private.distance_m(r.lat, r.lng, p_lat, p_lng) <= kasa_private.cfg_num('duplicate_radius_m')
  order by kasa_private.distance_m(r.lat, r.lng, p_lat, p_lng) limit 1;

  if v_parent.id is null then
    -- A spot that was "resolved" recently and is dirty again is a recurrence, on the record.
    select * into v_recur from public.reports r
    where r.category = p_category and r.status = 'resolved'
      and r.resolved_at > now() - make_interval(days => kasa_private.cfg_num('recurrence_days')::integer)
      and kasa_private.distance_m(r.lat, r.lng, p_lat, p_lng) <= kasa_private.cfg_num('duplicate_radius_m')
    order by r.resolved_at desc limit 1;
  end if;

  insert into public.reports (lat, lng, ward_no, severity, description, reporter_name, reporter_hash, photo_url,
      status, upvotes, flags, sla_days, parent_report_id, is_duplicate, sync_status, moderation_status,
      moderation_labels, category, landmark, user_id, client_id, accuracy_m, photo_path, boundary_type)
  values (p_lat, p_lng, p_ward_no, p_severity, nullif(trim(p_description), ''), null,
      substr(md5(me.user_id::text || (kasa_private.cfg('ip_salt') #>> '{}')), 1, 16), v_url,
      'open', 0, 0, 7, coalesce(v_parent.id, v_recur.id), v_parent.id is not null, 'synced', v_mod,
      case when v_chk.photo_path is null then '{}'::jsonb
           else jsonb_build_object('garbage_score', v_chk.garbage_score, 'labels', v_chk.labels) end,
      p_category, nullif(trim(p_landmark), ''), me.user_id, p_client_id, p_accuracy, p_photo_path, p_boundary_type)
  returning * into v_new;

  perform kasa_private.add_event(v_new.id::text, 'reported', me.user_id, null, v_url, null,
    jsonb_build_object('gps', p_accuracy is not null, 'accuracy_m', round(p_accuracy::numeric)));

  if v_parent.id is not null then
    insert into kasa_private.seen (report_id, user_id, on_site, distance_m)
    values (v_parent.id, me.user_id, p_accuracy is not null and p_accuracy <= kasa_private.cfg_num('max_gps_accuracy_m'),
            kasa_private.distance_m(v_parent.lat, v_parent.lng, p_lat, p_lng))
    on conflict do nothing;
    if found then
      update public.reports set upvotes = coalesce(upvotes, 0) + 1,
             seen_on_site = seen_on_site + (case when p_accuracy is not null
               and p_accuracy <= kasa_private.cfg_num('max_gps_accuracy_m') then 1 else 0 end)
      where id = v_parent.id;
    end if;
  elsif v_recur.id is not null then
    update public.reports set recurrence_count = recurrence_count + 1 where id = v_recur.id;
    perform kasa_private.add_event(v_recur.id::text, 'recurred', me.user_id, null, v_url, null,
      jsonb_build_object('new_report_id', v_new.id));
  end if;

  return jsonb_build_object('id', v_new.id, 'moderation_status', v_mod,
    'duplicate_of', v_parent.id, 'recurrence_of', v_recur.id);
end $$;

commit;
