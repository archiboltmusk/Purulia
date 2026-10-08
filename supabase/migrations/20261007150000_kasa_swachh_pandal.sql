-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — Swachh Pandal: puja pandals and the waste reported around them
--
-- Someone standing at a pandal adds it (good GPS fix, its name, the club or
-- committee). It waits for a moderator. During the puja window (settings
-- puja_start / puja_end, set by moderators; 2026: Mahalaya 10 Oct to the last
-- extra Durga Puja holiday 24 Oct, per the West Bengal government holiday list)
-- kasa_pandals() counts the public reports filed within puja_pandal_radius_m
-- of each approved pandal: how many are still open and how many were fixed.
-- pandals.html ranks pandals from that. No scores are made up: the ranking is
-- only those counts.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

insert into kasa_private.settings (key, value, note) values
  ('puja_start', '"2026-10-10"', 'First day reports count towards the Swachh Pandal list (Mahalaya)'),
  ('puja_end', '"2026-10-24"', 'Last day reports count towards the Swachh Pandal list'),
  ('puja_pandal_radius_m', '100', 'Reports this close to a pandal count for it'),
  ('puja_pandal_max_per_user', '10', 'How many pandals one person can add')
on conflict (key) do nothing;

create table if not exists kasa_private.pandals (
  id           bigint generated always as identity primary key,
  user_id      uuid not null,
  name         text not null,
  club         text,
  lat          double precision not null,
  lng          double precision not null,
  accuracy_m   double precision,
  ward_no      integer,
  block_name   text,
  district     text,
  place        text,
  status       text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'removed')),
  created_at   timestamptz not null default now(),
  reviewed_at  timestamptz,
  review_note  text
);
create index if not exists kasa_pandals_status_idx on kasa_private.pandals (status, created_at);
alter table kasa_private.pandals enable row level security;
revoke all on kasa_private.pandals from public, anon, authenticated;

create or replace function public.kasa_add_pandal(p_name text, p_club text, p_lat double precision, p_lng double precision,
    p_accuracy double precision) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me     kasa_private.profiles := kasa_private.me();
  v_name text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_club text := nullif(regexp_replace(trim(coalesce(p_club, '')), '\s+', ' ', 'g'), '');
  v_loc  jsonb;
  v_near kasa_private.pandals;
  v_id   bigint;
begin
  if length(v_name) < 3 or length(v_name) > 80 then
    perform kasa_private.fail('KASA_NAME_LENGTH', 'Give the pandal''s name in 3 to 80 characters.');
  end if;
  if length(coalesce(v_club, '')) > 80 then
    perform kasa_private.fail('KASA_BAD_FORM', 'Keep the club or committee name to 80 characters.');
  end if;
  if kasa_private.text_verdict(concat_ws(' ', v_name, v_club)) ->> 'level' = 'block' then
    perform kasa_private.fail('KASA_TEXT_BLOCKED', 'Please remove abusive words and try again.');
  end if;
  if p_accuracy is null or p_accuracy > kasa_private.cfg_num('max_gps_accuracy_m') then
    perform kasa_private.fail('KASA_GPS_WEAK', 'Your location isn''t precise enough yet. Wait a moment outdoors and try again.',
      jsonb_build_object('accuracy_m', round(coalesce(p_accuracy, 0)::numeric)));
  end if;
  v_loc := kasa_private.locate_any(p_lat, p_lng, null);
  if v_loc is null then perform kasa_private.fail('KASA_OUTSIDE_AREA', 'This location is outside the areas Parishkar covers.'); end if;
  if (select count(*) from kasa_private.pandals where user_id = me.user_id and status in ('pending', 'approved'))
     >= kasa_private.cfg_num('puja_pandal_max_per_user') then
    perform kasa_private.fail('KASA_PANDAL_LIMIT', 'You have added as many pandals as one person can.');
  end if;
  select * into v_near from kasa_private.pandals p
  where p.status in ('pending', 'approved')
    and p.lat between p_lat - 0.0005 and p_lat + 0.0005 and p.lng between p_lng - 0.0006 and p_lng + 0.0006
    and kasa_private.distance_m(p.lat, p.lng, p_lat, p_lng) <= 40
  limit 1;
  if v_near.id is not null then
    perform kasa_private.fail('KASA_PANDAL_TAKEN', 'This pandal is already on the list as ' || v_near.name || '.',
      jsonb_build_object('name', v_near.name));
  end if;
  perform kasa_private.rate_limit_actions(me.user_id);

  insert into kasa_private.pandals (user_id, name, club, lat, lng, accuracy_m, ward_no, block_name, district, place)
  values (me.user_id, v_name, v_club, p_lat, p_lng, p_accuracy,
          case when v_loc ->> 'kind' in ('town', 'place') then nullif(v_loc ->> 'ward', '')::integer end,
          v_loc ->> 'block', v_loc ->> 'district', v_loc ->> 'place')
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'status', 'pending');
end $$;

-- Approved pandals with the public reports filed near them during the puja window.
create or replace function public.kasa_pandals() returns jsonb
language sql stable security definer set search_path = '' as $$
  with w as (
    select (kasa_private.cfg('puja_start') #>> '{}')::date as d0,
           (kasa_private.cfg('puja_end') #>> '{}')::date as d1,
           kasa_private.cfg_num('puja_pandal_radius_m') as r
  ), c as (
    select p.id,
      count(r.id) filter (where r.status in ('open', 'claimed')) as open_n,
      count(r.id) filter (where r.status = 'resolved') as fixed_n
    from kasa_private.pandals p cross join w
    left join public.reports r
      on r.lat between p.lat - 0.002 and p.lat + 0.002 and r.lng between p.lng - 0.0025 and p.lng + 0.0025
     and kasa_private.distance_m(r.lat, r.lng, p.lat, p.lng) <= w.r
     and r.created_at >= w.d0 and r.created_at < w.d1 + 1
     and not coalesce(r.is_duplicate, false)
     and r.moderation_status not in ('hidden', 'review', 'flagged')
    where p.status = 'approved'
    group by p.id
  )
  select jsonb_build_object(
    'window', (select jsonb_build_object('start', d0, 'end', d1, 'radius_m', r) from w),
    'pandals', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.name, 'club', p.club, 'lat', round(p.lat::numeric, 5), 'lng', round(p.lng::numeric, 5),
        'ward_no', p.ward_no, 'block_name', p.block_name, 'district', p.district, 'place', p.place,
        'open', c.open_n, 'fixed', c.fixed_n, 'mine', p.user_id = auth.uid())
      order by c.open_n, c.fixed_n desc, p.name)
      from kasa_private.pandals p join c on c.id = p.id), '[]'::jsonb))
$$;

create or replace function public.kasa_admin_pandal_queue() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.name, 'club', p.club, 'lat', p.lat, 'lng', p.lng, 'accuracy_m', round(p.accuracy_m::numeric),
      'ward_no', p.ward_no, 'block_name', p.block_name, 'district', p.district, 'place', p.place,
      'created_at', p.created_at) order by p.created_at)
    from kasa_private.pandals p where p.status = 'pending'), '[]'::jsonb);
end $$;

create or replace function public.kasa_admin_review_pandal(p_id bigint, p_action text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_note text := nullif(left(trim(coalesce(p_note, '')), 280), '');
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  if p_action in ('approve', 'reject') then
    update kasa_private.pandals
    set status = case when p_action = 'approve' then 'approved' else 'rejected' end, reviewed_at = now(), review_note = v_note
    where id = p_id and status = 'pending';
  elsif p_action = 'remove' then
    if v_note is null or length(v_note) < 3 then perform kasa_private.fail('KASA_REASON_NEEDED', 'Give a short reason.'); end if;
    update kasa_private.pandals set status = 'removed', review_note = v_note where id = p_id and status = 'approved';
  else
    perform kasa_private.fail('KASA_BAD_ACTION', 'Approve, reject or remove.');
  end if;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'No such pandal waiting.'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- A moderator sets next year's puja window (dates as YYYY-MM-DD).
create or replace function public.kasa_admin_set_puja_window(p_start date, p_end date) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 45 then
    perform kasa_private.fail('KASA_BAD_FORM', 'Give a start and end date, at most 45 days apart.');
  end if;
  update kasa_private.settings set value = to_jsonb(p_start::text) where key = 'puja_start';
  update kasa_private.settings set value = to_jsonb(p_end::text) where key = 'puja_end';
  return jsonb_build_object('start', p_start, 'end', p_end);
end $$;

revoke all on function public.kasa_pandals() from public;
grant execute on function public.kasa_pandals() to anon, authenticated;
revoke all on function public.kasa_add_pandal(text, text, double precision, double precision, double precision) from public, anon;
revoke all on function public.kasa_admin_pandal_queue() from public, anon;
revoke all on function public.kasa_admin_review_pandal(bigint, text, text) from public, anon;
revoke all on function public.kasa_admin_set_puja_window(date, date) from public, anon;
grant execute on function public.kasa_add_pandal(text, text, double precision, double precision, double precision),
  public.kasa_admin_pandal_queue(), public.kasa_admin_review_pandal(bigint, text, text),
  public.kasa_admin_set_puja_window(date, date) to authenticated;

commit;

notify pgrst, 'reload schema';
