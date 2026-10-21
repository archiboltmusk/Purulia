-- Claim vs reality, §13 status set (design: research/claim-reality-engine-design.md §13).
-- Replaces candidate/approved/rejected/published/withdrawn on kasa_private.reality_signals with
-- staged → internal_review → notice_issued → under_counsel_review → approved_public, plus
-- rejected_evidence, rectified_officially and disputed_paused. Moves are checked by a trigger and
-- logged to an append-only table. Nothing here is public.
--
-- approved_public is refused for now: it needs the counsel role and sign-off fields, which are not
-- built, and legal_gate_open stays false. No row is deleted; rejected rows are kept (retention is a
-- counsel question). Safe to re-run.

-- ── 1. Columns and status set ───────────────────────────────────────────────
alter table kasa_private.reality_signals add column if not exists reject_reason text;
alter table kasa_private.reality_signals add column if not exists duplicate_of bigint
  references kasa_private.reality_signals (id) on delete set null;

drop trigger if exists kasa_reality_signal_transition on kasa_private.reality_signals;
alter table kasa_private.reality_signals drop constraint if exists reality_signals_status_check;
alter table kasa_private.reality_signals drop constraint if exists reality_signals_reviewed;
alter table kasa_private.reality_signals drop constraint if exists reality_signals_reject_reason;
alter table kasa_private.reality_signals drop constraint if exists reality_signals_duplicate;

update kasa_private.reality_signals set status = case status
    when 'candidate' then 'staged'
    when 'approved'  then 'internal_review'
    when 'rejected'  then 'rejected_evidence'
    when 'withdrawn' then 'rejected_evidence'
    when 'published' then 'disputed_paused'   -- never set before this file; hidden, never public
  end
  where status in ('candidate', 'approved', 'rejected', 'withdrawn', 'published');
update kasa_private.reality_signals set reject_reason = 'other'
  where status = 'rejected_evidence' and reject_reason is null;

alter table kasa_private.reality_signals alter column status set default 'staged';
alter table kasa_private.reality_signals add constraint reality_signals_status_check check (status in (
  'staged', 'internal_review', 'notice_issued', 'under_counsel_review', 'approved_public',
  'rejected_evidence', 'rectified_officially', 'disputed_paused'));
alter table kasa_private.reality_signals add constraint reality_signals_reviewed
  check (status = 'staged' or reviewed_at is not null);
alter table kasa_private.reality_signals add constraint reality_signals_reject_reason check (
  (status = 'rejected_evidence') = (reject_reason is not null)
  and (reject_reason is null or reject_reason in (
    'insufficient_evidence', 'duplicate', 'personal_data', 'child_in_photo', 'wrong_asset', 'noise', 'other')));
alter table kasa_private.reality_signals add constraint reality_signals_duplicate check (
  (reject_reason = 'duplicate') = (duplicate_of is not null) and duplicate_of is distinct from id);

-- ── 2. Append-only log of every move ────────────────────────────────────────
create table if not exists kasa_private.reality_signal_events (
  id            bigint generated always as identity primary key,
  signal_id     bigint not null,          -- no FK: the log outlives the row
  from_status   text,
  to_status     text not null,
  reject_reason text,
  duplicate_of  bigint,
  note          text,
  actor_id      uuid,
  created_at    timestamptz not null default now()
);
create index if not exists reality_signal_events_signal_idx on kasa_private.reality_signal_events (signal_id, created_at);
alter table kasa_private.reality_signal_events enable row level security;
revoke all on kasa_private.reality_signal_events from public, anon, authenticated;
drop trigger if exists kasa_reality_signal_events_append_only on kasa_private.reality_signal_events;
create trigger kasa_reality_signal_events_append_only before update or delete on kasa_private.reality_signal_events
  for each row execute function kasa_private.ev_append_only();

-- ── 3. Transition guard ─────────────────────────────────────────────────────
create or replace function kasa_private.reality_signal_transition() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_ok boolean;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'staged' then
      raise exception 'new signals start as staged' using errcode = '23514';
    end if;
    return new;
  end if;
  if new.status is not distinct from old.status then
    return new;
  end if;
  v_ok := case old.status
    when 'staged'               then new.status in ('internal_review', 'rejected_evidence')
    when 'internal_review'      then new.status in ('notice_issued', 'under_counsel_review', 'rejected_evidence', 'rectified_officially')
    when 'notice_issued'        then new.status in ('under_counsel_review', 'disputed_paused', 'rejected_evidence', 'rectified_officially')
    when 'under_counsel_review' then new.status in ('approved_public', 'disputed_paused', 'rejected_evidence', 'rectified_officially')
    when 'disputed_paused'      then new.status in ('under_counsel_review', 'rejected_evidence', 'rectified_officially')
    when 'approved_public'      then new.status in ('disputed_paused')
    else false                  -- rejected_evidence, rectified_officially: final
  end;
  if not v_ok then
    raise exception 'cannot move a signal from % to %', old.status, new.status using errcode = '23514';
  end if;
  if new.status = 'approved_public' then
    raise exception 'publication needs counsel sign-off, which is not built yet' using errcode = '42501';
  end if;
  insert into kasa_private.reality_signal_events (signal_id, from_status, to_status, reject_reason, duplicate_of, note, actor_id)
  values (new.id, old.status, new.status, new.reject_reason, new.duplicate_of, new.review_note, auth.uid());
  return new;
end $$;
revoke all on function kasa_private.reality_signal_transition() from public, anon, authenticated;

create trigger kasa_reality_signal_transition before insert or update of status on kasa_private.reality_signals
  for each row execute function kasa_private.reality_signal_transition();

-- ── 4. Moderator RPCs ───────────────────────────────────────────────────────
-- One call per move. A private note is required for every move.
create or replace function public.kasa_admin_transition_cluster_state(
  p_id bigint, p_to text, p_note text, p_reason text default null, p_duplicate_of bigint default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if not kasa_private.is_admin() then
    raise exception 'moderators only' using errcode = '42501';
  end if;
  if v_note is null then
    raise exception 'a note is required' using errcode = '22023';
  end if;
  if p_to = 'rejected_evidence' and p_reason is null then
    raise exception 'a reject reason is required' using errcode = '22023';
  end if;
  if p_reason = 'duplicate' and not exists (
       select 1 from kasa_private.reality_signals where id = p_duplicate_of and id <> p_id) then
    raise exception 'duplicate needs the id of the other signal' using errcode = '22023';
  end if;
  update kasa_private.reality_signals
     set status = p_to,
         reject_reason = case when p_to = 'rejected_evidence' then p_reason end,
         duplicate_of  = case when p_to = 'rejected_evidence' and p_reason = 'duplicate' then p_duplicate_of end,
         reviewed_by = auth.uid(), reviewed_at = now(), review_note = v_note
   where id = p_id and status <> p_to;
  if not found then
    raise exception 'signal not found or already in that state' using errcode = 'P0002';
  end if;
  return jsonb_build_object('id', p_id, 'status', p_to);
end $$;

-- Old two-button call kept for cached admin pages: approved → internal_review, rejected → rejected_evidence.
create or replace function public.kasa_admin_review_reality_signal(p_id bigint, p_decision text, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'decision must be approved or rejected' using errcode = '22023';
  end if;
  return public.kasa_admin_transition_cluster_state(p_id,
    case p_decision when 'approved' then 'internal_review' else 'rejected_evidence' end,
    coalesce(nullif(trim(coalesce(p_note, '')), ''), p_decision),
    case p_decision when 'rejected' then 'other' end);
end $$;

create or replace function public.kasa_admin_reality_signals(p_status text default 'staged', p_limit integer default 50)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_status text := case p_status when 'candidate' then 'staged' when 'approved' then 'internal_review'
                                 when 'rejected' then 'rejected_evidence' else p_status end;
begin
  if not kasa_private.is_admin() then
    raise exception 'moderators only' using errcode = '42501';
  end if;
  -- Contractor names and reporter hashes are deliberately not returned.
  return coalesce((
    select jsonb_agg(x order by x.computed_at desc)
    from (
      select s.id, s.signal_type, s.status, s.report_count, s.distinct_reporters,
             s.heuristic_score, s.first_reported_on, s.latest_reported_on, s.computed_at,
             s.cluster_lat, s.cluster_lng, s.review_note, s.reviewed_at, s.reject_reason, s.duplicate_of,
             w.title as work_title, w.tender_ref, w.portal, w.completed_on, w.dlp_months, w.dlp_source_url,
             a.name as asset_name, a.ref as asset_ref
      from kasa_private.reality_signals s
      join kasa_private.works w on w.id = s.work_id
      join kasa_private.assets a on a.id = s.asset_id
      where s.status = v_status
      order by s.computed_at desc
      limit least(greatest(p_limit, 1), 200)
    ) x
  ), '[]'::jsonb);
end $$;

revoke execute on function public.kasa_admin_transition_cluster_state(bigint, text, text, text, bigint) from public, anon;
revoke execute on function public.kasa_admin_review_reality_signal(bigint, text, text) from public, anon;
revoke execute on function public.kasa_admin_reality_signals(text, integer) from public, anon;
grant execute on function public.kasa_admin_transition_cluster_state(bigint, text, text, text, bigint) to authenticated;
grant execute on function public.kasa_admin_review_reality_signal(bigint, text, text) to authenticated;
grant execute on function public.kasa_admin_reality_signals(text, integer) to authenticated;
