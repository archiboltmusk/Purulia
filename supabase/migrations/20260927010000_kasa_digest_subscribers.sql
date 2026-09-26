-- Community subscriptions for weekly pattern digest
-- Users can opt-in by email to receive weekly civic reports

create table if not exists public.digest_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  subscribed_at timestamptz not null default now(),
  last_sent_at timestamptz,
  unsubscribe_token text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.digest_subscribers enable row level security;

-- Anyone can read subscriber count (anonymized)
create policy if not exists "count_only" on public.digest_subscribers
  for select
  to public, anon, authenticated
  using (false);  -- Cannot read rows, but COUNT(*) still works

-- Anyone can insert their email (subscribe)
create policy if not exists "subscribe_only" on public.digest_subscribers
  for insert
  to public, anon, authenticated
  with check (true);

-- Can only see their own record if they know the unsubscribe token
create policy if not exists "view_own" on public.digest_subscribers
  for select
  to authenticated
  using (auth.uid()::text = id::text);  -- In practice, unsubscribe uses token in URL

create index if not exists idx_digest_subscribers_email on public.digest_subscribers(email);
create index if not exists idx_digest_subscribers_active on public.digest_subscribers(is_active);
create index if not exists idx_digest_subscribers_token on public.digest_subscribers(unsubscribe_token);

-- RPC: Subscribe a user (returns count of active subscribers)
create or replace function public.kasa_digest_subscribe(p_email text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_token text;
  v_count bigint;
begin
  -- Generate unique unsubscribe token
  v_token := encode(gen_random_bytes(32), 'hex');

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

-- RPC: Get subscriber count (public, bypasses RLS via security definer)
create or replace function public.kasa_digest_subscriber_count()
returns bigint language sql stable security definer set search_path = '' as $$
  select count(*) from public.digest_subscribers where is_active;
$$;

-- RPC: Unsubscribe via token
create or replace function public.kasa_digest_unsubscribe(p_token text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_email text;
begin
  update public.digest_subscribers
  set is_active = false, updated_at = now()
  where unsubscribe_token = p_token and is_active
  returning email into v_email;

  if v_email is null then
    return jsonb_build_object('success', false, 'message', 'Token not found or already unsubscribed');
  end if;

  return jsonb_build_object('success', true, 'message', 'Unsubscribed', 'email', v_email);
exception when others then
  return jsonb_build_object('success', false, 'message', sqlerrm);
end $$;

-- RPC: Get active subscribers for the digest (service role only, used by edge function)
create or replace function kasa_private.digest_subscribers_for_send(p_limit int default 1000)
returns table(email text, unsubscribe_token text) as $$
  select email, unsubscribe_token from public.digest_subscribers
  where is_active
  limit p_limit;
$$ language sql stable security definer set search_path = '';

-- Revoke default permissions to keep this function private (service role only)
revoke all on function kasa_private.digest_subscribers_for_send(int) from public, anon, authenticated;
grant execute on function kasa_private.digest_subscribers_for_send(int) to service_role;
