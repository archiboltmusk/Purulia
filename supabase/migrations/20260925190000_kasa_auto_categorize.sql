-- ════════════════════════════════════════════════════════════════════════
-- PARISHKAR PURULIA — auto-categorize from the photo (fix: everything was "Other")
--
-- The zero-tap report flow never asks the citizen to pick a category — the
-- category grid was removed from kasa.html on purpose, so filing a report
-- is camera + GPS + submit, nothing else. kasa_create_report defaults an
-- unset category to 'other'. Nothing ever changed that after the fact, so
-- a genuinely photographed pothole/broken road sat in the public feed as
-- "Other civic problem" forever, along with every drain, streetlight and
-- water report — weakening ward analytics and routing every one of them to
-- the generic municipality chain instead of the right department.
--
-- Google Vision is already called on every report photo, asynchronously,
-- for self-moderation (kasa_private.self_moderate_photo, hooked into
-- kasa_record_photo_check). This adds a second, independent hook off the
-- same photo check: if the report is still sitting at the 'other' default
-- and Vision's labels clearly match one of the plain physical-object
-- categories, recategorize it — the same way a moderator's
-- kasa_admin_recategorize would, on the public record as a 'recategorized'
-- event.
--
-- Deliberately narrow:
--   * Only ever fires while category = 'other' — a category a citizen (or
--     a future UI) explicitly set is never touched.
--   * Only assigns categories Vision's object labels can actually speak to
--     (road, drain, streetlight, water, garbage). Never encroachment /
--     illegal_construction / illegal_mining / illegal_other — those need a
--     moderator's judgement about legality, which a label like "building"
--     or "excavator" cannot establish.
--   * A toggle (auto_categorize_photos) so it can be switched off without
--     a deploy, same pattern as self_moderate_photos.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

insert into kasa_private.settings (key, value, note) values
  ('auto_categorize_photos', 'true', 'Recategorize an "other" report from its Vision photo labels')
on conflict (key) do nothing;

create or replace function kasa_private.auto_categorize_photo(p_path text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_chk    kasa_private.photo_checks;
  v_report public.reports;
  v_labels text[];
  v_cat    text;
begin
  if not kasa_private.cfg_bool('auto_categorize_photos') then return; end if;

  select * into v_chk from kasa_private.photo_checks where photo_path = p_path;
  if not found or v_chk.labels is null then return; end if;

  -- Also matches school-audit photos (same 'reports/' storage folder); those aren't in
  -- public.reports at all, so this is a no-op for them, same as self_moderate_photo.
  select * into v_report from public.reports where photo_path = p_path;
  if not found or v_report.category <> 'other' then return; end if;

  select array_agg(lower(l)) into v_labels from jsonb_array_elements_text(v_chk.labels) l;
  if v_labels is null then return; end if;

  v_cat := case
    -- Deliberately no bare "road" or "street": Vision returns those for almost any
    -- outdoor photo (a streetlight, roadside garbage), which would misfire constantly.
    when exists (select 1 from unnest(v_labels) l where l ~ 'pothole|asphalt|road surface|road marking|highway|tarmac')
      then 'road'
    when exists (select 1 from unnest(v_labels) l where l ~ 'drain|sewer|gutter|manhole')
      then 'drain'
    when exists (select 1 from unnest(v_labels) l where l ~ 'street light|streetlight|lamppost|lamp post|light fixture')
      then 'streetlight'
    when exists (select 1 from unnest(v_labels) l where l ~ 'water pipe|water tap|tap water|hand ?pump|water tank|drinking water')
      then 'water'
    when exists (select 1 from unnest(v_labels) l where l ~ 'garbage|trash|waste|litter|rubbish|landfill|dump')
      then 'garbage'
    else null
  end;
  if v_cat is null then return; end if;

  update public.reports set category = v_cat, updated_at = now() where id = v_report.id;
  -- A distinct kind from 'recategorized': that one's timeline heading says "changed by a
  -- moderator", which would misattribute this automated match to a human.
  perform kasa_private.add_event(v_report.id::text, 'auto_recategorized', null, null, null, null,
    jsonb_build_object('from', v_report.category, 'to', v_cat));
end $$;

create or replace function public.kasa_record_photo_check(p_path text, p_sha256 text, p_dhash text, p_garbage_score double precision,
    p_labels jsonb, p_unsafe boolean, p_face_count integer, p_exif_gps_lat double precision default null,
    p_exif_gps_lng double precision default null, p_exif_match boolean default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into kasa_private.photo_checks (photo_path, sha256, dhash, garbage_score, labels, unsafe, face_count, exif_match)
  values (p_path, p_sha256, p_dhash, p_garbage_score, coalesce(p_labels, '[]'::jsonb), coalesce(p_unsafe, false),
          coalesce(p_face_count, 0), p_exif_match)
  on conflict (photo_path) do nothing;
  if p_path like 'reports/%' then
    perform kasa_private.auto_categorize_photo(p_path);
    perform kasa_private.self_moderate_photo(p_path);
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
