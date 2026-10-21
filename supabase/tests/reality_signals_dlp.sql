-- Local PostGIS check for kasa_private.reality_signals_dlp_run (phase 2a). Not run by supabase/tests/run.sh:
-- CI has no PostGIS. Run against a database with the migrations applied and PostGIS installed:
--   psql -d <db> -v ON_ERROR_STOP=1 -f supabase/tests/reality_signals_dlp.sql
-- Synthetic fixtures only (example.invalid URLs). Expects: 1 candidate with 4 reporters; re-run keeps a rejected status;
-- the 2-reporter cluster and the out-of-window report are excluded.
set session_replication_role = replica;  -- fixtures only: skip the probable-link guard
do $$
declare w bigint; a bigint;
begin
  insert into kasa_private.works (portal, title, source_url, status, completed_on, dlp_months, dlp_source_url, completion_source_url)
    values ('wbtenders', 'Test road repair (fixture)', 'https://example.invalid/nit', 'completed', date '2026-01-01', 12,
            'https://example.invalid/agreement', 'https://example.invalid/completion') returning id into w;
  insert into kasa_private.assets (kind, name, ref, geometry, source, source_url, licence)
    values ('road', 'Fixture road', 'FX-1', '{"type":"LineString","coordinates":[[86.3640,23.3300],[86.3670,23.3300]]}', 'osm', 'https://example.invalid/osm', 'ODbL')
    returning id into a;
  insert into kasa_private.work_assets (work_id, asset_id, status, proposed_by, match_method, confirmed_by, reviewed_at)
    values (w, a, 'confirmed', 'moderator', 'name', gen_random_uuid(), now());
end $$;
insert into public.reports (id, lat, lng, category, waste_type, moderation_status, photo_path, reporter_hash, created_at, status) values ('00000000-0000-0000-0000-000000000011', 23.33, 86.3665, 'road', 'pothole', 'approved', 'photos/p1.jpg', 'r-a', '2026-03-02T10:00:00+05:30', 'open');
insert into kasa_private.photo_meta (photo_path, user_id, capture, taken_at, exif_distance_m) values ('photos/p1.jpg', '00000000-0000-0000-0000-000000000099', 'live', '2026-03-02T10:00:00+05:30', 4);
insert into public.reports (id, lat, lng, category, waste_type, moderation_status, photo_path, reporter_hash, created_at, status) values ('00000000-0000-0000-0000-000000000012', 23.33, 86.36652, 'road', 'pothole', 'approved', 'photos/p2.jpg', 'r-b', '2026-03-05T10:00:00+05:30', 'open');
insert into kasa_private.photo_meta (photo_path, user_id, capture, taken_at, exif_distance_m) values ('photos/p2.jpg', '00000000-0000-0000-0000-000000000099', 'live', '2026-03-05T10:00:00+05:30', 4);
insert into public.reports (id, lat, lng, category, waste_type, moderation_status, photo_path, reporter_hash, created_at, status) values ('00000000-0000-0000-0000-000000000013', 23.33, 86.36654, 'road', 'pothole', 'approved', 'photos/p3.jpg', 'r-c', '2026-03-09T10:00:00+05:30', 'open');
insert into kasa_private.photo_meta (photo_path, user_id, capture, taken_at, exif_distance_m) values ('photos/p3.jpg', '00000000-0000-0000-0000-000000000099', 'live', '2026-03-09T10:00:00+05:30', 4);
insert into public.reports (id, lat, lng, category, waste_type, moderation_status, photo_path, reporter_hash, created_at, status) values ('00000000-0000-0000-0000-000000000014', 23.33, 86.36656, 'road', 'pothole', 'approved', 'photos/p4.jpg', 'r-d', '2026-03-11T10:00:00+05:30', 'open');
insert into kasa_private.photo_meta (photo_path, user_id, capture, taken_at, exif_distance_m) values ('photos/p4.jpg', '00000000-0000-0000-0000-000000000099', 'live', '2026-03-11T10:00:00+05:30', 4);
insert into public.reports (id, lat, lng, category, waste_type, moderation_status, photo_path, reporter_hash, created_at, status) values ('00000000-0000-0000-0000-000000000021', 23.33, 86.3663, 'road', 'pothole', 'approved', 'photos/q1.jpg', 'r-a', '2026-03-02T10:00:00+05:30', 'open');
insert into kasa_private.photo_meta (photo_path, user_id, capture, taken_at, exif_distance_m) values ('photos/q1.jpg', '00000000-0000-0000-0000-000000000099', 'live', '2026-03-02T10:00:00+05:30', 4);
insert into public.reports (id, lat, lng, category, waste_type, moderation_status, photo_path, reporter_hash, created_at, status) values ('00000000-0000-0000-0000-000000000022', 23.33, 86.36631, 'road', 'pothole', 'approved', 'photos/q2.jpg', 'r-e', '2026-03-02T10:00:00+05:30', 'open');
insert into kasa_private.photo_meta (photo_path, user_id, capture, taken_at, exif_distance_m) values ('photos/q2.jpg', '00000000-0000-0000-0000-000000000099', 'live', '2026-03-02T10:00:00+05:30', 4);
insert into public.reports (id, lat, lng, category, waste_type, moderation_status, photo_path, reporter_hash, created_at, status) values ('00000000-0000-0000-0000-000000000031', 23.33, 86.36658, 'road', 'pothole', 'approved', 'photos/o1.jpg', 'r-f', '2027-06-01T10:00:00+05:30', 'open');
insert into kasa_private.photo_meta (photo_path, user_id, capture, taken_at, exif_distance_m) values ('photos/o1.jpg', '00000000-0000-0000-0000-000000000099', 'live', '2027-06-01T10:00:00+05:30', 4);
select kasa_private.reality_signals_dlp_run();
select status, report_count, distinct_reporters from kasa_private.reality_signals;
update kasa_private.reality_signals set status='rejected', reviewed_at=now();
select kasa_private.reality_signals_dlp_run();
select status, report_count from kasa_private.reality_signals;
