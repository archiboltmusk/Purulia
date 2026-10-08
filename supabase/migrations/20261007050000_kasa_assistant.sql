-- Help assistant (assistant.html → edge function kasa-assistant → Sarvam AI).
-- Only a per-visitor daily question count is kept, so one browser can't drain the API key.
-- Called by the edge function with the service key; not callable from the browser.

create table if not exists kasa_private.assistant_usage (
  user_id uuid not null,
  day date not null default (now() at time zone 'Asia/Kolkata')::date,
  n integer not null default 0,
  primary key (user_id, day)
);
alter table kasa_private.assistant_usage enable row level security;

-- true = the question may go ahead (and is counted); false = today's limit is used up.
create or replace function public.kasa_assistant_take(p_user uuid, p_limit integer default 30) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_day date := (now() at time zone 'Asia/Kolkata')::date;
  v_n integer;
begin
  if p_user is null then return false; end if;
  delete from kasa_private.assistant_usage where day < v_day - 7;
  insert into kasa_private.assistant_usage as u (user_id, day, n) values (p_user, v_day, 1)
  on conflict (user_id, day) do update set n = u.n + 1
  returning n into v_n;
  return v_n <= greatest(1, coalesce(p_limit, 30));
end $$;

revoke all on function public.kasa_assistant_take(uuid, integer) from public, anon, authenticated;
grant execute on function public.kasa_assistant_take(uuid, integer) to service_role;
