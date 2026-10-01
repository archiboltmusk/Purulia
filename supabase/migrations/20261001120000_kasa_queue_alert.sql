-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — daily nudge when a moderation queue item waits over 72 h
--
-- Once a day the kasa-queue-alert Edge Function asks for anything that has
-- waited more than 72 hours for a moderator: reports and school checks held
-- for review, and pending place, official, school, translation and community
-- submissions. If there is any, it emails every admin and moderator one
-- summary (counts only). Nothing waiting, no email; one email a day at most.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

create table if not exists kasa_private.queue_alert_log (
  day date primary key,
  claimed_at timestamptz not null default now(),
  sent_at timestamptz,
  items jsonb,
  error text
);
alter table kasa_private.queue_alert_log enable row level security;

-- Counts of items older than 72 hours, per queue; queues with none are left out.
create or replace function kasa_private.queue_backlog() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(q, n) filter (where n > 0), '{}'::jsonb) from (
    select 'Reports held for review' q, count(*) n from public.reports
      where moderation_status in ('review', 'flagged') and created_at < now() - interval '72 hours'
    union all select 'School checks held for review', count(*) from public.school_audits
      where moderation_status in ('review', 'flagged') and created_at < now() - interval '72 hours'
    union all select 'Ward maps and places', count(*) from kasa_private.place_submissions
      where status = 'pending' and created_at < now() - interval '72 hours'
    union all select 'Officials', count(*) from kasa_private.official_suggestions
      where status = 'pending' and created_at < now() - interval '72 hours'
    union all select 'Schools', count(*) from kasa_private.school_suggestions
      where status = 'pending' and created_at < now() - interval '72 hours'
    union all select 'Translations', count(*) from kasa_private.translation_suggestions
      where status = 'pending' and created_at < now() - interval '72 hours'
    union all select 'Volunteer groups', count(*) from kasa_private.communities
      where status = 'pending' and created_at < now() - interval '72 hours'
  ) t
$$;
revoke all on function kasa_private.queue_backlog() from public, anon, authenticated;

create or replace function public.kasa_queue_alert_claim() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_day date := (now() at time zone 'Asia/Kolkata')::date;
  v_items jsonb := kasa_private.queue_backlog();
begin
  if v_items = '{}'::jsonb then return jsonb_build_object('day', v_day, 'items', v_items, 'to', '[]'::jsonb); end if;
  insert into kasa_private.queue_alert_log as l (day, claimed_at, items) values (v_day, now(), v_items)
  on conflict (day) do update set claimed_at = now(), items = excluded.items, error = null
    where l.sent_at is null and l.claimed_at <= now() - interval '30 minutes';
  if not found then return jsonb_build_object('day', v_day, 'items', '{}'::jsonb, 'to', '[]'::jsonb); end if;
  return jsonb_build_object('day', v_day, 'items', v_items,
    'to', coalesce((select jsonb_agg(distinct u.email) from public.admins a join auth.users u on u.id = a.user_id
                    where u.email is not null), '[]'::jsonb));
end $$;

create or replace function public.kasa_queue_alert_done(p_day date, p_error text default null) returns void
language sql security definer set search_path = '' as $$
  update kasa_private.queue_alert_log
  set sent_at = case when p_error is null then now() end,
      claimed_at = case when p_error is null then claimed_at else now() - interval '1 hour' end,
      error = left(p_error, 300)
  where day = p_day and sent_at is null
$$;
revoke all on function public.kasa_queue_alert_claim() from public, anon, authenticated;
revoke all on function public.kasa_queue_alert_done(date, text) from public, anon, authenticated;
grant execute on function public.kasa_queue_alert_claim(), public.kasa_queue_alert_done(date, text) to service_role;

commit;

-- Daily at 09:00 IST (03:30 UTC).
do $$
begin
  if not exists(select 1 from cron.job where jobname = 'kasa-queue-alert') then
    perform cron.schedule('kasa-queue-alert', '30 3 * * *', $job$
      select net.http_post(
        (kasa_private.cfg('functions_url') #>> '{}') || '/kasa-queue-alert', '{}'::jsonb, '{}'::jsonb,
        jsonb_build_object('Content-Type', 'application/json',
                           'apikey', kasa_private.cfg('public_anon_key') #>> '{}',
                           'Authorization', 'Bearer ' || (kasa_private.cfg('public_anon_key') #>> '{}')),
        60000
      )
    $job$);
  end if;
exception when others then
  raise notice 'kasa: queue alert scheduling skipped (%) - enable it manually if needed', sqlerrm;
end $$;
