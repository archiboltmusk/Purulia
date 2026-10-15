-- ════════════════════════════════════════════════════════════════════════
-- PARISHKAR — Public works linked to citizen-verified reports
--
-- Civic graph roadmap, schema appendix (8 Oct 2026). Who is responsible for a
-- broken road or drain, which tender built it, which firm, and is it still
-- inside its defect liability period (DLP)?
--
-- Separate from kasa_private.public_works (20261008100000), which records what
-- a site board says, photographed by a citizen. This side holds the tender and
-- agreement documents; tying a board to a tender is a later, moderated step.
--
--   jurisdictions  every body that answers for a spot (municipality, GP, PWD
--                  division, NHAI, cantonment...). Overlapping, not nested:
--                  a pin returns all of them, each with its source. No tier
--                  order, so a PWD division never "wins" over a ward.
--   assets         roads, drains, culverts... from OSM or official GIS only,
--                  always with a source link and licence.
--   contractors    firm name + GSTIN (public on the GST portal). No PAN: a
--                  proprietor's PAN is personal data and results rarely give it.
--   contractor_directors
--                  directors as they appear on the MCA company record, with
--                  its link. A fact only: no labels, scores or inferences, and
--                  nothing reads it yet (phase 4, behind the legal gate).
--   works          a tender / work order. DLP is blank unless the agreement
--                  states it (no default), with the document link.
--   work_revisions corrigenda, extensions, cancellations; a cancellation
--                  marks the work cancelled so its DLP badge drops at once.
--   work_assets    tender ↔ asset. Every link starts as a "probable match";
--                  only a moderator can confirm one (enforced by trigger, so
--                  the pipeline's service key cannot auto-link either).
--   reports.asset_id
--                  set only by a moderator; until then the report sheet shows
--                  the nearest mapped asset as a suggestion, within the
--                  report's own GPS accuracy (not a fixed 20 m).
--
-- is_under_dlp is computed when read (kasa_private.works_dlp), never stored.
-- Only verified reports count (kasa_private.report_is_verified: approved,
-- not a duplicate, live camera photo, real GPS fix within report_max_accuracy_m).
--
-- PostGIS: when the extension is installed, geom columns + GiST indexes are
-- added to areas, jurisdictions, assets and reports. Everything else works on
-- the existing jsonb polygons + bounding boxes, so this runs without it.
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

begin;

insert into kasa_private.settings (key, value, note) values
  ('asset_snap_min_m', '15', 'Nearest-asset suggestion: smallest search radius, even with a very good GPS fix'),
  ('asset_snap_max_m', '150', 'Nearest-asset suggestion: largest search radius, however poor the GPS fix')
on conflict (key) do nothing;

-- LGD codes on the places we already have.
alter table kasa_private.areas add column if not exists lgd_code text;
alter table kasa_private.places add column if not exists lgd_code text;

-- ── Geometry helpers (no PostGIS needed) ───────────────────────────────────

-- Bounding box of any GeoJSON geometry: {min_lat, max_lat, min_lng, max_lng}.
create or replace function kasa_private.geojson_bbox(p_geom jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('min_lat', min((v ->> 1)::double precision), 'max_lat', max((v ->> 1)::double precision),
                            'min_lng', min((v ->> 0)::double precision), 'max_lng', max((v ->> 0)::double precision))
  from jsonb_path_query(p_geom -> 'coordinates', 'lax $.**') v
  where jsonb_typeof(v) = 'array' and jsonb_typeof(v -> 0) = 'number'
$$;

-- Metres from a point to a GeoJSON geometry (0 inside a polygon). Local flat
-- projection around the point: fine at the few-hundred-metre scale it is used.
create or replace function kasa_private.distance_to_geojson_m(p_lat double precision, p_lng double precision, p_geom jsonb)
returns double precision language plpgsql immutable set search_path = '' as $$
declare
  t      text := p_geom ->> 'type';
  c      jsonb := p_geom -> 'coordinates';
  kx     double precision := 111320 * cos(radians(p_lat));
  ky     double precision := 110540;
  v_line jsonb;
  best   double precision;
  n integer; i integer;
  ax double precision; ay double precision; bx double precision; by_ double precision;
  dx double precision; dy double precision; u double precision; d double precision;
begin
  if t = 'Polygon' and kasa_private.in_polygons(p_lat, p_lng, jsonb_build_array(c)) then return 0; end if;
  if t = 'MultiPolygon' and kasa_private.in_polygons(p_lat, p_lng, c) then return 0; end if;
  for v_line in
    select case t when 'Point' then jsonb_build_array(c) else x end
    from jsonb_array_elements(case
      when t = 'Point' then jsonb_build_array(c)
      when t in ('MultiPoint') then (select jsonb_agg(jsonb_build_array(p)) from jsonb_array_elements(c) p)
      when t = 'LineString' then jsonb_build_array(c)
      when t in ('MultiLineString', 'Polygon') then c
      when t = 'MultiPolygon' then (select jsonb_agg(r) from jsonb_array_elements(c) poly, jsonb_array_elements(poly) r)
      else '[]'::jsonb end) x
  loop
    n := jsonb_array_length(v_line);
    for i in 0 .. greatest(n - 2, 0) loop
      ax := ((v_line -> i ->> 0)::double precision - p_lng) * kx;
      ay := ((v_line -> i ->> 1)::double precision - p_lat) * ky;
      if n = 1 then
        d := sqrt(ax * ax + ay * ay);
      else
        bx := ((v_line -> (i + 1) ->> 0)::double precision - p_lng) * kx;
        by_ := ((v_line -> (i + 1) ->> 1)::double precision - p_lat) * ky;
        dx := bx - ax; dy := by_ - ay;
        u := case when dx = 0 and dy = 0 then 0 else greatest(0, least(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy))) end;
        d := sqrt((ax + u * dx) ^ 2 + (ay + u * dy) ^ 2);
      end if;
      best := least(coalesce(best, d), d);
    end loop;
  end loop;
  return best;
end $$;

-- Fills the bounding box columns from a GeoJSON column (named in TG_ARGV[0]).
create or replace function kasa_private.set_geojson_bbox() returns trigger
language plpgsql set search_path = '' as $$
declare
  g jsonb := to_jsonb(new) -> tg_argv[0];
  b jsonb;
begin
  if g is null or jsonb_typeof(g) = 'null' then return new; end if;
  b := kasa_private.geojson_bbox(g);
  if b ->> 'min_lat' is null then
    raise exception 'geometry has no coordinates' using errcode = '22023';
  end if;
  new := jsonb_populate_record(new, b);
  return new;
end $$;

-- ── Jurisdictions ─────────────────────────────────────────────────────────

create table if not exists kasa_private.jurisdictions (
  id          bigint generated always as identity primary key,
  body        text not null,                -- e.g. 'Purulia Municipality', 'PWD Purulia Division', 'NHAI PIU Durgapur'
  body_type   text not null check (body_type in ('municipality', 'municipal_corporation', 'gram_panchayat',
                'panchayat_samiti', 'zilla_parishad', 'pwd_division', 'nhai', 'morth', 'irrigation_division',
                'phe_division', 'cantonment', 'railway', 'development_authority', 'other')),
  department  text,
  lgd_code    text,
  area_id     text references kasa_private.areas (id) on delete set null,  -- when the body's limits are an existing area
  outline     jsonb,                        -- else its own GeoJSON (Multi)Polygon, e.g. a PWD division
  min_lat     double precision,
  max_lat     double precision,
  min_lng     double precision,
  max_lng     double precision,
  source_url  text not null,
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint jurisdictions_has_limits check (area_id is not null or outline is not null),
  constraint jurisdictions_outline_polygon check (outline is null or outline ->> 'type' in ('Polygon', 'MultiPolygon'))
);
create index if not exists jurisdictions_area_idx on kasa_private.jurisdictions (area_id) where area_id is not null;
create index if not exists jurisdictions_bbox_idx on kasa_private.jurisdictions (min_lat, max_lat, min_lng, max_lng)
  where outline is not null;
create unique index if not exists jurisdictions_body_uq on kasa_private.jurisdictions (body, body_type);
drop trigger if exists jurisdictions_bbox on kasa_private.jurisdictions;
create trigger jurisdictions_bbox before insert or update of outline on kasa_private.jurisdictions
  for each row execute function kasa_private.set_geojson_bbox('outline');
alter table kasa_private.jurisdictions enable row level security;
revoke all on kasa_private.jurisdictions from public, anon, authenticated;

-- ── Assets ────────────────────────────────────────────────────────────────

create table if not exists kasa_private.assets (
  id                    bigint generated always as identity primary key,
  kind                  text not null check (kind in ('road', 'drain', 'culvert', 'bridge', 'streetlight', 'toilet',
                          'water_point', 'pond', 'building', 'other')),
  name                  text,
  ref                   text,               -- road number or official asset code
  geometry              jsonb not null check (geometry ->> 'type' in ('Point', 'MultiPoint', 'LineString',
                          'MultiLineString', 'Polygon', 'MultiPolygon')
                          and jsonb_typeof(geometry -> 'coordinates') = 'array'),
  geometry_approximate  boolean not null default false,  -- e.g. a stretch cut without a known chainage zero
  min_lat               double precision,
  max_lat               double precision,
  min_lng               double precision,
  max_lng               double precision,
  owner_jurisdiction_id bigint references kasa_private.jurisdictions (id) on delete set null,
  district              text,
  place                 text,
  source                text not null check (source in ('osm', 'official_gis')),
  source_ref            text,               -- OSM way id, GIS feature id
  source_url            text not null,
  licence               text not null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create unique index if not exists assets_source_uq on kasa_private.assets (source, source_ref) where source_ref is not null;
create index if not exists assets_bbox_idx on kasa_private.assets (min_lat, max_lat, min_lng, max_lng);
create index if not exists assets_owner_idx on kasa_private.assets (owner_jurisdiction_id) where owner_jurisdiction_id is not null;
drop trigger if exists assets_bbox on kasa_private.assets;
create trigger assets_bbox before insert or update of geometry on kasa_private.assets
  for each row execute function kasa_private.set_geojson_bbox('geometry');
alter table kasa_private.assets enable row level security;
revoke all on kasa_private.assets from public, anon, authenticated;

-- ── Contractors (firms only) ──────────────────────────────────────────────

create table if not exists kasa_private.contractors (
  id          bigint generated always as identity primary key,
  firm_name   text not null,
  gstin       text unique check (gstin ~ '^[0-9]{2}[A-Z0-9]{10}[0-9A-Z]Z[0-9A-Z]$'),
  source_url  text not null,              -- award result or GST portal page naming the firm
  created_at  timestamptz not null default now()
);
create index if not exists contractors_name_idx on kasa_private.contractors (lower(firm_name));
alter table kasa_private.contractors enable row level security;
revoke all on kasa_private.contractors from public, anon, authenticated;

create table if not exists kasa_private.contractor_directors (
  contractor_id  bigint not null references kasa_private.contractors (id) on delete cascade,
  din            text not null check (din ~ '^[0-9]{8}$'),
  director_name  text not null,
  mca_url        text not null,
  retrieved_on   date not null,
  primary key (contractor_id, din)
);
create index if not exists contractor_directors_din_idx on kasa_private.contractor_directors (din);
comment on table kasa_private.contractor_directors is
  'Directors exactly as on the MCA company record (mca_url). A shared DIN is a fact on that record only: never label it shell, cartel or collusion, and infer nothing else. Not exposed until the phase 4 legal gate.';
alter table kasa_private.contractor_directors enable row level security;
revoke all on kasa_private.contractor_directors from public, anon, authenticated;

-- ── Works (tenders / work orders) ─────────────────────────────────────────

create table if not exists kasa_private.works (
  id                       bigint generated always as identity primary key,
  portal                   text not null check (portal in ('wbtenders', 'cppp', 'gem', 'other_portal', 'rti', 'volunteer')),
  tender_ref               text,           -- NIT / tender id as printed
  work_order_ref           text,
  title                    text not null,
  department               text,
  issuing_jurisdiction_id  bigint references kasa_private.jurisdictions (id) on delete set null,
  contractor_id            bigint references kasa_private.contractors (id) on delete set null,
  sanctioned_amount        numeric(14, 2) check (sanctioned_amount >= 0),
  awarded_amount           numeric(14, 2) check (awarded_amount >= 0),
  nit_date                 date,
  awarded_on               date,
  stipulated_completion    date,
  completed_on             date,           -- from the completion certificate; the DLP runs from here
  completion_source_url    text,
  dlp_months               smallint check (dlp_months between 0 and 120),  -- no default: blank unless the agreement states it
  dlp_source_url           text,
  status                   text not null default 'tendered'
                             check (status in ('tendered', 'awarded', 'in_progress', 'completed', 'cancelled')),
  area_id                  text references kasa_private.areas (id) on delete set null,  -- ward/block when no asset is matched
  district                 text,
  place                    text,
  source_url               text not null,  -- NIT or award PDF/page
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint works_dlp_cited check (dlp_months is null or dlp_source_url is not null),
  constraint works_completion_cited check (completed_on is null or completion_source_url is not null)
);
create unique index if not exists works_tender_uq on kasa_private.works (portal, tender_ref) where tender_ref is not null;
create index if not exists works_contractor_idx on kasa_private.works (contractor_id) where contractor_id is not null;
create index if not exists works_jurisdiction_idx on kasa_private.works (issuing_jurisdiction_id) where issuing_jurisdiction_id is not null;
create index if not exists works_area_idx on kasa_private.works (area_id) where area_id is not null;
alter table kasa_private.works enable row level security;
revoke all on kasa_private.works from public, anon, authenticated;

create table if not exists kasa_private.work_revisions (
  id          bigint generated always as identity primary key,
  work_id     bigint not null references kasa_private.works (id) on delete cascade,
  kind        text not null check (kind in ('corrigendum', 'extension', 'revision', 'cancellation')),
  issued_on   date,
  summary     text,
  source_url  text not null,
  created_at  timestamptz not null default now()
);
create index if not exists work_revisions_work_idx on kasa_private.work_revisions (work_id);
alter table kasa_private.work_revisions enable row level security;
revoke all on kasa_private.work_revisions from public, anon, authenticated;

create or replace function kasa_private.work_revision_cancels() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.kind = 'cancellation' then
    update kasa_private.works set status = 'cancelled', updated_at = now() where id = new.work_id;
  end if;
  return new;
end $$;
drop trigger if exists work_revisions_cancel on kasa_private.work_revisions;
create trigger work_revisions_cancel after insert on kasa_private.work_revisions
  for each row execute function kasa_private.work_revision_cancels();

-- ── Tender ↔ asset links: probable until a moderator confirms ─────────────

create table if not exists kasa_private.work_assets (
  work_id              bigint not null references kasa_private.works (id) on delete cascade,
  asset_id             bigint not null references kasa_private.assets (id) on delete cascade,
  status               text not null default 'probable' check (status in ('probable', 'confirmed', 'rejected')),
  proposed_by          text not null check (proposed_by in ('pipeline', 'volunteer', 'moderator')),
  match_method         text check (match_method in ('name', 'distance', 'name_distance', 'document')),
  match_score          numeric(4, 3) check (match_score between 0 and 1),
  from_m               numeric(10, 1) check (from_m >= 0),   -- stretch along the asset, when the document gives one
  to_m                 numeric(10, 1) check (to_m >= from_m),
  segment_approximate  boolean not null default true,
  source_url           text,                -- the document that names this road / stretch
  proposed_at          timestamptz not null default now(),
  confirmed_by         uuid,
  reviewed_at          timestamptz,
  review_note          text,
  primary key (work_id, asset_id),
  constraint work_assets_confirmed_by check (status <> 'confirmed' or (confirmed_by is not null and reviewed_at is not null))
);
create index if not exists work_assets_asset_idx on kasa_private.work_assets (asset_id, status);
create index if not exists work_assets_probable_idx on kasa_private.work_assets (proposed_at) where status = 'probable';
alter table kasa_private.work_assets enable row level security;
revoke all on kasa_private.work_assets from public, anon, authenticated;

-- No auto-linking: a link is born probable, and only a signed-in moderator can
-- confirm it (the pipeline's service key has no auth.uid(), so it cannot).
create or replace function kasa_private.guard_work_asset_link() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' and new.status <> 'probable' then
    raise exception 'a tender-asset link starts as a probable match' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.status = 'confirmed' and old.status is distinct from 'confirmed' then
    if not kasa_private.is_admin() then
      raise exception 'only a moderator can confirm a tender-asset link' using errcode = '42501';
    end if;
    new.confirmed_by := auth.uid();
    new.reviewed_at := now();
  end if;
  return new;
end $$;
drop trigger if exists work_assets_guard on kasa_private.work_assets;
create trigger work_assets_guard before insert or update on kasa_private.work_assets
  for each row execute function kasa_private.guard_work_asset_link();

-- ── Reports: the asset a moderator matched ───────────────────────────────

alter table public.reports add column if not exists asset_id bigint;
do $$ begin
  alter table public.reports add constraint reports_asset_fk
    foreign key (asset_id) references kasa_private.assets (id) on delete set null;
exception when duplicate_object then null; end $$;
create index if not exists reports_asset_idx on public.reports (asset_id) where asset_id is not null;

create or replace function kasa_private.guard_report_asset() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.asset_id is not null and (tg_op = 'INSERT' or new.asset_id is distinct from old.asset_id)
     and not kasa_private.is_admin() then
    raise exception 'only a moderator can match a report to an asset' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists reports_asset_guard on public.reports;
create trigger reports_asset_guard before insert or update of asset_id on public.reports
  for each row execute function kasa_private.guard_report_asset();

-- Only verified reports count: approved, not a duplicate, live camera photo,
-- real GPS fix within report_max_accuracy_m.
create or replace function kasa_private.report_is_verified(r public.reports)
returns boolean language sql stable set search_path = '' as $$
  select r.moderation_status = 'approved'
     and not coalesce(r.is_duplicate, false)
     and r.photo_path is not null
     and r.accuracy_m > 0 and r.accuracy_m <= kasa_private.cfg_num('report_max_accuracy_m')
     and coalesce(r.moderation_labels -> 'photo' ->> 'capture', '') = 'live'
$$;

-- DLP worked out when read, so it never goes stale. NULL = not known.
create or replace view kasa_private.works_dlp with (security_invoker = true) as
  select w.id as work_id,
    case when w.status <> 'cancelled' and w.dlp_months is not null and w.completed_on is not null
         then (w.completed_on + make_interval(months => w.dlp_months))::date end as dlp_ends_on,
    case when w.status = 'cancelled' then false
         when w.dlp_months is null or w.completed_on is null then null
         else current_date <= (w.completed_on + make_interval(months => w.dlp_months))::date end as is_under_dlp
  from kasa_private.works w;
revoke all on kasa_private.works_dlp from public, anon, authenticated;

-- ── RPCs ──────────────────────────────────────────────────────────────────

-- Every body answering for a spot, each with its source. Overlaps are normal.
create or replace function public.kasa_jurisdictions_at(p_lat double precision, p_lng double precision) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', j.id, 'body', j.body, 'body_type', j.body_type,
      'department', j.department, 'lgd_code', j.lgd_code, 'source_url', j.source_url) order by j.body_type, j.body), '[]'::jsonb)
  from kasa_private.jurisdictions j
  left join kasa_private.areas a on a.id = j.area_id
  where case when j.outline is not null then
          p_lat between j.min_lat and j.max_lat and p_lng between j.min_lng and j.max_lng
          and kasa_private.distance_to_geojson_m(p_lat, p_lng, j.outline) = 0
        else
          p_lat between a.min_lat and a.max_lat and p_lng between a.min_lng and a.max_lng
          and kasa_private.in_polygons(p_lat, p_lng, a.polygons)
        end
$$;

-- Assets within r metres of a point, nearest first.
create or replace function kasa_private.assets_near(p_lat double precision, p_lng double precision, p_radius_m double precision)
returns table (asset_id bigint, distance_m double precision)
language sql stable set search_path = '' as $$
  select s.id, s.d from (
    select a.id, kasa_private.distance_to_geojson_m(p_lat, p_lng, a.geometry) as d
    from kasa_private.assets a
    where a.max_lat >= p_lat - p_radius_m / 110540 and a.min_lat <= p_lat + p_radius_m / 110540
      and a.max_lng >= p_lng - p_radius_m / (111320 * cos(radians(p_lat)))
      and a.min_lng <= p_lng + p_radius_m / (111320 * cos(radians(p_lat)))
  ) s where s.d <= p_radius_m order by s.d limit 5
$$;

create or replace function kasa_private.asset_json(p_id bigint) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', a.id, 'kind', a.kind, 'name', a.name, 'ref', a.ref,
    'geometry_approximate', a.geometry_approximate, 'source', a.source, 'source_url', a.source_url, 'licence', a.licence,
    'owner', case when j.id is not null then jsonb_build_object('body', j.body, 'body_type', j.body_type, 'source_url', j.source_url) end)
  from kasa_private.assets a left join kasa_private.jurisdictions j on j.id = a.owner_jurisdiction_id
  where a.id = p_id
$$;

-- The asset a report is about: the moderator's match, else the nearest mapped
-- asset within the report's own GPS accuracy, marked as a suggestion.
create or replace function public.kasa_report_asset(p_report_id text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  r public.reports;
  v_r double precision;
  v_near record;
begin
  select * into r from public.reports where id::text = p_report_id and moderation_status <> 'hidden';
  if r.id is null then return null; end if;
  if r.asset_id is not null then
    return jsonb_build_object('match', 'confirmed', 'asset', kasa_private.asset_json(r.asset_id));
  end if;
  v_r := least(greatest(coalesce(r.accuracy_m, 0), kasa_private.cfg_num('asset_snap_min_m')), kasa_private.cfg_num('asset_snap_max_m'));
  select * into v_near from kasa_private.assets_near(r.lat, r.lng, v_r) limit 1;
  if v_near.asset_id is null then return null; end if;
  return jsonb_build_object('match', 'nearest', 'distance_m', round(v_near.distance_m::numeric),
    'asset', kasa_private.asset_json(v_near.asset_id));
end $$;

-- Confirmed works on an asset, with DLP worked out today and the verified
-- reports filed on the asset (in total, and inside each work's DLP).
create or replace function public.kasa_asset_works(p_asset_id bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  with vr as (
    select r.created_at, r.status from public.reports r
    where r.asset_id = p_asset_id and kasa_private.report_is_verified(r)
  )
  select case when a.id is null then null else jsonb_build_object(
    'asset', kasa_private.asset_json(a.id),
    'verified_reports', (select count(*) from vr),
    'verified_open', (select count(*) from vr where vr.status in ('open', 'claimed')),
    'works', coalesce((select jsonb_agg(jsonb_build_object(
        'id', w.id, 'title', w.title, 'portal', w.portal, 'tender_ref', w.tender_ref, 'work_order_ref', w.work_order_ref,
        'department', w.department, 'issued_by', j.body, 'status', w.status,
        'sanctioned_amount', w.sanctioned_amount, 'awarded_amount', w.awarded_amount, 'awarded_on', w.awarded_on,
        'stipulated_completion', w.stipulated_completion, 'completed_on', w.completed_on,
        'completion_source_url', w.completion_source_url,
        'dlp_months', w.dlp_months, 'dlp_source_url', w.dlp_source_url,
        'dlp_ends_on', d.dlp_ends_on, 'is_under_dlp', d.is_under_dlp,
        'contractor', case when c.id is not null then jsonb_build_object('firm_name', c.firm_name, 'gstin', c.gstin, 'source_url', c.source_url) end,
        'stretch', case when wa.from_m is not null then jsonb_build_object('from_m', wa.from_m, 'to_m', wa.to_m, 'approximate', wa.segment_approximate) end,
        'link_source_url', wa.source_url, 'source_url', w.source_url,
        'verified_reports_in_dlp', (select count(*) from vr where d.dlp_ends_on is not null
                                     and vr.created_at::date between w.completed_on and d.dlp_ends_on))
      order by w.awarded_on desc nulls last, w.id desc)
      from kasa_private.work_assets wa
      join kasa_private.works w on w.id = wa.work_id
      join kasa_private.works_dlp d on d.work_id = w.id
      left join kasa_private.contractors c on c.id = w.contractor_id
      left join kasa_private.jurisdictions j on j.id = w.issuing_jurisdiction_id
      where wa.asset_id = a.id and wa.status = 'confirmed'), '[]'::jsonb)) end
  from (select p_asset_id as want) x left join kasa_private.assets a on a.id = x.want
$$;

create or replace function public.kasa_admin_work_link_queue() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'work_id', w.id, 'asset_id', wa.asset_id, 'title', w.title, 'portal', w.portal, 'tender_ref', w.tender_ref,
      'work_source_url', w.source_url, 'link_source_url', wa.source_url, 'proposed_by', wa.proposed_by,
      'match_method', wa.match_method, 'match_score', wa.match_score,
      'from_m', wa.from_m, 'to_m', wa.to_m, 'asset', kasa_private.asset_json(wa.asset_id), 'proposed_at', wa.proposed_at)
      order by wa.match_score desc nulls last, wa.proposed_at)
    from kasa_private.work_assets wa join kasa_private.works w on w.id = wa.work_id
    where wa.status = 'probable'), '[]'::jsonb);
end $$;

-- confirm / reject a probable link; reject also undoes a wrong confirmed one.
create or replace function public.kasa_admin_review_work_link(p_work_id bigint, p_asset_id bigint, p_action text,
    p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_note text := nullif(left(trim(coalesce(p_note, '')), 280), '');
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  if p_action = 'confirm' then
    update kasa_private.work_assets set status = 'confirmed', review_note = v_note
    where work_id = p_work_id and asset_id = p_asset_id and status = 'probable';
  elsif p_action = 'reject' then
    if v_note is null or length(v_note) < 3 then perform kasa_private.fail('KASA_REASON_NEEDED', 'Give a short reason.'); end if;
    update kasa_private.work_assets set status = 'rejected', review_note = v_note, reviewed_at = now()
    where work_id = p_work_id and asset_id = p_asset_id and status in ('probable', 'confirmed');
  else
    perform kasa_private.fail('KASA_BAD_ACTION', 'Confirm or reject.');
  end if;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'No such link waiting.'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- A moderator matches a report to an asset (null clears it).
create or replace function public.kasa_admin_set_report_asset(p_report_id text, p_asset_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not kasa_private.is_admin() then perform kasa_private.fail('KASA_NOT_ADMIN', 'Moderators only.'); end if;
  if p_asset_id is not null and not exists (select 1 from kasa_private.assets where id = p_asset_id) then
    perform kasa_private.fail('KASA_NOT_FOUND', 'No such asset.');
  end if;
  update public.reports set asset_id = p_asset_id where id::text = p_report_id;
  if not found then perform kasa_private.fail('KASA_NOT_FOUND', 'No such report.'); end if;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function kasa_private.geojson_bbox(jsonb),
  kasa_private.distance_to_geojson_m(double precision, double precision, jsonb),
  kasa_private.assets_near(double precision, double precision, double precision),
  kasa_private.asset_json(bigint), kasa_private.report_is_verified(public.reports) from public, anon, authenticated;
revoke all on function public.kasa_jurisdictions_at(double precision, double precision),
  public.kasa_report_asset(text), public.kasa_asset_works(bigint) from public;
grant execute on function public.kasa_jurisdictions_at(double precision, double precision),
  public.kasa_report_asset(text), public.kasa_asset_works(bigint) to anon, authenticated;
revoke all on function public.kasa_admin_work_link_queue(), public.kasa_admin_review_work_link(bigint, bigint, text, text),
  public.kasa_admin_set_report_asset(text, bigint) from public, anon;
grant execute on function public.kasa_admin_work_link_queue(), public.kasa_admin_review_work_link(bigint, bigint, text, text),
  public.kasa_admin_set_report_asset(text, bigint) to authenticated;

-- ── PostGIS geometry, only when the extension is already installed ───────
-- (enable it first with: create extension postgis with schema extensions;
--  then re-run this file). A failure here leaves the rest in place.
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

commit;

notify pgrst, 'reload schema';
