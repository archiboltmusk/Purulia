-- Enable PostGIS (claim vs reality decision D1) and add the geom columns.
-- Already applied to live on 2026-10-21 as migration 20261021095926 kasa_postgis_enable; this file
-- records it in the repo. The geom block is the same as the PostGIS block in
-- 20261008150000_kasa_tender_works.sql. Idempotent; safe to re-run.
-- Live used a plain `create extension`; here it is guarded so databases without the
-- PostGIS package (CI) skip it instead of failing. Everything below then no-ops.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'postgis') then
    create schema if not exists extensions;
    create extension if not exists postgis with schema extensions;
  end if;
end $$;

do $$
declare
  s text := (select n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'postgis');
begin
  if s is null then return; end if;
  begin
    execute format($f$alter table kasa_private.areas add column if not exists geom %1$I.geometry(MultiPolygon, 4326)
      generated always as (%1$I.st_setsrid(%1$I.st_geomfromgeojson('{"type":"MultiPolygon","coordinates":' || polygons::text || '}'), 4326)) stored$f$, s);
    execute format($f$alter table kasa_private.jurisdictions add column if not exists geom %1$I.geometry(Geometry, 4326)
      generated always as (%1$I.st_setsrid(%1$I.st_geomfromgeojson(outline::text), 4326)) stored$f$, s);
    execute format($f$alter table kasa_private.assets add column if not exists geom %1$I.geometry(Geometry, 4326)
      generated always as (%1$I.st_setsrid(%1$I.st_geomfromgeojson(geometry::text), 4326)) stored$f$, s);
    execute format($f$alter table public.reports add column if not exists geom %1$I.geometry(Point, 4326)
      generated always as (%1$I.st_setsrid(%1$I.st_makepoint(lng, lat), 4326)) stored$f$, s);
    create index if not exists areas_geom_gix on kasa_private.areas using gist (geom);
    create index if not exists jurisdictions_geom_gix on kasa_private.jurisdictions using gist (geom);
    create index if not exists assets_geom_gix on kasa_private.assets using gist (geom);
    create index if not exists reports_geom_gix on public.reports using gist (geom);
  exception when others then
    raise warning 'PostGIS geometry columns skipped: %', sqlerrm;
  end;
end $$;

notify pgrst, 'reload schema';
