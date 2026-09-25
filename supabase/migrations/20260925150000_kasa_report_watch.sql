-- ════════════════════════════════════════════════════════════════════════
-- PARISHKAR PURULIA — "watch this report" web push
--
-- Nearby alerts (kasa_push_subscribe / kasa-notify) tell a device about NEW
-- reports near a location it granted. This is different: a citizen looking
-- at one specific report opts in to hear about what happens to THAT report
-- — claimed, confirmed, disputed, resolved — wherever they are. No location
-- is asked for; watching a report you're already looking at needs no area
-- grant, unlike proximity alerts.
--
-- Every status change already lands in kasa_private.events through one
-- choke point (kasa_private.add_event), so that table is the hook: an
-- AFTER INSERT trigger best-effort-pings the kasa-notify-watch Edge
-- Function, which claims queued events (kasa_watch_notify_claim, same
-- claim-with-abandon-window shape as kasa_signup_alerts_claim) and sends
-- web push to everyone watching that report — except the person whose own
-- action produced the event. A 10-minute pg_cron backstop covers any ping
-- that never arrives; both are safe to call as often as needed, since an
-- event is only ever sent once (notify_sent_at).
--
-- Nothing here can identify or contact "the reporter" by any channel other
-- than the browser push subscription they themselves created: a watch row
-- stores only an opaque endpoint plus the existing anonymous user_id.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

insert into kasa_private.settings (key, value, note) values
  ('report_watches_max_per_user', '20', 'Oldest per-report watch subscriptions beyond this many are dropped')
on conflict (key) do nothing;

create table if not exists kasa_private.report_watches (
  id           uuid primary key default gen_random_uuid(),
  report_id    uuid not null references public.reports(id) on delete cascade,
  user_id      uuid not null,
  endpoint     text not null,
  p256dh       text not null,
  auth         text not null,
  lang         text not null default 'en',
  fail_count   integer not null default 0,
  last_sent_at timestamptz,
  created_at   timestamptz not null default now(),
  unique (report_id, endpoint)
);
create index if not exists kasa_report_watches_report_idx on kasa_private.report_watches (report_id);
create index if not exists kasa_report_watches_user_idx on kasa_private.report_watches (user_id, created_at desc);
alter table kasa_private.report_watches enable row level security;

alter table kasa_private.events
  add column if not exists notify_claimed_at timestamptz,
  add column if not exists notify_sent_at    timestamptz;
create index if not exists kasa_events_watch_pending_idx on kasa_private.events (created_at)
  where kind in ('claimed', 'quorum_reached', 'resolved', 'claim_rejected', 'claim_expired', 'disputed')
    and notify_sent_at is null;

-- A signed-in device opts in to be notified about one report's status changes.
create or replace function public.kasa_watch_report(p_report_id text, p_endpoint text, p_p256dh text,
    p_auth text, p_lang text default 'en')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me   kasa_private.profiles := kasa_private.me();
  v_id uuid;
begin
  if p_endpoint is null or p_endpoint !~ '^https://' or length(p_endpoint) > 1000
     or length(coalesce(p_p256dh, '')) not between 20 and 200 or length(coalesce(p_auth, '')) not between 8 and 100 then
    perform kasa_private.fail('KASA_BAD_SUBSCRIPTION', 'This browser returned an invalid push subscription.');
  end if;
  if not exists (select 1 from public.reports where id::text = p_report_id) then
    perform kasa_private.fail('KASA_NOT_FOUND', 'Report not found.');
  end if;
  insert into kasa_private.report_watches (report_id, user_id, endpoint, p256dh, auth, lang)
  values (p_report_id::uuid, me.user_id, p_endpoint, p_p256dh, p_auth,
          case when p_lang in ('en', 'bn', 'hi') then p_lang else 'en' end)
  on conflict (report_id, endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh,
    auth = excluded.auth, lang = excluded.lang, fail_count = 0
  returning id into v_id;
  delete from kasa_private.report_watches where id in (
    select id from kasa_private.report_watches where user_id = me.user_id
    order by created_at desc offset kasa_private.cfg_num('report_watches_max_per_user')::integer);
  return jsonb_build_object('watching', true);
end $$;

create or replace function public.kasa_unwatch_report(p_report_id text, p_endpoint text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me kasa_private.profiles := kasa_private.me();
begin
  delete from kasa_private.report_watches
  where report_id::text = p_report_id and endpoint = p_endpoint and user_id = me.user_id;
  return jsonb_build_object('watching', false);
end $$;

-- Service role only (kasa-notify-watch): claims up to N queued status-change events
-- for delivery, with each event's live watchers. A claim older than 10 minutes counts
-- as abandoned (mirrors kasa_signup_alerts_claim). The claimant of the underlying action
-- never gets notified about their own action.
create or replace function public.kasa_watch_notify_claim(p_limit integer default 20) returns jsonb
language sql security definer set search_path = '' as $$
  with c as (
    update kasa_private.events e set notify_claimed_at = now()
    where e.id in (
      select id from kasa_private.events
      where kind in ('claimed', 'quorum_reached', 'resolved', 'claim_rejected', 'claim_expired', 'disputed')
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

-- Marks a claimed batch done. On error, un-claims it (notify_claimed_at back to null)
-- so the next call retries immediately instead of waiting out the abandon window.
-- Once a 'resolved' event is successfully delivered there is nothing further to watch
-- for on that report, so its watches are cleared.
create or replace function public.kasa_watch_notify_done(p_event_ids bigint[], p_error text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update kasa_private.events
  set notify_sent_at = case when p_error is null then now() end,
      notify_claimed_at = case when p_error is null then notify_claimed_at end
  where id = any (p_event_ids);

  if p_error is null then
    delete from kasa_private.report_watches w
    using kasa_private.events e
    where e.id = any (p_event_ids) and e.kind = 'resolved' and w.report_id = e.report_id;
  end if;
end $$;

create or replace function public.kasa_watch_notify_result(p_watch_id uuid, p_ok boolean, p_gone boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_gone then delete from kasa_private.report_watches where id = p_watch_id;
  elsif p_ok then update kasa_private.report_watches set fail_count = 0, last_sent_at = now() where id = p_watch_id;
  else
    update kasa_private.report_watches set fail_count = fail_count + 1 where id = p_watch_id;
    delete from kasa_private.report_watches where id = p_watch_id and fail_count >= 5;
  end if;
end $$;

-- Best-effort ping, exactly like kasa_private.ping_signup_alert(): a delivery failure
-- must never lose the underlying event, so any error here is swallowed.
create or replace function kasa_private.ping_report_watch_alert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_url text := kasa_private.cfg('functions_url') #>> '{}';
  v_key text := kasa_private.cfg('public_anon_key') #>> '{}';
begin
  if v_url is not null and v_key is not null
     and to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is not null then
    execute 'select net.http_post($1, ''{}''::jsonb, ''{}''::jsonb, $2, 30000)'
      using v_url || '/kasa-notify-watch',
            jsonb_build_object('Content-Type', 'application/json', 'apikey', v_key, 'Authorization', 'Bearer ' || v_key);
  end if;
  return null;
exception when others then
  return null;
end $$;

drop trigger if exists report_watch_alert on kasa_private.events;
create trigger report_watch_alert after insert on kasa_private.events
  for each row
  when (new.kind in ('claimed', 'quorum_reached', 'resolved', 'claim_rejected', 'claim_expired', 'disputed'))
  execute function kasa_private.ping_report_watch_alert();

-- Unconditional version of the same ping, for the cron backstop below — cheap to call
-- even when the queue is empty, since kasa-notify-watch just claims nothing that time.
create or replace function kasa_private.ping_report_watch_alert_once() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_url text := kasa_private.cfg('functions_url') #>> '{}';
  v_key text := kasa_private.cfg('public_anon_key') #>> '{}';
begin
  if v_url is not null and v_key is not null
     and to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is not null then
    execute 'select net.http_post($1, ''{}''::jsonb, ''{}''::jsonb, $2, 30000)'
      using v_url || '/kasa-notify-watch',
            jsonb_build_object('Content-Type', 'application/json', 'apikey', v_key, 'Authorization', 'Bearer ' || v_key);
  end if;
exception when others then
  return;
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'kasa-watch-notify-retry';
    perform cron.schedule('kasa-watch-notify-retry', '*/10 * * * *', 'select kasa_private.ping_report_watch_alert_once()');
  end if;
exception when others then
  raise notice 'kasa: pg_cron scheduling skipped (%)', sqlerrm;
end $$;

revoke all on function public.kasa_watch_report(text, text, text, text, text) from public, anon;
revoke all on function public.kasa_unwatch_report(text, text) from public, anon;
revoke all on function public.kasa_watch_notify_claim(integer) from public, anon, authenticated;
revoke all on function public.kasa_watch_notify_done(bigint[], text) from public, anon, authenticated;
revoke all on function public.kasa_watch_notify_result(uuid, boolean, boolean) from public, anon, authenticated;
revoke all on function kasa_private.ping_report_watch_alert() from public, anon, authenticated;
revoke all on function kasa_private.ping_report_watch_alert_once() from public, anon, authenticated;

grant execute on function public.kasa_watch_report(text, text, text, text, text), public.kasa_unwatch_report(text, text) to authenticated;
do $$ begin
  execute 'grant execute on function public.kasa_watch_notify_claim(integer), public.kasa_watch_notify_done(bigint[], text),
    public.kasa_watch_notify_result(uuid, boolean, boolean) to service_role';
exception when undefined_object then null; end $$;

commit;

notify pgrst, 'reload schema';
