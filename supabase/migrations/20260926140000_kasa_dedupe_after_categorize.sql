-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — catch duplicates once the photo check names the category
--
-- Quick reports arrive with no category; kasa_create_report files them as
-- "other" and runs its duplicate/recurrence check then, so two garbage photos
-- of the same pile were never linked: at that moment both were "other".
-- auto_categorize_photo then set "garbage" without looking again.
--
-- kasa_private.link_report() now re-runs the same check for one report, and
-- auto_categorize_photo calls it after changing the category. Duplicates join
-- the earlier report (its "people saw this" count goes up); a problem back at
-- a recently fixed spot is recorded as a recurrence. duplicate_radius_m goes
-- from 25 to 40 m, since two phones at the same pile often disagree by that
-- much. Existing unlinked reports are checked once.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

update kasa_private.settings set value = '40'::jsonb where key = 'duplicate_radius_m' and value = '25'::jsonb;

create or replace function kasa_private.link_report(p_id text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  r       public.reports;
  v_par   public.reports;
  v_recur public.reports;
begin
  select * into r from public.reports where id::text = p_id for update;
  if not found or r.parent_report_id is not null or coalesce(r.is_duplicate, false) or r.status <> 'open'
     or r.moderation_status = 'hidden' or r.category = 'other' then
    return 'skip';
  end if;
  -- Something already joined this report, so it is the original, not a copy.
  if exists (select 1 from public.reports c where c.parent_report_id = r.id and coalesce(c.is_duplicate, false)) then
    return 'skip';
  end if;

  select * into v_par from public.reports o
  where o.id <> r.id and o.category = r.category and o.status in ('open', 'claimed')
    and not coalesce(o.is_duplicate, false) and o.moderation_status <> 'hidden'
    and o.created_at < r.created_at
    and o.created_at > r.created_at - make_interval(hours => kasa_private.cfg_num('duplicate_hours')::integer)
    and kasa_private.distance_m(o.lat, o.lng, r.lat, r.lng) <= kasa_private.cfg_num('duplicate_radius_m')
  order by kasa_private.distance_m(o.lat, o.lng, r.lat, r.lng), o.created_at
  limit 1;

  if v_par.id is not null then
    update public.reports set is_duplicate = true, parent_report_id = v_par.id, updated_at = now() where id = r.id;
    insert into kasa_private.seen (report_id, user_id, on_site, distance_m)
    values (v_par.id, r.user_id, r.accuracy_m is not null and r.accuracy_m <= kasa_private.cfg_num('max_gps_accuracy_m'),
            kasa_private.distance_m(v_par.lat, v_par.lng, r.lat, r.lng))
    on conflict do nothing;
    if found then
      update public.reports set upvotes = coalesce(upvotes, 0) + 1,
             seen_on_site = seen_on_site + (case when r.accuracy_m is not null
               and r.accuracy_m <= kasa_private.cfg_num('max_gps_accuracy_m') then 1 else 0 end)
      where id = v_par.id;
    end if;
    return 'duplicate';
  end if;

  select * into v_recur from public.reports o
  where o.id <> r.id and o.category = r.category and o.status = 'resolved'
    and o.resolved_at < r.created_at
    and o.resolved_at > r.created_at - make_interval(days => kasa_private.cfg_num('recurrence_days')::integer)
    and kasa_private.distance_m(o.lat, o.lng, r.lat, r.lng) <= kasa_private.cfg_num('duplicate_radius_m')
  order by o.resolved_at desc
  limit 1;

  if v_recur.id is not null then
    update public.reports set parent_report_id = v_recur.id, updated_at = now() where id = r.id;
    update public.reports set recurrence_count = recurrence_count + 1 where id = v_recur.id;
    perform kasa_private.add_event(v_recur.id::text, 'recurred', r.user_id, null, r.photo_url, null,
      jsonb_build_object('new_report_id', r.id));
    return 'recurrence';
  end if;
  return 'new';
end $$;
revoke all on function kasa_private.link_report(text) from public, anon, authenticated;

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
  -- It was filed as "other", so the duplicate check at filing time couldn't match it.
  perform kasa_private.link_report(v_report.id::text);
end $$;
revoke all on function kasa_private.auto_categorize_photo(text) from public, anon, authenticated;

-- Check open reports that were filed alone, oldest first, so the earliest stays the original.
do $$
declare v_id text;
begin
  for v_id in select id::text from public.reports
              where status = 'open' and parent_report_id is null and not coalesce(is_duplicate, false)
                and created_at > now() - make_interval(hours => kasa_private.cfg_num('duplicate_hours')::integer)
              order by created_at
  loop
    perform kasa_private.link_report(v_id);
  end loop;
end $$;

commit;

notify pgrst, 'reload schema';
