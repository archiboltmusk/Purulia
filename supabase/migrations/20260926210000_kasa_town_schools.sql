-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — first Purulia Municipality schools
--
-- The district list loaded earlier covers the 20 rural blocks only. These are
-- town schools whose UDISE codes could be confirmed from public listings
-- (Banglar Shiksha, schools.org.in). Their starting pins are approximate, so
-- they go in seen_lat/lng (a learned pin anyone standing there can correct),
-- not in the official lat/lng. The full municipality list is still to come.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

insert into public.schools (udise_code, name, block_name, village, seen_lat, seen_lng)
values
  ('19142100508', 'PURULIA ZILLA SCHOOL', 'Purulia Municipality', 'Purulia town', 23.32552, 86.35887),
  ('19142101307', 'PURULIA M.M. HIGH SCHOOL', 'Purulia Municipality', 'Purulia town', 23.32991, 86.36388)
on conflict (udise_code) do update
  set block_name = excluded.block_name,
      seen_lat = coalesce(public.schools.seen_lat, excluded.seen_lat),
      seen_lng = coalesce(public.schools.seen_lng, excluded.seen_lng);

commit;

notify pgrst, 'reload schema';
