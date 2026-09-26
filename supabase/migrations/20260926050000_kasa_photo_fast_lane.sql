-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — photo-check fast lane for cleanup claims
--
-- A cleanup claim whose live "after" photo clearly shows no rubbish
-- (server-side Vision score at or below fast_max_garbage_score, photo GPS
-- not contradicting the phone's) is "photo-confident":
--   • it needs fast_verify_quorum on-site confirmations (default 1) instead
--     of the full quorum; the usual rules still apply (distinct networks,
--     challenge window, low-history confirmers go to a moderator);
--   • if nobody confirms or disputes it within photo_only_days (default 3),
--     it closes on the photo check alone, with resolution_method
--     'photo_check' so the public record says so.
-- Only for dirty categories (garbage, drain), where Vision can judge the
-- photo, and only for reports with no earlier rejected claim. Any dispute
-- or hold takes a claim out of the photo-only path.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

insert into kasa_private.settings (key, value, note) values
  ('fast_max_garbage_score', '0.2', 'Cleanup photos at or below this garbage score count as photo-confident (fast lane)'),
  ('fast_verify_quorum',     '1',   'On-site confirmations a photo-confident cleanup claim needs'),
  ('photo_only_days',        '3',   'A photo-confident claim with no confirmations or disputes closes on the photo check after this many days (0 = never)')
on conflict (key) do nothing;

alter table kasa_private.claims add column if not exists photo_confident boolean not null default false;

create or replace function kasa_private.set_claim_photo_confident() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select coalesce(ch.garbage_score <= kasa_private.cfg_num('fast_max_garbage_score'), false)
         and ch.exif_match is not false
    into new.photo_confident
  from public.reports r
  left join kasa_private.photo_checks ch on ch.photo_path = new.photo_path
  where r.id = new.report_id
    and coalesce(r.rejected_claims, 0) = 0
    and r.category in (select jsonb_array_elements_text(kasa_private.cfg('dirty_categories')));
  new.photo_confident := coalesce(new.photo_confident, false);
  return new;
end $$;
drop trigger if exists set_claim_photo_confident on kasa_private.claims;
create trigger set_claim_photo_confident before insert on kasa_private.claims
  for each row execute function kasa_private.set_claim_photo_confident();

create or replace function kasa_private.claim_verify_need(c kasa_private.claims) returns integer
language sql stable security definer set search_path = '' as $$
  select case when c.photo_confident
              then least(kasa_private.area_num('verify_quorum', c.report_id)::integer,
                         kasa_private.cfg_num('fast_verify_quorum')::integer)
              else kasa_private.area_num('verify_quorum', c.report_id)::integer end
$$;

create or replace function kasa_private.photo_only_due(c kasa_private.claims) returns boolean
language sql stable security definer set search_path = '' as $$
  select c.status = 'pending' and c.photo_confident and c.quorum_reached_at is null
     and not c.needs_review and c.reviewed_at is null
     and c.dispute_count = 0 and c.verify_count = 0
     and kasa_private.cfg_num('photo_only_days') > 0
     and c.created_at + make_interval(days => kasa_private.cfg_num('photo_only_days')::integer) <= now()
$$;

create or replace function kasa_private.evaluate_claim(p_claim_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  c         kasa_private.claims;
  v_nets    integer;
  v_dnets   integer;
  v_trusted integer;
  v_ring    boolean;
  v_need    integer;
  v_dneed   integer;
  v_min_net integer;
  v_expiry  integer;
begin
  select * into c from kasa_private.claims where id = p_claim_id for update;
  if not found or c.status <> 'pending' then return coalesce(c.status, 'missing'); end if;
  v_need    := kasa_private.claim_verify_need(c);
  v_dneed   := kasa_private.area_num('dispute_quorum', c.report_id)::integer;
  v_min_net := kasa_private.area_num('min_distinct_networks', c.report_id)::integer;
  v_expiry  := kasa_private.area_num('claim_expiry_days', c.report_id)::integer;

  if c.dispute_count >= v_dneed then
    select count(distinct coalesce(v.ip_hash, v.id::text)) into v_dnets
    from kasa_private.votes v where v.claim_id = c.id and v.vote = 'dispute' and v.voided_at is null;
    if v_dnets >= least(v_dneed, v_min_net) then
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
                         'final_after', c.final_after, 'photo_confident', c.photo_confident));
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

  if kasa_private.photo_only_due(c) then
    update kasa_private.claims set status = 'accepted', decided_at = now(), decided_reason = 'photo_check'
    where id = c.id;
    update public.reports set status = 'resolved', resolved_at = now(), resolved_photo_url = c.photo_url,
           resolution_method = 'photo_check', updated_at = now()
    where id = c.report_id;
    perform kasa_private.add_event(c.report_id::text, 'resolved', null, c.id, null, null,
      jsonb_build_object('verify_count', 0, 'dispute_count', 0, 'by', 'photo_check'));
    return 'accepted';
  end if;

  if (c.quorum_reached_at is null or c.needs_review)
     and c.created_at + make_interval(days => v_expiry) <= now() then
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
    select c.id from kasa_private.claims c
    where c.status = 'pending'
      and ((c.quorum_reached_at is not null and coalesce(c.final_after, kasa_private.claim_final_after(c.quorum_reached_at)) <= now())
        or kasa_private.photo_only_due(c)
        or c.created_at + make_interval(days => kasa_private.cfg_num('claim_expiry_days')::integer) <= now()
        or c.created_at + make_interval(days => kasa_private.area_num('claim_expiry_days', c.report_id)::integer) <= now())
    limit 200
  loop
    v_state := kasa_private.evaluate_claim(v_id);
    if v_state <> 'pending' then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end $$;

-- Replies from kasa_vote_claim / kasa_claim_cleanup say how many confirmations this claim needs.
do $do$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.kasa_vote_claim(uuid,text,text,double precision,double precision,double precision,text)'::regprocedure);
  if position('claim_verify_need' in v_def) = 0 then
    v_def := replace(v_def, $a$'verify_needed', kasa_private.area_num('verify_quorum', c.report_id),$a$,
                            $a$'verify_needed', kasa_private.claim_verify_need(c),$a$);
    if position('claim_verify_need' in v_def) = 0 then raise exception 'kasa_vote_claim: fast-lane patch did not apply'; end if;
    execute v_def;
  end if;
  v_def := pg_get_functiondef('public.kasa_claim_cleanup(text,text,double precision,double precision,double precision)'::regprocedure);
  if position('claim_verify_need' in v_def) = 0 then
    v_def := replace(v_def, $a$'verify_needed', kasa_private.area_num('verify_quorum', r.id),$a$,
                            $a$'verify_needed', kasa_private.claim_verify_need(c), 'photo_confident', c.photo_confident,$a$);
    if position('claim_verify_need' in v_def) = 0 then raise exception 'kasa_claim_cleanup: fast-lane patch did not apply'; end if;
    execute v_def;
  end if;
  -- The weekly digest counts photo-check closures as fixes too.
  if to_regprocedure('public.kasa_weekly_digest_claim()') is not null then
    v_def := pg_get_functiondef('public.kasa_weekly_digest_claim()'::regprocedure);
    if position('photo_check' in v_def) = 0 then
      execute replace(v_def, $a$r.resolution_method = 'community'$a$, $a$r.resolution_method in ('community', 'photo_check')$a$);
    end if;
  end if;
end $do$;

-- Which pending (or photo-closed) claims are photo-confident, for the map. Claim ids only.
create or replace function public.kasa_fast_claims() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('claim_id', c.id, 'need', kasa_private.claim_verify_need(c),
                                               'photo_only_at', case when kasa_private.cfg_num('photo_only_days') > 0
                                                 then date_trunc('hour', c.created_at + make_interval(days => kasa_private.cfg_num('photo_only_days')::integer)) end)),
                  '[]'::jsonb)
  from kasa_private.claims c
  join public.reports r on r.claim_id = c.id and r.moderation_status in ('approved', 'flagged')
  where c.photo_confident and c.status in ('pending', 'accepted')
$$;
revoke all on function public.kasa_fast_claims() from public;
grant execute on function public.kasa_fast_claims() to anon, authenticated;
revoke all on function kasa_private.set_claim_photo_confident() from public, anon, authenticated;

create or replace function public.kasa_rules() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_object_agg(key, value) from kasa_private.settings
  where key in ('verify_quorum', 'dispute_quorum', 'challenge_hours', 'claim_expiry_days', 'claim_radius_m',
                'vote_radius_m', 'max_gps_accuracy_m', 'require_vote_photo', 'review_categories', 'bbox',
                'max_photo_age_minutes', 'photo_gps_far_m', 'require_live_capture',
                'rural_verify_quorum', 'rural_min_distinct_networks', 'rural_claim_expiry_days', 'town_ward_margin_m',
                'min_distinct_networks', 'fast_max_garbage_score', 'fast_verify_quorum', 'photo_only_days')
$$;

commit;

notify pgrst, 'reload schema';
