-- Public lifecycle stage for a report, next to the existing status (open / claimed / resolved).
-- Additive only: nullable, no backfill, nothing reads it yet. Existing rows stay null until a
-- later change sets stages. Stages: submitted, under_review, acknowledged, in_progress,
-- resolved, rejected.

alter table public.reports add column if not exists status_stage text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'reports_status_stage_check') then
    alter table public.reports add constraint reports_status_stage_check
      check (status_stage is null or status_stage in
        ('submitted', 'under_review', 'acknowledged', 'in_progress', 'resolved', 'rejected'));
  end if;
end $$;
