-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — residents add a school that is missing from the list
--
-- Someone standing at a school that isn't on the list sends its name, block
-- and village with a live photo of the gate or name board, taken there with
-- GPS on. Nothing is public until a moderator has looked at the photo and
-- found the school's UDISE code (Know Your School, kys.udiseplus.gov.in, or
-- the district list). Approving adds it to public.schools with that code;
-- its location is where the resident stood (seen_lat/lng), not an official
-- one, so it shows as "placed by residents".
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

insert into kasa_private.settings (key, value, note) values
  ('school_suggestions_per_day', '5', 'Missing schools one person can add per day')
on conflict (key) do nothing;

create table if not exists kasa_private.school_suggestions (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  user_id     uuid not null,
  name        text not null check (length(name) between 3 and 140),
  block_name  text not null,
  village     text,
  udise_hint  text check (udise_hint is null or udise_hint ~ '^[0-9]{11}$'),
  lat         double precision not null,
  lng         double precision not null,
  accuracy    double precision,
  photo_path  text not null,
  photo_url   text not null,
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  udise_code  text,
  reviewed_at timestamptz,
  note        text
);
create index if not exists kasa_school_suggestions_status_idx on kasa_private.school_suggestions (status, created_at);
create index if not exists kasa_school_suggestions_user_idx on kasa_private.school_suggestions (user_id, created_at desc);
alter table kasa_private.school_suggestions enable row level security;

alter table public.schools add column if not exists added_by_residents boolean not null default false;

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
$$;

create or replace function public.kasa_suggest_school(p_name text, p_block text, p_village text,
    p_lat double precision, p_lng double precision, p_accuracy double precision, p_photo_path text,
    p_udise_hint text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me     kasa_private.profiles := kasa_private.me();
  v_name text := nullif(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), '');
  v_hint text := nullif(regexp_replace(coalesce(p_udise_hint, ''), '[^0-9]', '', 'g'), '');
  v_block text;
  v_id   uuid;
begin
  if v_name is null or length(v_name) < 3 or length(v_name) > 140 then
    perform kasa_private.fail('KASA_BAD_INPUT', 'Write the school''s name as it is on the board.');
  end if;
  select s.block_name into v_block from public.schools s
  where kasa_private.block_key(s.block_name) = kasa_private.block_key(p_block) limit 1;
  if v_block is null then perform kasa_private.fail('KASA_BAD_INPUT', 'Choose the block.'); end if;
  if v_hint is not null and v_hint !~ '^[0-9]{11}$' then
    perform kasa_private.fail('KASA_BAD_INPUT', 'A UDISE code has 11 digits. Leave it empty if you don''t know it.');
  end if;
  if v_hint is not null and exists (select 1 from public.schools where udise_code = v_hint) then
    perform kasa_private.fail('KASA_SCHOOL_EXISTS', 'That school is already on the list.');
  end if;
  if p_lat is null or p_lng is null or p_accuracy is null or p_accuracy > kasa_private.cfg_num('max_gps_accuracy_m') then
    perform kasa_private.fail('KASA_GPS_REQUIRED', 'Stand at the school with location on.');
  end if;
  if (select count(*) from kasa_private.school_suggestions
      where user_id = me.user_id and created_at > now() - interval '1 day') >= kasa_private.cfg_num('school_suggestions_per_day') then
    perform kasa_private.fail('KASA_RATE_LIMIT', 'You have added a lot of schools today. Try again tomorrow.');
  end if;
  perform kasa_private.check_photo(p_photo_path, 'reports', me.user_id, null, p_lat, p_lng);

  insert into kasa_private.school_suggestions (user_id, name, block_name, village, udise_hint, lat, lng, accuracy, photo_path, photo_url)
  values (me.user_id, v_name, v_block, nullif(btrim(left(coalesce(p_village, ''), 80)), ''), v_hint, p_lat, p_lng, p_accuracy,
          p_photo_path, (kasa_private.cfg('storage_public_base') #>> '{}') || p_photo_path)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'status', 'pending');
end $$;

create or replace function public.kasa_admin_school_suggestion_queue() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', g.id, 'created_at', g.created_at, 'name', g.name, 'block_name', g.block_name, 'village', g.village,
      'udise_hint', g.udise_hint, 'lat', g.lat, 'lng', g.lng, 'accuracy', g.accuracy, 'photo_url', g.photo_url,
      'nearby', (select coalesce(jsonb_agg(jsonb_build_object('udise_code', s.udise_code, 'name', s.name)), '[]'::jsonb)
                 from (select s.udise_code, s.name from public.schools s
                       where coalesce(s.lat, s.seen_lat) is not null
                         and kasa_private.distance_m(g.lat, g.lng, coalesce(s.lat, s.seen_lat), coalesce(s.lng, s.seen_lng)) <= 300
                       limit 5) s)) order by g.created_at)
    from kasa_private.school_suggestions g where g.status = 'pending'
  ), '[]'::jsonb);
end $$;

-- Approving needs the school's real UDISE code, looked up by the moderator.
create or replace function public.kasa_admin_moderate_school_suggestion(p_id text, p_action text,
    p_udise_code text default null, p_name text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  g kasa_private.school_suggestions;
  v_code text := nullif(regexp_replace(coalesce(p_udise_code, ''), '[^0-9]', '', 'g'), '');
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  if p_action not in ('approve', 'reject') then perform kasa_private.fail('KASA_BAD_ACTION', 'Approve or reject.'); end if;
  select * into g from kasa_private.school_suggestions where id::text = p_id and status = 'pending' for update;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'That school is not waiting any more.'); end if;
  if p_action = 'approve' then
    if v_code is null or v_code !~ '^[0-9]{11}$' then
      perform kasa_private.fail('KASA_BAD_INPUT', 'Enter the school''s 11-digit UDISE code.');
    end if;
    if exists (select 1 from public.schools where udise_code = v_code) then
      perform kasa_private.fail('KASA_SCHOOL_EXISTS', 'That UDISE code is already on the list.');
    end if;
    insert into public.schools (udise_code, name, block_name, village, seen_lat, seen_lng, seen_checks, added_by_residents)
    values (v_code, left(coalesce(nullif(btrim(p_name), ''), g.name), 140), g.block_name, g.village, g.lat, g.lng, 0, true);
  end if;
  update kasa_private.school_suggestions
  set status = case p_action when 'approve' then 'approved' else 'rejected' end,
      udise_code = case p_action when 'approve' then v_code end, reviewed_at = now(), note = left(p_note, 500)
  where id = g.id returning * into g;
  return jsonb_build_object('id', g.id, 'status', g.status, 'udise_code', g.udise_code);
end $$;

revoke all on function public.kasa_suggest_school(text, text, text, double precision, double precision, double precision, text, text) from public, anon;
grant execute on function public.kasa_suggest_school(text, text, text, double precision, double precision, double precision, text, text) to authenticated;
revoke all on function public.kasa_admin_school_suggestion_queue() from public, anon;
grant execute on function public.kasa_admin_school_suggestion_queue() to authenticated;
revoke all on function public.kasa_admin_moderate_school_suggestion(text, text, text, text, text) from public, anon;
grant execute on function public.kasa_admin_moderate_school_suggestion(text, text, text, text, text) to authenticated;

commit;

notify pgrst, 'reload schema';
