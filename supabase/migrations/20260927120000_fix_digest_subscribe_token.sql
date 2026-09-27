-- Fix: subscribing to the weekly digest failed with
-- "function gen_random_bytes(integer) does not exist".
--
-- kasa_digest_subscribe used gen_random_bytes(32), which needs the pgcrypto
-- extension. Nothing in this project installs pgcrypto — every other table
-- here generates random IDs with gen_random_uuid(), a core Postgres builtin
-- that needs no extension. Switch the unsubscribe token to the same builtin
-- instead of adding a new dependency: two UUIDs concatenated give 256 bits
-- of randomness, the same as gen_random_bytes(32) hex-encoded.

create or replace function public.kasa_digest_subscribe(p_email text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_token text;
  v_count bigint;
begin
  -- Generate unique unsubscribe token
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

  -- Try to insert, or update if already exists
  insert into public.digest_subscribers (email, unsubscribe_token, is_active)
  values (lower(trim(p_email)), v_token, true)
  on conflict (email) do update
  set is_active = true, updated_at = now();

  -- Get current active subscriber count
  select count(*) into v_count from public.digest_subscribers where is_active;

  return jsonb_build_object(
    'success', true,
    'message', 'Subscribed to weekly civic digest',
    'email', lower(trim(p_email)),
    'total_subscribers', v_count
  );
exception when others then
  return jsonb_build_object(
    'success', false,
    'message', sqlerrm,
    'error', sqlstate
  );
end $$;
