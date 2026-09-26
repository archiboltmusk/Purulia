-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — a school's pin comes from people standing at it, and can be fixed
--
-- A school with no official location is placed by the people who stand at it:
-- every visible school check, plus every "the school is here" mark
-- (kasa_mark_school_location), is a position. The pin is the median of the
-- school_pin_points most recent positions, so one wrong or mischievous mark
-- can't drag it away, but a few people agreeing on the right spot move it.
-- A mark needs a good GPS fix inside the school's block, and counts once per
-- person per school per day.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

create table if not exists kasa_private.school_location_marks (
  id          bigint generated always as identity primary key,
  udise_code  text not null references public.schools(udise_code) on delete cascade,
  user_id     uuid not null,
  lat         double precision not null,
  lng         double precision not null,
  accuracy_m  double precision,
  ip_hash     text,
  created_at  timestamptz not null default now()
);
create index if not exists kasa_school_location_marks_code_idx on kasa_private.school_location_marks (udise_code, created_at desc);
alter table kasa_private.school_location_marks enable row level security;
revoke all on kasa_private.school_location_marks from public, anon, authenticated;

insert into kasa_private.settings (key, value, note) values
  ('school_pin_points', '5', 'A school''s pin is the median of this many most recent on-site positions (checks and "school is here" marks)')
on conflict (key) do nothing;

create or replace function kasa_private.learn_school_location(p_code text) returns void
language sql security definer set search_path = '' as $$
  with pts as (
    select lat, lng, created_at from public.school_audits
    where udise_code = p_code and moderation_status in ('approved', 'flagged')
    union all
    select lat, lng, created_at from kasa_private.school_location_marks where udise_code = p_code
  ), recent as (
    select * from pts order by created_at desc
    limit greatest(1, kasa_private.cfg_num('school_pin_points')::integer)
  ), agg as (
    select percentile_cont(0.5) within group (order by lat) as lat,
           percentile_cont(0.5) within group (order by lng) as lng,
           (select count(*) from pts)::integer as n
    from recent
  )
  update public.schools s
  set seen_lat = agg.lat, seen_lng = agg.lng, seen_checks = agg.n
  from agg
  where s.udise_code = p_code
$$;

create or replace function public.kasa_mark_school_location(p_udise_code text, p_lat double precision, p_lng double precision,
    p_accuracy double precision) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me    kasa_private.profiles := kasa_private.me();
  s     public.schools;
  v_loc jsonb;
begin
  select * into s from public.schools where udise_code = p_udise_code;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'Choose a school from the list.'); end if;
  if p_accuracy is null or p_accuracy > kasa_private.cfg_num('max_gps_accuracy_m') then
    perform kasa_private.fail('KASA_GPS_WEAK', 'Your location isn''t precise enough yet. Wait a moment outdoors and try again.',
      jsonb_build_object('accuracy_m', round(coalesce(p_accuracy, 0)::numeric)));
  end if;
  v_loc := kasa_private.locate(p_lat, p_lng, null);
  if v_loc is null then perform kasa_private.fail('KASA_OUTSIDE_AREA', 'This location is outside Purulia district.'); end if;
  if s.block_name is not null and v_loc ->> 'block' is not null
     and kasa_private.block_key(s.block_name) <> kasa_private.block_key(v_loc ->> 'block') then
    perform kasa_private.fail('KASA_OTHER_BLOCK', 'You are in a different block from this school. Stand at the school and try again.');
  end if;
  if exists (select 1 from kasa_private.school_location_marks m
             where m.udise_code = s.udise_code and m.user_id = me.user_id and m.created_at > now() - interval '1 day') then
    perform kasa_private.fail('KASA_ALREADY_MARKED', 'You already placed this school today.');
  end if;
  perform kasa_private.rate_limit_actions(me.user_id);

  insert into kasa_private.school_location_marks (udise_code, user_id, lat, lng, accuracy_m, ip_hash)
  values (s.udise_code, me.user_id, p_lat, p_lng, p_accuracy, kasa_private.ip_hash());
  perform kasa_private.learn_school_location(s.udise_code);
  select * into s from public.schools where udise_code = p_udise_code;
  return jsonb_build_object('udise_code', s.udise_code, 'lat', s.seen_lat, 'lng', s.seen_lng, 'points', s.seen_checks);
end $$;

revoke all on function public.kasa_mark_school_location(text, double precision, double precision, double precision) from public, anon;
grant execute on function public.kasa_mark_school_location(text, double precision, double precision, double precision) to authenticated;
revoke all on function kasa_private.learn_school_location(text) from public, anon, authenticated;

-- Recompute every placed school with the median rule.
select kasa_private.learn_school_location(c) from (select distinct udise_code c from public.school_audits where udise_code is not null) t;

commit;

notify pgrst, 'reload schema';
