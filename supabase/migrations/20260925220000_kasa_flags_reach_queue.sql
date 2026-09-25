-- ════════════════════════════════════════════════════════════════════════
-- PURULIA KASA — every flag reaches the moderation queue
--
-- A report only moved to 'flagged' (and so into kasa_admin_queue) after
-- flag_review_threshold flags from established accounts on distinct
-- networks. That threshold is right for pulling a report off the public map
-- automatically, but it meant a single flag — or several from new accounts —
-- was recorded and never seen by anyone.
--
-- The queue now also lists still-public ('approved') reports with any flag
-- newer than the last moderator decision on them. "Publish / keep" (which
-- logs a 'moderated' event) clears it until someone flags it again. The
-- auto-hide threshold is unchanged.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

create or replace function public.kasa_admin_queue() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  return jsonb_build_object(
    'reports', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
        select r.id, r.created_at, r.category, r.severity, r.ward_no, r.description, r.landmark, r.photo_url,
               r.moderation_status, r.flags, r.moderation_labels,
               (select jsonb_agg(jsonb_build_object('reason', f.reason, 'note', f.note, 'at', f.created_at, 'suggested_category', f.suggested_category))
                  from kasa_private.flags f where f.report_id = r.id) as flag_reasons
        from public.reports r
        where r.moderation_status in ('review', 'flagged')
           or (r.moderation_status = 'approved' and exists (
                 select 1 from kasa_private.flags f
                 where f.report_id = r.id
                   and f.created_at > coalesce((select max(e.created_at) from kasa_private.events e
                                                where e.report_id::text = r.id::text and e.kind = 'moderated'),
                                               '-infinity'::timestamptz)))
        order by r.created_at desc limit 100) x), '[]'::jsonb),
    'claims', coalesce((select jsonb_agg(to_jsonb(y) order by y.needs_attention desc, y.created_at desc) from (
        select c.id, c.report_id, c.created_at, c.photo_url, round(c.distance_m::numeric) as distance_m,
               c.verify_count, c.dispute_count, c.quorum_reached_at, r.photo_url as original_photo_url,
               r.category, r.ward_no, r.description, c.needs_review, c.photo_meta,
               c.needs_review or exists (select 1 from kasa_private.votes hv
                                         where hv.claim_id = c.id and hv.needs_review and hv.voided_at is null) as needs_attention,
               (select jsonb_agg(jsonb_build_object('id', v.id, 'vote', v.vote, 'photo_url', v.photo_url,
                        'distance_m', round(v.distance_m::numeric), 'at', v.created_at,
                        'needs_review', v.needs_review, 'photo_meta', v.photo_meta) order by v.created_at)
                  from kasa_private.votes v where v.claim_id = c.id and v.voided_at is null) as votes
        from kasa_private.claims c join public.reports r on r.id = c.report_id
        where c.status = 'pending' order by c.created_at desc limit 100) y), '[]'::jsonb));
end $$;

commit;

notify pgrst, 'reload schema';
