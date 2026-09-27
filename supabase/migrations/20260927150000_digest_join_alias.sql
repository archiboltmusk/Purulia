-- kasa_digest_join: same as kasa_digest_subscribe under a name without "subscribe" in the URL.
-- Some iPhone content blockers drop requests to URLs containing "_subscribe", which showed up
-- as "Load failed" on the sign-up sheet. The old name stays for any page still calling it.

create or replace function public.kasa_digest_join(p_email text, p_name text default null)
returns json language sql security definer set search_path = '' as $$
  select public.kasa_digest_subscribe(p_email, p_name);
$$;

revoke all on function public.kasa_digest_join(text, text) from public;
grant execute on function public.kasa_digest_join(text, text) to anon, authenticated;
