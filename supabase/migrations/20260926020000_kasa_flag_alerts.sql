-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — email the moderation team when a report is flagged
--
-- Every new flag pings the kasa-flag-alert Edge Function. Like the sign-up
-- alerts, the function never takes a flag from its caller: it claims the
-- flags not yet emailed here, sends ONE email listing them to every admin
-- and moderator, and marks them sent. Several flags in a burst go out in
-- one email; calling it again can't send anything twice.
--
-- The email carries the report's category, place and flag reason, and a
-- link to the admin page — never who flagged it or their note.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

alter table kasa_private.flags
  add column if not exists alerted_at timestamptz,
  add column if not exists alert_claimed_at timestamptz,
  add column if not exists alert_error text;
create index if not exists flags_unalerted_idx on kasa_private.flags (created_at) where alerted_at is null;

-- Flags from before this migration count as already seen.
update kasa_private.flags set alerted_at = created_at where alerted_at is null and created_at < now() - interval '1 minute';

-- Claims pending flags (a claim older than 10 minutes counts as abandoned) and says who to email.
create or replace function public.kasa_flag_alerts_claim(p_limit integer default 50) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_flags jsonb;
begin
  with c as (
    update kasa_private.flags f set alert_claimed_at = now()
    where (f.report_id, f.user_id) in (
      select report_id, user_id from kasa_private.flags
      where alerted_at is null and (alert_claimed_at is null or alert_claimed_at < now() - interval '10 minutes')
      order by created_at limit greatest(1, least(coalesce(p_limit, 50), 200))
      for update skip locked)
    returning f.report_id, f.user_id, f.reason, f.suggested_category, f.created_at)
  select coalesce(jsonb_agg(jsonb_build_object(
           'report_id', c.report_id::text, 'user_id', c.user_id, 'reason', c.reason,
           'suggested_category', c.suggested_category, 'at', c.created_at,
           'category', r.category, 'ward_no', r.ward_no, 'block_name', r.block_name,
           'landmark', r.landmark, 'moderation_status', r.moderation_status, 'flags', r.flags
         ) order by c.created_at), '[]'::jsonb)
  into v_flags
  from c join public.reports r on r.id = c.report_id;

  return jsonb_build_object(
    'flags', v_flags,
    'to', coalesce((select jsonb_agg(u.email) from public.admins a join auth.users u on u.id = a.user_id
                    where u.email is not null), '[]'::jsonb));
end $$;

create or replace function public.kasa_flag_alerts_done(p_keys jsonb, p_error text default null) returns void
language sql security definer set search_path = '' as $$
  update kasa_private.flags f
  set alerted_at = case when p_error is null then now() end,
      alert_claimed_at = case when p_error is null then f.alert_claimed_at end,
      alert_error = left(p_error, 300)
  from jsonb_to_recordset(p_keys) as k(report_id text, user_id uuid)
  where f.report_id::text = k.report_id and f.user_id = k.user_id
$$;

create or replace function kasa_private.ping_flag_alert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_url text := kasa_private.cfg('functions_url') #>> '{}';
  v_key text := kasa_private.cfg('public_anon_key') #>> '{}';
begin
  if v_url is not null and v_key is not null
     and to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is not null then
    execute 'select net.http_post($1, ''{}''::jsonb, ''{}''::jsonb, $2, 30000)'
      using v_url || '/kasa-flag-alert',
            jsonb_build_object('Content-Type', 'application/json', 'apikey', v_key, 'Authorization', 'Bearer ' || v_key);
  end if;
  return null;
exception when others then
  return null;  -- an alert failure must never lose the flag
end $$;

drop trigger if exists kasa_flag_alert on kasa_private.flags;
create trigger kasa_flag_alert after insert on kasa_private.flags
  for each statement execute function kasa_private.ping_flag_alert();

revoke all on function public.kasa_flag_alerts_claim(integer) from public, anon, authenticated;
revoke all on function public.kasa_flag_alerts_done(jsonb, text) from public, anon, authenticated;
grant execute on function public.kasa_flag_alerts_claim(integer), public.kasa_flag_alerts_done(jsonb, text) to service_role;
revoke all on function kasa_private.ping_flag_alert() from public, anon, authenticated;

commit;

notify pgrst, 'reload schema';
