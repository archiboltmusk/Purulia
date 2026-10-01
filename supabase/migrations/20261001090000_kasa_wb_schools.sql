-- ════════════════════════════════════════════════════════════════════════
-- PARISHKAR BENGAL — every West Bengal district's school list
--
-- public.schools.district is the district slug (as in places/wb_district_facts.json),
-- read from the UDISE code's district digits (19 = West Bengal, then 14 = Purulia,
-- 13 = Bankura…; 21, Siliguri's education district, is Darjeeling). Purulia's list
-- is already in; the other districts are loaded from the UDISE+ school list on India Data Portal with
-- tools/load-wb-schools.sql. kasa_school_coverage(p_district) returns one
-- district's schools; with no argument it returns all of them, as before.
-- A school check is now accepted anywhere in West Bengal, not only in Purulia
-- (a check far from the school's listed location still waits for a moderator),
-- and the check's block list and nearby schools follow the district.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

alter table public.schools add column if not exists district text;

create or replace function kasa_private.udise_district(p_code text) returns text
language sql immutable set search_path = '' as $$
  select case when p_code like '19%' then case substr(p_code, 3, 2)
    when '01' then 'darjeeling' when '02' then 'jalpaiguri' when '03' then 'cooch-behar' when '04' then 'uttar-dinajpur'
    when '05' then 'dakshin-dinajpur' when '06' then 'malda' when '07' then 'murshidabad' when '08' then 'birbhum'
    when '10' then 'nadia' when '11' then 'north-24-parganas' when '12' then 'hooghly' when '13' then 'bankura'
    when '14' then 'purulia' when '16' then 'howrah' when '17' then 'kolkata' when '18' then 'south-24-parganas'
    when '19' then 'purba-medinipur' when '20' then 'paschim-medinipur' when '21' then 'darjeeling'
    when '22' then 'alipurduar' when '23' then 'jhargram' when '24' then 'kalimpong'
    when '25' then 'purba-bardhaman' when '26' then 'paschim-bardhaman' end end
$$;

-- Schools added later (by residents, or a moderator) get theirs the same way.
create or replace function kasa_private.schools_set_district() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.district is null then new.district := kasa_private.udise_district(new.udise_code); end if;
  return new;
end $$;
drop trigger if exists schools_set_district on public.schools;
create trigger schools_set_district before insert or update on public.schools
  for each row execute function kasa_private.schools_set_district();

update public.schools set district = kasa_private.udise_district(udise_code) where district is null;
create index if not exists schools_district_idx on public.schools (district);

drop function if exists public.kasa_school_coverage();
drop function if exists public.kasa_school_coverage(text);
create or replace function public.kasa_school_coverage(p_district text default null) returns table (
  udise_code text, name text, lat double precision, lng double precision, block_name text, panchayat text, village text,
  management text, category text, audits integer, last_audit_at timestamptz,
  water_ok boolean, toilets_ok boolean, boundary_ok boolean, electricity_ok boolean, mdm_ok boolean,
  building_condition text, photo_url text, score integer, score_of integer, located text,
  girls_toilet_ok boolean, meal_today_ok boolean, teachers_seen smallint, official jsonb, official_year text)
language sql stable security definer set search_path = '' as $$
  with vis as (
    select a.*, coalesce(a.udise_code, (
             select s2.udise_code from public.schools s2
             where s2.lat is not null and a.lat between s2.lat - 0.002 and s2.lat + 0.002
               and a.lng between s2.lng - 0.002 and s2.lng + 0.002
               and kasa_private.distance_m(a.lat, a.lng, s2.lat, s2.lng) <= kasa_private.cfg_num('school_match_m')
             order by kasa_private.distance_m(a.lat, a.lng, s2.lat, s2.lng) limit 1)) as code
    from public.school_audits a
    where a.moderation_status in ('approved', 'flagged')
  ), counts as (
    select code, count(*)::integer as n, max(created_at) as last_at from vis where code is not null group by code
  ), latest as (
    select distinct on (code) * from vis where code is not null order by code, created_at desc
  )
  select s.udise_code, s.name, coalesce(s.lat, s.seen_lat), coalesce(s.lng, s.seen_lng), s.block_name, s.panchayat, s.village, s.management, s.category,
         coalesce(c.n, 0), date_trunc('hour', c.last_at),
         l.water_ok, l.toilets_ok, l.boundary_ok, l.electricity_ok, l.mdm_ok, l.building_condition, l.photo_url,
         case when l.id is null then null else
           (l.water_ok::int + l.toilets_ok::int + l.boundary_ok::int + coalesce(l.electricity_ok::int, 0)
            + coalesce(l.mdm_ok::int, 0) + (l.building_condition = 'good')::int
            + coalesce(l.girls_toilet_ok::int, 0) + coalesce(l.meal_today_ok::int, 0)) end,
         case when l.id is null then null else
           4 + (l.electricity_ok is not null)::int + (l.mdm_ok is not null)::int
             + (l.girls_toilet_ok is not null)::int + (l.meal_today_ok is not null)::int end,
         case when s.lat is not null then 'official' when s.seen_lat is not null then 'checks' end,
         l.girls_toilet_ok, l.meal_today_ok, l.teachers_seen, s.official, s.official_year
  from public.schools s
  left join counts c on c.code = s.udise_code
  left join latest l on l.code = s.udise_code
  where p_district is null or s.district = p_district
  order by s.block_name nulls last, s.name
$$;
create or replace function public.kasa_create_school_audit(p_school_name text, p_lat double precision, p_lng double precision,
    p_accuracy double precision, p_ward_no integer, p_water_ok boolean, p_toilets_ok boolean, p_boundary_ok boolean,
    p_building_condition text, p_photo_path text, p_client_id text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me      kasa_private.profiles := kasa_private.me();
  v_chk   kasa_private.photo_checks;
  v_meta  jsonb;
  v_loc   jsonb;
  v_url   text;
  v_mod   text := 'approved';
  v_existing public.school_audits;
  v_new   public.school_audits;
begin
  if p_client_id is not null then
    select * into v_existing from public.school_audits where user_id = me.user_id and client_id = p_client_id;
    if found then
      return jsonb_build_object('id', v_existing.id, 'moderation_status', v_existing.moderation_status, 'replayed', true);
    end if;
  end if;

  if length(trim(coalesce(p_school_name, ''))) < 3 or length(p_school_name) > 140 then
    perform kasa_private.fail('KASA_BAD_SCHOOL_NAME', 'Enter the school''s name.');
  end if;
  if p_water_ok is null or p_toilets_ok is null or p_boundary_ok is null then
    perform kasa_private.fail('KASA_INCOMPLETE_AUDIT', 'Answer every checklist question.');
  end if;
  if p_building_condition not in ('good', 'needs_repair', 'unsafe') then
    perform kasa_private.fail('KASA_BAD_CONDITION', 'Choose the building condition.');
  end if;
  if p_ward_no is not null and p_ward_no not between 1 and 23 then
    perform kasa_private.fail('KASA_BAD_WARD', 'Ward must be between 1 and 23.');
  end if;
  -- Purulia gives the block and ward; anywhere else in West Bengal, the town or district.
  v_loc := kasa_private.locate_any(p_lat, p_lng, p_ward_no);
  if v_loc is null then
    perform kasa_private.fail('KASA_OUTSIDE_AREA', 'This location is outside West Bengal.');
  end if;
  p_ward_no := case when v_loc ->> 'kind' = 'town' then (v_loc ->> 'ward')::integer end;

  if (select count(*) from public.school_audits where user_id = me.user_id and created_at > now() - interval '1 hour')
       >= kasa_private.cfg_num('school_audits_per_hour')
  or (select count(*) from public.school_audits where user_id = me.user_id and created_at > now() - interval '1 day')
       >= kasa_private.cfg_num('school_audits_per_day') then
    perform kasa_private.fail('KASA_RATE_LIMIT', 'You have filed a lot of audits. Try again later.');
  end if;

  v_chk := kasa_private.check_photo(p_photo_path, 'reports', me.user_id, null, p_lat, p_lng);
  v_meta := kasa_private.photo_meta_verdict(p_photo_path, false, p_lat, p_lng, null);
  v_url := (kasa_private.cfg('storage_public_base') #>> '{}') || p_photo_path;

  if coalesce(v_chk.face_count, 0) > 0 or coalesce((v_meta ->> 'ai_edited')::boolean, false)
     or (kasa_private.cfg_bool('require_live_report_photo') and coalesce(v_meta ->> 'capture', 'unknown') <> 'live') then
    v_mod := 'review';
  elsif v_meta ? 'flag' then
    v_mod := 'flagged';
  end if;

  insert into public.school_audits (user_id, client_id, school_name, lat, lng, accuracy_m, ward_no, area_kind, block_name,
      photo_path, photo_url, water_ok, toilets_ok, boundary_ok, building_condition, moderation_status, moderation_labels)
  values (me.user_id, p_client_id, trim(p_school_name), p_lat, p_lng, p_accuracy, p_ward_no,
      v_loc ->> 'kind', v_loc ->> 'block', p_photo_path, v_url, p_water_ok, p_toilets_ok, p_boundary_ok, p_building_condition,
      v_mod, jsonb_build_object('photo', v_meta) ||
      case when v_chk.photo_path is null then '{}'::jsonb else jsonb_build_object('labels', v_chk.labels) end)
  returning * into v_new;

  return jsonb_build_object('id', v_new.id, 'moderation_status', v_new.moderation_status);
end $$;

revoke all on function public.kasa_school_coverage(text) from public;
grant execute on function public.kasa_school_coverage(text) to anon, authenticated;

-- One district's blocks for the school check's block list.
drop function if exists public.kasa_school_blocks();
create or replace function public.kasa_school_blocks(p_district text default null) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('block', b, 'schools', n) order by b), '[]'::jsonb)
  from (select block_name as b, count(*) as n from public.schools
        where block_name is not null and (p_district is null or district = p_district) group by block_name) x
$$;
revoke all on function public.kasa_school_blocks(text) from public;
grant execute on function public.kasa_school_blocks(text) to anon, authenticated;

-- Schools near you, and which district (and, outside Purulia, block) the nearest one is in.
create or replace function public.kasa_nearby_schools(p_lat double precision, p_lng double precision) returns jsonb
language sql stable security definer set search_path = '' as $$
  with here as (select kasa_private.locate(p_lat, p_lng, null) as loc),
  near as (
    select s.udise_code, s.name, s.block_name, s.panchayat, s.village, s.district,
           s.lat is null as learned,
           kasa_private.distance_m(p_lat, p_lng, coalesce(s.lat, s.seen_lat), coalesce(s.lng, s.seen_lng)) as d
    from public.schools s
    where coalesce(s.lat, s.seen_lat) between p_lat - 0.03 and p_lat + 0.03
      and coalesce(s.lng, s.seen_lng) between p_lng - 0.033 and p_lng + 0.033
  ), nearest as (select * from near order by d limit 1)
  select jsonb_build_object(
    'block', coalesce((select loc ->> 'block' from here), (select block_name from nearest)),
    'area', (select loc ->> 'kind' from here),
    'district', (select district from nearest),
    'near', coalesce((select jsonb_agg(jsonb_build_object('udise_code', udise_code, 'name', name, 'block_name', block_name,
                        'panchayat', panchayat, 'village', village, 'distance_m', round(d)::integer, 'learned', learned) order by d)
                      from (select * from near where d <= kasa_private.cfg_num('nearby_school_m') order by d limit 12) n), '[]'::jsonb))
$$;
revoke all on function public.kasa_nearby_schools(double precision, double precision) from public;
grant execute on function public.kasa_nearby_schools(double precision, double precision) to anon, authenticated;

commit;

notify pgrst, 'reload schema';
