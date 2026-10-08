-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — snake sightings and the snake rescuers near them
--
-- A snake rescuer registers standing at their base (good GPS fix, public
-- name, mobile number they agree to show, how far they will travel). It waits
-- for a moderator, who calls the number before approving. Approved rescuers
-- are public (kasa_snake_rescuers). The rescuer can stop
-- (kasa_leave_snake_rescuer); a moderator can remove.
--
-- Someone who sees a snake takes a live camera photo at the spot with a good
-- GPS fix (kasa_report_snake). The sighting is public for 48 hours
-- (kasa_snake_sightings) and the reply lists the approved rescuers whose
-- range covers the spot, nearest first, so the page can offer call and
-- WhatsApp buttons. Nothing is sent from the server.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

insert into kasa_private.settings (key, value, note) values
  ('snake_sightings_per_day', '10', 'How many snake sightings one account can send in a day'),
  ('snake_rescuer_max_km', '50', 'The farthest a snake rescuer can say they travel'),
  ('snake_sighting_hours', '48', 'How long a snake sighting stays on the public list')
on conflict (key) do nothing;

create table if not exists kasa_private.snake_rescuers (
  id           bigint generated always as identity primary key,
  user_id      uuid not null,
  name         text not null,
  phone        text not null,
  whatsapp     boolean not null default true,
  lat          double precision not null,
  lng          double precision not null,
  accuracy_m   double precision,
  range_km     integer not null,
  note         text,
  block_name   text,
  district     text,
  place        text,
  status       text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'removed', 'left')),
  created_at   timestamptz not null default now(),
  reviewed_at  timestamptz,
  review_note  text
);
create index if not exists kasa_snake_rescuers_status_idx on kasa_private.snake_rescuers (status, created_at);
alter table kasa_private.snake_rescuers enable row level security;
revoke all on kasa_private.snake_rescuers from public, anon, authenticated;

create table if not exists kasa_private.snake_sightings (
  id          bigint generated always as identity primary key,
  user_id     uuid not null,
  lat         double precision not null,
  lng         double precision not null,
  accuracy_m  double precision,
  photo_path  text not null unique,
  photo_url   text not null,
  note        text,
  ward_no     integer,
  block_name  text,
  district    text,
  place       text,
  hidden      boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists kasa_snake_sightings_time_idx on kasa_private.snake_sightings (created_at desc);
alter table kasa_private.snake_sightings enable row level security;
revoke all on kasa_private.snake_sightings from public, anon, authenticated;

-- A snake photo can't be reused elsewhere either.
create or replace function kasa_private.photo_in_use(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.reports r where r.photo_path = p_path)
      or exists (select 1 from kasa_private.report_photos rp where rp.photo_path = p_path)
      or exists (select 1 from kasa_private.claims c where c.photo_path = p_path)
      or exists (select 1 from kasa_private.votes v where v.photo_path = p_path)
      or (to_regclass('public.school_audits') is not null
          and exists (select 1 from public.school_audits a where a.photo_path = p_path))
      or exists (select 1 from kasa_private.school_report_cards rc where rc.photo_path = p_path)
      or exists (select 1 from kasa_private.school_suggestions ss where ss.photo_path = p_path)
      or exists (select 1 from kasa_private.snake_sightings sn where sn.photo_path = p_path)
$$;

-- Approved rescuers whose range covers a point, nearest first.
create or replace function kasa_private.snake_rescuers_near(p_lat double precision, p_lng double precision) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('name', r.name, 'phone', r.phone, 'whatsapp', r.whatsapp,
      'km', round((r.d / 1000)::numeric, 1), 'note', r.note, 'district', r.district) order by r.d), '[]'::jsonb)
  from (select s.*, kasa_private.distance_m(s.lat, s.lng, p_lat, p_lng) d
        from kasa_private.snake_rescuers s where s.status = 'approved') r
  where r.d <= r.range_km * 1000
$$;
revoke all on function kasa_private.snake_rescuers_near(double precision, double precision) from public, anon, authenticated;

create or replace function public.kasa_register_snake_rescuer(p_name text, p_phone text, p_whatsapp boolean,
    p_lat double precision, p_lng double precision, p_accuracy double precision, p_range_km integer, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me      kasa_private.profiles := kasa_private.me();
  v_name  text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_note  text := nullif(regexp_replace(trim(coalesce(p_note, '')), '\s+', ' ', 'g'), '');
  v_loc   jsonb;
  v_id    bigint;
begin
  if length(v_name) < 3 or length(v_name) > 60 then
    perform kasa_private.fail('KASA_NAME_LENGTH', 'Give a name of 3 to 60 characters, the one people know you by.');
  end if;
  if length(v_phone) = 12 and v_phone like '91%' then v_phone := substr(v_phone, 3); end if;
  if length(v_phone) = 11 and v_phone like '0%' then v_phone := substr(v_phone, 2); end if;
  if v_phone !~ '^[6-9][0-9]{9}$' then
    perform kasa_private.fail('KASA_BAD_PHONE', 'Give a 10-digit Indian mobile number.');
  end if;
  if p_range_km is null or p_range_km < 1 or p_range_km > kasa_private.cfg_num('snake_rescuer_max_km') then
    perform kasa_private.fail('KASA_BAD_FORM', 'Say how far you can travel (1 to 50 km).');
  end if;
  if length(coalesce(v_note, '')) > 280 then
    perform kasa_private.fail('KASA_BAD_FORM', 'Keep the note to 280 characters.');
  end if;
  if kasa_private.text_verdict(concat_ws(' ', v_name, v_note)) ->> 'level' = 'block' then
    perform kasa_private.fail('KASA_TEXT_BLOCKED', 'Please remove abusive words and try again.');
  end if;
  if p_accuracy is null or p_accuracy > kasa_private.cfg_num('max_gps_accuracy_m') then
    perform kasa_private.fail('KASA_GPS_WEAK', 'Your location isn''t precise enough yet. Wait a moment outdoors and try again.',
      jsonb_build_object('accuracy_m', round(coalesce(p_accuracy, 0)::numeric)));
  end if;
  v_loc := kasa_private.locate_any(p_lat, p_lng, null);
  if v_loc is null then perform kasa_private.fail('KASA_OUTSIDE_AREA', 'This location is outside the areas Parishkar covers.'); end if;
  if exists (select 1 from kasa_private.snake_rescuers where user_id = me.user_id and status in ('pending', 'approved')) then
    perform kasa_private.fail('KASA_RESCUER_EXISTS', 'You are already registered as a snake rescuer. Stop that one first to change it.');
  end if;
  perform kasa_private.rate_limit_actions(me.user_id);

  insert into kasa_private.snake_rescuers (user_id, name, phone, whatsapp, lat, lng, accuracy_m, range_km, note, block_name, district, place)
  values (me.user_id, v_name, v_phone, coalesce(p_whatsapp, true), p_lat, p_lng, p_accuracy, p_range_km, v_note,
          v_loc ->> 'block', v_loc ->> 'district', v_loc ->> 'place')
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'status', 'pending');
end $$;

-- Approved rescuers. Their base is rounded to about 1 km; the number is public by their choice.
create or replace function public.kasa_snake_rescuers() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'name', r.name, 'phone', r.phone, 'whatsapp', r.whatsapp, 'range_km', r.range_km, 'note', r.note,
      'lat', round(r.lat::numeric, 2), 'lng', round(r.lng::numeric, 2),
      'block_name', r.block_name, 'district', r.district, 'place', r.place,
      'since', r.reviewed_at, 'mine', r.user_id = auth.uid()) order by r.district, r.name), '[]'::jsonb)
  from kasa_private.snake_rescuers r where r.status = 'approved'
$$;

create or replace function public.kasa_leave_snake_rescuer() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  update kasa_private.snake_rescuers set status = 'left', reviewed_at = coalesce(reviewed_at, now())
  where user_id = auth.uid() and status in ('pending', 'approved');
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'You are not registered as a snake rescuer.'); end if;
  return jsonb_build_object('left', true);
end $$;

create or replace function public.kasa_report_snake(p_lat double precision, p_lng double precision, p_accuracy double precision,
    p_photo_path text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me     kasa_private.profiles := kasa_private.me();
  v_note text := nullif(regexp_replace(trim(coalesce(p_note, '')), '\s+', ' ', 'g'), '');
  v_loc  jsonb;
  v_id   bigint;
begin
  if length(coalesce(v_note, '')) > 140 then
    perform kasa_private.fail('KASA_BAD_FORM', 'Keep the note to 140 characters.');
  end if;
  if v_note is not null and kasa_private.text_verdict(v_note) ->> 'level' = 'block' then
    perform kasa_private.fail('KASA_TEXT_BLOCKED', 'Please remove abusive words and try again.');
  end if;
  if p_lat is null or p_lng is null or p_accuracy is null or p_accuracy > kasa_private.cfg_num('max_gps_accuracy_m') then
    perform kasa_private.fail('KASA_GPS_WEAK', 'Your location isn''t precise enough yet. Wait a moment outdoors and try again.',
      jsonb_build_object('accuracy_m', round(coalesce(p_accuracy, 0)::numeric)));
  end if;
  v_loc := kasa_private.locate_any(p_lat, p_lng, null);
  if v_loc is null then perform kasa_private.fail('KASA_OUTSIDE_AREA', 'This location is outside the areas Parishkar covers.'); end if;
  if (select count(*) from kasa_private.snake_sightings
      where user_id = me.user_id and created_at > now() - interval '1 day') >= kasa_private.cfg_num('snake_sightings_per_day') then
    perform kasa_private.fail('KASA_RATE_LIMIT', 'You have sent a lot of snake sightings today. Try again tomorrow.');
  end if;
  perform kasa_private.check_photo(p_photo_path, 'reports', me.user_id, null, p_lat, p_lng);
  -- Live camera, taken now (the same rule as evidence photos).
  perform kasa_private.photo_meta_verdict(p_photo_path, true, p_lat, p_lng, null);

  insert into kasa_private.snake_sightings (user_id, lat, lng, accuracy_m, photo_path, photo_url, note, ward_no, block_name, district, place)
  values (me.user_id, p_lat, p_lng, p_accuracy, p_photo_path, (kasa_private.cfg('storage_public_base') #>> '{}') || p_photo_path, v_note,
          case when v_loc ->> 'kind' in ('town', 'place') then nullif(v_loc ->> 'ward', '')::integer end,
          v_loc ->> 'block', v_loc ->> 'district', v_loc ->> 'place')
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'rescuers', kasa_private.snake_rescuers_near(p_lat, p_lng));
end $$;

-- Sightings of the last 48 hours, so neighbours and rescuers can see them. The sender is never shown.
create or replace function public.kasa_snake_sightings() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'lat', round(s.lat::numeric, 5), 'lng', round(s.lng::numeric, 5), 'photo_url', s.photo_url, 'note', s.note,
      'ward_no', s.ward_no, 'block_name', s.block_name, 'district', s.district, 'place', s.place, 'at', s.created_at)
    order by s.created_at desc), '[]'::jsonb)
  from kasa_private.snake_sightings s
  where not s.hidden and s.created_at > now() - make_interval(hours => kasa_private.cfg_num('snake_sighting_hours')::integer)
$$;

create or replace function public.kasa_admin_snake_queue() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', r.id, 'name', r.name, 'phone', r.phone, 'whatsapp', r.whatsapp, 'lat', r.lat, 'lng', r.lng,
      'accuracy_m', round(r.accuracy_m::numeric), 'range_km', r.range_km, 'note', r.note,
      'block_name', r.block_name, 'district', r.district, 'place', r.place, 'created_at', r.created_at) order by r.created_at)
    from kasa_private.snake_rescuers r where r.status = 'pending'), '[]'::jsonb);
end $$;

-- approve / reject a waiting rescuer; remove an approved one; hide a sighting (p_action 'hide_sighting', p_id = sighting id).
create or replace function public.kasa_admin_review_snake(p_id bigint, p_action text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_note text := nullif(left(trim(coalesce(p_note, '')), 280), '');
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  if p_action in ('approve', 'reject') then
    update kasa_private.snake_rescuers
    set status = case when p_action = 'approve' then 'approved' else 'rejected' end, reviewed_at = now(), review_note = v_note
    where id = p_id and status = 'pending';
  elsif p_action = 'remove' then
    if v_note is null or length(v_note) < 3 then perform kasa_private.fail('KASA_REASON_NEEDED', 'Give a short reason.'); end if;
    update kasa_private.snake_rescuers set status = 'removed', review_note = v_note where id = p_id and status = 'approved';
  elsif p_action = 'hide_sighting' then
    update kasa_private.snake_sightings set hidden = true where id = p_id and not hidden;
  else
    perform kasa_private.fail('KASA_BAD_ACTION', 'Approve, reject, remove or hide.');
  end if;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'Nothing to change.'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- The daily moderator nudge counts waiting snake rescuers too.
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
    union all select 'Snake rescuers', count(*) from kasa_private.snake_rescuers
      where status = 'pending' and created_at < now() - interval '72 hours'
  ) t
$$;
revoke all on function kasa_private.queue_backlog() from public, anon, authenticated;

revoke all on function public.kasa_snake_rescuers() from public;
revoke all on function public.kasa_snake_sightings() from public;
grant execute on function public.kasa_snake_rescuers(), public.kasa_snake_sightings() to anon, authenticated;
revoke all on function public.kasa_register_snake_rescuer(text, text, boolean, double precision, double precision, double precision, integer, text) from public, anon;
revoke all on function public.kasa_leave_snake_rescuer() from public, anon;
revoke all on function public.kasa_report_snake(double precision, double precision, double precision, text, text) from public, anon;
revoke all on function public.kasa_admin_snake_queue() from public, anon;
revoke all on function public.kasa_admin_review_snake(bigint, text, text) from public, anon;
grant execute on function public.kasa_register_snake_rescuer(text, text, boolean, double precision, double precision, double precision, integer, text),
  public.kasa_leave_snake_rescuer(), public.kasa_report_snake(double precision, double precision, double precision, text, text),
  public.kasa_admin_snake_queue(), public.kasa_admin_review_snake(bigint, text, text) to authenticated;

commit;

notify pgrst, 'reload schema';
