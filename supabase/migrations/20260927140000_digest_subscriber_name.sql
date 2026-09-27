-- Weekly digest sign-up: optional name, and reject addresses that aren't emails.
-- Replaces kasa_digest_subscribe(text) with kasa_digest_subscribe(text, text default null);
-- the old one-argument form is dropped so PostgREST never sees two candidates.

alter table public.digest_subscribers add column if not exists name text;

drop function if exists public.kasa_digest_subscribe(text);

create or replace function public.kasa_digest_subscribe(p_email text, p_name text default null)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_name  text := nullif(left(trim(coalesce(p_name, '')), 80), '');
  v_count bigint;
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then
    return json_build_object('success', false, 'message', 'Please enter a valid email address');
  end if;

  insert into public.digest_subscribers (email, name, unsubscribe_token, is_active)
  values (v_email, v_name,
          replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
          true)
  on conflict (email) do update
  set is_active = true,
      name = coalesce(excluded.name, public.digest_subscribers.name),
      updated_at = now();

  select count(*) into v_count from public.digest_subscribers where is_active;

  return json_build_object(
    'success', true,
    'message', 'Subscribed to weekly civic digest',
    'email', v_email,
    'total_subscribers', v_count
  );
exception when others then
  return json_build_object('success', false, 'message', sqlerrm, 'error', sqlstate);
end $$;

revoke all on function public.kasa_digest_subscribe(text, text) from public;
grant execute on function public.kasa_digest_subscribe(text, text) to anon, authenticated;
