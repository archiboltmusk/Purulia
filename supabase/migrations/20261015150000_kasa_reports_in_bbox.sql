-- Viewport read for the report map: public reports inside a bounding box, newest first.
-- Reads the same public view as kasa_public_reports (security invoker, no new data exposed).
-- Returns jsonb rows, not the view's row type: a function returning the view's
-- type blocks later migrations that drop and recreate the view.
-- Idempotent: create or replace; grants re-applied.

create or replace function public.kasa_reports_in_bbox(
  min_lng double precision,
  min_lat double precision,
  max_lng double precision,
  max_lat double precision,
  p_limit integer default 500
)
returns setof jsonb
language sql
stable
set search_path = public
as $$
  select to_jsonb(v)
  from public.kasa_public_reports v
  where v.lng between min_lng and max_lng
    and v.lat between min_lat and max_lat
  order by v.created_at desc
  limit least(greatest(coalesce(p_limit, 500), 1), 1000);
$$;

revoke all on function public.kasa_reports_in_bbox(double precision, double precision, double precision, double precision, integer) from public;
grant execute on function public.kasa_reports_in_bbox(double precision, double precision, double precision, double precision, integer) to anon, authenticated;
