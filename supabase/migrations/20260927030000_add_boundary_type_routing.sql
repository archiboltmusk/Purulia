-- Add boundary_type column to reports table for Municipality/Gram Panchayat routing
-- This enables proper SLA and escalation routing based on administrative jurisdiction

begin;

-- Add boundary_type column to reports table
alter table public.reports
  add column if not exists boundary_type text;

-- Create check constraint for valid boundary types
do $$ begin
  alter table public.reports add constraint kasa_reports_boundary_type_chk
    check (boundary_type is null or boundary_type in ('municipality', 'gram_panchayat'));
exception when duplicate_object then null; end $$;

-- Create index for boundary-based queries (analytics, routing dashboards)
create index if not exists kasa_reports_boundary_type_idx on public.reports (boundary_type);

-- Update public view to include boundary_type for analytics and routing visibility
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
       date_trunc('hour', c.reviewed_at) as claim_reviewed_at,
       r.boundary_type
from public.reports r
left join kasa_private.claims c on c.id = r.claim_id
where r.moderation_status in ('approved', 'flagged');

revoke all on public.kasa_public_reports from public, anon, authenticated;
grant select on public.kasa_public_reports to anon, authenticated;

notify pgrst, 'reload schema';

-- TODO: Update kasa_create_report function in a follow-up migration
-- Function update will be done separately to avoid conflicts with existing versions

commit;
