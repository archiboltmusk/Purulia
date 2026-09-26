-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — school checks tied to the official school list
--
-- kasa_school_check() files an audit for one listed school (by UDISE code):
-- it runs every check kasa_create_school_audit does (photo, location inside
-- the district, rate limits, moderation), then records the school's code and
-- two more answers (electricity, mid-day meal kitchen). Because most listed
-- schools have no coordinates, an audit filed from a different block than
-- the school's goes to moderator review, and so does one filed more than
-- school_far_m from a school whose location is known.
--
-- kasa_school_checks(code) lists a school's visible audits;
-- kasa_school_coverage() now matches audits by code (or distance) and gives
-- each school's latest answers and a 0–6 score.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

alter table public.school_audits
  add column if not exists udise_code text references public.schools(udise_code) on delete set null,
  add column if not exists electricity_ok boolean,
  add column if not exists mdm_ok boolean;
create index if not exists kasa_school_audits_udise_idx on public.school_audits (udise_code, created_at desc);

insert into kasa_private.settings (key, value, note) values
  ('school_far_m', '500', 'A school check filed farther than this from a school with a known location goes to review')
on conflict (key) do nothing;

-- "PURULIA-I", "Purulia I" and "purulia 1" are the same block.
create or replace function kasa_private.block_key(p text) returns text
language sql immutable as $$
  select replace(replace(regexp_replace(upper(coalesce(p, '')), '[^A-Z0-9]', '', 'g'), 'II', '2'), 'I', '1')
$$;

create or replace function public.kasa_school_check(p_udise_code text, p_lat double precision, p_lng double precision,
    p_accuracy double precision, p_water_ok boolean, p_toilets_ok boolean, p_boundary_ok boolean,
    p_electricity_ok boolean, p_mdm_ok boolean, p_building_condition text, p_photo_path text, p_client_id text default null)
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
      moderation_status = case when v_hold is not null and moderation_status = 'approved' then 'review' else moderation_status end,
      moderation_labels = case when v_hold is null then moderation_labels
                               else coalesce(moderation_labels, '{}'::jsonb) || jsonb_build_object('hold', v_hold) end
  where id = a.id returning * into a;

  return jsonb_build_object('id', a.id, 'moderation_status', a.moderation_status, 'school', s.name, 'hold', v_hold);
end $$;

-- A school's visible checks, newest first.
create or replace function public.kasa_school_checks(p_udise_code text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id, 'created_at', date_trunc('hour', a.created_at), 'photo_url', a.photo_url,
           'water_ok', a.water_ok, 'toilets_ok', a.toilets_ok, 'boundary_ok', a.boundary_ok,
           'electricity_ok', a.electricity_ok, 'mdm_ok', a.mdm_ok, 'building_condition', a.building_condition,
           'flags', coalesce(a.flags, 0)) order by a.created_at desc), '[]'::jsonb)
  from public.school_audits a
  where a.udise_code = p_udise_code and a.moderation_status in ('approved', 'flagged')
$$;

-- Block names for the school picker, with how many listed schools each has.
create or replace function public.kasa_school_blocks() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('block', b, 'schools', n) order by b), '[]'::jsonb)
  from (select block_name as b, count(*) as n from public.schools where block_name is not null group by block_name) x
$$;
revoke all on function public.kasa_school_blocks() from public;
grant execute on function public.kasa_school_blocks() to anon, authenticated;

drop function if exists public.kasa_school_coverage();
create or replace function public.kasa_school_coverage() returns table (
  udise_code text, name text, lat double precision, lng double precision, block_name text, panchayat text, village text,
  management text, category text, audits integer, last_audit_at timestamptz,
  water_ok boolean, toilets_ok boolean, boundary_ok boolean, electricity_ok boolean, mdm_ok boolean,
  building_condition text, photo_url text, score integer, score_of integer)
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
  select s.udise_code, s.name, s.lat, s.lng, s.block_name, s.panchayat, s.village, s.management, s.category,
         coalesce(c.n, 0), date_trunc('hour', c.last_at),
         l.water_ok, l.toilets_ok, l.boundary_ok, l.electricity_ok, l.mdm_ok, l.building_condition, l.photo_url,
         case when l.id is null then null else
           (l.water_ok::int + l.toilets_ok::int + l.boundary_ok::int + coalesce(l.electricity_ok::int, 0)
            + coalesce(l.mdm_ok::int, 0) + (l.building_condition = 'good')::int) end,
         case when l.id is null then null else
           4 + (l.electricity_ok is not null)::int + (l.mdm_ok is not null)::int end
  from public.schools s
  left join counts c on c.code = s.udise_code
  left join latest l on l.code = s.udise_code
  order by s.block_name nulls last, s.name
$$;

-- Moderation queue now carries the school code, the two new answers and why it was held.
create or replace function public.kasa_admin_school_audit_queue() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id, 'created_at', a.created_at, 'school_name', a.school_name, 'udise_code', a.udise_code, 'ward_no', a.ward_no,
      'block_name', a.block_name, 'photo_url', a.photo_url, 'water_ok', a.water_ok, 'toilets_ok', a.toilets_ok,
      'boundary_ok', a.boundary_ok, 'electricity_ok', a.electricity_ok, 'mdm_ok', a.mdm_ok,
      'building_condition', a.building_condition, 'moderation_status', a.moderation_status,
      'hold', a.moderation_labels ->> 'hold', 'flags', a.flags) order by a.created_at)
    from public.school_audits a where a.moderation_status in ('review', 'flagged')
  ), '[]'::jsonb);
end $$;

revoke all on function public.kasa_school_check(text, double precision, double precision, double precision, boolean, boolean,
  boolean, boolean, boolean, text, text, text) from public, anon;
grant execute on function public.kasa_school_check(text, double precision, double precision, double precision, boolean, boolean,
  boolean, boolean, boolean, text, text, text) to authenticated;
revoke all on function public.kasa_school_checks(text) from public;
grant execute on function public.kasa_school_checks(text) to anon, authenticated;
revoke all on function public.kasa_school_coverage() from public;
grant execute on function public.kasa_school_coverage() to anon, authenticated;
revoke all on function kasa_private.block_key(text) from public, anon, authenticated;

commit;

notify pgrst, 'reload schema';
