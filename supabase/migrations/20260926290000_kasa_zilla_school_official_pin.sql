-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — Purulia Zilla School's official location
--
-- Purulia Zilla School had picked up a seen_lat/seen_lng "learned from
-- checks" pin (the average of its approved school_audits) that drifted from
-- its real location. Rather than overwrite that computed average directly —
-- kasa_private.learn_school_location() recomputes it from public.school_audits
-- on every new approved check, so a plain edit there would eventually be
-- blended away — this sets the official lat/lng instead, which the map and
-- kasa_school_coverage() already prefer over any learned pin. It's a
-- well-known landmark school, so this is treated as ground truth, not
-- another guess to average in.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

update public.schools set lat = 23.3326, lng = 86.3644 where udise_code = '19142100508';

commit;

notify pgrst, 'reload schema';
