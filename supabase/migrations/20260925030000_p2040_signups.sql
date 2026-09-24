-- ════════════════════════════════════════════════════════════════════════
-- PURULIA 2040 — Join form and follow sign-ups (replaces Google Apps Script)
--
-- Anyone can submit (no sign-in); nobody but moderators can read. Limited
-- to 5 submissions per network per hour and 300 per day in total; abusive
-- text is refused by the same filter as reports.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

create table if not exists kasa_private.signups (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('join', 'follow')),
  name       text,
  role       text,
  location   text,
  contact    text not null,
  message    text,
  ip_hash    text,
  created_at timestamptz not null default now()
);
create index if not exists signups_created_idx on kasa_private.signups (created_at desc);
create index if not exists signups_ip_idx on kasa_private.signups (ip_hash, created_at desc);
alter table kasa_private.signups enable row level security;
revoke all on kasa_private.signups from anon, authenticated;

create or replace function public.p2040_submit(p_kind text, p_name text, p_role text, p_location text,
    p_contact text, p_message text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ip   text := kasa_private.ip_hash();
  v_name text := nullif(trim(p_name), '');
  v_con  text := nullif(trim(p_contact), '');
begin
  if p_kind not in ('join', 'follow') then perform kasa_private.fail('KASA_BAD_FORM', 'Unknown form.'); end if;
  if v_con is null or length(v_con) > 200 then
    perform kasa_private.fail('KASA_BAD_FORM', 'Please give a phone number or e-mail address.');
  end if;
  if p_kind = 'follow' and v_con !~* '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' then
    perform kasa_private.fail('KASA_BAD_FORM', 'Please enter a valid e-mail address.');
  end if;
  if p_kind = 'join' and (v_name is null or nullif(trim(p_role), '') is null) then
    perform kasa_private.fail('KASA_BAD_FORM', 'Please fill in your name, role and contact.');
  end if;
  if length(coalesce(v_name, '')) > 120 or length(coalesce(p_role, '')) > 120
     or length(coalesce(p_location, '')) > 160 or length(coalesce(p_message, '')) > 2000 then
    perform kasa_private.fail('KASA_TOO_LONG', 'That is too long. Please shorten it.');
  end if;
  if kasa_private.text_verdict(concat_ws(' ', v_name, p_location, p_message)) ->> 'level' = 'block' then
    perform kasa_private.fail('KASA_TEXT_BLOCKED', 'Please remove abusive words and try again.');
  end if;
  if (v_ip is not null and (select count(*) from kasa_private.signups
                            where ip_hash = v_ip and created_at > now() - interval '1 hour') >= 5)
     or (select count(*) from kasa_private.signups where created_at > now() - interval '1 day') >= 300 then
    perform kasa_private.fail('KASA_RATE_LIMIT', 'Too many submissions right now. Please try again later.');
  end if;

  insert into kasa_private.signups (kind, name, role, location, contact, message, ip_hash)
  values (p_kind, v_name, nullif(trim(p_role), ''), nullif(trim(p_location), ''), v_con,
          nullif(trim(p_message), ''), v_ip);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.kasa_admin_signups(p_limit integer default 200) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  return coalesce((select jsonb_agg(to_jsonb(s) - 'ip_hash' order by s.created_at desc)
                   from (select * from kasa_private.signups order by created_at desc
                         limit greatest(1, least(coalesce(p_limit, 200), 1000))) s), '[]'::jsonb);
end $$;

revoke all on function public.p2040_submit(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.p2040_submit(text, text, text, text, text, text) to anon, authenticated;
revoke all on function public.kasa_admin_signups(integer) from public, anon, authenticated;
grant execute on function public.kasa_admin_signups(integer) to authenticated;

commit;

notify pgrst, 'reload schema';
