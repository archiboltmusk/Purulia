-- Add boundary_type column to reports table for Municipality/Gram Panchayat routing
-- Minimal migration: just add the column and its constraint

begin;

-- Add boundary_type column to reports table
alter table public.reports
  add column if not exists boundary_type text;

-- Create check constraint for valid boundary types
do $$ begin
  alter table public.reports add constraint kasa_reports_boundary_type_chk
    check (boundary_type is null or boundary_type in ('municipality', 'gram_panchayat'));
exception when duplicate_object then null; end $$;

commit;
