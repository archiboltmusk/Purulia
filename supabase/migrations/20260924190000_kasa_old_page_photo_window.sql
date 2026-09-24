-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — temporary window for pages cached before 24 Sep 2026
--
-- Pages from before migration 20260924160000 upload photos as
-- <folder>/<user id>/<name>.jpg. On 24 Sep 2026 Vercel's free-plan daily
-- deployment limit held the new page back for about a day, so the live page
-- still used that format. Until 'old_photo_paths_until' (26 Sep 2026 06:00
-- UTC), uploads in the old format are accepted again — only into the
-- uploader's own folder. Afterwards they are refused automatically; nothing
-- needs to be undone. (Photo links from such uploads contain the uploader's
-- anonymous ID, as they did before the fix.)
--
-- Safe to re-run. Apply after the earlier migrations.
-- ════════════════════════════════════════════════════════════════════════

begin;

insert into kasa_private.settings (key, value, note) values
  ('old_photo_paths_until', '"2026-09-26T06:00:00Z"',
   'Until then, photos in the pre-24-Sep-2026 <folder>/<user id>/<name> format are accepted from their owner')
on conflict (key) do nothing;

-- True for an old-format path inside the caller's own folder, while the window is open.
create or replace function kasa_private.old_photo_path_ok(p_path text, p_uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(now() < (kasa_private.cfg('old_photo_paths_until') #>> '{}')::timestamptz, false)
     and p_uid is not null
     and p_path ~ '^(reports|claims|votes)/[0-9a-f-]{36}/[A-Za-z0-9_-]{8,64}\.(jpg|jpeg|png|webp)$'
     and split_part(p_path, '/', 2) = p_uid::text
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
  if exists (select 1 from public.reports  where photo_path = p_path)
  or exists (select 1 from kasa_private.claims where photo_path = p_path)
  or exists (select 1 from kasa_private.votes  where photo_path = p_path) then
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
  -- The exact same file is never a new photo, wherever it was used before.
  if exists (select 1 from kasa_private.photo_checks c where c.photo_path <> p_path and c.sha256 = v_chk.sha256) then
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

revoke all on all functions in schema kasa_private from public, anon, authenticated;
grant execute on function kasa_private.is_admin() to authenticated;

-- The upload policy repeats the window inline (no helper call), so it keeps
-- working whatever happens to function privileges. Uploading alone does
-- nothing: check_photo above decides whether a photo can be used.

do $$
declare p record;
begin
  for p in select policyname from pg_policies
           where schemaname = 'storage' and tablename = 'objects'
             and (coalesce(qual, '') ilike '%kasa-photos%' or coalesce(with_check, '') ilike '%kasa-photos%')
  loop
    execute format('drop policy %I on storage.objects', p.policyname);
  end loop;
  execute $p$
    create policy kasa_photos_insert on storage.objects for insert to authenticated
    with check (
      bucket_id = 'kasa-photos'
      and (name ~ '^(reports|claims|votes)/[A-Za-z0-9_-]{16,64}\.(jpg|jpeg|png|webp)$'
           or (now() < '2026-09-26T06:00:00Z'::timestamptz
               and name ~ '^(reports|claims|votes)/[0-9a-f-]{36}/[A-Za-z0-9_-]{8,64}\.(jpg|jpeg|png|webp)$'
               and (storage.foldername(name))[2] = (select auth.uid())::text))
    )
  $p$;
exception when others then
  raise notice 'kasa: could not replace storage policies (%). See SETUP-KASA.md.', sqlerrm;
end $$;

commit;

notify pgrst, 'reload schema';
