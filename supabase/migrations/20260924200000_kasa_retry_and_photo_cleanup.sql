-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — honest retries, and photo cleanup through the Storage API
--
-- 1. A photo counts as "already used" only if a report, cleanup claim or
--    confirmation actually uses it. Before, a refused attempt (too far, weak
--    GPS…) left the photo's fingerprint behind, so trying again with the same
--    photo was refused as "already used".
--
-- 2. Supabase blocks deleting rows from storage.objects with SQL (the files
--    would stay behind in the object store), so the weekly cleanup failed.
--    Unused uploads older than two days are now listed here and removed by
--    the kasa-cleanup Edge Function through the Storage API. The weekly job
--    asks that function to run.
--
-- Safe to re-run. Apply after the earlier migrations.
-- ════════════════════════════════════════════════════════════════════════

begin;

insert into kasa_private.settings (key, value, note) values
  ('functions_url', '"https://cnmikcyvyamplbldiivp.supabase.co/functions/v1"', 'Where the Edge Functions live'),
  ('public_anon_key', '"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNubWlrY3l2eWFtcGxibGRpaXZwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyMzY0MDEsImV4cCI6MjEwNTgxMjQwMX0.h4nOvb0GWz92A_GuH-RPX90wUIRvza4RvsD9TA-XiM0"',
   'The public (anon) key from config.js, used to call kasa-cleanup; not a secret')
on conflict (key) do nothing;

create or replace function kasa_private.photo_in_use(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.reports r where r.photo_path = p_path)
      or exists (select 1 from kasa_private.claims c where c.photo_path = p_path)
      or exists (select 1 from kasa_private.votes v where v.photo_path = p_path)
$$;

create or replace function kasa_private.check_photo(p_path text, p_folder text, p_uid uuid, p_not_before timestamptz,
                                                    p_lat double precision, p_lng double precision)
returns kasa_private.photo_checks
language plpgsql security definer set search_path = '' as $$
declare
  v_created timestamptz;
  v_owner   text;
  v_chk     kasa_private.photo_checks;
  v_near    integer := kasa_private.cfg_num('near_duplicate_distance')::integer;
  v_far     double precision := kasa_private.cfg_num('elsewhere_radius_m');
begin
  if p_path is null or (p_path !~ ('^' || p_folder || '/[A-Za-z0-9_-]{16,64}\.(jpg|jpeg|png|webp)$')
                        and not (p_path like p_folder || '/%' and kasa_private.old_photo_path_ok(p_path, p_uid))) then
    perform kasa_private.fail('KASA_PHOTO_INVALID', 'A photo is required.');
  end if;

  select o.created_at, coalesce(o.owner_id::text, o.owner::text) into v_created, v_owner
  from storage.objects o where o.bucket_id = 'kasa-photos' and o.name = p_path;
  if not found then
    perform kasa_private.fail('KASA_PHOTO_MISSING', 'Upload the photo first.');
  end if;
  if v_owner is distinct from p_uid::text then
    perform kasa_private.fail('KASA_PHOTO_NOT_YOURS', 'You can only submit photos you uploaded.');
  end if;
  if v_created < coalesce(p_not_before, '-infinity') or v_created < now() - interval '24 hours' then
    perform kasa_private.fail('KASA_PHOTO_STALE', 'Take a new photo now — older uploads can''t be used.');
  end if;
  if kasa_private.photo_in_use(p_path) then
    perform kasa_private.fail('KASA_PHOTO_REUSED', 'This photo has already been used.');
  end if;

  select * into v_chk from kasa_private.photo_checks where photo_path = p_path;
  if not found then
    if kasa_private.cfg_bool('require_photo_check') then
      perform kasa_private.fail('KASA_PHOTO_UNCHECKED', 'Photo verification is unavailable right now. Try again shortly.');
    end if;
    return null;
  end if;
  if v_chk.unsafe then
    perform kasa_private.fail('KASA_PHOTO_UNSAFE', 'This photo can''t be published.');
  end if;
  -- The exact same file, already used somewhere, is never a new photo. (An
  -- upload that was never used — a refused attempt — doesn't count, so an
  -- honest retry with the same photo works.)
  if exists (select 1 from kasa_private.photo_checks c
             where c.photo_path <> p_path and c.sha256 = v_chk.sha256 and kasa_private.photo_in_use(c.photo_path)) then
    perform kasa_private.fail('KASA_PHOTO_REUSED', 'This photo has already been used. Take a new one.');
  end if;
  -- A look-alike of a photo used at a different place was taken somewhere else.
  -- (Look-alikes at the same spot are allowed: honest people photographing the
  -- same clean corner produce near-identical pictures.)
  if p_lat is not null and exists (
      select 1 from kasa_private.photo_checks c
      join lateral (
        select r.lat, r.lng from public.reports r where r.photo_path = c.photo_path
        union all select cl.lat, cl.lng from kasa_private.claims cl where cl.photo_path = c.photo_path
        union all select v.lat, v.lng from kasa_private.votes v where v.photo_path = c.photo_path
      ) used on true
      where c.photo_path <> p_path
        and kasa_private.photo_distance(c.dhash, v_chk.dhash) <= v_near
        and kasa_private.distance_m(used.lat, used.lng, p_lat, p_lng) > v_far) then
    perform kasa_private.fail('KASA_PHOTO_ELSEWHERE', 'This photo matches one taken at a different place.');
  end if;
  return v_chk;
end $$;

-- ── Photo cleanup ────────────────────────────────────────────────────────
-- Uploads nothing uses, older than two days (the page uses a photo within
-- seconds of uploading it). Service role only: the kasa-cleanup function.
create or replace function public.kasa_orphan_photos(p_limit integer default 500) returns setof text
language sql stable security definer set search_path = '' as $$
  select o.name from storage.objects o
  where o.bucket_id = 'kasa-photos'
    and o.created_at < now() - interval '2 days'
    and o.name !~ '\.emptyFolderPlaceholder$'
    and not kasa_private.photo_in_use(o.name)
    and not exists (select 1 from public.reports r
                    where r.photo_url like ('%/kasa-photos/' || o.name) or r.resolved_photo_url like ('%/kasa-photos/' || o.name))
  order by o.created_at
  limit greatest(1, least(coalesce(p_limit, 500), 1000))
$$;

-- After the Storage API removed them: forget what we stored about those photos.
create or replace function public.kasa_photos_removed(p_paths text[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  n integer := coalesce(array_length(p_paths, 1), 0);
begin
  delete from kasa_private.photo_checks where photo_path = any (p_paths) and not kasa_private.photo_in_use(photo_path);
  delete from kasa_private.photo_meta   where photo_path = any (p_paths) and not kasa_private.photo_in_use(photo_path);
  if to_regclass('public.automation_log') is not null then
    insert into public.automation_log (job_name, result, ran_at)
    values ('photo_cleanup', jsonb_build_object('removed', n, 'ran_at', now()), now());
  end if;
  return n;
end $$;

-- Called by the weekly job: counts unused uploads and asks kasa-cleanup to
-- remove them. Never deletes rows itself.
create or replace function public.cleanup_orphaned_photos() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  n     integer;
  v_url text := kasa_private.cfg('functions_url') #>> '{}';
  v_key text := kasa_private.cfg('public_anon_key') #>> '{}';
begin
  select count(*) into n from public.kasa_orphan_photos(1000);
  if n > 0 and v_url is not null and v_key is not null
     and to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is not null then
    execute 'select net.http_post($1, ''{}''::jsonb, ''{}''::jsonb, $2, 30000)'
      using v_url || '/kasa-cleanup',
            jsonb_build_object('Content-Type', 'application/json', 'apikey', v_key, 'Authorization', 'Bearer ' || v_key);
  end if;
  return n;
end $$;

revoke all on function public.kasa_orphan_photos(integer) from public, anon, authenticated;
revoke all on function public.kasa_photos_removed(text[]) from public, anon, authenticated;
revoke all on function public.cleanup_orphaned_photos() from public, anon, authenticated;
do $$ begin
  execute 'grant execute on function public.kasa_orphan_photos(integer), public.kasa_photos_removed(text[]) to service_role';
exception when undefined_object then null; end $$;
revoke all on all functions in schema kasa_private from public, anon, authenticated;
grant execute on function kasa_private.is_admin() to authenticated;

commit;

notify pgrst, 'reload schema';
