-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — security hardening
--
--  • Drop unused, empty tables: the civic_reports scaffolding (anon had
--    INSERT/UPDATE/DELETE/TRUNCATE; TRUNCATE ignores RLS) and the legacy
--    report_upvotes / report_flags tables (policies allowed any insert).
--  • Trim leftover grants on admins, automation_log and wards.
--  • New tables, sequences and functions in public no longer get automatic
--    grants to anon/authenticated: every migration must grant explicitly,
--    so a forgotten grant fails closed instead of opening the API.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

drop table if exists public.report_duplicates;
drop table if exists public.moderation_logs;
drop table if exists public.civic_reports;
drop table if exists public.report_upvotes;
drop table if exists public.report_flags;

do $$
begin
  if to_regclass('public.admins') is not null then
    revoke all on public.admins from anon, authenticated;
    grant select on public.admins to authenticated;
  end if;
  if to_regclass('public.automation_log') is not null then
    revoke all on public.automation_log from anon, authenticated;
    grant select on public.automation_log to authenticated;
  end if;
  if to_regclass('public.wards') is not null then
    revoke all on public.wards from anon, authenticated;
    grant select on public.wards to anon, authenticated;
  end if;
end $$;

do $$
begin
  alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
  alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
  alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;
  -- Schema-level defaults only add to the global ones, so PUBLIC's EXECUTE is removed globally.
  alter default privileges for role postgres revoke execute on functions from public;
exception when others then
  raise notice 'kasa: could not change default privileges (%)', sqlerrm;
end $$;

commit;

notify pgrst, 'reload schema';
