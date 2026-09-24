-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — harder-to-fake cleanup confirmations and disputes
--
-- Uses only data already kept for anonymous accounts (account age, past
-- activity, the salted network hash). Nothing new is collected.
--
--  • Confirm AND dispute: account must be ≥ voter_min_account_hours old when
--    the claim was made, with ≥ voter_min_prior_actions earlier actions.
--  • A person can confirm the same claimant's cleanups once per
--    confirm_same_claimant_days.
--  • Disputes must come from ≥ 2 networks to reject automatically; otherwise
--    the claim waits for a moderator. Dispute rejections give no strike
--    (only a moderator rejection does).
--  • A quorum made only of low-history confirmers waits for a moderator.
--  • Cleanup and confirmation photos must pass the server photo check
--    (fingerprint reuse check; Vision when configured). New reports don't.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

insert into kasa_private.settings (key, value, note) values
  ('voter_min_account_hours', '72', 'Confirmers and disputers: account age (hours) when the claim was made'),
  ('voter_min_prior_actions', '1', 'Confirmers and disputers: earlier reports/votes/claims needed'),
  ('trusted_prior_actions', '3', 'A quorum needs at least one confirmer with this many earlier actions, else a moderator reviews'),
  ('confirm_same_claimant_days', '7', 'One confirmation per claimant per this many days'),
  ('require_evidence_photo_check', 'true', 'Cleanup claims and votes need a recorded server photo check')
on conflict (key) do nothing;

-- Earlier real activity: approved reports, unvoided votes, accepted claims.
create or replace function kasa_private.prior_actions(p_uid uuid, p_before timestamptz) returns integer
language sql stable security definer set search_path = '' as $$
  select (select count(*) from public.reports r
            where r.user_id = p_uid and r.created_at < p_before and r.moderation_status = 'approved')::integer
       + (select count(*) from kasa_private.votes v
            where v.voter_id = p_uid and v.created_at < p_before and v.voided_at is null)::integer
       + (select count(*) from kasa_private.claims c
            where c.claimant_id = p_uid and c.created_at < p_before and c.status = 'accepted')::integer
$$;

create or replace function kasa_private.check_photo(p_path text, p_folder text, p_uid uuid, p_not_before timestamptz,
                                                    p_lat double precision, p_lng double precision)
returns kasa_private.photo_checks
language plpgsql security definer set search_path = '' as $$
declare
  v_created timestamptz;
  v_owner   text;
  v_chk     kasa_private.photo_checks;
  v_near    integer := kasa_private.cfg_num('near_duplicate_distance')::integer;
  v_far     double precision := kasa_private.cfg_num('elsewhere_radius_m');
begin
  if p_path is null or (p_path !~ ('^' || p_folder || '/[A-Za-z0-9_-]{16,64}\.(jpg|jpeg|png|webp)$')
                        and not (p_path like p_folder || '/%' and kasa_private.old_photo_path_ok(p_path, p_uid))) then
    perform kasa_private.fail('KASA_PHOTO_INVALID', 'A photo is required.');
  end if;

  select o.created_at, coalesce(o.owner_id::text, o.owner::text) into v_created, v_owner
  from storage.objects o where o.bucket_id = 'kasa-photos' and o.name = p_path;
  if not found then
    perform kasa_private.fail('KASA_PHOTO_MISSING', 'Upload the photo first.');
  end if;
  if v_owner is distinct from p_uid::text then
    perform kasa_private.fail('KASA_PHOTO_NOT_YOURS', 'You can only submit photos you uploaded.');
  end if;
  if v_created < coalesce(p_not_before, '-infinity') or v_created < now() - interval '24 hours' then
    perform kasa_private.fail('KASA_PHOTO_STALE', 'Take a new photo now — older uploads can''t be used.');
  end if;
  if kasa_private.photo_in_use(p_path) then
    perform kasa_private.fail('KASA_PHOTO_REUSED', 'This photo has already been used.');
  end if;

  select * into v_chk from kasa_private.photo_checks where photo_path = p_path;
  if not found then
    if kasa_private.cfg_bool('require_photo_check')
       or (p_folder in ('claims', 'votes') and coalesce(kasa_private.cfg_bool('require_evidence_photo_check'), false)) then
      perform kasa_private.fail('KASA_PHOTO_UNCHECKED', 'Photo verification is unavailable right now. Try again shortly.');
    end if;
    return null;
  end if;
  if v_chk.unsafe then
    perform kasa_private.fail('KASA_PHOTO_UNSAFE', 'This photo can''t be published.');
  end if;
  if exists (select 1 from kasa_private.photo_checks c
             where c.photo_path <> p_path and c.sha256 = v_chk.sha256 and kasa_private.photo_in_use(c.photo_path)) then
    perform kasa_private.fail('KASA_PHOTO_REUSED', 'This photo has already been used. Take a new one.');
  end if;
  if p_lat is not null and exists (
      select 1 from kasa_private.photo_checks c
      join lateral (
        select r.lat, r.lng from public.reports r where r.photo_path = c.photo_path
        union all select cl.lat, cl.lng from kasa_private.claims cl where cl.photo_path = c.photo_path
        union all select v.lat, v.lng from kasa_private.votes v where v.photo_path = c.photo_path
      ) used on true
      where c.photo_path <> p_path
        and kasa_private.photo_distance(c.dhash, v_chk.dhash) <= v_near
        and kasa_private.distance_m(used.lat, used.lng, p_lat, p_lng) > v_far) then
    perform kasa_private.fail('KASA_PHOTO_ELSEWHERE', 'This photo matches one taken at a different place.');
  end if;
  return v_chk;
end $$;

create or replace function public.kasa_vote_claim(p_claim_id uuid, p_vote text, p_photo_path text,
    p_lat double precision, p_lng double precision, p_accuracy double precision, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me       kasa_private.profiles := kasa_private.me();
  c        kasa_private.claims;
  r        public.reports;
  v_chk    kasa_private.photo_checks;
  v_meta   jsonb := jsonb_build_object('capture', 'none');
  v_review boolean := false;
  v_dist   double precision;
  v_joined timestamptz;
  v_state  text;
  v_url    text;
begin
  if p_vote not in ('verify', 'dispute') then perform kasa_private.fail('KASA_BAD_VOTE', 'Unknown vote.'); end if;
  select * into c from kasa_private.claims where id = p_claim_id for update;
  if not found or c.status <> 'pending' then
    perform kasa_private.fail('KASA_CLAIM_CLOSED', 'This cleanup claim is no longer open.');
  end if;
  select * into r from public.reports where id = c.report_id;
  if c.claimant_id = me.user_id then
    perform kasa_private.fail('KASA_OWN_CLAIM', 'You made this claim — other people have to confirm it.');
  end if;
  if exists (select 1 from kasa_private.votes where claim_id = c.id and voter_id = me.user_id) then
    perform kasa_private.fail('KASA_ALREADY_VOTED', 'You already responded to this claim.');
  end if;

  -- Both confirmations and disputes need an established account.
  select u.created_at into v_joined from auth.users u where u.id = me.user_id;
  if v_joined is null
     or v_joined > c.created_at - make_interval(hours => kasa_private.cfg_num('voter_min_account_hours')::integer) then
    perform kasa_private.fail('KASA_ACCOUNT_TOO_NEW',
      'Only people who used Kasa for a few days before this cleanup was claimed can respond to it.');
  end if;
  if kasa_private.prior_actions(me.user_id, c.created_at) < kasa_private.cfg_num('voter_min_prior_actions') then
    perform kasa_private.fail('KASA_NO_HISTORY',
      'Report or confirm something else first — new accounts can''t respond to cleanups yet.');
  end if;
  if p_vote = 'verify' and exists (
      select 1 from kasa_private.votes v join kasa_private.claims oc on oc.id = v.claim_id
      where v.voter_id = me.user_id and v.vote = 'verify' and oc.claimant_id = c.claimant_id
        and v.created_at > now() - make_interval(days => kasa_private.cfg_num('confirm_same_claimant_days')::integer)) then
    perform kasa_private.fail('KASA_CONFIRM_LIMIT',
      'You recently confirmed a cleanup by the same person. Let other neighbours confirm this one.');
  end if;
  perform kasa_private.rate_limit_actions(me.user_id);

  if p_lat is null or p_lng is null or p_accuracy is null then
    perform kasa_private.fail('KASA_GPS_REQUIRED', 'Turn on location — you need to be at the spot.');
  end if;
  if p_accuracy > kasa_private.cfg_num('max_gps_accuracy_m') then
    perform kasa_private.fail('KASA_GPS_WEAK', 'GPS signal is too weak. Step outside and try again.',
      jsonb_build_object('accuracy_m', round(p_accuracy::numeric)));
  end if;
  v_dist := kasa_private.distance_m(r.lat, r.lng, p_lat, p_lng);
  if v_dist > kasa_private.cfg_num('vote_radius_m') then
    perform kasa_private.fail('KASA_TOO_FAR', 'You must be at the reported spot.',
      jsonb_build_object('distance_m', round(v_dist::numeric), 'limit_m', kasa_private.cfg_num('vote_radius_m')));
  end if;

  if p_photo_path is null then
    if kasa_private.cfg_bool('require_vote_photo') then
      perform kasa_private.fail('KASA_PHOTO_INVALID', 'Take a photo of the spot as it is now.');
    end if;
  else
    v_chk := kasa_private.check_photo(p_photo_path, 'votes', me.user_id, c.created_at, p_lat, p_lng);
    v_meta := kasa_private.photo_meta_verdict(p_photo_path, true, r.lat, r.lng, c.created_at);
    v_url := (kasa_private.cfg('storage_public_base') #>> '{}') || p_photo_path;
    if v_chk.photo_path is not null then
      if r.category in (select jsonb_array_elements_text(kasa_private.cfg('dirty_categories'))) then
        if p_vote = 'verify' and coalesce(v_chk.garbage_score, 0) > kasa_private.cfg_num('clean_max_garbage_score') then
          perform kasa_private.fail('KASA_STILL_DIRTY', 'Your photo still shows garbage — choose "Still dirty" instead.',
            jsonb_build_object('garbage_score', round(v_chk.garbage_score::numeric, 2)));
        end if;
        if p_vote = 'dispute' and kasa_private.cfg_num('dispute_min_garbage_score') > 0
           and coalesce(v_chk.garbage_score, 1) < kasa_private.cfg_num('dispute_min_garbage_score') then
          perform kasa_private.fail('KASA_LOOKS_CLEAN', 'Your photo doesn''t show garbage. Photograph what is still there.');
        end if;
      end if;
    end if;
  end if;
  v_review := p_vote = 'verify' and v_meta ? 'flag';

  insert into kasa_private.votes (claim_id, voter_id, vote, photo_path, photo_url, lat, lng, accuracy_m, distance_m, ip_hash, note,
                                  capture, photo_meta, needs_review)
  values (c.id, me.user_id, p_vote, p_photo_path, v_url, p_lat, p_lng, p_accuracy, v_dist,
          kasa_private.ip_hash(), nullif(left(trim(coalesce(p_note, '')), 280), ''),
          v_meta ->> 'capture', v_meta, v_review);

  if p_vote = 'verify' then
    if not v_review then update kasa_private.claims set verify_count = verify_count + 1 where id = c.id; end if;
  else
    update kasa_private.claims set dispute_count = dispute_count + 1 where id = c.id;
  end if;
  perform kasa_private.add_event(r.id::text, case when p_vote = 'verify' then 'verified' else 'disputed' end,
    me.user_id, c.id, v_url, v_dist,
    (case when v_chk.photo_path is null then '{}'::jsonb
          else jsonb_build_object('garbage_score', round(v_chk.garbage_score::numeric, 2)) end)
    || v_meta || jsonb_build_object('needs_review', v_review));

  v_state := kasa_private.evaluate_claim(c.id);
  select * into c from kasa_private.claims where id = c.id;
  return jsonb_build_object('claim_status', v_state, 'verify_count', c.verify_count, 'dispute_count', c.dispute_count,
    'needs_review', v_review,
    'verify_needed', kasa_private.cfg_num('verify_quorum'), 'dispute_needed', kasa_private.cfg_num('dispute_quorum'),
    'final_after', case when c.quorum_reached_at is null then null
                        else c.quorum_reached_at + make_interval(hours => kasa_private.cfg_num('challenge_hours')::integer) end);
end $$;

create or replace function kasa_private.evaluate_claim(p_claim_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  c         kasa_private.claims;
  v_nets    integer;
  v_dnets   integer;
  v_trusted integer;
  v_need    integer := kasa_private.cfg_num('verify_quorum')::integer;
  v_min_net integer := kasa_private.cfg_num('min_distinct_networks')::integer;
begin
  select * into c from kasa_private.claims where id = p_claim_id for update;
  if not found or c.status <> 'pending' then return coalesce(c.status, 'missing'); end if;

  if c.dispute_count >= kasa_private.cfg_num('dispute_quorum') then
    select count(distinct coalesce(v.ip_hash, v.id::text)) into v_dnets
    from kasa_private.votes v where v.claim_id = c.id and v.vote = 'dispute' and v.voided_at is null;
    if v_dnets >= least(kasa_private.cfg_num('dispute_quorum')::integer, v_min_net) then
      -- No strike: disputes alone can be coordinated; only a moderator rejection strikes.
      perform kasa_private.reject_claim(c.id, 'disputed_on_site', null, false);
      return 'rejected';
    end if;
    -- Disputes from one network: a moderator decides (unless one already reviewed since).
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
    update kasa_private.claims set quorum_reached_at = now(), needs_review = needs_review or v_trusted = 0
    where id = c.id returning * into c;
    perform kasa_private.add_event(c.report_id::text, 'quorum_reached', null, c.id, null, null,
      jsonb_build_object('verify_count', c.verify_count, 'needs_review', c.needs_review,
                         'final_after', now() + make_interval(hours => kasa_private.cfg_num('challenge_hours')::integer)));
  end if;

  if c.quorum_reached_at is not null and not c.needs_review
     and c.quorum_reached_at + make_interval(hours => kasa_private.cfg_num('challenge_hours')::integer) <= now() then
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

revoke all on all functions in schema kasa_private from public, anon, authenticated;
grant execute on function kasa_private.is_admin() to authenticated;
revoke all on function public.kasa_vote_claim(uuid, text, text, double precision, double precision, double precision, text) from public, anon;
grant execute on function public.kasa_vote_claim(uuid, text, text, double precision, double precision, double precision, text) to authenticated;

commit;

notify pgrst, 'reload schema';
