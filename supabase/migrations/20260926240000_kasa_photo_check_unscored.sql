-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — don't treat "the photo check is unavailable" as "clean"
--
-- The garbage-score checks on a cleanup claim and its confirmations read
-- coalesce(garbage_score, 0): if the Vision key is missing, over its free
-- quota, or the service is down, garbage_score is null and that null was
-- silently treated as "definitely not garbage" — a claim or "still there"
-- confirmation would pass the automatic check with no photo evidence
-- actually having been looked at. As report volume grows past what any
-- free API tier covers, that gap only gets more likely, not less.
--
-- Now: when the photo check ran but couldn't score the photo, the claim
-- (or confirmation) still goes through — nobody should be blocked because
-- a free quota is being watched — but it's held with needs_review = true,
-- the same "wait for a moderator" path already used for other photo
-- red flags, instead of quietly counting as verified.
--
-- Patches the live function bodies in place (like kasa_photo_fast_lane.sql)
-- so the fast-lane and district patches already applied to them survive.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

do $do$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.kasa_claim_cleanup(text,text,double precision,double precision,double precision)'::regprocedure);
  if position('v_unscored' in v_def) = 0 then
    v_def := replace(v_def,
      $a$  v_dist double precision;
  c      kasa_private.claims;$a$,
      $a$  v_dist double precision;
  v_unscored boolean := false;
  c      kasa_private.claims;$a$);
    v_def := replace(v_def,
      $a$    if r.category in (select jsonb_array_elements_text(kasa_private.cfg('dirty_categories')))
       and coalesce(v_chk.garbage_score, 0) > kasa_private.cfg_num('clean_max_garbage_score') then
      perform kasa_private.fail('KASA_STILL_DIRTY', 'The photo still shows garbage.',
        jsonb_build_object('garbage_score', round(v_chk.garbage_score::numeric, 2)));
    end if;$a$,
      $a$    if r.category in (select jsonb_array_elements_text(kasa_private.cfg('dirty_categories'))) then
      if v_chk.garbage_score is null then
        -- The check ran but couldn't score this photo (no Vision key, over quota, or an
        -- outage). Don't guess either way: let the claim through, held for a moderator.
        v_unscored := true;
      elsif v_chk.garbage_score > kasa_private.cfg_num('clean_max_garbage_score') then
        perform kasa_private.fail('KASA_STILL_DIRTY', 'The photo still shows garbage.',
          jsonb_build_object('garbage_score', round(v_chk.garbage_score::numeric, 2)));
      end if;
    end if;$a$);
    v_def := replace(v_def,
      $a$kasa_private.ip_hash(), v_meta ->> 'capture', v_meta, v_meta ? 'flag')$a$,
      $a$kasa_private.ip_hash(), v_meta ->> 'capture', v_meta, (v_meta ? 'flag') or v_unscored)$a$);
    if position('v_unscored' in v_def) = 0 then raise exception 'kasa_claim_cleanup: unscored-photo patch did not apply'; end if;
    execute v_def;
  end if;

  v_def := pg_get_functiondef('public.kasa_vote_claim(uuid,text,text,double precision,double precision,double precision,text)'::regprocedure);
  if position('v_unscored' in v_def) = 0 then
    v_def := replace(v_def,
      $a$  v_review boolean := false;
  v_dist   double precision;$a$,
      $a$  v_review boolean := false;
  v_unscored boolean := false;
  v_dist   double precision;$a$);
    v_def := replace(v_def,
      $a$      if r.category in (select jsonb_array_elements_text(kasa_private.cfg('dirty_categories'))) then
        if p_vote = 'verify' and coalesce(v_chk.garbage_score, 0) > kasa_private.cfg_num('clean_max_garbage_score') then
          perform kasa_private.fail('KASA_STILL_DIRTY', 'Your photo still shows garbage — choose "Still dirty" instead.',
            jsonb_build_object('garbage_score', round(v_chk.garbage_score::numeric, 2)));
        end if;$a$,
      $a$      if r.category in (select jsonb_array_elements_text(kasa_private.cfg('dirty_categories'))) then
        if p_vote = 'verify' then
          if v_chk.garbage_score is null then
            v_unscored := true;
          elsif v_chk.garbage_score > kasa_private.cfg_num('clean_max_garbage_score') then
            perform kasa_private.fail('KASA_STILL_DIRTY', 'Your photo still shows garbage — choose "Still dirty" instead.',
              jsonb_build_object('garbage_score', round(v_chk.garbage_score::numeric, 2)));
          end if;
        end if;$a$);
    v_def := replace(v_def,
      $a$v_review := p_vote = 'verify' and v_meta ? 'flag';$a$,
      $a$v_review := p_vote = 'verify' and (v_unscored or v_meta ? 'flag');$a$);
    if position('v_unscored' in v_def) = 0 then raise exception 'kasa_vote_claim: unscored-photo patch did not apply'; end if;
    execute v_def;
  end if;
end $do$;

commit;

notify pgrst, 'reload schema';
