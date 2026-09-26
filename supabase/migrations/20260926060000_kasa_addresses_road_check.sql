-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — written addresses, and a road check for road reports
--
-- Addresses: each report gets a short written place ("NC Dasgupta Road ·
-- near Town Hall") from OpenStreetMap, looked up once by the kasa-geocode
-- Edge Function and saved. A new report pings the function; an hourly job
-- fills in anything missed (and older reports). The function only works on
-- reports the database hands out, so calling it directly can't write an
-- address anyone chose. Addresses are public through kasa_report_addresses().
--
-- Road check: a road report whose photo Vision labels, but with nothing
-- road-like among the labels, goes to moderator review (never hidden).
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

alter table public.reports
  add column if not exists address text,
  add column if not exists address_tries smallint not null default 0,
  add column if not exists address_claimed_at timestamptz;

create or replace function public.kasa_geocode_claim(p_limit integer default 10) returns jsonb
language sql security definer set search_path = '' as $$
  with c as (
    update public.reports r set address_claimed_at = now(), address_tries = r.address_tries + 1
    where r.id in (
      select id from public.reports
      where address is null and address_tries < 3 and lat is not null and lng is not null
        and (address_claimed_at is null or address_claimed_at < now() - interval '10 minutes')
      order by created_at desc
      limit greatest(1, least(coalesce(p_limit, 10), 40))
      for update skip locked)
    returning r.id, r.lat, r.lng)
  select coalesce(jsonb_agg(jsonb_build_object('id', id::text, 'lat', lat, 'lng', lng)), '[]'::jsonb) from c
$$;

drop function if exists public.kasa_geocode_done(text, text);
-- p_retry: the lookup service was busy; hand the report back without using up a try.
create or replace function public.kasa_geocode_done(p_id text, p_address text, p_retry boolean default false) returns void
language sql security definer set search_path = '' as $$
  update public.reports
  set address = nullif(left(regexp_replace(trim(coalesce(p_address, '')), '[\r\n<>]+', ' ', 'g'), 120), ''),
      address_tries = case when p_retry then greatest(address_tries - 1, 0) else address_tries end,
      address_claimed_at = null
  where id::text = p_id
$$;

-- Public: addresses of visible reports only.
create or replace function public.kasa_report_addresses() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(r.id::text, r.address), '{}'::jsonb)
  from public.reports r
  where r.address is not null and r.moderation_status in ('approved', 'flagged')
$$;

revoke all on function public.kasa_geocode_claim(integer) from public, anon, authenticated;
revoke all on function public.kasa_geocode_done(text, text, boolean) from public, anon, authenticated;
grant execute on function public.kasa_geocode_claim(integer), public.kasa_geocode_done(text, text, boolean) to service_role;
revoke all on function public.kasa_report_addresses() from public;
grant execute on function public.kasa_report_addresses() to anon, authenticated;

create or replace function kasa_private.ping_geocode() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_url text := kasa_private.cfg('functions_url') #>> '{}';
  v_key text := kasa_private.cfg('public_anon_key') #>> '{}';
begin
  if v_url is not null and v_key is not null
     and to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is not null then
    execute 'select net.http_post($1, ''{}''::jsonb, ''{}''::jsonb, $2, 60000)'
      using v_url || '/kasa-geocode',
            jsonb_build_object('Content-Type', 'application/json', 'apikey', v_key, 'Authorization', 'Bearer ' || v_key);
  end if;
  return null;
exception when others then
  return null;  -- an address lookup must never block a report
end $$;
revoke all on function kasa_private.ping_geocode() from public, anon, authenticated;

drop trigger if exists kasa_geocode on public.reports;
create trigger kasa_geocode after insert on public.reports
  for each statement execute function kasa_private.ping_geocode();

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.unschedule('kasa-geocode') where exists (select 1 from cron.job where jobname = 'kasa-geocode');
    perform cron.schedule('kasa-geocode', '17 * * * *', $job$
      select net.http_post(
        (kasa_private.cfg('functions_url') #>> '{}') || '/kasa-geocode', '{}'::jsonb, '{}'::jsonb,
        jsonb_build_object('Content-Type', 'application/json',
                           'apikey', kasa_private.cfg('public_anon_key') #>> '{}',
                           'Authorization', 'Bearer ' || (kasa_private.cfg('public_anon_key') #>> '{}')),
        60000)
    $job$);
  end if;
exception when others then
  raise notice 'kasa: geocode scheduling skipped (%)', sqlerrm;
end $$;

-- ── Road check ───────────────────────────────────────────────────────────
insert into kasa_private.settings (key, value, note) values
  ('road_labels',
   '["road","street","asphalt","pothole","lane","highway","pavement","sidewalk","path","gravel","soil","mud","dirt","puddle","tar","thoroughfare","infrastructure","road surface","concrete","rural area","land lot","alley","track","water","crack","bitumen","trail","pedestrian"]',
   'Vision labels that count as "shows a road" for road reports; a road photo with none of them goes to review')
on conflict (key) do nothing;

create or replace function kasa_private.self_moderate_photo(p_path text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_chk    kasa_private.photo_checks;
  v_report public.reports;
  v_reason text;
  v_labels text[];
  v_denylist text[];
begin
  if not kasa_private.cfg_bool('self_moderate_photos') then return; end if;

  select * into v_chk from kasa_private.photo_checks where photo_path = p_path;
  if not found then return; end if;

  select * into v_report from public.reports where photo_path = p_path;
  if not found or v_report.moderation_status <> 'approved' then return; end if;

  select array_agg(lower(l)) into v_labels from jsonb_array_elements_text(coalesce(v_chk.labels, '[]'::jsonb)) l;

  if v_chk.unsafe then
    v_reason := 'unsafe_content';
  elsif coalesce(v_chk.face_count, 0) > 0 then
    v_reason := 'face_detected';
  else
    select array_agg(value #>> '{}') into v_denylist from jsonb_array_elements(kasa_private.cfg('off_topic_labels'));
    if v_labels is not null and array_length(v_labels, 1) > 0 and not exists (
         select 1 from unnest(v_labels) lbl
         where not exists (select 1 from unnest(v_denylist) bad where lbl like '%' || bad || '%')
       ) then
      v_reason := 'off_topic_photo';
    elsif v_report.category = 'road' and v_labels is not null and array_length(v_labels, 1) > 0 and not exists (
         select 1 from unnest(v_labels) lbl, jsonb_array_elements_text(coalesce(kasa_private.cfg('road_labels'), '[]'::jsonb)) ok
         where lbl like '%' || ok || '%') then
      v_reason := 'no_road_in_photo';
    end if;
  end if;

  if v_reason is not null then
    update public.reports set moderation_status = 'review', updated_at = now() where id = v_report.id;
    perform kasa_private.add_event(v_report.id::text, 'moderation_hold', null, null, null, null,
      jsonb_build_object('reason', v_reason, 'labels', v_chk.labels));
  end if;
end $$;
revoke all on function kasa_private.self_moderate_photo(text) from public, anon, authenticated;

commit;

notify pgrst, 'reload schema';
