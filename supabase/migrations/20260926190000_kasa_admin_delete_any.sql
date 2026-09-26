-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — admins can delete any report (for example an exact repeat)
--
-- Deleting used to be limited to reports already flagged or held for review.
-- An admin (not a moderator) can now delete any report, with a short reason.
-- Reports that were joined to it as repeats become their own reports again.
-- Each deletion is kept in kasa_private.deleted_reports (what, where, when,
-- why, by whom) so deletions stay accountable.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

create table if not exists kasa_private.deleted_reports (
  id          bigint generated always as identity primary key,
  report_id   text not null,
  category    text,
  ward_no     integer,
  block_name  text,
  reported_at timestamptz,
  photo_url   text,
  reason      text not null,
  deleted_by  uuid,
  deleted_at  timestamptz not null default now()
);
alter table kasa_private.deleted_reports enable row level security;
revoke all on kasa_private.deleted_reports from public, anon, authenticated;

create or replace function public.kasa_admin_moderate(p_report_id text, p_action text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.reports;
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  if p_action not in ('approve', 'hide', 'restore', 'delete') then perform kasa_private.fail('KASA_BAD_ACTION', 'Unknown action.'); end if;

  if p_action = 'delete' then
    if not kasa_private.is_super_admin() then perform kasa_private.fail('KASA_NOT_SUPER_ADMIN', 'Only an admin can delete permanently. Hide it instead.'); end if;
    if length(trim(coalesce(p_reason, ''))) < 3 then
      perform kasa_private.fail('KASA_REASON_REQUIRED', 'Give a short reason for deleting, like "exact repeat of another report".');
    end if;
    select * into r from public.reports where id::text = p_report_id for update;
    if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'Report not found.'); end if;
    -- Repeats joined to it stand on their own again instead of pointing at nothing.
    update public.reports set is_duplicate = false, parent_report_id = null, updated_at = now()
    where parent_report_id = r.id;
    insert into kasa_private.deleted_reports (report_id, category, ward_no, block_name, reported_at, photo_url, reason, deleted_by)
    values (r.id::text, r.category, r.ward_no, r.block_name, r.created_at, r.photo_url, left(trim(p_reason), 280), auth.uid());
    delete from public.reports where id = r.id;
    return jsonb_build_object('deleted', true);
  end if;

  update public.reports set moderation_status = case p_action when 'hide' then 'hidden' else 'approved' end, updated_at = now()
  where id::text = p_report_id returning * into r;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'Report not found.'); end if;
  perform kasa_private.add_event(r.id::text, 'moderated', null, null, null, null,
    jsonb_build_object('action', p_action, 'reason', p_reason));
  return jsonb_build_object('moderation_status', r.moderation_status);
end $$;

commit;

notify pgrst, 'reload schema';
