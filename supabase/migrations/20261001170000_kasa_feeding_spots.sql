-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — community dog feeding spots and their caregivers
--
-- ABC Rules 2023, rule 20 (G.S.R. 193(E), 10 Mar 2023): the RWA, apartment
-- owners' association or local body's representative designates mutually
-- agreed feeding spots and times, away from children's play areas, entry and
-- exit points and staircases, with designated feeders. The Supreme Court
-- (Suo Motu W.P.(C) 5/2025, order of 22 Aug 2025, para 33(d)) told municipal
-- authorities to create dedicated feeding spaces in each ward.
--
-- A caregiver standing at the spot registers it (good GPS fix, public name,
-- feeding time, about how many dogs, whether they will help catch dogs for
-- vaccination and sterilisation). It waits for a moderator, who sees how far
-- the nearest school is. Approved spots are public (kasa_feeding_spots). A
-- caregiver says the spot is proposed by them; only a moderator records that
-- a local body, RWA or Animal Welfare Committee designated it, with a source.
-- The caregiver can stop (kasa_leave_feeding_spot); a moderator can remove.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

insert into kasa_private.settings (key, value, note) values
  ('feed_spot_radius_m', '25', 'Two feeding spots closer than this are the same spot'),
  ('feed_spot_max_per_user', '3', 'How many feeding spots one caregiver can register at once')
on conflict (key) do nothing;

create table if not exists kasa_private.feeding_spots (
  id               bigint generated always as identity primary key,
  user_id          uuid not null,
  name             text not null,
  lat              double precision not null,
  lng              double precision not null,
  accuracy_m       double precision,
  feed_time        text not null,
  dogs             integer not null,
  helps_abc        boolean not null default false,
  note             text,
  ward_no          integer,
  block_name       text,
  district         text,
  place            text,
  near_school_m    integer,
  near_school      text,
  status           text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'removed', 'left')),
  created_at       timestamptz not null default now(),
  reviewed_at      timestamptz,
  review_note      text,
  designated_note  text,
  designated_url   text,
  designated_at    timestamptz
);
create index if not exists kasa_feeding_spots_status_idx on kasa_private.feeding_spots (status, created_at);
create index if not exists kasa_feeding_spots_pos_idx on kasa_private.feeding_spots (lat, lng) where status in ('pending', 'approved');
alter table kasa_private.feeding_spots enable row level security;
revoke all on kasa_private.feeding_spots from public, anon, authenticated;

create or replace function public.kasa_register_feeding_spot(p_name text, p_lat double precision, p_lng double precision,
    p_accuracy double precision, p_feed_time text, p_dogs integer, p_helps_abc boolean default false, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me     kasa_private.profiles := kasa_private.me();
  v_name text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_time text := regexp_replace(trim(coalesce(p_feed_time, '')), '\s+', ' ', 'g');
  v_note text := nullif(regexp_replace(trim(coalesce(p_note, '')), '\s+', ' ', 'g'), '');
  v_loc  jsonb;
  v_near kasa_private.feeding_spots;
  v_sch  record;
  v_id   bigint;
begin
  if length(v_name) < 3 or length(v_name) > 60 then
    perform kasa_private.fail('KASA_NAME_LENGTH', 'Give a name of 3 to 60 characters, the one neighbours know you by.');
  end if;
  if length(v_time) < 3 or length(v_time) > 40 then
    perform kasa_private.fail('KASA_BAD_FORM', 'Say when you feed, like "7 to 7:30 am".');
  end if;
  if p_dogs is null or p_dogs < 1 or p_dogs > 60 then
    perform kasa_private.fail('KASA_BAD_FORM', 'Say about how many dogs you feed here (1 to 60).');
  end if;
  if length(coalesce(v_note, '')) > 280 then
    perform kasa_private.fail('KASA_BAD_FORM', 'Keep the note to 280 characters.');
  end if;
  if kasa_private.text_verdict(concat_ws(' ', v_name, v_time, v_note)) ->> 'level' = 'block' then
    perform kasa_private.fail('KASA_TEXT_BLOCKED', 'Please remove abusive words and try again.');
  end if;
  if p_accuracy is null or p_accuracy > kasa_private.cfg_num('max_gps_accuracy_m') then
    perform kasa_private.fail('KASA_GPS_WEAK', 'Your location isn''t precise enough yet. Wait a moment outdoors and try again.',
      jsonb_build_object('accuracy_m', round(coalesce(p_accuracy, 0)::numeric)));
  end if;
  v_loc := kasa_private.locate_any(p_lat, p_lng, null);
  if v_loc is null then perform kasa_private.fail('KASA_OUTSIDE_AREA', 'This location is outside the areas Parishkar covers.'); end if;
  if (select count(*) from kasa_private.feeding_spots where user_id = me.user_id and status in ('pending', 'approved'))
     >= kasa_private.cfg_num('feed_spot_max_per_user') then
    perform kasa_private.fail('KASA_FEED_LIMIT', 'You already have as many feeding spots as one person can register. Stop one first.');
  end if;
  select * into v_near from kasa_private.feeding_spots f
  where f.status in ('pending', 'approved')
    and f.lat between p_lat - 0.0005 and p_lat + 0.0005 and f.lng between p_lng - 0.0006 and p_lng + 0.0006
    and kasa_private.distance_m(f.lat, f.lng, p_lat, p_lng) <= kasa_private.cfg_num('feed_spot_radius_m')
  order by kasa_private.distance_m(f.lat, f.lng, p_lat, p_lng) limit 1;
  if v_near.id is not null then
    perform kasa_private.fail('KASA_FEED_TAKEN', 'There is already a feeding spot here, looked after by ' || v_near.name || '. Please feed together.',
      jsonb_build_object('name', v_near.name));
  end if;
  perform kasa_private.rate_limit_actions(me.user_id);

  -- The nearest school within about 200 m, for the moderator (rule 20: keep spots away from children).
  select s.name, round(kasa_private.distance_m(s.lat, s.lng, p_lat, p_lng))::integer as m into v_sch
  from public.schools s
  where s.lat between p_lat - 0.0019 and p_lat + 0.0019 and s.lng between p_lng - 0.0021 and p_lng + 0.0021
  order by kasa_private.distance_m(s.lat, s.lng, p_lat, p_lng) limit 1;

  insert into kasa_private.feeding_spots (user_id, name, lat, lng, accuracy_m, feed_time, dogs, helps_abc, note,
                                          ward_no, block_name, district, place, near_school_m, near_school)
  values (me.user_id, v_name, p_lat, p_lng, p_accuracy, v_time, p_dogs, coalesce(p_helps_abc, false), v_note,
          case when v_loc ->> 'kind' in ('town', 'place') then nullif(v_loc ->> 'ward', '')::integer end,
          v_loc ->> 'block', v_loc ->> 'district', v_loc ->> 'place',
          case when v_sch.m <= 200 then v_sch.m end, case when v_sch.m <= 200 then v_sch.name end)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'status', 'pending');
end $$;

-- Approved spots. The caregiver's account is never shown, only the name they typed.
create or replace function public.kasa_feeding_spots() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', f.id, 'name', f.name, 'lat', round(f.lat::numeric, 5), 'lng', round(f.lng::numeric, 5),
      'feed_time', f.feed_time, 'dogs', f.dogs, 'helps_abc', f.helps_abc, 'note', f.note,
      'ward_no', f.ward_no, 'block_name', f.block_name, 'district', f.district, 'place', f.place,
      'since', f.reviewed_at, 'mine', f.user_id = auth.uid(),
      'designated', case when f.designated_note is not null
                         then jsonb_build_object('note', f.designated_note, 'source_url', f.designated_url) end)
    order by f.designated_note is null, f.reviewed_at desc), '[]'::jsonb)
  from kasa_private.feeding_spots f where f.status = 'approved'
$$;

create or replace function public.kasa_leave_feeding_spot(p_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  update kasa_private.feeding_spots set status = 'left', reviewed_at = coalesce(reviewed_at, now())
  where id = p_id and user_id = auth.uid() and status in ('pending', 'approved');
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'That is not a feeding spot you registered.'); end if;
  return jsonb_build_object('left', true);
end $$;

create or replace function public.kasa_admin_feeding_queue() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', f.id, 'name', f.name, 'lat', f.lat, 'lng', f.lng, 'accuracy_m', round(f.accuracy_m::numeric),
      'feed_time', f.feed_time, 'dogs', f.dogs, 'helps_abc', f.helps_abc, 'note', f.note,
      'ward_no', f.ward_no, 'block_name', f.block_name, 'district', f.district, 'place', f.place,
      'near_school_m', f.near_school_m, 'near_school', f.near_school, 'created_at', f.created_at) order by f.created_at)
    from kasa_private.feeding_spots f where f.status = 'pending'), '[]'::jsonb);
end $$;

-- approve / reject a waiting spot; remove an approved one.
create or replace function public.kasa_admin_review_feeding_spot(p_id bigint, p_action text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_note text := nullif(left(trim(coalesce(p_note, '')), 280), '');
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  if p_action in ('approve', 'reject') then
    update kasa_private.feeding_spots
    set status = case when p_action = 'approve' then 'approved' else 'rejected' end, reviewed_at = now(), review_note = v_note
    where id = p_id and status = 'pending';
  elsif p_action = 'remove' then
    if v_note is null or length(v_note) < 3 then perform kasa_private.fail('KASA_REASON_NEEDED', 'Give a short reason.'); end if;
    update kasa_private.feeding_spots set status = 'removed', review_note = v_note
    where id = p_id and status = 'approved';
  else
    perform kasa_private.fail('KASA_BAD_ACTION', 'Approve, reject or remove.');
  end if;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'No such feeding spot waiting.'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- A moderator records that the local body, RWA or Animal Welfare Committee designated the spot,
-- with a link to the order, letter or minutes. An empty note clears it.
create or replace function public.kasa_admin_set_feeding_designation(p_id bigint, p_note text, p_source_url text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_note text := regexp_replace(trim(coalesce(p_note, '')), '\s+', ' ', 'g');
  v_url  text := trim(coalesce(p_source_url, ''));
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  if v_note = '' then
    update kasa_private.feeding_spots set designated_note = null, designated_url = null, designated_at = null
    where id = p_id and status = 'approved';
  else
    if length(v_note) < 5 or length(v_note) > 280 then
      perform kasa_private.fail('KASA_NOTE_LENGTH', 'Say who designated the spot in 5 to 280 characters.');
    end if;
    if v_url !~ '^https://[^\s/]+\.[^\s]+$' or length(v_url) > 500 then
      perform kasa_private.fail('KASA_SOURCE_NEEDED', 'Give an https link to the order, letter or minutes.');
    end if;
    update kasa_private.feeding_spots set designated_note = v_note, designated_url = v_url, designated_at = now()
    where id = p_id and status = 'approved';
  end if;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'No such feeding spot.'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- The daily moderator nudge counts waiting feeding spots too.
create or replace function kasa_private.queue_backlog() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(q, n) filter (where n > 0), '{}'::jsonb) from (
    select 'Reports held for review' q, count(*) n from public.reports
      where moderation_status in ('review', 'flagged') and created_at < now() - interval '72 hours'
    union all select 'School checks held for review', count(*) from public.school_audits
      where moderation_status in ('review', 'flagged') and created_at < now() - interval '72 hours'
    union all select 'Ward maps and places', count(*) from kasa_private.place_submissions
      where status = 'pending' and created_at < now() - interval '72 hours'
    union all select 'Officials', count(*) from kasa_private.official_suggestions
      where status = 'pending' and created_at < now() - interval '72 hours'
    union all select 'Schools', count(*) from kasa_private.school_suggestions
      where status = 'pending' and created_at < now() - interval '72 hours'
    union all select 'Translations', count(*) from kasa_private.translation_suggestions
      where status = 'pending' and created_at < now() - interval '72 hours'
    union all select 'Volunteer groups', count(*) from kasa_private.communities
      where status = 'pending' and created_at < now() - interval '72 hours'
    union all select 'Dog feeding spots', count(*) from kasa_private.feeding_spots
      where status = 'pending' and created_at < now() - interval '72 hours'
  ) t
$$;
revoke all on function kasa_private.queue_backlog() from public, anon, authenticated;

revoke all on function public.kasa_feeding_spots() from public;
grant execute on function public.kasa_feeding_spots() to anon, authenticated;
revoke all on function public.kasa_register_feeding_spot(text, double precision, double precision, double precision, text, integer, boolean, text) from public, anon;
revoke all on function public.kasa_leave_feeding_spot(bigint) from public, anon;
revoke all on function public.kasa_admin_feeding_queue() from public, anon;
revoke all on function public.kasa_admin_review_feeding_spot(bigint, text, text) from public, anon;
revoke all on function public.kasa_admin_set_feeding_designation(bigint, text, text) from public, anon;
grant execute on function public.kasa_register_feeding_spot(text, double precision, double precision, double precision, text, integer, boolean, text),
  public.kasa_leave_feeding_spot(bigint), public.kasa_admin_feeding_queue(),
  public.kasa_admin_review_feeding_spot(bigint, text, text), public.kasa_admin_set_feeding_designation(bigint, text, text) to authenticated;

commit;

notify pgrst, 'reload schema';
