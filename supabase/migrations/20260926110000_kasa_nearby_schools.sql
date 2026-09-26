-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — "schools near me" for the school check (like UTS stations)
--
-- Most listed schools have no coordinates. Each approved check of a school
-- teaches us where it is: schools.seen_lat/lng is the average position of its
-- visible checks (only used when the official location is missing). Then
-- kasa_nearby_schools(lat, lng) returns the caller's block and the schools
-- with a known or learned location within nearby_school_m, nearest first.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

alter table public.schools
  add column if not exists seen_lat double precision,
  add column if not exists seen_lng double precision,
  add column if not exists seen_checks integer not null default 0;

insert into kasa_private.settings (key, value, note) values
  ('nearby_school_m', '3000', 'How far the school check looks for schools near the person')
on conflict (key) do nothing;

create or replace function kasa_private.learn_school_location(p_code text) returns void
language sql security definer set search_path = '' as $$
  update public.schools s
  set seen_lat = x.lat, seen_lng = x.lng, seen_checks = x.n
  from (select avg(a.lat) as lat, avg(a.lng) as lng, count(*)::integer as n
        from public.school_audits a
        where a.udise_code = p_code and a.moderation_status in ('approved', 'flagged')) x
  where s.udise_code = p_code
$$;

create or replace function kasa_private.school_audit_learn() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.udise_code is not null then perform kasa_private.learn_school_location(new.udise_code); end if;
  if tg_op = 'UPDATE' and old.udise_code is not null and old.udise_code is distinct from new.udise_code then
    perform kasa_private.learn_school_location(old.udise_code);
  end if;
  return null;
end $$;
drop trigger if exists kasa_school_audit_learn on public.school_audits;
create trigger kasa_school_audit_learn after insert or update of moderation_status, udise_code on public.school_audits
  for each row execute function kasa_private.school_audit_learn();

-- Backfill from checks already filed.
select kasa_private.learn_school_location(c) from (select distinct udise_code c from public.school_audits where udise_code is not null) t;

create or replace function public.kasa_nearby_schools(p_lat double precision, p_lng double precision) returns jsonb
language sql stable security definer set search_path = '' as $$
  with here as (select kasa_private.locate(p_lat, p_lng, null) as loc),
  near as (
    select s.udise_code, s.name, s.block_name, s.panchayat, s.village,
           s.lat is null as learned,
           kasa_private.distance_m(p_lat, p_lng, coalesce(s.lat, s.seen_lat), coalesce(s.lng, s.seen_lng)) as d
    from public.schools s
    where coalesce(s.lat, s.seen_lat) between p_lat - 0.03 and p_lat + 0.03
      and coalesce(s.lng, s.seen_lng) between p_lng - 0.033 and p_lng + 0.033
  )
  select jsonb_build_object(
    'block', (select loc ->> 'block' from here),
    'area', (select loc ->> 'kind' from here),
    'near', coalesce((select jsonb_agg(jsonb_build_object('udise_code', udise_code, 'name', name, 'block_name', block_name,
                        'panchayat', panchayat, 'village', village, 'distance_m', round(d)::integer, 'learned', learned) order by d)
                      from (select * from near where d <= kasa_private.cfg_num('nearby_school_m') order by d limit 12) n), '[]'::jsonb))
$$;

revoke all on function kasa_private.learn_school_location(text) from public, anon, authenticated;
revoke all on function kasa_private.school_audit_learn() from public, anon, authenticated;
revoke all on function public.kasa_nearby_schools(double precision, double precision) from public;
grant execute on function public.kasa_nearby_schools(double precision, double precision) to anon, authenticated;

commit;

notify pgrst, 'reload schema';
