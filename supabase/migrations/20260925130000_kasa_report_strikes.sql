-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — repeat-offender pause for reports
--
-- The AI check (self_moderate_photo, previous migration) and the human
-- moderator queue (admin.html, kasa_admin_moderate) already exist — this
-- migration is the one genuinely new piece from the "cry wolf" protocol:
-- a person whose reports keep getting hidden by a moderator can't keep
-- filing new ones for a while.
--
-- Deliberately keyed to a MODERATOR hiding a report (kasa_admin_moderate,
-- action = 'hide'), never to an AI self-moderation hold or a public flag —
-- those can be false positives a moderator hasn't looked at yet. Only a
-- human's confirmed "this was wrong" counts, same principle as claim
-- strikes (kasa_private.profiles.strikes, incremented only by
-- reject_claim, never by a dispute or a flag on its own).
--
-- Mirrors the failed-claim cooldown exactly (kasa_private.claims_paused_until
-- / guard_failed_claims in kasa_claim_integrity.sql): a rolling window,
-- computed on the fly from the events already on the record — no new
-- counter column to keep in sync, and it lifts itself once the window
-- passes. The person can still confirm, dispute, flag and comment on
-- others' reports while paused; only filing a NEW report is blocked.
--
-- The block is a clear, told-to-your-face error (KASA_REPORTS_PAUSED),
-- like every other Kasa rule — not a silent throttle. Telling someone
-- why they were blocked is not a hint an abuser can use to get around
-- the block (the count is real, not guessable timing), and a rule
-- nobody can see is much harder to make fair or to correct if it is
-- ever wrong. See RUNBOOK.md and methodology.html.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

insert into kasa_private.settings (key, value, note) values
  ('hidden_reports_limit', '3', 'Reports a moderator hides within the window that trigger a reporting pause'),
  ('hidden_reports_window_days', '30', 'Window (days) for counting moderator-hidden reports'),
  ('hidden_reports_block_days', '30', 'Reporting pause (days) after too many moderator-hidden reports')
on conflict (key) do nothing;

create or replace function kasa_private.reports_paused_until(p_uid uuid) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select max(e.created_at) + make_interval(days => kasa_private.cfg_num('hidden_reports_block_days')::integer)
  from kasa_private.events e
  join public.reports r on r.id = e.report_id
  where r.user_id = p_uid and e.kind = 'moderated' and e.detail ->> 'action' = 'hide'
    and e.created_at > now() - make_interval(days => kasa_private.cfg_num('hidden_reports_block_days')::integer)
    and (select count(*) from kasa_private.events oe
         join public.reports orr on orr.id = oe.report_id
         where orr.user_id = p_uid and oe.kind = 'moderated' and oe.detail ->> 'action' = 'hide'
           and oe.created_at <= e.created_at
           and oe.created_at > e.created_at - make_interval(days => kasa_private.cfg_num('hidden_reports_window_days')::integer))
        >= kasa_private.cfg_num('hidden_reports_limit')
$$;

create or replace function kasa_private.guard_reports_paused() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_until timestamptz := kasa_private.reports_paused_until(new.user_id);
begin
  if new.user_id is not null and v_until is not null and v_until > now() then
    perform kasa_private.fail('KASA_REPORTS_PAUSED',
      'A moderator removed several of your recent reports, so you can''t file new reports for a while. You can still confirm, dispute and flag others'' reports.',
      jsonb_build_object('until', date_trunc('day', v_until) + interval '1 day'));
  end if;
  return new;
end $$;

drop trigger if exists guard_reports_paused on public.reports;
create trigger guard_reports_paused before insert on public.reports
  for each row execute function kasa_private.guard_reports_paused();

revoke all on function kasa_private.reports_paused_until(uuid) from public, anon, authenticated;
revoke all on function kasa_private.guard_reports_paused() from public, anon, authenticated;

commit;

notify pgrst, 'reload schema';
