-- ════════════════════════════════════════════════════════════════════════
-- PARISHKAR — four-week "still there?" questionnaire
--
-- The reporter of an open report is asked, four weeks after filing, one
-- of three things: still there, fixed, or not sure. The answer is kept
-- privately (owner-only, never published). It changes no public status:
-- "fixed" only leads the reporter to the usual cleanup photo + GPS claim,
-- which is the only path that can resolve a report.
--
-- Owner only (reports.user_id = the caller). Can be changed while the
-- report is still open. Four weeks = 28 days, the same as the client's
-- check-in (MINE_ASK_DAYS in kasa.js).
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

create table if not exists kasa_private.followups (
  report_id   uuid not null references public.reports(id) on delete cascade,
  user_id     uuid not null,
  answer      text not null check (answer in ('still', 'fixed', 'unsure')),
  answered_at timestamptz not null default now(),
  primary key (report_id, user_id)
);

alter table kasa_private.followups enable row level security;
revoke all on kasa_private.followups from public, anon, authenticated;

create or replace function public.kasa_report_followup(p_report_id uuid, p_answer text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me kasa_private.profiles := kasa_private.me();
  r  public.reports;
  v_at timestamptz;
begin
  if p_answer is null or p_answer not in ('still', 'fixed', 'unsure') then
    perform kasa_private.fail('KASA_BAD_ANSWER', 'Pick still there, fixed or not sure.');
  end if;
  select * into r from public.reports where id = p_report_id;
  if not found or r.user_id is distinct from me.user_id then
    perform kasa_private.fail('KASA_NOT_FOUND', 'Report not found.');
  end if;
  if r.status is distinct from 'open' then
    perform kasa_private.fail('KASA_NOT_OPEN', 'This is no longer open. Check the case page for its status.');
  end if;
  if r.created_at > now() - interval '28 days' then
    perform kasa_private.fail('KASA_TOO_EARLY', 'This question is asked four weeks after the report.');
  end if;

  insert into kasa_private.followups (report_id, user_id, answer)
  values (r.id, me.user_id, p_answer)
  on conflict (report_id, user_id) do update set answer = excluded.answer, answered_at = now()
  returning answered_at into v_at;

  return jsonb_build_object('report_id', r.id, 'answer', p_answer, 'answered_at', v_at);
end $$;

create or replace function public.kasa_my_followups()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me kasa_private.profiles := kasa_private.me();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('report_id', f.report_id, 'answer', f.answer, 'answered_at', f.answered_at))
    from kasa_private.followups f
    where f.user_id = me.user_id
  ), '[]'::jsonb);
end $$;

revoke all on function public.kasa_report_followup(uuid, text) from public, anon;
revoke all on function public.kasa_my_followups() from public, anon;
grant execute on function public.kasa_report_followup(uuid, text) to authenticated;
grant execute on function public.kasa_my_followups() to authenticated;

commit;

notify pgrst, 'reload schema';
