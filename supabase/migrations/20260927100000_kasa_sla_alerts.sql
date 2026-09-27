-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — SLA push alerts
--
-- The SLA clock (kasa_private.sla_days_for, kasa.js's slaCountdown) was
-- purely a display: a citizen only saw "Due in Xh" / "Xh overdue" if they
-- happened to reopen the report sheet. Nothing pushed a notification when
-- a report actually approached or missed its target.
--
-- This reuses the "watch this report" pipeline (20260925150000) rather than
-- building a new delivery path: a scheduled function walks open reports,
-- raises a 'sla_warning' event once a report crosses sla_warning_pct of its
-- target (default 75%) and a 'sla_breached' event once it's actually
-- overdue — each exactly once per report, through the same
-- kasa_private.add_event choke point every other event already uses — and
-- the existing report_watch_alert trigger + kasa-notify-watch Edge Function
-- deliver them to that report's watchers, same as "claimed"/"resolved".
--
-- Nobody is auto-subscribed to their own report; this only reaches whoever
-- already tapped "watch" on it, exactly like every other watch alert.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

insert into kasa_private.settings (key, value, note) values
  ('sla_warning_pct', '75', 'Percent of a report''s SLA elapsed before an "approaching deadline" alert fires')
on conflict (key) do nothing;

-- Widen the pending-notify index and the trigger to also cover the two new kinds.
drop index if exists kasa_private.kasa_events_watch_pending_idx;
create index kasa_events_watch_pending_idx on kasa_private.events (created_at)
  where kind in ('claimed', 'quorum_reached', 'resolved', 'claim_rejected', 'claim_expired', 'disputed',
                 'sla_warning', 'sla_breached')
    and notify_sent_at is null;

drop trigger if exists report_watch_alert on kasa_private.events;
create trigger report_watch_alert after insert on kasa_private.events
  for each row
  when (new.kind in ('claimed', 'quorum_reached', 'resolved', 'claim_rejected', 'claim_expired', 'disputed',
                      'sla_warning', 'sla_breached'))
  execute function kasa_private.ping_report_watch_alert();

-- Same shape as the original (20260925150000), with the two new kinds added to the claim filter.
create or replace function public.kasa_watch_notify_claim(p_limit integer default 20) returns jsonb
language sql security definer set search_path = '' as $$
  with c as (
    update kasa_private.events e set notify_claimed_at = now()
    where e.id in (
      select id from kasa_private.events
      where kind in ('claimed', 'quorum_reached', 'resolved', 'claim_rejected', 'claim_expired', 'disputed',
                     'sla_warning', 'sla_breached')
        and notify_sent_at is null
        and (notify_claimed_at is null or notify_claimed_at < now() - interval '10 minutes')
      order by created_at limit greatest(1, least(coalesce(p_limit, 20), 50))
      for update skip locked)
    returning e.id, e.report_id, e.kind, e.actor_id, e.detail, e.created_at)
  select coalesce(jsonb_agg(jsonb_build_object(
    'event_id', c.id, 'report_id', c.report_id, 'kind', c.kind,
    'category', r.category, 'ward_no', r.ward_no, 'detail', c.detail,
    'targets', coalesce((
      select jsonb_agg(jsonb_build_object('id', w.id, 'endpoint', w.endpoint, 'p256dh', w.p256dh, 'auth', w.auth, 'lang', w.lang))
      from kasa_private.report_watches w
      where w.report_id = c.report_id and w.user_id is distinct from c.actor_id), '[]'::jsonb)
  ) order by c.created_at), '[]'::jsonb)
  from c join public.reports r on r.id = c.report_id
$$;

-- Walks open reports and raises each SLA event at most once, through the same
-- choke point every other event goes through.
create or replace function kasa_private.check_sla_alerts() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_pct numeric := coalesce(kasa_private.cfg_num('sla_warning_pct'), 75);
  rep   record;
begin
  for rep in
    select r.id from public.reports r
    where r.status <> 'resolved'
      and now() >= r.created_at + ((coalesce(r.sla_days, 7) * v_pct / 100.0)::double precision * interval '1 day')
      and now() < r.created_at + (coalesce(r.sla_days, 7)::double precision * interval '1 day')
      and not exists (select 1 from kasa_private.events e where e.report_id = r.id and e.kind = 'sla_warning')
  loop
    perform kasa_private.add_event(rep.id::text, 'sla_warning', null);
  end loop;

  for rep in
    select r.id from public.reports r
    where r.status <> 'resolved'
      and now() >= r.created_at + (coalesce(r.sla_days, 7)::double precision * interval '1 day')
      and not exists (select 1 from kasa_private.events e where e.report_id = r.id and e.kind = 'sla_breached')
  loop
    perform kasa_private.add_event(rep.id::text, 'sla_breached', null);
  end loop;
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'kasa-sla-alerts';
    perform cron.schedule('kasa-sla-alerts', '*/30 * * * *', 'select kasa_private.check_sla_alerts()');
  end if;
exception when others then
  raise notice 'kasa: pg_cron scheduling skipped (%)', sqlerrm;
end $$;

revoke all on function kasa_private.check_sla_alerts() from public, anon, authenticated;

commit;

notify pgrst, 'reload schema';
