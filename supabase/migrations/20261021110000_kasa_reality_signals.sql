-- Claim vs reality, phase 2a: private candidate signals for repeated damage on a
-- confirmed work's defect liability period (DLP). Design: research/claim-reality-engine-design.md.
--
-- Nothing here is public. Signals are candidates until a moderator reviews them, and
-- publication goes through the evidence gate (legal_gate_open), which is not part of this file.
--
-- Also adds the 'work_not_visible' road sub-type (decision D5): citizens can say a repair
-- or work they were told about is not visible on the ground.
--
-- The run function needs PostGIS (geography distance, ST_ClusterDBSCAN). The table and RPCs
-- do not, so this file applies without it. Install PostGIS first, then re-run the
-- tender-works migration so assets.geom and reports.geom exist. Safe to re-run.

-- ── 1. Road sub-type 'work_not_visible' (road category) ─────────────────────
create or replace function kasa_private.subtype_category(p text) returns text
language sql immutable set search_path = '' as $$
  select case p
    when 'household' then 'garbage'
    when 'construction' then 'garbage'
    when 'mixed' then 'garbage'
    when 'e_waste' then 'garbage'
    when 'biomedical' then 'garbage'
    when 'dirty_spot' then 'garbage'
    when 'garbage_dump' then 'dumpsite'
    when 'bin_full' then 'garbage'
    when 'vehicle_missed' then 'garbage'
    when 'not_swept' then 'garbage'
    when 'burning' then 'garbage'
    when 'dead_animal' then 'garbage'
    when 'toilet_dirty' then 'toilet'
    when 'toilet_no_water' then 'toilet'
    when 'toilet_no_power' then 'toilet'
    when 'toilet_blocked' then 'toilet'
    when 'toilet_locked' then 'toilet'
    when 'open_defecation' then 'toilet'
    when 'yellow_spot' then 'toilet'
    when 'drain_blocked' then 'drain'
    when 'sewer_overflow' then 'drain'
    when 'stagnant_water' then 'drain'
    when 'septic_overflow' then 'drain'
    when 'sludge_dumped' then 'drain'
    when 'open_manhole' then 'missing'
    when 'manhole_entry' then 'illegal_other'
    when 'dry_tap' then 'water'
    when 'water_leak' then 'water'
    when 'pump_broken' then 'hand_pump'
    when 'no_doctor' then 'health_centre'
    when 'no_medicine' then 'health_centre'
    when 'centre_closed' then 'health_centre'
    when 'pothole' then 'road'
    when 'work_not_visible' then 'road'
    when 'light_out' then 'streetlight'
    when 'work_missing' then 'rural_jobs'
    when 'no_signboard' then 'rural_jobs'
    when 'no_drinking_water' then 'water'
    when 'water_body_filling' then 'illegal_other'
    when 'illegal_construction' then 'illegal_construction'
    when 'hostel_washroom' then 'toilet'
    when 'hostel_dustbin' then 'garbage'
    when 'hostel_corridor' then 'garbage'
    when 'puja_floral' then 'garbage'
    when 'puja_debris' then 'garbage'
  end
$$;

-- The waste_type check listed sub-types by hand and did not include hostel_*, puja_* or
-- work_not_visible. subtype_category is the single list now, so the constraint follows it.
alter table public.reports drop constraint if exists reports_waste_type_check;
alter table public.reports add constraint reports_waste_type_check
  check (waste_type is null or kasa_private.subtype_category(waste_type) is not null);

-- ── 2. Candidate signals (private) ──────────────────────────────────────────
create table if not exists kasa_private.reality_signals (
  id                  bigint generated always as identity primary key,
  signal_type         text not null check (signal_type in ('DLP_DAMAGE_CLUSTER')),
  work_id             bigint not null references kasa_private.works (id) on delete cascade,
  asset_id            bigint not null references kasa_private.assets (id) on delete cascade,
  anchor_report_id    uuid not null references public.reports (id) on delete cascade,
  cluster_lat         double precision not null,
  cluster_lng         double precision not null,
  report_count        integer not null check (report_count >= 1),
  distinct_reporters  integer not null check (distinct_reporters >= 0),
  first_reported_on   date not null,
  latest_reported_on  date not null,
  heuristic_score     numeric(3, 2) not null check (heuristic_score between 0 and 1),
  status              text not null default 'candidate'
                        check (status in ('candidate', 'approved', 'rejected', 'published', 'withdrawn')),
  computed_at         timestamptz not null default now(),
  reviewed_by         uuid,
  reviewed_at         timestamptz,
  review_note        text,
  constraint reality_signals_key unique (work_id, asset_id, signal_type, anchor_report_id),
  constraint reality_signals_reviewed check (status not in ('approved', 'rejected') or reviewed_at is not null)
);
create index if not exists reality_signals_status_idx on kasa_private.reality_signals (status, computed_at desc);
alter table kasa_private.reality_signals enable row level security;
revoke all on kasa_private.reality_signals from public, anon, authenticated;

-- ── 3. Run: candidates only, never touches status ───────────────────────────
-- Rules and assumptions (A1-A7) are in the design doc. Every threshold is an assumption to confirm.
create or replace function kasa_private.reality_signals_dlp_run() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_n integer;
begin
  if not exists (select 1 from pg_extension where extname = 'postgis') then
    raise exception 'PostGIS is required for the DLP run' using errcode = '0A000';
  end if;

  with dlp_works as (
    select w.id as work_id, w.completed_on,
           (w.completed_on + make_interval(months => w.dlp_months))::date as dlp_end
    from kasa_private.works w
    where w.status = 'completed'
      and w.completed_on is not null
      and w.dlp_months is not null and w.dlp_months > 0   -- blank = unknown, never a default
      and w.dlp_source_url is not null
  ),
  linked as (
    select d.work_id, d.completed_on, d.dlp_end, a.id as asset_id, a.geom,
           32600 + (floor((extensions.ST_X(extensions.ST_Centroid(a.geom)) + 180) / 6)::int + 1) as utm_srid
    from dlp_works d
    join kasa_private.work_assets wa on wa.work_id = d.work_id and wa.status = 'confirmed'
    join kasa_private.assets a on a.id = wa.asset_id
    where a.geom is not null
  ),
  matched as (
    select l.work_id, l.asset_id, l.utm_srid, r.id as report_id, r.reporter_hash,
           r.geom as report_geom, r.created_at,
           coalesce(pm.taken_at, r.created_at) as captured_at
    from linked l
    join public.reports r
      on extensions.ST_DWithin(l.geom::extensions.geography, r.geom::extensions.geography, 25.0)  -- A1, metres
    join kasa_private.photo_meta pm on pm.photo_path = r.photo_path
    where pm.capture = 'live'
      and pm.exif_distance_m is not null and pm.exif_distance_m <= 50                 -- A4
      and r.moderation_status = 'approved'
      and r.category = 'road'
      and r.waste_type = 'pothole'
      and coalesce(pm.taken_at, r.created_at)::date between l.completed_on and l.dlp_end
  ),
  clustered as (
    select m.*,
      extensions.ST_ClusterDBSCAN(extensions.ST_Transform(m.report_geom, m.utm_srid), eps => 15, minpoints => 1)
        over (partition by m.work_id, m.asset_id) as cluster_id                       -- A2, metres
    from matched m
  ),
  groups as (
    select work_id, asset_id, cluster_id,
           count(*) as report_count,
           count(distinct reporter_hash) filter (where reporter_hash is not null) as distinct_reporters,
           (array_agg(report_id order by created_at, report_id))[1] as anchor_report_id,
           extensions.ST_Centroid(extensions.ST_Collect(report_geom)) as cluster_centroid,
           min(captured_at)::date as first_reported_on,
           max(captured_at)::date as latest_reported_on
    from clustered
    group by work_id, asset_id, cluster_id
    having count(distinct reporter_hash) >= 3                                         -- A3, AND rule (D2)
  ),
  upserted as (
    insert into kasa_private.reality_signals (
      signal_type, work_id, asset_id, anchor_report_id, cluster_lat, cluster_lng, report_count,
      distinct_reporters, first_reported_on, latest_reported_on, heuristic_score)
    select 'DLP_DAMAGE_CLUSTER', g.work_id, g.asset_id, g.anchor_report_id,
           extensions.ST_Y(g.cluster_centroid), extensions.ST_X(g.cluster_centroid),
           g.report_count, g.distinct_reporters, g.first_reported_on, g.latest_reported_on,
           least(0.50 + 0.10 * g.distinct_reporters, 1.00)                            -- A6, heuristic
    from groups g
    on conflict (work_id, asset_id, signal_type, anchor_report_id) do update set
      report_count       = excluded.report_count,
      distinct_reporters = excluded.distinct_reporters,
      cluster_lat        = excluded.cluster_lat,
      cluster_lng        = excluded.cluster_lng,
      latest_reported_on = excluded.latest_reported_on,
      heuristic_score    = excluded.heuristic_score,
      computed_at       = now()
      -- status, reviewed_by, reviewed_at, review_note are never touched here
    returning 1
  )
  select count(*) into v_n from upserted;
  return v_n;
end $$;
revoke all on function kasa_private.reality_signals_dlp_run() from public, anon, authenticated;

-- ── 4. Moderator RPCs (is_admin checked server-side) ────────────────────────
create or replace function public.kasa_admin_reality_signals_run() returns integer
language plpgsql security definer set search_path = '' as $$
begin
  if not kasa_private.is_admin() then
    raise exception 'moderators only' using errcode = '42501';
  end if;
  return kasa_private.reality_signals_dlp_run();
end $$;

create or replace function public.kasa_admin_reality_signals(p_status text default 'candidate', p_limit integer default 50)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not kasa_private.is_admin() then
    raise exception 'moderators only' using errcode = '42501';
  end if;
  -- Contractor names and reporter hashes are deliberately not returned.
  return coalesce((
    select jsonb_agg(x order by x.computed_at desc)
    from (
      select s.id, s.signal_type, s.status, s.report_count, s.distinct_reporters,
             s.heuristic_score, s.first_reported_on, s.latest_reported_on, s.computed_at,
             s.cluster_lat, s.cluster_lng, s.review_note, s.reviewed_at,
             w.title as work_title, w.tender_ref, w.portal, w.completed_on, w.dlp_months, w.dlp_source_url,
             a.name as asset_name, a.ref as asset_ref
      from kasa_private.reality_signals s
      join kasa_private.works w on w.id = s.work_id
      join kasa_private.assets a on a.id = s.asset_id
      where s.status = p_status
      order by s.computed_at desc
      limit least(greatest(p_limit, 1), 200)
    ) x
  ), '[]'::jsonb);
end $$;

create or replace function public.kasa_admin_review_reality_signal(p_id bigint, p_decision text, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not kasa_private.is_admin() then
    raise exception 'moderators only' using errcode = '42501';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'decision must be approved or rejected' using errcode = '22023';
  end if;
  update kasa_private.reality_signals
     set status = p_decision, reviewed_by = auth.uid(), reviewed_at = now(),
         review_note = nullif(trim(coalesce(p_note, '')), '')
   where id = p_id and status = 'candidate';
  if not found then
    raise exception 'signal not found or already reviewed' using errcode = 'P0002';
  end if;
  return jsonb_build_object('id', p_id, 'status', p_decision);
end $$;

revoke execute on function public.kasa_admin_reality_signals_run() from public, anon;
revoke execute on function public.kasa_admin_reality_signals(text, integer) from public, anon;
revoke execute on function public.kasa_admin_review_reality_signal(bigint, text, text) from public, anon;
grant execute on function public.kasa_admin_reality_signals_run() to authenticated;
grant execute on function public.kasa_admin_reality_signals(text, integer) to authenticated;
grant execute on function public.kasa_admin_review_reality_signal(bigint, text, text) to authenticated;
