-- ════════════════════════════════════════════════════════════════════
-- PURULIA KASA — Hostel sanitation: report types, floor checklists, verification
--
-- 1. Three report types (hostel_washroom, hostel_dustbin, hostel_corridor). Every
--    mapping from 20261008110000 is kept.
-- 2. A moderator adds a hostel site (name, place, cited source, floors). Each floor
--    has three daily checklist items: washroom, dustbin, corridor.
-- 3. The on-duty supervisor submits one check per item per day with a before and an
--    after photo taken live and a real GPS fix. Nothing from a gallery is accepted.
-- 4. A floor representative (claimed with a one-time code from a moderator) marks a
--    check verified or flagged. The submitter cannot verify their own check.
-- 5. Public view: facts only (floor, item, date, status, dates). No names, no photos,
--    no GPS. Moderators export a month per site, with missed days listed as not_submitted.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════

begin;

create or replace function kasa_private.subtype_category(p text) returns text
language sql immutable set search_path = '' as $$
  select case p
    when 'household' then 'garbage'
    when 'construction' then 'garbage'
    when 'mixed' then 'garbage'
    when 'e_waste' then 'garbage'
    when 'biomedical' then 'garbage'
    when 'dirty_spot' then 'garbage'
    when 'garbage_dump' then 'dumpsite'
    when 'bin_full' then 'garbage'
    when 'vehicle_missed' then 'garbage'
    when 'not_swept' then 'garbage'
    when 'burning' then 'garbage'
    when 'dead_animal' then 'garbage'
    when 'toilet_dirty' then 'toilet'
    when 'toilet_no_water' then 'toilet'
    when 'toilet_no_power' then 'toilet'
    when 'toilet_blocked' then 'toilet'
    when 'toilet_locked' then 'toilet'
    when 'open_defecation' then 'toilet'
    when 'yellow_spot' then 'toilet'
    when 'drain_blocked' then 'drain'
    when 'sewer_overflow' then 'drain'
    when 'stagnant_water' then 'drain'
    when 'septic_overflow' then 'drain'
    when 'sludge_dumped' then 'drain'
    when 'open_manhole' then 'missing'
    when 'manhole_entry' then 'illegal_other'
    when 'dry_tap' then 'water'
    when 'water_leak' then 'water'
    when 'pump_broken' then 'hand_pump'
    when 'no_doctor' then 'health_centre'
    when 'no_medicine' then 'health_centre'
    when 'centre_closed' then 'health_centre'
    when 'pothole' then 'road'
    when 'light_out' then 'streetlight'
    when 'work_missing' then 'rural_jobs'
    when 'no_signboard' then 'rural_jobs'
    when 'no_drinking_water' then 'water'
    when 'water_body_filling' then 'illegal_other'
    when 'illegal_construction' then 'illegal_construction'
    when 'hostel_washroom' then 'toilet'
    when 'hostel_dustbin' then 'garbage'
    when 'hostel_corridor' then 'garbage'
  end
$$;

-- Today's date in India. Checks are dated by the day in India, not by the database clock.
create or replace function kasa_private.ist_today() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Kolkata')::date
$$;

create table if not exists kasa_private.hostel_sites (
  id         bigint generated always as identity primary key,
  name       text not null,
  place      text not null,
  district   text,
  source_url text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists kasa_private.hostel_floors (
  id      bigint generated always as identity primary key,
  site_id bigint not null references kasa_private.hostel_sites(id) on delete cascade,
  label   text not null,
  ord     integer not null default 0,
  unique (site_id, label)
);

create table if not exists kasa_private.hostel_reps (
  floor_id   bigint not null references kasa_private.hostel_floors(id) on delete cascade,
  user_id    uuid not null,
  created_at timestamptz not null default now(),
  primary key (floor_id, user_id)
);

-- One-time codes a moderator issues per floor representative. Only the hash is kept.
create table if not exists kasa_private.hostel_rep_codes (
  code_hash  text primary key,
  floor_id   bigint not null references kasa_private.hostel_floors(id) on delete cascade,
  expires_at timestamptz not null,
  used_at    timestamptz
);

create table if not exists kasa_private.hostel_checks (
  id           bigint generated always as identity primary key,
  floor_id     bigint not null references kasa_private.hostel_floors(id) on delete cascade,
  item         text not null check (item in ('washroom', 'dustbin', 'corridor')),
  check_date   date not null default kasa_private.ist_today(),
  submitted_by uuid not null,
  before_path  text not null,
  after_path   text not null,
  lat          double precision not null,
  lng          double precision not null,
  accuracy_m   double precision not null,
  submitted_at timestamptz not null default now(),
  status       text not null default 'unverified' check (status in ('unverified', 'verified', 'flagged')),
  verified_by  uuid,
  verified_at  timestamptz,
  rep_note     text,
  unique (floor_id, item, check_date)
);

revoke all on kasa_private.hostel_sites, kasa_private.hostel_floors, kasa_private.hostel_reps,
  kasa_private.hostel_rep_codes, kasa_private.hostel_checks from public, anon, authenticated;

-- Moderator: add a site with its floors. The source link is required.
create or replace function public.kasa_admin_hostel_add_site(p_name text, p_place text, p_district text,
                                                             p_source_url text, p_floors text[]) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_id bigint;
  v_f  text;
  v_i  integer := 0;
begin
  if not kasa_private.is_admin() then raise exception 'Moderators only.'; end if;
  if coalesce(trim(p_name), '') = '' or coalesce(trim(p_place), '') = '' or coalesce(trim(p_source_url), '') = '' then
    raise exception 'Name, place and a source link are needed.';
  end if;
  if p_floors is null or cardinality(p_floors) = 0 then raise exception 'List at least one floor.'; end if;
  insert into kasa_private.hostel_sites (name, place, district, source_url)
  values (trim(p_name), trim(p_place), nullif(trim(p_district), ''), trim(p_source_url))
  returning id into v_id;
  foreach v_f in array p_floors loop
    v_i := v_i + 1;
    insert into kasa_private.hostel_floors (site_id, label, ord) values (v_id, trim(v_f), v_i);
  end loop;
  return v_id;
end $$;
revoke all on function public.kasa_admin_hostel_add_site(text, text, text, text, text[]) from public, anon;
grant execute on function public.kasa_admin_hostel_add_site(text, text, text, text, text[]) to authenticated;

-- Moderator: one-time code for a floor representative, valid 7 days. Shown once.
create or replace function public.kasa_admin_hostel_rep_code(p_floor_id bigint) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_code text;
begin
  if not kasa_private.is_admin() then raise exception 'Moderators only.'; end if;
  if not exists (select 1 from kasa_private.hostel_floors where id = p_floor_id) then raise exception 'Floor not found.'; end if;
  v_code := upper(substr(md5(random()::text || clock_timestamp()::text || p_floor_id::text), 1, 10));
  insert into kasa_private.hostel_rep_codes (code_hash, floor_id, expires_at)
  values (encode(sha256(convert_to(v_code, 'utf8')), 'hex'), p_floor_id, now() + interval '7 days');
  return v_code;
end $$;
revoke all on function public.kasa_admin_hostel_rep_code(bigint) from public, anon;
grant execute on function public.kasa_admin_hostel_rep_code(bigint) to authenticated;

-- Floor representative: claim a floor with a one-time code.
create or replace function public.kasa_hostel_rep_claim(p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me kasa_private.profiles := kasa_private.me();
  c  kasa_private.hostel_rep_codes%rowtype;
begin
  perform kasa_private.rate_limit_actions(me.user_id);
  select * into c from kasa_private.hostel_rep_codes
   where code_hash = encode(sha256(convert_to(upper(trim(coalesce(p_code, ''))), 'utf8')), 'hex') for update;
  if not found or c.used_at is not null or c.expires_at < now() then
    raise exception 'That code is not valid, has been used, or has expired.';
  end if;
  insert into kasa_private.hostel_reps (floor_id, user_id) values (c.floor_id, me.user_id) on conflict do nothing;
  update kasa_private.hostel_rep_codes set used_at = now() where code_hash = c.code_hash;
  return jsonb_build_object('floor_id', c.floor_id);
end $$;
revoke all on function public.kasa_hostel_rep_claim(text) from public, anon;
grant execute on function public.kasa_hostel_rep_claim(text) to authenticated;

-- Public: active sites with their floors.
create or replace function public.kasa_hostel_sites() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'name', s.name, 'place', s.place, 'district', s.district, 'source_url', s.source_url,
           'floors', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'label', f.label) order by f.ord), '[]'::jsonb)
                      from kasa_private.hostel_floors f where f.site_id = s.id))
         order by s.name), '[]'::jsonb)
  from kasa_private.hostel_sites s where s.active
$$;
revoke all on function public.kasa_hostel_sites() from public;
grant execute on function public.kasa_hostel_sites() to anon, authenticated;

-- Public: checks of one site since a date. Facts only: no submitter, no note, no photo, no GPS.
create or replace function public.kasa_hostel_checks(p_site_id bigint, p_from date default (kasa_private.ist_today() - 31)) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'floor', f.label, 'item', c.item, 'check_date', c.check_date, 'status', c.status,
           'submitted_at', c.submitted_at, 'verified_at', c.verified_at)
         order by c.check_date desc, f.ord, c.item), '[]'::jsonb)
  from kasa_private.hostel_checks c
  join kasa_private.hostel_floors f on f.id = c.floor_id
  join kasa_private.hostel_sites s on s.id = f.site_id
  where f.site_id = p_site_id and s.active and c.check_date >= p_from
$$;
revoke all on function public.kasa_hostel_checks(bigint, date) from public;
grant execute on function public.kasa_hostel_checks(bigint, date) to anon, authenticated;

-- Supervisor: one check per floor and item per day, with a live before and after photo and GPS.
create or replace function public.kasa_hostel_submit_check(p_floor_id bigint, p_item text, p_before text, p_after text,
                                                           p_lat double precision, p_lng double precision,
                                                           p_accuracy double precision) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me kasa_private.profiles := kasa_private.me();
  v_id bigint;
begin
  perform kasa_private.rate_limit_actions(me.user_id);
  if p_item not in ('washroom', 'dustbin', 'corridor') then raise exception 'Unknown checklist item.'; end if;
  if not exists (select 1 from kasa_private.hostel_floors f join kasa_private.hostel_sites s on s.id = f.site_id
                 where f.id = p_floor_id and s.active) then
    raise exception 'Floor not found.';
  end if;
  if p_lat is null or p_lng is null or p_accuracy is null then raise exception 'Location is needed.'; end if;
  if p_accuracy > kasa_private.cfg_num('report_max_accuracy_m') then
    raise exception 'GPS is too weak. Move to open space and try again.';
  end if;
  if p_before is null or p_after is null or p_before = p_after then
    raise exception 'Take a before and an after photo.';
  end if;
  perform kasa_private.check_photo(p_before, 'reports', me.user_id, now() - interval '3 hours', p_lat, p_lng);
  perform kasa_private.check_photo(p_after, 'reports', me.user_id, now() - interval '3 hours', p_lat, p_lng);
  if kasa_private.cfg_bool('require_live_report_photo') then
    if coalesce(kasa_private.photo_meta_verdict(p_before, false, p_lat, p_lng, null) ->> 'capture', 'unknown') <> 'live'
       or coalesce(kasa_private.photo_meta_verdict(p_after, false, p_lat, p_lng, null) ->> 'capture', 'unknown') <> 'live' then
      raise exception 'Take both photos with the camera in the app.';
    end if;
  end if;
  begin
    insert into kasa_private.hostel_checks (floor_id, item, check_date, submitted_by, before_path, after_path, lat, lng, accuracy_m)
    values (p_floor_id, p_item, kasa_private.ist_today(), me.user_id, p_before, p_after, p_lat, p_lng, p_accuracy)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'This item is already submitted for today.';
  end;
  return jsonb_build_object('id', v_id);
end $$;
revoke all on function public.kasa_hostel_submit_check(bigint, text, text, text, double precision, double precision, double precision) from public, anon;
grant execute on function public.kasa_hostel_submit_check(bigint, text, text, text, double precision, double precision, double precision) to authenticated;

-- Floor representative: checks on the floors they hold, last 14 days, with photos (not public).
create or replace function public.kasa_hostel_my_floors_checks() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  me kasa_private.profiles := kasa_private.me();
  v_base text := kasa_private.cfg('storage_public_base') #>> '{}';
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', c.id, 'floor', f.label, 'floor_id', f.id, 'item', c.item, 'check_date', c.check_date,
             'status', c.status, 'submitted_at', c.submitted_at, 'rep_note', c.rep_note,
             'mine', c.submitted_by = me.user_id,
             'before_url', v_base || c.before_path, 'after_url', v_base || c.after_path)
           order by c.submitted_at desc)
    from kasa_private.hostel_checks c
    join kasa_private.hostel_floors f on f.id = c.floor_id
    join kasa_private.hostel_reps r on r.floor_id = c.floor_id and r.user_id = me.user_id
    where c.check_date >= kasa_private.ist_today() - 14
  ), '[]'::jsonb);
end $$;
revoke all on function public.kasa_hostel_my_floors_checks() from public, anon;
grant execute on function public.kasa_hostel_my_floors_checks() to authenticated;

-- Floor representative: mark a check verified or flagged. Submitter cannot verify their own.
create or replace function public.kasa_hostel_verify(p_check_id bigint, p_decision text, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me kasa_private.profiles := kasa_private.me();
  c  kasa_private.hostel_checks%rowtype;
begin
  if p_decision not in ('verified', 'flagged') then raise exception 'Decision must be verified or flagged.'; end if;
  select * into c from kasa_private.hostel_checks where id = p_check_id for update;
  if not found then raise exception 'Check not found.'; end if;
  if not exists (select 1 from kasa_private.hostel_reps r where r.floor_id = c.floor_id and r.user_id = me.user_id) then
    raise exception 'Only the floor representative can verify this floor.';
  end if;
  if c.submitted_by = me.user_id then raise exception 'The person who submitted a check cannot verify it.'; end if;
  update kasa_private.hostel_checks
     set status = p_decision, verified_by = me.user_id, verified_at = now(),
         rep_note = nullif(left(trim(coalesce(p_note, '')), 300), '')
   where id = p_check_id;
  return jsonb_build_object('id', p_check_id, 'status', p_decision);
end $$;
revoke all on function public.kasa_hostel_verify(bigint, text, text) from public, anon;
grant execute on function public.kasa_hostel_verify(bigint, text, text) to authenticated;

-- Moderator: one month of one site, every floor × item × day up to today.
-- A day with no check is listed as not_submitted (a missed day), not guessed.
create or replace function public.kasa_admin_hostel_export(p_site_id bigint, p_month date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_start date := date_trunc('month', p_month)::date;
  v_end   date;
  v       jsonb;
begin
  if not kasa_private.is_admin() then raise exception 'Moderators only.'; end if;
  v_end := least((v_start + interval '1 month')::date - 1, kasa_private.ist_today());
  with items(item, ord) as (values ('washroom', 1), ('dustbin', 2), ('corridor', 3)),
  slots as (
    select f.id as floor_id, f.label, f.ord as floor_ord, i.item, i.ord as item_ord, d::date as check_date
    from kasa_private.hostel_floors f
    cross join items i
    cross join generate_series(v_start, v_end, interval '1 day') d
    where f.site_id = p_site_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'floor', sl.label, 'item', sl.item, 'check_date', sl.check_date,
           'status', coalesce(c.status, 'not_submitted'),
           'submitted_at', c.submitted_at, 'verified_at', c.verified_at,
           'lat', round(c.lat::numeric, 5), 'lng', round(c.lng::numeric, 5), 'accuracy_m', round(c.accuracy_m::numeric))
         order by sl.check_date, sl.floor_ord, sl.item_ord), '[]'::jsonb)
    into v
  from slots sl
  left join kasa_private.hostel_checks c
    on c.floor_id = sl.floor_id and c.item = sl.item and c.check_date = sl.check_date;
  return v;
end $$;
revoke all on function public.kasa_admin_hostel_export(bigint, date) from public, anon;
grant execute on function public.kasa_admin_hostel_export(bigint, date) to authenticated;

commit;

notify pgrst, 'reload schema';
