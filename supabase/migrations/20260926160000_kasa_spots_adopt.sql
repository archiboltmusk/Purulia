-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — spots that keep filling up, and spots people look after
--
-- kasa_problem_spots(days): public. Groups the visible reports of the last
-- `days` days into places (all reports within 50 m of the busiest report,
-- places at least 100 m apart) with at least problem_spot_min reports (duplicates count: each is someone who saw it).
-- It shows a place, never a person.
--
-- Adopting a spot: a shop, school, club or neighbour standing at a spot says
-- "we look after this". kasa_adopt_spot needs a good GPS fix inside the
-- district, a public name (3–60 characters), no other adoption within
-- adopt_radius_m, and at most adopt_max_per_user active spots per person.
-- kasa_adopted_spots() is public: each spot with its open problems within the
-- radius and the days since the last problem there. The adopter can let go
-- (kasa_leave_spot); a moderator can remove a bad name (kasa_admin_remove_adoption).
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

insert into kasa_private.settings (key, value, note) values
  ('problem_spot_min', '3', 'A place (reports within 50 m) is listed as a problem spot once it has this many reports in the period'),
  ('adopt_radius_m', '50', 'How far an adopted spot reaches, and how close two adopted spots may be'),
  ('adopt_max_per_user', '3', 'How many spots one person can look after at once')
on conflict (key) do nothing;

create or replace function public.kasa_problem_spots(p_days integer default 90) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_min   integer := kasa_private.cfg_num('problem_spot_min')::integer;
  v_since timestamptz := now() - make_interval(days => greatest(7, least(coalesce(p_days, 90), 365)));
  v_out   jsonb := '[]'::jsonb;
  v_taken double precision[][] := '{}';
  c       record;
  v_skip  boolean;
  i       integer;
begin
  -- Each report is a candidate centre; the busiest centres win, and a centre within
  -- 100 m of one already listed is the same place, so it is skipped.
  for c in
    with r as (
      select * from public.reports
      where moderation_status in ('approved', 'flagged') and created_at > v_since
    )
    select a.lat, a.lng, count(*)::integer as n, max(b.created_at) as last_at
    from r a join r b
      on b.lat between a.lat - 0.00046 and a.lat + 0.00046 and b.lng between a.lng - 0.0005 and a.lng + 0.0005
     and kasa_private.distance_m(a.lat, a.lng, b.lat, b.lng) <= 50
    group by a.id, a.lat, a.lng
    having count(*) >= v_min
    order by count(*) desc, max(b.created_at) desc
  loop
    v_skip := false;
    for i in 1 .. coalesce(array_length(v_taken, 1), 0) loop
      if kasa_private.distance_m(v_taken[i][1], v_taken[i][2], c.lat, c.lng) <= 100 then v_skip := true; exit; end if;
    end loop;
    continue when v_skip;
    v_taken := v_taken || array[[c.lat, c.lng]];
    v_out := v_out || (
      select jsonb_build_object(
        'lat', round(avg(r.lat)::numeric, 5), 'lng', round(avg(r.lng)::numeric, 5),
        'reports', count(*),
        'fixed', count(*) filter (where r.status = 'resolved'),
        'open', count(*) filter (where r.status <> 'resolved' and not coalesce(r.is_duplicate, false)),
        'came_back', coalesce(sum(r.recurrence_count), 0),
        'category', mode() within group (order by r.category),
        'report_id', (array_agg(r.id::text order by r.created_at desc))[1],
        'landmark', (array_agg(r.landmark order by r.created_at desc) filter (where coalesce(r.landmark, '') <> ''))[1],
        'ward_no', mode() within group (order by r.ward_no),
        'block_name', mode() within group (order by r.block_name),
        'last_at', max(r.created_at))
      from public.reports r
      where r.moderation_status in ('approved', 'flagged') and r.created_at > v_since
        and r.lat between c.lat - 0.00046 and c.lat + 0.00046 and r.lng between c.lng - 0.0005 and c.lng + 0.0005
        and kasa_private.distance_m(c.lat, c.lng, r.lat, r.lng) <= 50);
    exit when jsonb_array_length(v_out) >= 25;
  end loop;
  return v_out;
end $$;

create table if not exists kasa_private.adoptions (
  id             bigint generated always as identity primary key,
  user_id        uuid not null,
  name           text not null,
  lat            double precision not null,
  lng            double precision not null,
  accuracy_m     double precision,
  ward_no        integer,
  block_name     text,
  created_at     timestamptz not null default now(),
  ended_at       timestamptz,
  ended_reason   text
);
create index if not exists kasa_adoptions_active_idx on kasa_private.adoptions (lat, lng) where ended_at is null;
alter table kasa_private.adoptions enable row level security;
revoke all on kasa_private.adoptions from public, anon, authenticated;

create or replace function public.kasa_adopted_spots() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by (x ->> 'open')::integer desc, x ->> 'since'), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', a.id, 'name', a.name, 'lat', round(a.lat::numeric, 5), 'lng', round(a.lng::numeric, 5),
      'ward_no', a.ward_no, 'block_name', a.block_name, 'since', a.created_at,
      'mine', a.user_id = auth.uid(),
      'open', (select count(*) from public.reports r
               where r.moderation_status in ('approved', 'flagged') and r.status <> 'resolved' and not coalesce(r.is_duplicate, false)
                 and r.lat between a.lat - 0.001 and a.lat + 0.001 and r.lng between a.lng - 0.0011 and a.lng + 0.0011
                 and kasa_private.distance_m(a.lat, a.lng, r.lat, r.lng) <= kasa_private.cfg_num('adopt_radius_m')),
      'fixed', (select count(*) from public.reports r
                where r.moderation_status in ('approved', 'flagged') and r.status = 'resolved' and r.resolved_at >= a.created_at
                  and r.lat between a.lat - 0.001 and a.lat + 0.001 and r.lng between a.lng - 0.0011 and a.lng + 0.0011
                  and kasa_private.distance_m(a.lat, a.lng, r.lat, r.lng) <= kasa_private.cfg_num('adopt_radius_m')),
      'last_problem_at', (select max(r.created_at) from public.reports r
                where r.moderation_status in ('approved', 'flagged') and r.created_at >= a.created_at
                  and r.lat between a.lat - 0.001 and a.lat + 0.001 and r.lng between a.lng - 0.0011 and a.lng + 0.0011
                  and kasa_private.distance_m(a.lat, a.lng, r.lat, r.lng) <= kasa_private.cfg_num('adopt_radius_m'))
    ) as x
    from kasa_private.adoptions a where a.ended_at is null
  ) t
$$;

create or replace function public.kasa_adopt_spot(p_name text, p_lat double precision, p_lng double precision,
    p_accuracy double precision) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me     kasa_private.profiles := kasa_private.me();
  v_name text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_loc  jsonb;
  v_near kasa_private.adoptions;
  v_id   bigint;
begin
  if length(v_name) < 3 or length(v_name) > 60 then
    perform kasa_private.fail('KASA_NAME_LENGTH', 'Give a name of 3 to 60 characters, like a shop, school or club.');
  end if;
  if p_accuracy is null or p_accuracy > kasa_private.cfg_num('max_gps_accuracy_m') then
    perform kasa_private.fail('KASA_GPS_WEAK', 'Your location isn''t precise enough yet. Wait a moment outdoors and try again.',
      jsonb_build_object('accuracy_m', round(coalesce(p_accuracy, 0)::numeric)));
  end if;
  v_loc := kasa_private.locate(p_lat, p_lng, null);
  if v_loc is null then perform kasa_private.fail('KASA_OUTSIDE_AREA', 'This location is outside Purulia district.'); end if;
  if (select count(*) from kasa_private.adoptions where user_id = me.user_id and ended_at is null)
     >= kasa_private.cfg_num('adopt_max_per_user') then
    perform kasa_private.fail('KASA_ADOPT_LIMIT', 'You already look after as many spots as one person can. Let one go first.');
  end if;
  select * into v_near from kasa_private.adoptions a
  where a.ended_at is null
    and kasa_private.distance_m(a.lat, a.lng, p_lat, p_lng) <= kasa_private.cfg_num('adopt_radius_m')
  order by kasa_private.distance_m(a.lat, a.lng, p_lat, p_lng) limit 1;
  if v_near.id is not null then
    perform kasa_private.fail('KASA_ALREADY_ADOPTED', 'Someone already looks after this spot: ' || v_near.name || '.',
      jsonb_build_object('name', v_near.name));
  end if;
  perform kasa_private.rate_limit_actions(me.user_id);

  insert into kasa_private.adoptions (user_id, name, lat, lng, accuracy_m, ward_no, block_name)
  values (me.user_id, v_name, p_lat, p_lng, p_accuracy,
          nullif(v_loc ->> 'ward', '')::integer, v_loc ->> 'block')
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'name', v_name);
end $$;

create or replace function public.kasa_leave_spot(p_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  update kasa_private.adoptions set ended_at = now(), ended_reason = 'left'
  where id = p_id and user_id = auth.uid() and ended_at is null;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'That spot is not one you look after.'); end if;
  return jsonb_build_object('left', true);
end $$;

create or replace function public.kasa_admin_remove_adoption(p_id bigint, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then perform kasa_private.fail('KASA_REASON_NEEDED', 'Give a short reason.'); end if;
  update kasa_private.adoptions set ended_at = now(), ended_reason = left(trim(p_reason), 280)
  where id = p_id and ended_at is null;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'No such adopted spot.'); end if;
  return jsonb_build_object('removed', true);
end $$;

revoke all on function public.kasa_problem_spots(integer) from public;
revoke all on function public.kasa_adopted_spots() from public;
grant execute on function public.kasa_problem_spots(integer), public.kasa_adopted_spots() to anon, authenticated;
revoke all on function public.kasa_adopt_spot(text, double precision, double precision, double precision) from public, anon;
revoke all on function public.kasa_leave_spot(bigint) from public, anon;
revoke all on function public.kasa_admin_remove_adoption(bigint, text) from public, anon;
grant execute on function public.kasa_adopt_spot(text, double precision, double precision, double precision),
  public.kasa_leave_spot(bigint), public.kasa_admin_remove_adoption(bigint, text) to authenticated;

commit;

notify pgrst, 'reload schema';
