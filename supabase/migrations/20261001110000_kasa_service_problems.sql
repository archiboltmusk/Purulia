-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — service problems: a dry tap, a broken hand pump, a health
-- centre with no doctor, no medicines, or shut in working hours
--
-- The report form's chips now include these. Each sets the category (water,
-- hand_pump, health_centre) and is kept in reports.waste_type, which holds the
-- report's sub-type. kasa_create_report body is the 20260928090000 one with
-- the new sub-types.
--
-- In Purulia district, village reports of a dry tap or a broken hand pump also
-- go in a weekly letter to the Executive Engineer, Public Health Engineering
-- (Civil), Purulia: ee_pur@wbphed.gov.in, District Disaster Management Plan
-- Purulia 2023-24, p.198.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

alter table public.reports drop constraint if exists reports_waste_type_check;
alter table public.reports add constraint reports_waste_type_check
  check (waste_type is null or waste_type in ('household', 'construction', 'mixed', 'e_waste', 'biomedical',
                                              'dry_tap', 'pump_broken', 'no_doctor', 'no_medicine', 'centre_closed'));

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

  -- Picking a waste type says "this is garbage", and picking a service problem says which
  -- service: the quick report has no category step, so without it the report would start as
  -- 'other' and wait for auto-categorise. The column keeps its old name, waste_type.
  if p_waste_type is not null and p_waste_type not in ('household', 'construction', 'mixed', 'e_waste', 'biomedical',
      'dry_tap', 'pump_broken', 'no_doctor', 'no_medicine', 'centre_closed') then
    perform kasa_private.fail('KASA_BAD_WASTE_TYPE', 'Choose a waste type from the list.');
  end if;
  if p_waste_type in ('dry_tap', 'pump_broken', 'no_doctor', 'no_medicine', 'centre_closed') then
    p_category := case p_waste_type when 'dry_tap' then 'water' when 'pump_broken' then 'hand_pump' else 'health_centre' end;
  elsif p_waste_type is not null and (p_category is null or p_category = 'other') then
    p_category := 'garbage';
  end if;
  if p_category is null then
    p_category := 'other';
  end if;
  if not (p_category in ('garbage', 'dumpsite') and p_waste_type in ('household', 'construction', 'mixed', 'e_waste', 'biomedical')
       or p_category = 'water' and p_waste_type = 'dry_tap'
       or p_category = 'hand_pump' and p_waste_type = 'pump_broken'
       or p_category = 'health_centre' and p_waste_type in ('no_doctor', 'no_medicine', 'centre_closed')) then
    p_waste_type := null;
  end if;
  if p_category not in ('garbage', 'drain', 'road', 'streetlight', 'water', 'missing',
      'encroachment', 'illegal_construction', 'illegal_mining', 'illegal_other', 'other',
      'hand_pump', 'anganwadi', 'health_centre', 'school', 'dumpsite', 'toilet') then
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

insert into kasa_private.office_contacts (office, title, addressee, emails, source)
values ('phed', 'Executive Engineer, PHE (Civil), Purulia', 'The Executive Engineer, Public Health Engineering (Civil), Purulia',
        array['ee_pur@wbphed.gov.in'],
        'http://wbdmd.gov.in/writereaddata/uploaded/DP/DPPurulia59822.pdf (DDMP Purulia 2023-24, p.198)')
on conflict (office) do update set title = excluded.title, addressee = excluded.addressee,
  emails = excluded.emails, source = excluded.source;

create or replace function public.kasa_office_letters_claim() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_week date := date_trunc('week', now() at time zone 'Asia/Kolkata')::date;
  v_out jsonb;
begin
  with base as (
    select r.id, r.created_at, r.ward_no, r.category, r.landmark, r.sla_days, r.waste_type, r.block_name,
           r.area_kind = 'rural' and r.place is null and r.waste_type in ('dry_tap', 'pump_broken') as phed,
           -- Jhalda and Raghunathpur towns have no email on file and aren't the BDO's to fix.
           case when r.ward_no is not null then 'municipality'
                when r.boundary_type = 'municipality' then null else r.block_name end as office
    from public.kasa_public_reports r
    where r.status <> 'resolved' and not coalesce(r.is_duplicate, false)
  ), open_r as (
    select b.id, b.created_at, b.ward_no, b.category, b.landmark, b.sla_days, b.waste_type, b.block_name, b.office, null::text as via from base b
    union all
    -- Village taps and hand pumps in Purulia district: the PHE engineer too.
    select b.id, b.created_at, b.ward_no, b.category, b.landmark, b.sla_days, b.waste_type, b.block_name, 'phed', null from base b where b.phed
    union all
    -- The next step up: 14 days past the deadline, the DM gets it too.
    select b.id, b.created_at, b.ward_no, b.category, b.landmark, b.sla_days, b.waste_type, b.block_name, 'dm',
           (select c.title from kasa_private.office_contacts c where c.office = b.office)
    from base b
    where b.office is not null
      and b.created_at < now() - make_interval(days => coalesce(b.sla_days, 7) + 14)
  ), due as (
    select c.office from kasa_private.office_contacts c
    where exists (select 1 from open_r o where o.office = c.office)
      and not exists (select 1 from kasa_private.office_letter_log l
                      where l.office = c.office and l.week = v_week
                        and (l.sent_at is not null or l.claimed_at > now() - interval '30 minutes'))
  ), claimed as (
    insert into kasa_private.office_letter_log as l (office, week, claimed_at, report_count)
    select d.office, v_week, now(), (select count(*) from open_r o where o.office = d.office) from due d
    on conflict (office, week) do update set claimed_at = now(), error = null, report_count = excluded.report_count
      where l.sent_at is null and l.claimed_at <= now() - interval '30 minutes'
    returning l.office
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'office', c.office, 'title', c.title, 'addressee', c.addressee, 'emails', to_jsonb(c.emails),
           'reports', (select jsonb_agg(jsonb_build_object(
                          'id', o.id, 'created_at', o.created_at, 'ward_no', o.ward_no, 'category', o.category,
                          'landmark', o.landmark, 'sla_days', o.sla_days, 'via', o.via,
                          'kind', o.waste_type, 'block', o.block_name,
                          'councillor', (select w.councillor_name from public.wards w where w.ward_no = o.ward_no))
                        order by o.created_at)
                       from open_r o where o.office = c.office))), '[]'::jsonb)
  into v_out
  from claimed x join kasa_private.office_contacts c on c.office = x.office;

  return jsonb_build_object('week', v_week, 'offices', v_out,
    'reply_to', coalesce((select jsonb_agg(u.email) from public.admins a join auth.users u on u.id = a.user_id
                          where u.email is not null), '[]'::jsonb));
end $$;
revoke all on function public.kasa_office_letters_claim() from public, anon, authenticated;
grant execute on function public.kasa_office_letters_claim() to service_role;

commit;
