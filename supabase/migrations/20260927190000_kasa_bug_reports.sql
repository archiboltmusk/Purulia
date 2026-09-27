-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — "Report a bug" on every page (bug-report.js)
--
-- public.bug_reports  something on the website itself went wrong: a button
--                     that does nothing, a page that will not load. Not a
--                     civic report (kasa.html) and not a grievance.
--                     Carries the page address, browser/device and the
--                     page's recent error messages so we can reproduce it.
--
-- Closed to anon/authenticated; everything goes through the RPCs. Only
-- moderators read the queue (admin.html). Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

create table if not exists public.bug_reports (
  id          uuid primary key default gen_random_uuid(),
  what        text not null check (length(what) between 5 and 2000),
  email       text check (length(email) <= 200),
  page_url    text check (length(page_url) <= 500),
  user_agent  text check (length(user_agent) <= 500),
  device      jsonb not null default '{}'::jsonb,
  errors      jsonb not null default '[]'::jsonb,
  status      text not null default 'open' check (status in ('open', 'fixed', 'dismissed')),
  ip_hash     text,
  handled_by  uuid,
  handled_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists bug_reports_status_idx on public.bug_reports (status, created_at desc);
create index if not exists bug_reports_ip_idx on public.bug_reports (ip_hash, created_at);
alter table public.bug_reports enable row level security;
revoke all on public.bug_reports from anon, authenticated;

-- ── Anyone: report a bug ────────────────────────────────────────────────
-- p_device: small object (screen, viewport, language, touch...); p_errors: up to 10
-- recent error strings. Both are trimmed here so a caller cannot store a blob.
create or replace function public.kasa_bug_submit(
  p_what text, p_email text default null, p_page_url text default null,
  p_user_agent text default null, p_device jsonb default '{}'::jsonb, p_errors jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ip text := kasa_private.ip_hash();
  v_id uuid;
  v_errors jsonb;
begin
  if v_ip is not null and (select count(*) from public.bug_reports where ip_hash = v_ip and created_at > now() - interval '1 hour') >= 5 then
    perform kasa_private.fail('KASA_RATE_LIMIT', 'Thanks! That is five bug reports this hour already. Please try again later.');
  end if;
  if v_ip is not null and (select count(*) from public.bug_reports where ip_hash = v_ip and created_at > now() - interval '1 day') >= 20 then
    perform kasa_private.fail('KASA_RATE_LIMIT', 'Thanks! That is twenty bug reports today already. Please try again tomorrow.');
  end if;
  if (select count(*) from public.bug_reports where status = 'open') >= 500 then
    perform kasa_private.fail('KASA_QUEUE_FULL', 'The bug list is full right now. Please try again in a few days.');
  end if;
  if nullif(trim(p_email), '') is not null and trim(p_email) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    perform kasa_private.fail('KASA_BAD_EMAIL', 'That email address does not look right. Leave it empty if you prefer.');
  end if;
  select coalesce(jsonb_agg(left(e #>> '{}', 500)), '[]'::jsonb) into v_errors
  from (select e from jsonb_array_elements(case when jsonb_typeof(p_errors) = 'array' then p_errors else '[]'::jsonb end) e limit 10) x;

  insert into public.bug_reports (what, email, page_url, user_agent, device, errors, ip_hash)
  values (trim(p_what), nullif(trim(p_email), ''), left(nullif(trim(p_page_url), ''), 500), left(p_user_agent, 500),
          case when jsonb_typeof(p_device) = 'object' and length(p_device::text) <= 2000 then p_device else '{}'::jsonb end,
          v_errors, v_ip)
  returning id into v_id;
  return jsonb_build_object('id', v_id);
exception
  when check_violation or not_null_violation then
    perform kasa_private.fail('KASA_BAD_INPUT', 'Please say what went wrong (at least 5 letters).');
end $$;
revoke all on function public.kasa_bug_submit(text, text, text, text, jsonb, jsonb) from public;
grant execute on function public.kasa_bug_submit(text, text, text, text, jsonb, jsonb) to anon, authenticated;

-- ── Moderators ──────────────────────────────────────────────────────────
create or replace function public.kasa_admin_bugs()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  return coalesce((select jsonb_agg(to_jsonb(b) - 'ip_hash' order by b.created_at desc)
    from public.bug_reports b where b.status = 'open'), '[]'::jsonb);
end $$;
revoke all on function public.kasa_admin_bugs() from public, anon;
grant execute on function public.kasa_admin_bugs() to authenticated;

-- p_status: 'fixed' or 'dismissed'.
create or replace function public.kasa_admin_bug_close(p_id uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  if p_status not in ('fixed', 'dismissed') then perform kasa_private.fail('KASA_BAD_ACTION', 'Unknown action.'); end if;
  update public.bug_reports set status = p_status, handled_by = auth.uid(), handled_at = now()
  where id = p_id and status = 'open';
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'Already handled or not found.'); end if;
  return jsonb_build_object('status', p_status);
end $$;
revoke all on function public.kasa_admin_bug_close(uuid, text) from public, anon;
grant execute on function public.kasa_admin_bug_close(uuid, text) to authenticated;

commit;

notify pgrst, 'reload schema';
