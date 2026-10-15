-- Cleanup claims need one on-site citizen confirmation (was 3 town, 2 rural), per the 2026-10-15 decision.
-- Unchanged: the two-network rule (least of the quorum and min_distinct_networks, so 1 here), the 12 hour
-- challenge window, dispute_quorum, the photo, GPS and radius checks, and moderator review of first-time confirmers.
begin;

update kasa_private.settings
   set value = to_jsonb(1),
       note = 'On-site confirmations (besides the claimant) needed to resolve; 1 since 2026-10-15'
 where key = 'verify_quorum';

update kasa_private.settings
   set value = to_jsonb(1),
       note = 'Confirmations needed for a cleanup outside Purulia town; 1 since 2026-10-15'
 where key = 'rural_verify_quorum';

commit;

notify pgrst, 'reload schema';
