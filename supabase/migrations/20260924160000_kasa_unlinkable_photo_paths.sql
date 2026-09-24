-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA v2.1 — photo links no longer reveal who uploaded them
--
-- v2 stored uploads as <folder>/<user id>/<name>.jpg. Photo links are public,
-- so anyone could group every report, cleanup claim and confirmation made by
-- the same (anonymous) person — the opposite of the per-report pseudonyms the
-- evidence trail and Privacy Policy promise. Uploads now go to
-- <folder>/<random name>.jpg. Who uploaded a photo is still checked on the
-- server, from the owner Supabase Storage records for every upload.
--
-- Safe to re-run. Apply after 20260924120000_kasa_v2_accountability.sql.
-- ════════════════════════════════════════════════════════════════════════

begin;

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
  if p_path is null or p_path !~ ('^' || p_folder || '/[A-Za-z0-9_-]{16,64}\.(jpg|jpeg|png|webp)$') then
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

-- Lets the kasa-photo-check Edge Function confirm the caller uploaded the photo
-- before it spends a Vision request on it. Service role only.
create or replace function public.kasa_photo_owner(p_path text) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(o.owner_id::text, o.owner::text)
  from storage.objects o where o.bucket_id = 'kasa-photos' and o.name = p_path
$$;
revoke all on function public.kasa_photo_owner(text) from public, anon, authenticated;
grant execute on function public.kasa_photo_owner(text) to service_role;

-- Uploads: signed-in users only, into reports/claims/votes, random flat names.
-- No update or delete policy, so nobody can overwrite or remove evidence, and
-- no select policy, so the bucket can't be listed (links still work because
-- the bucket is public).
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
      and name ~ '^(reports|claims|votes)/[A-Za-z0-9_-]{16,64}\.(jpg|jpeg|png|webp)$'
    )
  $p$;
exception when others then
  raise notice 'kasa: could not replace storage policies (%). See SETUP-KASA.md.', sqlerrm;
end $$;

commit;

notify pgrst, 'reload schema';
