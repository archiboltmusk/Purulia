-- ════════════════════════════════════════════════════════════════════════
-- PARISHKAR PURULIA — "your reports" history
--
-- reports.user_id has been set from the reporter's own anonymous session
-- since the v2 accountability migration, with an index on it already —
-- no new identity concept needed. This just exposes it back to that same
-- session: every field kasa_public_reports offers, for this caller's own
-- reports only, but WITHOUT that view's `moderation_status in ('approved',
-- 'flagged')` filter — an owner must still see their own report's true
-- state (under review, hidden) rather than have it vanish from their own
-- list, and without the hour-truncation the public view applies, since
-- there's no reason to blur a citizen's view of their own data.
--
-- Same shape as kasa_public_reports (see 20260925140000_kasa_resolution_
-- captions.sql) so the client can normalize() these rows exactly like any
-- other report and reuse the whole detail-sheet renderer unchanged.
--
-- authenticated only, never anon: a report only "belongs" to whoever is
-- signed in, and an anonymous session with zero reports correctly gets [].
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

create or replace function public.kasa_my_reports() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me kasa_private.profiles := kasa_private.me();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'created_at', r.created_at, 'lat', r.lat, 'lng', r.lng, 'ward_no', r.ward_no,
      'category', r.category, 'severity', r.severity, 'status', r.status, 'description', r.description,
      'landmark', r.landmark, 'photo_url', r.photo_url, 'upvotes', coalesce(r.upvotes, 0),
      'seen_on_site', r.seen_on_site, 'flags', coalesce(r.flags, 0), 'moderation_status', r.moderation_status,
      'is_duplicate', coalesce(r.is_duplicate, false), 'parent_report_id', r.parent_report_id,
      'recurrence_count', r.recurrence_count, 'rejected_claims', r.rejected_claims,
      'resolved_at', r.resolved_at, 'resolved_photo_url', r.resolved_photo_url, 'resolution_method', r.resolution_method,
      'sla_days', coalesce(r.sla_days, 7), 'gps_verified', (r.accuracy_m is not null),
      'claim_id', c.id, 'claim_photo_url', c.photo_url, 'claim_created_at', c.created_at,
      'claim_verify_count', c.verify_count, 'claim_dispute_count', c.dispute_count,
      'claim_quorum_reached_at', c.quorum_reached_at,
      'claim_finalize_after', c.final_after + interval '59 minutes 59 seconds',
      'claim_distance_m', round(c.distance_m::numeric),
      'rating_count', r.rating_count, 'onsite_rating_count', r.onsite_rating_count,
      'authenticity_avg', r.authenticity_avg, 'severity_avg', r.severity_avg,
      'neighbour_status', r.neighbour_status, 'reply_count', r.reply_count,
      'claim_needs_review', c.needs_review, 'area_kind', r.area_kind, 'block_name', r.block_name,
      'verify_needed', (select (s.value #>> '{}')::integer from kasa_private.settings s
                        where s.key = case when r.area_kind = 'rural' then 'rural_verify_quorum' else 'verify_quorum' end),
      'claim_reviewed_at', c.reviewed_at
    ) order by r.created_at desc)
    from public.reports r
    left join kasa_private.claims c on c.id = r.claim_id
    where r.user_id = me.user_id
  ), '[]'::jsonb);
end $$;

revoke all on function public.kasa_my_reports() from public, anon;
grant execute on function public.kasa_my_reports() to authenticated;

commit;

notify pgrst, 'reload schema';
