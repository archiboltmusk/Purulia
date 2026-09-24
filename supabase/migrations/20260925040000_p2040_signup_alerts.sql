-- ════════════════════════════════════════════════════════════════════════
-- PURULIA 2040 — email alerts for Join / Follow sign-ups (via Resend)
--
-- After each sign-up the database pings the p2040-signup-alert Edge
-- Function. The function never takes a sign-up from its caller: it claims
-- up to 20 saved, not-yet-emailed sign-ups here, emails them, and marks
-- them sent. Calling it more often can't send anything twice, and sign-ups
-- that arrived while email wasn't configured go out on the next call.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

alter table kasa_private.signups
  add column if not exists alerted_at timestamptz,
  add column if not exists alert_claimed_at timestamptz,
  add column if not exists alert_error text;
create index if not exists signups_unalerted_idx on kasa_private.signups (created_at) where alerted_at is null;

-- Claims pending sign-ups for one sender; a claim older than 10 minutes counts as abandoned.
create or replace function public.kasa_signup_alerts_claim(p_limit integer default 20) returns jsonb
language sql security definer set search_path = '' as $$
  with c as (
    update kasa_private.signups s set alert_claimed_at = now()
    where s.id in (select id from kasa_private.signups
                   where alerted_at is null and (alert_claimed_at is null or alert_claimed_at < now() - interval '10 minutes')
                   order by created_at limit greatest(1, least(coalesce(p_limit, 20), 50))
                   for update skip locked)
    returning s.id, s.kind, s.name, s.role, s.location, s.contact, s.message, s.created_at)
  select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at), '[]'::jsonb) from c
$$;

create or replace function public.kasa_signup_alerts_done(p_ids uuid[], p_error text default null) returns void
language sql security definer set search_path = '' as $$
  update kasa_private.signups
  set alerted_at = case when p_error is null then now() end,
      alert_claimed_at = case when p_error is null then alert_claimed_at end,
      alert_error = left(p_error, 300)
  where id = any (p_ids)
$$;

create or replace function kasa_private.ping_signup_alert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_url text := kasa_private.cfg('functions_url') #>> '{}';
  v_key text := kasa_private.cfg('public_anon_key') #>> '{}';
begin
  if v_url is not null and v_key is not null
     and to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is not null then
    execute 'select net.http_post($1, ''{}''::jsonb, ''{}''::jsonb, $2, 30000)'
      using v_url || '/p2040-signup-alert',
            jsonb_build_object('Content-Type', 'application/json', 'apikey', v_key, 'Authorization', 'Bearer ' || v_key);
  end if;
  return null;
exception when others then
  return null;  -- an alert failure must never lose the sign-up
end $$;

drop trigger if exists p2040_signup_alert on kasa_private.signups;
create trigger p2040_signup_alert after insert on kasa_private.signups
  for each row execute function kasa_private.ping_signup_alert();

revoke all on function public.kasa_signup_alerts_claim(integer) from public, anon, authenticated;
revoke all on function public.kasa_signup_alerts_done(uuid[], text) from public, anon, authenticated;
grant execute on function public.kasa_signup_alerts_claim(integer), public.kasa_signup_alerts_done(uuid[], text) to service_role;
revoke all on function kasa_private.ping_signup_alert() from public, anon, authenticated;

commit;

notify pgrst, 'reload schema';
