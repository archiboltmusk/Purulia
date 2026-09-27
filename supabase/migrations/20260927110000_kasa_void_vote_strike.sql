-- PURULIA KASA — strike the voter when a moderator voids their confirm/dispute as
-- fake, and actually enforce it by blocking further voting once strikes pile up.
--
-- kasa_admin_void_vote already removes a proven-fake vote's effect on the claim, the
-- same way kasa_admin_reject_claim removes a fake cleanup claim's effect (giving the
-- claimant a strike via kasa_private.reject_claim's p_strike). void_vote gave the
-- voter nothing, and nothing anywhere checked a voter's strikes before letting them
-- vote: someone could dispute (or confirm) in bad faith without limit, each instance
-- costing nothing beyond that one vote being voided on review.
--
-- kasa_vote_claim's body is rewritten in place by later migrations (kasa_district,
-- kasa_photo_fast_lane, kasa_photo_check_unscored — see their `pg_get_functiondef` +
-- `replace()` patches) rather than redefined wholesale after 20260925000000, so a
-- plain `create or replace` here from a copied body would silently drop all of that.
-- A `before insert on kasa_private.votes` trigger reaches the same block without
-- touching the function at all — the same pattern kasa_claim_integrity's
-- guard_failed_claims trigger already uses for the equivalent claim-side block.

create or replace function public.kasa_admin_void_vote(p_vote_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v kasa_private.votes;
  c kasa_private.claims;
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  if coalesce(trim(p_reason), '') = '' then perform kasa_private.fail('KASA_REASON_REQUIRED', 'Give a public reason.'); end if;
  select * into v from kasa_private.votes where id = p_vote_id for update;
  if not found or v.voided_at is not null then perform kasa_private.fail('KASA_NOT_FOUND', 'Vote not found.'); end if;
  select * into c from kasa_private.claims where id = v.claim_id for update;
  if c.status <> 'pending' then perform kasa_private.fail('KASA_CLAIM_CLOSED', 'This claim is already decided.'); end if;
  update kasa_private.votes set voided_at = now(), void_reason = left(p_reason, 200) where id = v.id;
  update kasa_private.claims
  set verify_count = verify_count - (case when v.vote = 'verify' and not v.needs_review then 1 else 0 end),
      dispute_count = dispute_count - (case when v.vote = 'dispute' then 1 else 0 end)
  where id = c.id;
  insert into kasa_private.profiles (user_id, strikes) values (v.voter_id, 1)
    on conflict (user_id) do update set strikes = kasa_private.profiles.strikes + 1;
  perform kasa_private.add_event(c.report_id::text, 'vote_voided', null, c.id, v.photo_url, null,
    jsonb_build_object('vote', v.vote, 'reason', left(p_reason, 200), 'voter', kasa_private.tag(v.voter_id, c.report_id::text)));
  return jsonb_build_object('claim_status', kasa_private.evaluate_claim(c.id));
end $$;

create or replace function kasa_private.guard_bad_voters() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_strikes int;
begin
  select strikes into v_strikes from kasa_private.profiles where user_id = new.voter_id;
  if coalesce(v_strikes, 0) >= kasa_private.cfg_num('max_strikes') then
    perform kasa_private.fail('KASA_CLAIM_BLOCKED',
      'Too many of your claims or votes were rejected as fake. You are blocked from claiming, confirming or disputing.');
  end if;
  return new;
end $$;

drop trigger if exists guard_bad_voters on kasa_private.votes;
create trigger guard_bad_voters before insert on kasa_private.votes
  for each row execute function kasa_private.guard_bad_voters();
