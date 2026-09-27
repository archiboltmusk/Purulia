-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — fuller school checks, and room for official school figures
--
-- A school check can now also say whether the girls' toilet is usable,
-- whether the mid-day meal was cooked today, and how many teachers the
-- resident saw teaching. The first two count toward the score when answered
-- ("can't tell" is left out, not counted as a failure); the teacher count is
-- shown beside the official number of teachers, not scored.
--
-- public.schools.official holds the school's own UDISE+ figures (enrolment,
-- teachers, classrooms, facilities) when tools/load-schools.py is given a
-- UDISE+ export that carries them; official_year says which year. The
-- schools page shows them next to what residents found.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

alter table public.school_audits
  add column if not exists girls_toilet_ok boolean,
  add column if not exists meal_today_ok boolean,
  add column if not exists teachers_seen smallint;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'kasa_school_audits_teachers_seen_ck') then
    alter table public.school_audits add constraint kasa_school_audits_teachers_seen_ck check (teachers_seen between 0 and 200);
  end if;
end $$;

alter table public.schools
  add column if not exists official jsonb,
  add column if not exists official_year text;

drop function if exists public.kasa_school_check(text, double precision, double precision, double precision, boolean, boolean,
  boolean, boolean, boolean, text, text, text);
create or replace function public.kasa_school_check(p_udise_code text, p_lat double precision, p_lng double precision,
    p_accuracy double precision, p_water_ok boolean, p_toilets_ok boolean, p_boundary_ok boolean,
    p_electricity_ok boolean, p_mdm_ok boolean, p_building_condition text, p_photo_path text, p_client_id text default null,
    p_girls_toilet_ok boolean default null, p_meal_today_ok boolean default null, p_teachers_seen integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s      public.schools;
  v_res  jsonb;
  a      public.school_audits;
  v_hold text;
begin
  select * into s from public.schools where udise_code = p_udise_code;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'Choose a school from the list.'); end if;
  if p_electricity_ok is null or p_mdm_ok is null then
    perform kasa_private.fail('KASA_INCOMPLETE_AUDIT', 'Answer every checklist question.');
  end if;
  if p_teachers_seen is not null and (p_teachers_seen < 0 or p_teachers_seen > 200) then
    perform kasa_private.fail('KASA_BAD_TEACHERS', 'Enter how many teachers you saw, from 0 to 200.');
  end if;

  v_res := public.kasa_create_school_audit(left(s.name, 140), p_lat, p_lng, p_accuracy, null, p_water_ok, p_toilets_ok,
                                           p_boundary_ok, p_building_condition, p_photo_path, p_client_id);
  select * into a from public.school_audits where id::text = v_res ->> 'id';
  if coalesce((v_res ->> 'replayed')::boolean, false) then return v_res; end if;

  if s.lat is not null and kasa_private.distance_m(p_lat, p_lng, s.lat, s.lng) > kasa_private.cfg_num('school_far_m') then
    v_hold := 'far_from_school';
  elsif s.block_name is not null and a.block_name is not null
        and kasa_private.block_key(s.block_name) <> kasa_private.block_key(a.block_name) then
    v_hold := 'other_block';
  end if;

  update public.school_audits
  set udise_code = s.udise_code, electricity_ok = p_electricity_ok, mdm_ok = p_mdm_ok,
      girls_toilet_ok = p_girls_toilet_ok, meal_today_ok = p_meal_today_ok, teachers_seen = p_teachers_seen,
      moderation_status = case when v_hold is not null and moderation_status = 'approved' then 'review' else moderation_status end,
      moderation_labels = case when v_hold is null then moderation_labels
                               else coalesce(moderation_labels, '{}'::jsonb) || jsonb_build_object('hold', v_hold) end
  where id = a.id returning * into a;

  return jsonb_build_object('id', a.id, 'moderation_status', a.moderation_status, 'school', s.name, 'hold', v_hold);
end $$;

create or replace function public.kasa_school_checks(p_udise_code text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id, 'created_at', date_trunc('hour', a.created_at), 'photo_url', a.photo_url,
           'water_ok', a.water_ok, 'toilets_ok', a.toilets_ok, 'boundary_ok', a.boundary_ok,
           'electricity_ok', a.electricity_ok, 'mdm_ok', a.mdm_ok, 'building_condition', a.building_condition,
           'girls_toilet_ok', a.girls_toilet_ok, 'meal_today_ok', a.meal_today_ok, 'teachers_seen', a.teachers_seen,
           'flags', coalesce(a.flags, 0)) order by a.created_at desc), '[]'::jsonb)
  from public.school_audits a
  where a.udise_code = p_udise_code and a.moderation_status in ('approved', 'flagged')
$$;

drop function if exists public.kasa_school_coverage();
create or replace function public.kasa_school_coverage() returns table (
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
  order by s.block_name nulls last, s.name
$$;

create or replace function public.kasa_admin_school_audit_queue() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id, 'created_at', a.created_at, 'school_name', a.school_name, 'udise_code', a.udise_code, 'ward_no', a.ward_no,
      'block_name', a.block_name, 'photo_url', a.photo_url, 'water_ok', a.water_ok, 'toilets_ok', a.toilets_ok,
      'boundary_ok', a.boundary_ok, 'electricity_ok', a.electricity_ok, 'mdm_ok', a.mdm_ok,
      'girls_toilet_ok', a.girls_toilet_ok, 'meal_today_ok', a.meal_today_ok, 'teachers_seen', a.teachers_seen,
      'building_condition', a.building_condition, 'moderation_status', a.moderation_status,
      'hold', a.moderation_labels ->> 'hold', 'flags', a.flags) order by a.created_at)
    from public.school_audits a where a.moderation_status in ('review', 'flagged')
  ), '[]'::jsonb);
end $$;

revoke all on function public.kasa_school_check(text, double precision, double precision, double precision, boolean, boolean,
  boolean, boolean, boolean, text, text, text, boolean, boolean, integer) from public, anon;
grant execute on function public.kasa_school_check(text, double precision, double precision, double precision, boolean, boolean,
  boolean, boolean, boolean, text, text, text, boolean, boolean, integer) to authenticated;
revoke all on function public.kasa_school_checks(text) from public;
grant execute on function public.kasa_school_checks(text) to anon, authenticated;
revoke all on function public.kasa_school_coverage() from public;
grant execute on function public.kasa_school_coverage() to anon, authenticated;

commit;

notify pgrst, 'reload schema';
