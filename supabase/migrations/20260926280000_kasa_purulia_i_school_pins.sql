-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — starting pins for major Purulia-I block schools
--
-- Same as the Purulia-II pins: these schools were already in
-- public.schools from the district's official (WBBSE) list, but had no
-- location. Coordinates are from a user-supplied list, not surveyed, so
-- they go in seen_lat/seen_lng, only where no pin exists yet.
--
-- Two schools from that list are not in this table at all — Sainik
-- School Purulia (Ministry of Defence, CBSE) and G.R.K. D.A.V. Public
-- School (DAV Trust, CBSE) are outside the state WBBSE list this table
-- is built from.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

update public.schools set seen_lat = v.lat, seen_lng = v.lng
from (values
  ('19141605003', 23.3415, 86.3420), -- BELGUMA VIVEKANANDA VIDYAPITH
  ('19141603105', 23.3750, 86.3180), -- BELKURI HIGH SCHOOL
  ('19141607205', 23.2420, 86.4010), -- CHIPIDA VIDYAMANDIR HIGH SCHOOL
  ('19141600904', 23.2795, 86.3812), -- GARAPHUSRA HIGH SCHOOL
  ('19141603905', 23.3698, 86.3225), -- LAGDA HIGH SCHOOL (H S )
  ('19141603906', 23.3695, 86.3210), -- LAGDA GIRLS HIGH SCHOOL
  ('19141607006', 23.2350, 86.4150)  -- PICHASI HIGH SCHOOL
) as v(udise_code, lat, lng)
where public.schools.udise_code = v.udise_code
  and public.schools.lat is null and public.schools.seen_lat is null;

commit;

notify pgrst, 'reload schema';
