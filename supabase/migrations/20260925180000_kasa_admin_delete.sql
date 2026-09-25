-- ════════════════════════════════════════════════════════════════════════
-- PARISHKAR PURULIA — admin delete for flagged/held posts
--
-- kasa_admin_moderate only ever had approve/hide/restore: reports keep an
-- append-only public evidence trail (claim/verify/dispute history depends
-- on every row staying put), so hiding — never deleting — has always been
-- the tool for a clean report someone got wrong.
--
-- A hard delete is added here too, but restricted to reports already in
-- 'flagged' or 'review' — a report a moderator sent to review, or the
-- public already flagged as suspect, has no accountability history worth
-- protecting yet. A report that was simply 'approved' still can't be
-- deleted; 'hide' remains the only tool for those, on purpose. Deleting
-- cascades to its claims/votes/events/flags/replies (all already
-- `references public.reports(id) on delete cascade`), so nothing is left
-- half-erased.
--
-- School audits (kasa_admin_moderate_school_audit, previous migration)
-- have no such history to protect, so their delete stays unrestricted.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

create or replace function public.kasa_admin_moderate(p_report_id text, p_action text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.reports;
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  if p_action not in ('approve', 'hide', 'restore', 'delete') then perform kasa_private.fail('KASA_BAD_ACTION', 'Unknown action.'); end if;

  if p_action = 'delete' then
    select * into r from public.reports where id::text = p_report_id and moderation_status in ('review', 'flagged') for update;
    if not found then
      perform kasa_private.fail('KASA_NOT_DELETABLE', 'Only a report already flagged or held for review can be deleted. Hide it instead.');
    end if;
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
