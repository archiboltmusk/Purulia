-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — moderation in public
--
-- The analytics page already shows every report. This adds what moderators
-- and the automatic checks did, as monthly counts anyone can read: reports
-- hidden or kept, flags, category changes, cleanup claims thrown out,
-- confirmations voided, claims that expired, official replies posted — plus
-- how many reports are waiting for review right now and how big the team is.
--
-- Counts only: no report IDs, no user IDs, no reasons. Reasons stay on each
-- report's own public evidence trail, as before.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

create or replace function public.kasa_public_transparency() returns jsonb
language sql stable security definer set search_path = '' as $$
  with months as (
    select date_trunc('month', now()) - make_interval(months => g) as m
    from generate_series(0, 11) g
  ), ev as (
    select date_trunc('month', e.created_at) as m, e.kind, e.detail ->> 'action' as action
    from kasa_private.events e
    where e.created_at >= date_trunc('month', now()) - interval '11 months'
  )
  select jsonb_build_object(
    'generated_at', now(),
    'months', (select jsonb_agg(jsonb_build_object(
        'month',              to_char(mo.m, 'YYYY-MM'),
        'reported',           (select count(*) from ev where ev.m = mo.m and ev.kind = 'reported'),
        'flagged',            (select count(*) from ev where ev.m = mo.m and ev.kind = 'flagged'),
        'hidden',             (select count(*) from ev where ev.m = mo.m and ev.kind = 'moderated' and ev.action = 'hide'),
        'kept',               (select count(*) from ev where ev.m = mo.m and ev.kind = 'moderated' and ev.action in ('approve', 'restore')),
        'recategorized',      (select count(*) from ev where ev.m = mo.m and ev.kind = 'recategorized'),
        'auto_recategorized', (select count(*) from ev where ev.m = mo.m and ev.kind = 'auto_recategorized'),
        'claims_rejected',    (select count(*) from ev where ev.m = mo.m and ev.kind = 'claim_rejected'),
        'claims_expired',     (select count(*) from ev where ev.m = mo.m and ev.kind = 'claim_expired'),
        'votes_voided',       (select count(*) from ev where ev.m = mo.m and ev.kind = 'vote_voided'),
        'official_replies',   (select count(*) from ev where ev.m = mo.m and ev.kind = 'official_reply')
      ) order by mo.m desc) from months mo),
    'now', jsonb_build_object(
      'waiting_review', (select count(*) from public.reports r where r.moderation_status in ('review', 'flagged')),
      'hidden',         (select count(*) from public.reports r where r.moderation_status = 'hidden'),
      'admins',         (select count(*) from public.admins a where a.role = 'admin'),
      'moderators',     (select count(*) from public.admins a where a.role = 'moderator')
    ));
$$;

revoke all on function public.kasa_public_transparency() from public;
grant execute on function public.kasa_public_transparency() to anon, authenticated;

commit;

notify pgrst, 'reload schema';
