-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — school map: coverage includes learned locations
--
-- kasa_school_coverage() now returns a school's official location, or else
-- the one learned from its checks (seen_lat/lng), and says which (located).
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

drop function if exists public.kasa_school_coverage();
create or replace function public.kasa_school_coverage() returns table (
  udise_code text, name text, lat double precision, lng double precision, block_name text, panchayat text, village text,
  management text, category text, audits integer, last_audit_at timestamptz,
  water_ok boolean, toilets_ok boolean, boundary_ok boolean, electricity_ok boolean, mdm_ok boolean,
  building_condition text, photo_url text, score integer, score_of integer, located text)
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
            + coalesce(l.mdm_ok::int, 0) + (l.building_condition = 'good')::int) end,
         case when l.id is null then null else
           4 + (l.electricity_ok is not null)::int + (l.mdm_ok is not null)::int end,
         case when s.lat is not null then 'official' when s.seen_lat is not null then 'checks' end
  from public.schools s
  left join counts c on c.code = s.udise_code
  left join latest l on l.code = s.udise_code
  order by s.block_name nulls last, s.name
$$;
revoke all on function public.kasa_school_coverage() from public;
grant execute on function public.kasa_school_coverage() to anon, authenticated;

commit;

notify pgrst, 'reload schema';
