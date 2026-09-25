-- ════════════════════════════════════════════════════════════════════════
-- PARISHKAR PURULIA — a single, trusted "am I an admin?" check for the login page
--
-- admin.js used to read public.admins directly via PostgREST (RLS-gated by
-- admins_self_read). That policy checks out fine on inspection, but it's a
-- second, bespoke authorization path that nothing else in the codebase uses
-- — every other admin function trusts kasa_private.is_admin() instead. This
-- exposes that exact same function, so the login page uses the identical,
-- already-battle-tested check as kasa_admin_moderate, kasa_admin_queue, etc.,
-- rather than a parallel one that only the login page depends on.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

create or replace function public.kasa_is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select kasa_private.is_admin()
$$;

revoke all on function public.kasa_is_admin() from public, anon;
grant execute on function public.kasa_is_admin() to authenticated;

commit;

notify pgrst, 'reload schema';
