-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — cleanup, confirm and dispute photos: live camera only
--
-- Evidence photos must now come from the in-page camera with a valid
-- one-time camera token (see 20260925080000_kasa_live_capture.sql).
-- Gallery files are refused with KASA_LIVE_CAMERA_REQUIRED.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

update kasa_private.settings set value = 'true'::jsonb where key = 'require_live_capture';
