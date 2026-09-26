-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — the official school list, for school-audit coverage
--
-- public.schools holds the district's UDISE+ school list (code, name,
-- location when known, block, panchayat, village), loaded by tools/load-schools.py from the
-- spreadsheet the district education office keeps. It is public
-- information. kasa_school_coverage() gives, for every school, how many
-- visible audits were filed within school_match_m of it and when the latest
-- was, so a page can show which schools nobody has checked yet.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

create table if not exists public.schools (
  udise_code  text primary key check (udise_code ~ '^[0-9]{11}$'),
  name        text not null,
  lat         double precision not null,
  lng         double precision not null,
  block_name  text,
  management  text,
  category    text,
  updated_at  timestamptz not null default now()
);
-- The district's list gives block, panchayat and village but often no coordinates.
alter table public.schools alter column lat drop not null, alter column lng drop not null;
alter table public.schools add column if not exists panchayat text, add column if not exists village text;
create index if not exists kasa_schools_lat_idx on public.schools (lat, lng);
alter table public.schools enable row level security;
drop policy if exists kasa_schools_public_read on public.schools;
create policy kasa_schools_public_read on public.schools for select using (true);
revoke insert, update, delete, truncate on public.schools from anon, authenticated;
grant select on public.schools to anon, authenticated;

insert into kasa_private.settings (key, value, note) values
  ('school_match_m', '150', 'An audit counts for a listed school when filed within this many metres of it')
on conflict (key) do nothing;

drop function if exists public.kasa_school_coverage();
create or replace function public.kasa_school_coverage() returns table (
  udise_code text, name text, lat double precision, lng double precision, block_name text, panchayat text, village text,
  management text, category text, audits integer, last_audit_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select s.udise_code, s.name, s.lat, s.lng, s.block_name, s.panchayat, s.village, s.management, s.category,
         count(a.id)::integer, date_trunc('hour', max(a.created_at))
  from public.schools s
  left join public.school_audits a
    on a.moderation_status in ('approved', 'flagged')
   and a.lat between s.lat - 0.002 and s.lat + 0.002
   and a.lng between s.lng - 0.002 and s.lng + 0.002
   and kasa_private.distance_m(a.lat, a.lng, s.lat, s.lng) <= kasa_private.cfg_num('school_match_m')
  group by s.udise_code
  order by s.block_name nulls last, s.name
$$;
revoke all on function public.kasa_school_coverage() from public;
grant execute on function public.kasa_school_coverage() to anon, authenticated;

commit;

notify pgrst, 'reload schema';
