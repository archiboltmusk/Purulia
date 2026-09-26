-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — admins can accept a cleanup; moderators can add a public note
--
-- kasa_admin_accept_claim(claim, note): an admin (not a moderator) who has
-- checked the photos can accept a pending cleanup claim. The report becomes
-- resolved with resolution_method 'moderator', which the site shows as
-- "accepted by a moderator after checking the photos". It is not counted as
-- a neighbour-verified fix, and the admin's note is on the public timeline.
--
-- kasa_admin_note(report, note): a moderator or admin adds a public note to
-- a report's timeline (for example "the claim photo shows a different wall").
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

create or replace function public.kasa_admin_accept_claim(p_claim_id uuid, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c kasa_private.claims;
begin
  if not kasa_private.is_super_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Only an admin can accept a cleanup.'); end if;
  if length(trim(coalesce(p_note, ''))) < 3 then
    perform kasa_private.fail('KASA_REASON_REQUIRED', 'Say in a few words why the photos show it is cleaned.');
  end if;
  select * into c from kasa_private.claims where id = p_claim_id for update;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'Claim not found.'); end if;
  if c.status <> 'pending' then perform kasa_private.fail('KASA_CLAIM_CLOSED', 'This claim is already decided.'); end if;

  update kasa_private.claims set status = 'accepted', decided_at = now(), decided_reason = 'moderator: ' || left(trim(p_note), 200)
  where id = c.id;
  update public.reports set status = 'resolved', resolved_at = now(), resolved_photo_url = c.photo_url,
         resolution_method = 'moderator', updated_at = now()
  where id = c.report_id;
  perform kasa_private.add_event(c.report_id::text, 'resolved', auth.uid(), c.id, null, null,
    jsonb_build_object('verify_count', c.verify_count, 'dispute_count', c.dispute_count, 'by', 'moderator',
                       'reason', left(trim(p_note), 280)));
  return jsonb_build_object('accepted', true);
end $$;

create or replace function public.kasa_admin_note(p_report_id text, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.reports;
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  if length(trim(coalesce(p_note, ''))) < 3 then perform kasa_private.fail('KASA_REASON_REQUIRED', 'Write a short note.'); end if;
  select * into r from public.reports where id::text = p_report_id;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'Report not found.'); end if;
  perform kasa_private.add_event(r.id::text, 'moderated', auth.uid(), null, null, null,
    jsonb_build_object('action', 'note', 'reason', left(trim(p_note), 500)));
  return jsonb_build_object('noted', true);
end $$;

revoke all on function public.kasa_admin_accept_claim(uuid, text) from public, anon;
revoke all on function public.kasa_admin_note(text, text) from public, anon;
grant execute on function public.kasa_admin_accept_claim(uuid, text), public.kasa_admin_note(text, text) to authenticated;

commit;

notify pgrst, 'reload schema';
