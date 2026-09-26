-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — place a school by moving the map under a pin (like food apps)
--
-- "The school is here" now shows a small map with a pin in the middle; the
-- person drags the map until the pin sits on the school gate. The phone's own
-- GPS fix is sent too, and the chosen spot must be within school_pin_drag_m of
-- it, so nobody can place a school from across town. Without a GPS fix the old
-- behaviour stays: the school goes where the phone is.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

insert into kasa_private.settings (key, value, note) values
  ('school_pin_drag_m', '150', 'How far from the phone''s GPS fix a person may move a school''s pin when placing it')
on conflict (key) do nothing;

drop function if exists public.kasa_mark_school_location(text, double precision, double precision, double precision);

create or replace function public.kasa_mark_school_location(p_udise_code text, p_lat double precision, p_lng double precision,
    p_accuracy double precision, p_gps_lat double precision default null, p_gps_lng double precision default null) returns jsonb
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
  -- The pin may be moved a short way from where the phone actually is, not further.
  if p_gps_lat is not null and p_gps_lng is not null
     and kasa_private.distance_m(p_gps_lat, p_gps_lng, p_lat, p_lng) > kasa_private.cfg_num('school_pin_drag_m') then
    perform kasa_private.fail('KASA_PIN_TOO_FAR', 'Keep the pin close to where you are standing. Walk to the school and try again.');
  end if;
  v_loc := kasa_private.locate(p_lat, p_lng, null);
  if v_loc is null then perform kasa_private.fail('KASA_OUTSIDE_AREA', 'This location is outside Purulia district.'); end if;
  if s.block_name is not null and s.block_name <> 'Purulia Municipality' and v_loc ->> 'block' is not null
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

revoke all on function public.kasa_mark_school_location(text, double precision, double precision, double precision, double precision, double precision) from public, anon;
grant execute on function public.kasa_mark_school_location(text, double precision, double precision, double precision, double precision, double precision) to authenticated;

commit;

notify pgrst, 'reload schema';
