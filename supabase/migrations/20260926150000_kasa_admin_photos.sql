-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — admins decide which photos stay
--
-- Several people photographing the same pile fill a report with near-identical
-- pictures. Admins (not moderators) can now remove:
--   • an extra photo of a report (positions 2–3), or
--   • a duplicate report that joined it (its photo goes with it; the "people
--     saw this" count the duplicate added stays, since that person was there).
-- The report's own first photo stays: it is the evidence the report stands on;
-- a wrong report is hidden instead. Every removal is a public "moderator
-- action" on the report's timeline with the admin's reason. Removed files are
-- deleted from storage by the existing kasa-cleanup job once nothing uses them.
--
-- kasa_admin_report_photos(id) lists a report's photos for the admin page;
-- kasa_admin_repeat_photos() lists recent duplicates across all reports.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

create or replace function public.kasa_admin_report_photos(p_report_id text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r public.reports;
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  select * into r from public.reports where id::text = p_report_id;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'Report not found.'); end if;
  return jsonb_build_object(
    'main', r.photo_url,
    'extras', coalesce((select jsonb_agg(jsonb_build_object('position', p.position, 'photo_url', p.photo_url) order by p.position)
                        from kasa_private.report_photos p where p.report_id = r.id), '[]'::jsonb),
    'duplicates', coalesce((select jsonb_agg(jsonb_build_object('id', d.id::text, 'photo_url', d.photo_url, 'created_at', d.created_at,
                                                               'moderation_status', d.moderation_status) order by d.created_at)
                            from public.reports d where d.parent_report_id = r.id and coalesce(d.is_duplicate, false)), '[]'::jsonb));
end $$;

create or replace function public.kasa_admin_repeat_photos(p_limit integer default 60) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  return coalesce((
    select jsonb_agg(x order by x ->> 'created_at' desc) from (
      select jsonb_build_object('id', d.id::text, 'photo_url', d.photo_url, 'created_at', d.created_at,
                                'parent_id', p.id::text, 'parent_photo_url', p.photo_url, 'category', p.category,
                                'ward_no', p.ward_no, 'block_name', p.block_name) as x
      from public.reports d join public.reports p on p.id = d.parent_report_id
      where coalesce(d.is_duplicate, false)
      order by d.created_at desc
      limit greatest(1, least(coalesce(p_limit, 60), 200))) t), '[]'::jsonb);
end $$;

create or replace function public.kasa_admin_remove_photo(p_report_id text, p_kind text, p_ref text, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r   public.reports;
  d   public.reports;
  v_url text;
begin
  if not kasa_private.is_super_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Only an admin can remove photos.'); end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    perform kasa_private.fail('KASA_REASON_NEEDED', 'Give a short public reason.');
  end if;
  select * into r from public.reports where id::text = p_report_id for update;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'Report not found.'); end if;

  if p_kind = 'extra' then
    delete from kasa_private.report_photos where report_id = r.id and position::text = p_ref returning photo_url into v_url;
    if v_url is null then perform kasa_private.fail('KASA_NOT_FOUND', 'That photo is not on this report.'); end if;
  elsif p_kind = 'duplicate' then
    select * into d from public.reports where id::text = p_ref and parent_report_id = r.id and coalesce(is_duplicate, false) for update;
    if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'That duplicate is not joined to this report.'); end if;
    v_url := d.photo_url;
    delete from public.reports where id = d.id;
  else
    perform kasa_private.fail('KASA_BAD_ACTION', 'Unknown photo kind.');
  end if;

  perform kasa_private.add_event(r.id::text, 'moderated', auth.uid(), null, null, null,
    jsonb_build_object('action', 'remove_photo', 'kind', p_kind, 'reason', left(trim(p_reason), 280)));
  return jsonb_build_object('removed', true, 'kind', p_kind);
end $$;

revoke all on function public.kasa_admin_report_photos(text) from public, anon;
revoke all on function public.kasa_admin_repeat_photos(integer) from public, anon;
revoke all on function public.kasa_admin_remove_photo(text, text, text, text) from public, anon;
grant execute on function public.kasa_admin_report_photos(text), public.kasa_admin_repeat_photos(integer),
  public.kasa_admin_remove_photo(text, text, text, text) to authenticated;

commit;

notify pgrst, 'reload schema';
