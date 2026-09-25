-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — self-moderation from Google Vision, after the fact
--
-- The report is created before Vision answers (kasa.js fires the photo
-- check but doesn't wait for it, so slow village connections aren't held
-- up — see checkPhoto() in kasa.js). That means a report can already be
-- live on the map by the time we learn what the photo actually shows.
--
-- This migration closes that gap for REPORT photos only (claims/votes
-- already await their Vision check before being created — see
-- api.evidence() in kasa.js — so they never have this gap). When Vision's
-- result lands (kasa_record_photo_check, called by the kasa-photo-check
-- edge function), a still-"approved" report gets moved to "review" —
-- never hidden, never deleted — when:
--
--   • the photo is unsafe (adult/violent content Vision flagged), or
--   • Vision detected a face (privacy — same as the synchronous rule for
--     encroachment/illegal-activity reports), or
--   • every label Vision returned is on the "off_topic_labels" list
--     (selfies, pets, food, screenshots, memes, ...) and none of them is
--     a civic label — so the photo is very likely not of a civic problem.
--
-- Deliberately NOT using garbage_score for this: that score is scoped to
-- "does this look like garbage" for the garbage/drain categories only
-- (see kasa-photo-check/logic.ts and clean_max_garbage_score). A road,
-- streetlight, dry hand pump, school or health-centre photo will always
-- score near 0 there without being a bad photo — using it as a general
-- relevance filter would misfire on exactly the reports most worth
-- keeping. The off-topic check below is a denylist of clearly-not-civic
-- subjects instead of a civic allowlist, so an unexpected but genuine
-- civic label never gets misread as "nothing recognised".
--
-- A report already moved to review/flagged/hidden (by this, a moderator,
-- or the synchronous checks in kasa_create_report) is left alone — this
-- only ever holds an "approved" report once, and only a moderator's own
-- action in admin.html can undo a hold.
--
-- Toggle without a deploy: `update kasa_private.settings set value =
-- 'false' where key = 'self_moderate_photos';`
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

insert into kasa_private.settings (key, value, note) values
  ('self_moderate_photos', 'true',
   'Move a report to review when its Vision result (arriving after creation) turns out unsafe, shows a face, or is off-topic'),
  ('off_topic_labels',
   '["selfie","self portrait","portrait photography","person","human","people","man","woman","child","baby","toddler","smile","skin","hairstyle","forehead","chin","cheek","eyebrow","eyelash","facial expression","facial hair","jaw","nose","ear","pet","dog","cat","kitten","puppy","animal","food","cuisine","dish","recipe","meal","breakfast","lunch","dinner","dessert","screenshot","font","text","document","meme","cartoon","anime","illustration","fictional character","album cover","logo","interior design","room","furniture","selfie stick"]',
   'Vision labels that mean "not a civic photo" when they are the ONLY labels a report photo gets')
on conflict (key) do nothing;

create or replace function kasa_private.self_moderate_photo(p_path text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_chk    kasa_private.photo_checks;
  v_report public.reports;
  v_reason text;
  v_labels text[];
  v_denylist text[];
begin
  if not kasa_private.cfg_bool('self_moderate_photos') then return; end if;

  select * into v_chk from kasa_private.photo_checks where photo_path = p_path;
  if not found then return; end if;

  select * into v_report from public.reports where photo_path = p_path;
  -- Only ever hold a report that is still live and unreviewed; never touch one a
  -- moderator or an earlier check already moved to review/flagged/hidden.
  if not found or v_report.moderation_status <> 'approved' then return; end if;

  if v_chk.unsafe then
    v_reason := 'unsafe_content';
  elsif coalesce(v_chk.face_count, 0) > 0 then
    v_reason := 'face_detected';
  else
    select array_agg(lower(l)) into v_labels from jsonb_array_elements_text(coalesce(v_chk.labels, '[]'::jsonb)) l;
    select array_agg(value #>> '{}') into v_denylist from jsonb_array_elements(kasa_private.cfg('off_topic_labels'));
    if v_labels is not null and array_length(v_labels, 1) > 0 and not exists (
         select 1 from unnest(v_labels) lbl
         where not exists (select 1 from unnest(v_denylist) bad where lbl like '%' || bad || '%')
       ) then
      v_reason := 'off_topic_photo';
    end if;
  end if;

  if v_reason is not null then
    update public.reports set moderation_status = 'review', updated_at = now() where id = v_report.id;
    perform kasa_private.add_event(v_report.id::text, 'moderation_hold', null, null, null, null,
      jsonb_build_object('reason', v_reason, 'labels', v_chk.labels));
  end if;
end $$;

create or replace function public.kasa_record_photo_check(p_path text, p_sha256 text, p_dhash text,
    p_garbage_score double precision, p_labels jsonb, p_unsafe boolean, p_face_count integer,
    p_exif_gps_lat double precision default null, p_exif_gps_lng double precision default null,
    p_exif_match boolean default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into kasa_private.photo_checks (photo_path, sha256, dhash, garbage_score, labels, unsafe, face_count, exif_match)
  values (p_path, p_sha256, p_dhash, p_garbage_score, coalesce(p_labels, '[]'::jsonb), coalesce(p_unsafe, false),
          coalesce(p_face_count, 0), p_exif_match)
  on conflict (photo_path) do nothing;
  if p_path like 'reports/%' then
    perform kasa_private.self_moderate_photo(p_path);
  end if;
end $$;

revoke all on function kasa_private.self_moderate_photo(text) from public, anon, authenticated;
grant execute on function public.kasa_record_photo_check(text,text,text,double precision,jsonb,boolean,integer,double precision,double precision,boolean) to service_role;

commit;

notify pgrst, 'reload schema';
