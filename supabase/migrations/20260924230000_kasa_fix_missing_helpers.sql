-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — repair a partially-applied database
--
-- The live database skipped 20260924190000, so kasa_private.check_photo()
-- (as redefined by 20260924200000) called a missing old_photo_path_ok()
-- and every kasa_create_report / claim / vote failed after the photo upload.
-- The kasa-photo-check Edge Function also sends EXIF GPS fields that
-- kasa_record_photo_check() never accepted, so photo checks were never saved.
--
-- Safe to re-run. Does not touch check_photo().
-- ════════════════════════════════════════════════════════════════════════

begin;

insert into kasa_private.settings (key, value, note) values
  ('old_photo_paths_until', '"2026-09-26T06:00:00Z"',
   'Until then, photos in the pre-24-Sep-2026 <folder>/<user id>/<name> format are accepted from their owner')
on conflict (key) do nothing;

create or replace function kasa_private.old_photo_path_ok(p_path text, p_uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(now() < (kasa_private.cfg('old_photo_paths_until') #>> '{}')::timestamptz, false)
     and p_uid is not null
     and p_path ~ '^(reports|claims|votes)/[0-9a-f-]{36}/[A-Za-z0-9_-]{8,64}\.(jpg|jpeg|png|webp)$'
     and split_part(p_path, '/', 2) = p_uid::text
$$;

alter table kasa_private.photo_checks
  add column if not exists exif_gps_lat double precision,
  add column if not exists exif_gps_lng double precision,
  add column if not exists exif_match boolean;

drop function if exists public.kasa_record_photo_check(text, text, text, double precision, jsonb, boolean, integer);

create or replace function public.kasa_record_photo_check(p_path text, p_sha256 text, p_dhash text,
    p_garbage_score double precision, p_labels jsonb, p_unsafe boolean, p_face_count integer,
    p_exif_gps_lat double precision default null, p_exif_gps_lng double precision default null,
    p_exif_match boolean default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into kasa_private.photo_checks (photo_path, sha256, dhash, garbage_score, labels, unsafe, face_count,
                                         exif_gps_lat, exif_gps_lng, exif_match)
  values (p_path, p_sha256, p_dhash, p_garbage_score, coalesce(p_labels, '[]'::jsonb), coalesce(p_unsafe, false),
          coalesce(p_face_count, 0), p_exif_gps_lat, p_exif_gps_lng, p_exif_match)
  on conflict (photo_path) do nothing;
end $$;

revoke all on function kasa_private.old_photo_path_ok(text, uuid) from public, anon, authenticated;
revoke all on function public.kasa_record_photo_check(text, text, text, double precision, jsonb, boolean, integer,
  double precision, double precision, boolean) from public, anon, authenticated;
grant execute on function public.kasa_record_photo_check(text, text, text, double precision, jsonb, boolean, integer,
  double precision, double precision, boolean) to service_role;

commit;

notify pgrst, 'reload schema';
