-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — five more Purulia Municipality schools
--
-- UDISE codes confirmed from schools.org.in and purulia.gov.in, matched by
-- ward number against the user-supplied list. Starting pins are approximate
-- (from that list, not surveyed), so they go in seen_lat/seen_lng — a
-- learned pin anyone standing there can correct — not the official lat/lng,
-- same as Purulia Zilla School and Purulia M.M. High School before them.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

insert into public.schools (udise_code, name, block_name, village, seen_lat, seen_lng)
values
  ('19142100302', 'GOVT. GIRLS HIGH SCHOOL (H.S)', 'Purulia Municipality', 'Purulia town', 23.3308, 86.3615),
  ('19142100509', 'MANBHUM VICTORIA INSTITUTION',  'Purulia Municipality', 'Purulia town', 23.3312, 86.3598),
  ('19142100604', 'PURULIA NETAJI VIDYAPITH',       'Purulia Municipality', 'Purulia town', 23.3341, 86.3682),
  ('19142101306', 'CHITTARANJAN HIGH SCHOOL',       'Purulia Municipality', 'Purulia town', 23.3298, 86.3621),
  ('19142101802', 'RAJASTHAN VIDYAPITH',            'Purulia Municipality', 'Purulia town', 23.3365, 86.3650)
on conflict (udise_code) do update
  set block_name = excluded.block_name,
      seen_lat = coalesce(public.schools.seen_lat, excluded.seen_lat),
      seen_lng = coalesce(public.schools.seen_lng, excluded.seen_lng);

commit;

notify pgrst, 'reload schema';
