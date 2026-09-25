-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — harder-to-buy confirmations, fairer flags, coarser times
--
-- Uses only data already kept (account age, past activity, the salted
-- network hash). Nothing new is collected about anyone.
--
--  • Ring check: when a cleanup reaches its confirmations, if two of its
--    confirmers have confirmed ≥ ring_min_shared other claims together in
--    the last ring_window_days, it waits for a moderator.
--  • Failed-claim cooldown: failed_claims_limit rejected claims within
--    failed_claims_window_days stop a person claiming for
--    failed_claims_block_days (they can still report, confirm and dispute).
--  • Night window: only daytime hours (quiet_end_hour to quiet_start_hour,
--    Asia/Kolkata) count toward the challenge_hours dispute window.
--  • Flags: only flags from accounts at least voter_min_account_hours old
--    with voter_min_prior_actions earlier actions count toward review, and
--    they must come from ≥ min_distinct_networks networks.
--  • Public views show report, event and reply times rounded to the hour,
--    so times can't be matched against someone's movements.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

insert into kasa_private.settings (key, value, note) values
  ('ring_min_shared', '3', 'Two confirmers who confirmed this many other claims together send a quorum to a moderator'),
  ('ring_window_days', '30', 'Look-back (days) for the confirmer ring check'),
  ('failed_claims_limit', '3', 'Rejected cleanup claims within the window that trigger a claiming pause'),
  ('failed_claims_window_days', '30', 'Window (days) for counting rejected claims'),
  ('failed_claims_block_days', '30', 'Claiming pause (days) after too many rejected claims'),
  ('quiet_start_hour', '22', 'Night starts (Asia/Kolkata hour); night hours do not count toward challenge_hours'),
  ('quiet_end_hour', '6', 'Night ends (Asia/Kolkata hour)')
on conflict (key) do nothing;

-- ── Night window ─────────────────────────────────────────────────────────
-- Only daytime hours (quiet_end_hour to quiet_start_hour, Asia/Kolkata) count
-- toward challenge_hours, so a quorum reached late at night can't become
-- final before neighbours have had a full day to dispute it.
create or replace function kasa_private.claim_final_after(p_quorum timestamptz) returns timestamptz
language plpgsql stable security definer set search_path = '' as $$
declare
  v_left  interval := make_interval(hours => kasa_private.cfg_num('challenge_hours')::integer);
  v_start integer  := kasa_private.cfg_num('quiet_start_hour')::integer;
  v_end   integer  := kasa_private.cfg_num('quiet_end_hour')::integer;
  v_t     timestamp;
  v_day   timestamp;
  v_close timestamp;
begin
  if p_quorum is null then return null; end if;
  if v_start <= v_end then return p_quorum + v_left; end if;   -- no night window configured
  v_t := p_quorum at time zone 'Asia/Kolkata';
  for i in 1..60 loop
    v_day := date_trunc('day', v_t);
    if v_t < v_day + make_interval(hours => v_end) then
      v_t := v_day + make_interval(hours => v_end);
    elsif v_t >= v_day + make_interval(hours => v_start) then
      v_t := v_day + interval '1 day' + make_interval(hours => v_end);
    end if;
    v_close := date_trunc('day', v_t) + make_interval(hours => v_start);
    if v_t + v_left <= v_close then return (v_t + v_left) at time zone 'Asia/Kolkata'; end if;
    v_left := v_left - (v_close - v_t);
    v_t := v_close;
  end loop;
  return p_quorum + make_interval(hours => kasa_private.cfg_num('challenge_hours')::integer);
end $$;

alter table kasa_private.claims add column if not exists final_after timestamptz;

-- final_after follows quorum_reached_at, however it gets set.
create or replace function kasa_private.sync_final_after() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.quorum_reached_at is distinct from old.quorum_reached_at then
    new.final_after := kasa_private.claim_final_after(new.quorum_reached_at);
  end if;
  return new;
end $$;
drop trigger if exists sync_final_after on kasa_private.claims;
create trigger sync_final_after before insert or update of quorum_reached_at on kasa_private.claims
  for each row execute function kasa_private.sync_final_after();
update kasa_private.claims set final_after = kasa_private.claim_final_after(quorum_reached_at)
where quorum_reached_at is not null and final_after is null;

-- ── Ring check ───────────────────────────────────────────────────────────
-- True when two current confirmers of this claim confirmed ring_min_shared
-- other claims together recently. Compares pairs only; nothing is stored.
create or replace function kasa_private.confirmers_often_together(p_claim_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  with cur as (
    select distinct v.voter_id from kasa_private.votes v
    where v.claim_id = p_claim_id and v.vote = 'verify' and v.voided_at is null
  )
  select exists (
    select 1
    from cur a join cur b on a.voter_id < b.voter_id
    join kasa_private.votes va on va.voter_id = a.voter_id and va.vote = 'verify' and va.voided_at is null
                                and va.claim_id <> p_claim_id
                                and va.created_at > now() - make_interval(days => kasa_private.cfg_num('ring_window_days')::integer)
    join kasa_private.votes vb on vb.voter_id = b.voter_id and vb.vote = 'verify' and vb.voided_at is null
                                and vb.claim_id = va.claim_id
    group by a.voter_id, b.voter_id
    having count(distinct va.claim_id) >= kasa_private.cfg_num('ring_min_shared')
  )
$$;

create or replace function kasa_private.evaluate_claim(p_claim_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  c         kasa_private.claims;
  v_nets    integer;
  v_dnets   integer;
  v_trusted integer;
  v_ring    boolean;
  v_need    integer := kasa_private.cfg_num('verify_quorum')::integer;
  v_min_net integer := kasa_private.cfg_num('min_distinct_networks')::integer;
begin
  select * into c from kasa_private.claims where id = p_claim_id for update;
  if not found or c.status <> 'pending' then return coalesce(c.status, 'missing'); end if;

  if c.dispute_count >= kasa_private.cfg_num('dispute_quorum') then
    select count(distinct coalesce(v.ip_hash, v.id::text)) into v_dnets
    from kasa_private.votes v where v.claim_id = c.id and v.vote = 'dispute' and v.voided_at is null;
    if v_dnets >= least(kasa_private.cfg_num('dispute_quorum')::integer, v_min_net) then
      perform kasa_private.reject_claim(c.id, 'disputed_on_site', null, false);
      return 'rejected';
    end if;
    if not c.needs_review and (c.reviewed_at is null or c.reviewed_at < (
         select max(v.created_at) from kasa_private.votes v
         where v.claim_id = c.id and v.vote = 'dispute' and v.voided_at is null)) then
      update kasa_private.claims set needs_review = true where id = c.id returning * into c;
      perform kasa_private.add_event(c.report_id::text, 'claim_held', null, c.id, null, null,
        jsonb_build_object('reason', 'disputes_one_network'));
    end if;
  end if;

  select count(distinct coalesce(v.ip_hash, v.id::text)),
         count(*) filter (where kasa_private.prior_actions(v.voter_id, c.created_at)
                                >= kasa_private.cfg_num('trusted_prior_actions'))
    into v_nets, v_trusted
  from kasa_private.votes v
  where v.claim_id = c.id and v.vote = 'verify' and v.voided_at is null and not v.needs_review;

  if c.quorum_reached_at is null and c.verify_count >= v_need and v_nets >= least(v_need, v_min_net) then
    v_ring := kasa_private.confirmers_often_together(c.id);
    update kasa_private.claims set quorum_reached_at = now(),
        needs_review = needs_review or v_trusted = 0 or v_ring
    where id = c.id returning * into c;
    if v_ring then
      perform kasa_private.add_event(c.report_id::text, 'claim_held', null, c.id, null, null,
        jsonb_build_object('reason', 'confirmers_often_together'));
    end if;
    perform kasa_private.add_event(c.report_id::text, 'quorum_reached', null, c.id, null, null,
      jsonb_build_object('verify_count', c.verify_count, 'needs_review', c.needs_review,
                         'final_after', c.final_after));
  end if;

  if c.quorum_reached_at is not null and not c.needs_review
     and coalesce(c.final_after, kasa_private.claim_final_after(c.quorum_reached_at)) <= now() then
    update kasa_private.claims set status = 'accepted', decided_at = now(), decided_reason = 'community_verified'
    where id = c.id;
    update public.reports set status = 'resolved', resolved_at = now(), resolved_photo_url = c.photo_url,
           resolution_method = 'community', updated_at = now()
    where id = c.report_id;
    perform kasa_private.add_event(c.report_id::text, 'resolved', null, c.id, null, null,
      jsonb_build_object('verify_count', c.verify_count, 'dispute_count', c.dispute_count));
    return 'accepted';
  end if;

  if (c.quorum_reached_at is null or c.needs_review)
     and c.created_at + make_interval(days => kasa_private.cfg_num('claim_expiry_days')::integer) <= now() then
    update kasa_private.claims set status = 'expired', decided_at = now(),
           decided_reason = case when c.needs_review then 'photo_not_reviewed' else 'not_enough_confirmations' end
    where id = c.id;
    update public.reports set status = 'open', claim_id = null, updated_at = now() where id = c.report_id;
    perform kasa_private.add_event(c.report_id::text, 'claim_expired', null, c.id, null, null,
      jsonb_build_object('verify_count', c.verify_count, 'needs_review', c.needs_review));
    return 'expired';
  end if;

  return 'pending';
end $$;

create or replace function public.kasa_finalize_due() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_n  integer := 0;
  v_state text;
begin
  perform kasa_private.forget_unused_photo_gps();
  for v_id in
    select id from kasa_private.claims
    where status = 'pending'
      and ((quorum_reached_at is not null and coalesce(final_after, kasa_private.claim_final_after(quorum_reached_at)) <= now())
        or created_at + make_interval(days => kasa_private.cfg_num('claim_expiry_days')::integer) <= now())
    limit 200
  loop
    v_state := kasa_private.evaluate_claim(v_id);
    if v_state <> 'pending' then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end $$;

-- kasa_vote_claim: only the returned final_after changes.
do $do$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.kasa_vote_claim(uuid,text,text,double precision,double precision,double precision,text)'::regprocedure);
  v_def := replace(v_def,
    'else c.quorum_reached_at + make_interval(hours => kasa_private.cfg_num(''challenge_hours'')::integer) end',
    'else c.final_after end');
  if position('else c.final_after end' in v_def) = 0 then raise exception 'kasa_vote_claim: final_after not patched'; end if;
  execute v_def;
end $do$;

-- ── Failed-claim cooldown ────────────────────────────────────────────────
create or replace function kasa_private.claims_paused_until(p_uid uuid) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select max(r.decided_at) + make_interval(days => kasa_private.cfg_num('failed_claims_block_days')::integer)
  from kasa_private.claims r
  where r.claimant_id = p_uid and r.status = 'rejected'
    and r.decided_at > now() - make_interval(days => kasa_private.cfg_num('failed_claims_block_days')::integer)
    and (select count(*) from kasa_private.claims o
         where o.claimant_id = p_uid and o.status = 'rejected'
           and o.decided_at <= r.decided_at
           and o.decided_at > r.decided_at - make_interval(days => kasa_private.cfg_num('failed_claims_window_days')::integer))
        >= kasa_private.cfg_num('failed_claims_limit')
$$;

create or replace function kasa_private.guard_failed_claims() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_until timestamptz := kasa_private.claims_paused_until(new.claimant_id);
begin
  if v_until is not null and v_until > now() then
    perform kasa_private.fail('KASA_CLAIMS_PAUSED',
      'Several of your recent cleanup claims were rejected, so you can''t claim cleanups for a while. You can still report, confirm and dispute.',
      jsonb_build_object('until', date_trunc('day', v_until) + interval '1 day'));
  end if;
  return new;
end $$;

drop trigger if exists guard_failed_claims on kasa_private.claims;
create trigger guard_failed_claims before insert on kasa_private.claims
  for each row execute function kasa_private.guard_failed_claims();

-- ── Flags from established accounts only ─────────────────────────────────
alter table kasa_private.flags
  add column if not exists ip_hash text,
  add column if not exists counts  boolean not null default true;

create or replace function public.kasa_flag_report(p_report_id text, p_reason text, p_note text default null,
    p_suggested_category text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me       kasa_private.profiles := kasa_private.me();
  r        public.reports;
  v_joined timestamptz;
  v_counts boolean;
  v_n      integer;
  v_nets   integer;
  v_need   integer := kasa_private.cfg_num('flag_review_threshold')::integer;
begin
  select * into r from public.reports where id::text = p_report_id and moderation_status in ('approved', 'flagged') for update;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'Report not found.'); end if;
  if r.user_id = me.user_id then perform kasa_private.fail('KASA_OWN_REPORT', 'You can''t flag your own report.'); end if;
  if p_reason is null or p_reason not in ('not_an_issue', 'wrong_category', 'wrong_location', 'duplicate', 'inappropriate',
                                          'fake_or_old_photo', 'other') then
    perform kasa_private.fail('KASA_BAD_REASON', 'Choose a reason.');
  end if;
  if p_reason = 'wrong_category' and (not coalesce(kasa_private.valid_category(p_suggested_category), false)
                                      or p_suggested_category = r.category) then
    perform kasa_private.fail('KASA_BAD_CATEGORY', 'Choose the right category for this problem.');
  end if;
  if kasa_private.text_verdict(p_note) ->> 'level' = 'block' then
    perform kasa_private.fail('KASA_TEXT_BLOCKED', 'Please remove abusive words and try again.');
  end if;
  perform kasa_private.rate_limit_actions(me.user_id);

  select u.created_at into v_joined from auth.users u where u.id = me.user_id;
  v_counts := v_joined is not null
              and v_joined <= now() - make_interval(hours => kasa_private.cfg_num('voter_min_account_hours')::integer)
              and kasa_private.prior_actions(me.user_id, now()) >= kasa_private.cfg_num('voter_min_prior_actions');

  insert into kasa_private.flags (report_id, user_id, reason, note, suggested_category, ip_hash, counts)
  values (r.id, me.user_id, p_reason, nullif(left(trim(coalesce(p_note, '')), 280), ''),
          case when p_reason = 'wrong_category' then p_suggested_category end, kasa_private.ip_hash(), v_counts)
  on conflict do nothing;
  if not found then return jsonb_build_object('counted', false, 'flags', r.flags); end if;

  select count(*), count(distinct coalesce(f.ip_hash, f.user_id::text)) into v_n, v_nets
  from kasa_private.flags f where f.report_id = r.id and f.counts;

  update public.reports set flags = coalesce(flags, 0) + 1,
         moderation_status = case when v_n >= v_need
                                        and v_nets >= least(v_need, kasa_private.cfg_num('min_distinct_networks')::integer)
                                        and moderation_status = 'approved' then 'flagged' else moderation_status end
  where id = r.id returning * into r;
  perform kasa_private.add_event(r.id::text, 'flagged', me.user_id, null, null, null,
    jsonb_build_object('reason', p_reason) ||
    case when p_reason = 'wrong_category' then jsonb_build_object('suggested_category', p_suggested_category) else '{}'::jsonb end);
  return jsonb_build_object('counted', true, 'weighs', v_counts, 'flags', r.flags, 'under_review', r.moderation_status = 'flagged');
end $$;

-- ── Public times rounded to the hour ─────────────────────────────────────
create or replace view public.kasa_public_reports as
select r.id,
       date_trunc('hour', r.created_at) as created_at,
       r.lat, r.lng, r.ward_no, r.category, r.severity, r.status, r.description, r.landmark, r.photo_url,
       coalesce(r.upvotes, 0) as upvotes, r.seen_on_site, coalesce(r.flags, 0) as flags, r.moderation_status,
       coalesce(r.is_duplicate, false) as is_duplicate, r.parent_report_id, r.recurrence_count, r.rejected_claims,
       date_trunc('hour', r.resolved_at) as resolved_at,
       r.resolved_photo_url, r.resolution_method, coalesce(r.sla_days, 7) as sla_days,
       (r.accuracy_m is not null) as gps_verified,
       c.id as claim_id, c.photo_url as claim_photo_url,
       date_trunc('hour', c.created_at) as claim_created_at,
       c.verify_count as claim_verify_count, c.dispute_count as claim_dispute_count,
       date_trunc('hour', c.quorum_reached_at) as claim_quorum_reached_at,
       date_trunc('hour', c.final_after + interval '59 minutes 59 seconds') as claim_finalize_after,
       round(c.distance_m::numeric) as claim_distance_m,
       r.rating_count, r.onsite_rating_count, r.authenticity_avg, r.severity_avg, r.neighbour_status, r.reply_count,
       c.needs_review as claim_needs_review
from public.reports r
left join kasa_private.claims c on c.id = r.claim_id and c.status = 'pending'
where r.moderation_status in ('approved', 'flagged');

create or replace view public.kasa_public_events as
select e.id, e.report_id, e.kind, e.actor_tag, e.claim_id, e.photo_url, round(e.distance_m::numeric) as distance_m,
       e.detail, date_trunc('hour', e.created_at) as created_at
from kasa_private.events e
join public.reports r on r.id = e.report_id
where r.moderation_status in ('approved', 'flagged');

create or replace view public.kasa_public_replies as
select p.id, p.report_id, p.responder_name, p.responder_role, p.body, p.verified_note,
       date_trunc('hour', p.created_at) as created_at
from kasa_private.replies p
join public.reports r on r.id = p.report_id
where p.hidden_at is null and r.moderation_status in ('approved', 'flagged');

revoke all on function kasa_private.claim_final_after(timestamptz) from public, anon, authenticated;
revoke all on function kasa_private.confirmers_often_together(uuid) from public, anon, authenticated;
revoke all on function kasa_private.claims_paused_until(uuid) from public, anon, authenticated;
revoke all on function kasa_private.guard_failed_claims() from public, anon, authenticated;
revoke all on function kasa_private.sync_final_after() from public, anon, authenticated;

commit;

notify pgrst, 'reload schema';
