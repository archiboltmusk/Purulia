-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — email the moderation team when someone reports a bug
--
-- Same shape as the flag alerts: every new bug report pings the
-- kasa-bug-alert Edge Function, which claims the bug reports not yet
-- emailed here, sends ONE email listing them to every admin and moderator,
-- and marks them sent. Calling it again can't send anything twice.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

alter table public.bug_reports
  add column if not exists alerted_at timestamptz,
  add column if not exists alert_claimed_at timestamptz,
  add column if not exists alert_error text;
create index if not exists bug_reports_unalerted_idx on public.bug_reports (created_at) where alerted_at is null;

-- Bug reports from before this migration count as already seen.
update public.bug_reports set alerted_at = created_at where alerted_at is null and created_at < now() - interval '1 minute';

-- Claims pending bug reports (a claim older than 10 minutes counts as abandoned) and says who to email.
create or replace function public.kasa_bug_alerts_claim(p_limit integer default 50) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_bugs jsonb;
begin
  with c as (
    update public.bug_reports b set alert_claimed_at = now()
    where b.id in (
      select id from public.bug_reports
      where alerted_at is null and (alert_claimed_at is null or alert_claimed_at < now() - interval '10 minutes')
      order by created_at limit greatest(1, least(coalesce(p_limit, 50), 200))
      for update skip locked)
    returning b.id, b.what, b.email, b.page_url, b.user_agent, b.errors, b.created_at)
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'what', c.what, 'email', c.email, 'page_url', c.page_url,
           'user_agent', c.user_agent, 'errors', jsonb_array_length(c.errors), 'at', c.created_at
         ) order by c.created_at), '[]'::jsonb)
  into v_bugs from c;

  return jsonb_build_object(
    'bugs', v_bugs,
    'to', coalesce((select jsonb_agg(u.email) from public.admins a join auth.users u on u.id = a.user_id
                    where u.email is not null), '[]'::jsonb));
end $$;

create or replace function public.kasa_bug_alerts_done(p_ids jsonb, p_error text default null) returns void
language sql security definer set search_path = '' as $$
  update public.bug_reports
  set alerted_at = case when p_error is null then now() end,
      alert_claimed_at = case when p_error is null then alert_claimed_at end,
      alert_error = left(p_error, 300)
  where id::text in (select jsonb_array_elements_text(p_ids))
$$;

create or replace function kasa_private.ping_bug_alert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_url text := kasa_private.cfg('functions_url') #>> '{}';
  v_key text := kasa_private.cfg('public_anon_key') #>> '{}';
begin
  if v_url is not null and v_key is not null
     and to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is not null then
    execute 'select net.http_post($1, ''{}''::jsonb, ''{}''::jsonb, $2, 30000)'
      using v_url || '/kasa-bug-alert',
            jsonb_build_object('Content-Type', 'application/json', 'apikey', v_key, 'Authorization', 'Bearer ' || v_key);
  end if;
  return null;
exception when others then
  return null;  -- an alert failure must never lose the bug report
end $$;

drop trigger if exists kasa_bug_alert on public.bug_reports;
create trigger kasa_bug_alert after insert on public.bug_reports
  for each statement execute function kasa_private.ping_bug_alert();

revoke all on function public.kasa_bug_alerts_claim(integer) from public, anon, authenticated;
revoke all on function public.kasa_bug_alerts_done(jsonb, text) from public, anon, authenticated;
grant execute on function public.kasa_bug_alerts_claim(integer), public.kasa_bug_alerts_done(jsonb, text) to service_role;
revoke all on function kasa_private.ping_bug_alert() from public, anon, authenticated;

-- The admin queue shouldn't carry the alert bookkeeping.
create or replace function public.kasa_admin_bugs()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  return coalesce((select jsonb_agg(to_jsonb(b) - 'ip_hash' - 'alerted_at' - 'alert_claimed_at' - 'alert_error' order by b.created_at desc)
    from public.bug_reports b where b.status = 'open'), '[]'::jsonb);
end $$;

commit;

notify pgrst, 'reload schema';
