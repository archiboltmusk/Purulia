-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — how many people are taking part (for "Join N people")
--
-- kasa_people_count(): public. The number of different accounts that have
-- filed a visible report or confirmed/disputed a cleanup. Just a number:
-- nobody is named.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

create or replace function public.kasa_people_count() returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::integer from (
    select user_id from public.reports where user_id is not null and moderation_status in ('approved', 'flagged')
    union
    select voter_id from kasa_private.votes where voided_at is null
  ) p
$$;
revoke all on function public.kasa_people_count() from public;
grant execute on function public.kasa_people_count() to anon, authenticated;

commit;

notify pgrst, 'reload schema';
