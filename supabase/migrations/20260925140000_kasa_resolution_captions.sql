-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — resolution captions ("Resolved by 3 confirmers · ...")
--
-- kasa_public_reports has always joined the report's claim ON c.status =
-- 'pending', so the moment a claim is accepted (the report resolves), the
-- join stops matching and claim_verify_count/claim_needs_review etc. all
-- go null — exactly the numbers a "resolved by N confirmers" caption needs.
-- reports.claim_id is never cleared on acceptance (only on rejection or
-- expiry, where it's set back to null), so dropping the status filter is
-- enough: the join now shows the live claim while a report is being
-- verified, and the same accepted claim's final numbers once it's
-- resolved, with no ambiguity between the two.
--
-- Also exposes claim_reviewed_at: a moderator clearing a held claim
-- (kasa_admin_clear_claim) sets needs_review = false and reviewed_at =
-- now(), and nothing ever unsets reviewed_at afterwards — so "reviewed_at
-- is not null" means a moderator actually looked at this one, whether it
-- was held for thin confirmer history or a ring pattern. A claim that
-- sailed through without ever needing review keeps reviewed_at null.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

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
       c.needs_review as claim_needs_review,
       r.area_kind, r.block_name,
       (select (s.value #>> '{}')::integer from kasa_private.settings s
        where s.key = case when r.area_kind = 'rural' then 'rural_verify_quorum' else 'verify_quorum' end) as verify_needed,
       date_trunc('hour', c.reviewed_at) as claim_reviewed_at
from public.reports r
left join kasa_private.claims c on c.id = r.claim_id
where r.moderation_status in ('approved', 'flagged');

commit;

notify pgrst, 'reload schema';
