-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — "What's the problem?": every Swachhata app category and more
--
-- The report form's optional problem pick now covers the 21 categories of the
-- Swachhata app (dirty spot, garbage dump, van not come, burning, sweeping,
-- dustbins, open defecation, sewage/storm water, stagnant water, septic tank,
-- public toilet power/water/blockage/cleaning, yellow spot, faecal sludge, open
-- manholes, unsafe manhole entry, debris, dead animals) plus a locked toilet,
-- blocked drain, water leak, pothole and dead streetlight; the two rural
-- jobs types (20261001130000) are kept. Each is kept in
-- reports.waste_type and sets the category (kasa_private.subtype_category).
-- kasa_create_report body is the 20261001130000 one with that lookup.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

create or replace function kasa_private.subtype_category(p text) returns text
language sql immutable set search_path = '' as $$
  select case p
    when 'household' then 'garbage'
    when 'construction' then 'garbage'
    when 'mixed' then 'garbage'
    when 'e_waste' then 'garbage'
    when 'biomedical' then 'garbage'
    when 'dirty_spot' then 'garbage'
    when 'garbage_dump' then 'dumpsite'
    when 'bin_full' then 'garbage'
    when 'vehicle_missed' then 'garbage'
    when 'not_swept' then 'garbage'
    when 'burning' then 'garbage'
    when 'dead_animal' then 'garbage'
    when 'toilet_dirty' then 'toilet'
    when 'toilet_no_water' then 'toilet'
    when 'toilet_no_power' then 'toilet'
    when 'toilet_blocked' then 'toilet'
    when 'toilet_locked' then 'toilet'
    when 'open_defecation' then 'toilet'
    when 'yellow_spot' then 'toilet'
    when 'drain_blocked' then 'drain'
    when 'sewer_overflow' then 'drain'
    when 'stagnant_water' then 'drain'
    when 'septic_overflow' then 'drain'
    when 'sludge_dumped' then 'drain'
    when 'open_manhole' then 'missing'
    when 'manhole_entry' then 'illegal_other'
    when 'dry_tap' then 'water'
    when 'water_leak' then 'water'
    when 'pump_broken' then 'hand_pump'
    when 'no_doctor' then 'health_centre'
    when 'no_medicine' then 'health_centre'
    when 'centre_closed' then 'health_centre'
    when 'pothole' then 'road'
    when 'light_out' then 'streetlight'
    when 'work_missing' then 'rural_jobs'
    when 'no_signboard' then 'rural_jobs'
  end
$$;

alter table public.reports drop constraint if exists reports_waste_type_check;
alter table public.reports add constraint reports_waste_type_check
  check (waste_type is null or waste_type in (
    'household', 'construction', 'mixed', 'e_waste', 'biomedical', 'dirty_spot',
    'garbage_dump', 'bin_full', 'vehicle_missed', 'not_swept', 'burning', 'dead_animal',
    'toilet_dirty', 'toilet_no_water', 'toilet_no_power', 'toilet_blocked', 'toilet_locked', 'open_defecation',
    'yellow_spot', 'drain_blocked', 'sewer_overflow', 'stagnant_water', 'septic_overflow', 'sludge_dumped',
    'open_manhole', 'manhole_entry', 'dry_tap', 'water_leak', 'pump_broken', 'no_doctor',
    'no_medicine', 'centre_closed', 'pothole', 'light_out', 'work_missing', 'no_signboard'));

create or replace function public.kasa_create_report(p_category text, p_severity text, p_lat double precision, p_lng double precision, p_accuracy double precision, p_ward_no integer, p_description text, p_landmark text, p_photo_path text, p_client_id text default null::text, p_boundary_type text default null::text, p_waste_type text default null::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  me        kasa_private.profiles := kasa_private.me();
  v_bbox    jsonb := kasa_private.cfg('bbox');
  v_chk     kasa_private.photo_checks;
  v_meta    jsonb;
  v_existing public.reports;
  v_parent  public.reports;
  v_recur   public.reports;
  v_new     public.reports;
  v_mod     text := 'approved';
  v_url     text;
  v_loc     jsonb;
begin
  if p_client_id is not null then
    select * into v_existing from public.reports where user_id = me.user_id and client_id = p_client_id;
    if found then
      return jsonb_build_object('id', v_existing.id, 'moderation_status', v_existing.moderation_status, 'replayed', true);
    end if;
  end if;

  -- The quick report has no category step: the optional "What's the problem?" pick (kept in
  -- the old waste_type column) says which category it is. The five garbage kinds only file an
  -- uncategorised report as garbage; every other pick sets the category outright.
  if p_waste_type is not null and kasa_private.subtype_category(p_waste_type) is null then
    perform kasa_private.fail('KASA_BAD_WASTE_TYPE', 'Choose a problem from the list.');
  end if;
  if p_waste_type in ('household', 'construction', 'mixed', 'e_waste', 'biomedical') then
    if p_category is null or p_category = 'other' then
      p_category := 'garbage';
    end if;
    if p_category not in ('garbage', 'dumpsite') then
      p_waste_type := null;
    end if;
  elsif p_waste_type is not null then
    p_category := kasa_private.subtype_category(p_waste_type);
  end if;
  if p_category is null then
    p_category := 'other';
  end if;
  if p_category not in ('garbage', 'drain', 'road', 'streetlight', 'water', 'missing',
      'encroachment', 'illegal_construction', 'illegal_mining', 'illegal_other', 'other',
      'hand_pump', 'anganwadi', 'health_centre', 'school', 'dumpsite', 'toilet', 'rural_jobs') then
    perform kasa_private.fail('KASA_BAD_CATEGORY', 'Choose what kind of problem this is.');
  end if;
  if p_severity is null then
    p_severity := 'minor';
  elsif p_severity not in ('minor', 'severe', 'critical') then
    perform kasa_private.fail('KASA_BAD_SEVERITY', 'Choose a severity.');
  end if;
  if p_ward_no is not null and p_ward_no not between 1 and 23 then
    perform kasa_private.fail('KASA_BAD_WARD', 'Ward must be between 1 and 23.');
  end if;
  v_loc := kasa_private.locate_any(p_lat, p_lng, p_ward_no);
  if v_loc is null then
    perform kasa_private.fail('KASA_OUTSIDE_AREA', 'This location is outside the areas Parishkar covers.');
  end if;
  p_ward_no := case when v_loc ->> 'kind' = 'town' then (v_loc ->> 'ward')::integer end;
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
  v_meta := kasa_private.photo_meta_verdict(p_photo_path, false, p_lat, p_lng, null);
  v_url := (kasa_private.cfg('storage_public_base') #>> '{}') || p_photo_path;

  if p_category in (select jsonb_array_elements_text(kasa_private.cfg('review_categories')))
     or coalesce(v_chk.face_count, 0) > 0 or coalesce((v_meta ->> 'ai_edited')::boolean, false)
     or (kasa_private.cfg_bool('require_live_report_photo') and coalesce(v_meta ->> 'capture', 'unknown') <> 'live') then
    v_mod := 'review';
  elsif v_meta ? 'flag' then
    v_mod := 'flagged';
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
      moderation_labels, category, landmark, user_id, client_id, accuracy_m, photo_path, boundary_type, waste_type)
  values (p_lat, p_lng, p_ward_no, p_severity, nullif(trim(p_description), ''), null,
      substr(md5(me.user_id::text || (kasa_private.cfg('ip_salt') #>> '{}')), 1, 16), v_url,
      'open', 0, 0, kasa_private.sla_days_for(p_severity), coalesce(v_parent.id, v_recur.id), v_parent.id is not null,
      'synced', v_mod,
      jsonb_build_object('photo', v_meta) ||
      case when v_chk.photo_path is null then '{}'::jsonb
           else jsonb_build_object('garbage_score', v_chk.garbage_score, 'labels', v_chk.labels) end,
      p_category, nullif(trim(p_landmark), ''), me.user_id, p_client_id, p_accuracy, p_photo_path, p_boundary_type, p_waste_type)
  returning * into v_new;

  perform kasa_private.add_event(v_new.id::text, 'reported', me.user_id, null, v_url, null,
    jsonb_build_object('gps', p_accuracy is not null, 'accuracy_m', round(p_accuracy::numeric)) || v_meta);

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

  return jsonb_build_object('id', v_new.id, 'moderation_status', v_new.moderation_status,
    'duplicate_of', v_parent.id, 'recurrence_of', v_recur.id);
end $function$;

commit;
