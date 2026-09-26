-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — starting pins for major Purulia-II block schools
--
-- These schools were already in public.schools (the district's official
-- list covers all 20 rural blocks) but had no location at all. Coordinates
-- are from a user-supplied list, not surveyed, so — same as the town
-- schools — they go in seen_lat/seen_lng (a learned pin anyone standing
-- there can correct), not the official lat/lng, and only where no pin
-- (official or learned) exists yet.
--
-- Ramakrishna Mission Vidyapith is registered as two rows (English-medium
-- and Bengali-medium sections); both get the same campus location.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

update public.schools set seen_lat = v.lat, seen_lng = v.lng
from (values
  ('19141707002', 23.3578, 86.3872), -- R K MISSION VIDYAPITH -BENG (H S )
  ('19141707004', 23.3578, 86.3872), -- R K MISSION VIDYAPITH - ENG (H S )
  ('19141707003', 23.3585, 86.3855), -- BONGABARI GIRLS HIGH SCHOOL
  ('19141706202', 23.3820, 86.4175), -- CHHARA HIGH SCHOOL (H S )
  ('19141710702', 23.3546, 86.4856), -- HUTMURA HIGH SCHOOL (H S )
  ('19141710703', 23.3552, 86.4840), -- HUTMURA HARIMATI GIRLS HIGH SCHOOL
  ('19141701902', 23.4180, 86.4420)  -- GOLAMARA HIGH SCHOOL (H S )
) as v(udise_code, lat, lng)
where public.schools.udise_code = v.udise_code
  and public.schools.lat is null and public.schools.seen_lat is null;

commit;

notify pgrst, 'reload schema';
