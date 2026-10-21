# Claim vs reality engine: design (phase 1 + phase 2 plan)

Status: **design only.** No migration applied to live Supabase. Nothing is public. The SQL below is a draft for review, not run against any database.

Scope source: Anupam's brief (2026-10-21) and the two follow-up messages on DLP SQL and MCP. The coordinator's review notes are folded in.

## 1. What already exists (reuse, do not duplicate)

| Need in brief | Existing piece | Where | Verdict |
|---|---|---|---|
| Citizen report with geo | `public.reports` (lat, lng, category, waste_type, reporter_hash, photo_path, status, moderation_status, resolved_at, created_at) | `20260924120000_kasa_v2_accountability.sql` | **Reuse.** Brief's `citizen_reports` is this table. |
| Report category | `reports.category` in (garbage, drain, road, streetlight, water, missing, encroachment, illegal_construction, illegal_mining, illegal_other, other); damage subtypes in `waste_type` (`pothole`, `missing_drain`) | `kasa_v2`, `20261001160000_kasa_problem_types.sql` | **Conflict.** Brief's `road_pothole`, `drainage_overflow`, `street_light_out`, `structural_crack` do not exist. Map to `road`/`drain` + `waste_type`. |
| Live camera + real GPS | `kasa_private.photo_meta` (capture live/file, taken_at, exif_distance_m, ai_marker) | `20260924180000_kasa_photo_evidence_checks.sql` | **Reuse.** This is the EXIF-vs-GPS check and the live-camera rule. |
| Photo hash | `kasa_private.photo_checks` (sha256, dhash), `kasa_private.photo_distance`, setting `near_duplicate_distance` = 6 | `kasa_v2`, `kasa_vote_integrity` | **Reuse.** The brief's pHash is already dHash. Do not add a second hash. |
| Reporter anonymity | `reports.reporter_hash` | `kasa_v2` | **Reuse.** Brief's `reporter_hash`. Distinct count is a weak Sybil check (see §5). |
| Flags, duplicates | `kasa_private.flags`, `duplicate_reviews`, `deleted_reports` | `kasa_v2`, `kasa_moderate_repeats` | **Reuse.** |
| Road authority per report | `kasa_private.road_tags` (OSM IN:NH/SH/MDR/ODR/VR) | `20261016100000_kasa_road_authority.sql` | **Reuse.** |
| Asset footprint | `kasa_private.assets` (kind, geometry jsonb, bbox, source osm/official_gis, source_url, licence); `assets.geom` added only when PostGIS installed | `20261008150000_kasa_tender_works.sql` | **Reuse.** Brief's `official_assets` would duplicate it. |
| Official work record (tender, cost, dates, DLP) | `kasa_private.works` (portal, tender_ref, sanctioned/awarded, completed_on, dlp_months, dlp_source_url, status, contractor_id, source_url) + `work_revisions` | `20261008150000` | **Reuse, do not create `official_assets`.** Brief's `project_code`=`tender_ref`, `work_status`=`status`, `completion_date`=`completed_on`, `agency_name`=`contractor_id`/`issuing_jurisdiction_id`. |
| DLP end | `works.dlp_months` (no default; blank unless the agreement states it), view `works_dlp`, `is_under_dlp` at read | `20261008150000` | **Conflict.** Brief's `DEFAULT 12` is rejected. A default DLP is an unsourced figure. |
| Tender ↔ asset link | `kasa_private.work_assets` (born `probable`; only a signed-in moderator confirms) | `20261008150000` | **Reuse. Conflict with brief's SQL**, which joins works to assets straight by geometry. Flags may only use `status='confirmed'` links. Probable links feed a candidate queue only. |
| Corroborated damage count | `kasa_asset_works`, `report_is_verified(report)` (public counts use verified reports only) | `20261008150000` | **Reuse.** |
| Public citizen works | `kasa_private.public_works` (pending/approved/removed) | `20261008100000_kasa_public_works.sql` | **Keep separate.** It is a citizen claim about a work, not an official record. |
| Evidence publication gate | `kasa_private.sources`, `documents` (sha256, archive_url), `assertions`, `harms`, `harm_reports`, `reviews`, `audit_log`, `ev_submissions`; trigger `ev_publish_check`; setting `legal_gate_open` (false) | `20261014200000_kasa_evidence.sql` | **Reuse for publication.** Flags do not get their own public table. An approved flag becomes an assertion/harm and goes through the same gate. |
| Ministry / portal fragments | `kasa_private.documents` + `source_runs` for PDFs; `kasa_admin_add_tender_candidate` for manual single-tender entry | evidence + tender migrations | **Reuse.** Brief's "Fragment harvester" tables are not needed yet. |
| Tender PDF extraction | none in repo | — | **New** (phase 2, §7). |
| Spatial clustering, geodetic buffers | PostGIS is **not installed** on live (available). `kasa_private.distance_to_geojson_m` (flat, local) exists | tender migration | **New dependency.** See decision D1. |
| Discrepancy flags | none | — | **New**: `kasa_private.reality_signals` (§4). |
| Reporter reliability weights | none | — | **New**, phase 2c. Computed, not stored, at first. |

Brief's proposed tables vs existing:
- `official_assets` → **not created**. Use `works` + `assets` + `work_assets`.
- `citizen_reports` → **not created**. Use `reports` + `photo_meta` + `photo_checks`.
- `flagged_irregularities` → **renamed** to `kasa_private.reality_signals`. "Irregularity" is a conclusion. The public label must be "Unverified signal" (naming-risk note; unverified-label rule).

## 2. Conflicts with the brief's SQL (corrected)

1. `ON CONFLICT (official_asset_id, anomaly_type)` has no matching unique index. It errors. Fixed by a unique key in §4.
2. The GIST index was on `geom` (geometry) but the join casts to `geography`, so the planner ignores it. Fixed with an expression index on `(geom::geography)`.
3. `eps := 0.00015` degrees is not 15 m: it is about 16.7 m north-south and about 15.3 m east-west at 23°N. The spec says 15 m. Fixed: cluster in metres in the asset's local UTM zone (`ST_Transform` to EPSG 326xx, zone from longitude). Covers India zones 43–47 without a single projection.
4. Consensus gate used `OR` (3 reporters **or** 5 reports). One person with 5 photos would pass. Spec says 3 distinct citizens. Fixed: `AND`. (Decision D2 to confirm.)
5. `ON CONFLICT ... DO UPDATE SET status = 'OPEN'` overwrites moderator decisions (approved/rejected) on every re-run. Fixed: the update never touches `status`.
6. The cluster id from a window function is not stable across runs, so keying by `(asset, type)` allowed only one signal per asset. Fixed: key = `(work_id, asset_id, signal_type, anchor_report_id)`, anchor = earliest report in the cluster.
7. The SQL uses `captured_at` and `category IN ('road_damage', 'pothole', ...)`. Neither exists. Capture time = `coalesce(photo_meta.taken_at, reports.created_at)`; categories mapped per §1.
8. The SQL uses `defect_liability_period_months DEFAULT 12`. Rejected (see §1). Rows with `dlp_months` null are skipped.
9. The SQL joins directly to assets, bypassing the moderator-confirm rule. Fixed: `work_assets.status = 'confirmed'` required.
10. Live photo rule: no `capture = 'live'` filter in the brief. Fixed: `photo_meta.capture = 'live'` and `exif_distance_m <= 50` (assumption A4). Reports without a photo_meta row are excluded.
11. `confidence_score = 0.50 + 0.10 × reporters` is an invented formula. Renamed `heuristic_score`, shown nowhere as a percentage, labelled heuristic in the review UI (assumption A6).
12. Contractor name is not in the signal row, and the public view (§4) has no contractor column. The brief's warning that the flag "flags the contractor directly for warranty liability" is removed from every output.

## 3. Draft SQL (phase 2, not applied, not in `migrations/`)

Requires PostGIS. Schema prefix `extensions.` assumes PostGIS is installed in `extensions` (as the tender migration checks dynamically). Verify before applying.

```sql
-- Phase 2 draft. Not applied. Requires PostGIS.
create table if not exists kasa_private.reality_signals (
  id                  bigint generated always as identity primary key,
  signal_type         text not null check (signal_type in ('DLP_DAMAGE_CLUSTER')),
  work_id             bigint not null references kasa_private.works (id) on delete cascade,
  asset_id            bigint not null references kasa_private.assets (id) on delete cascade,
  anchor_report_id    uuid not null references public.reports (id) on delete cascade,
  cluster_centroid    extensions.geometry(Point, 4326) not null,
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
  review_note         text,
  constraint reality_signals_key unique (work_id, asset_id, signal_type, anchor_report_id)
);
alter table kasa_private.reality_signals enable row level security;
revoke all on kasa_private.reality_signals from public, anon, authenticated;

create index if not exists reality_signals_centroid_gist
  on kasa_private.reality_signals using gist (cluster_centroid);

-- Spatial indices the join actually uses.
create index if not exists assets_geog_gist on kasa_private.assets using gist ((geom::geography));
create index if not exists reports_geog_gist on public.reports using gist ((geom::geography));
create index if not exists reports_time_cat on public.reports (created_at, category);

create or replace function kasa_private.reality_signals_dlp_run() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_n integer;
begin
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
           -- local UTM zone of the asset, so clustering runs in metres
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
      on extensions.ST_DWithin(l.geom::extensions.geography, r.geom::extensions.geography, 25.0)  -- metres
    join kasa_private.photo_meta pm on pm.photo_path = r.photo_path
    where pm.capture = 'live'
      and pm.exif_distance_m is not null and pm.exif_distance_m <= 50         -- A4
      and r.moderation_status = 'approved'
      and r.category in ('road', 'drain')
      and r.waste_type in ('pothole', 'missing_drain')                         -- damage subtypes
      and coalesce(pm.taken_at, r.created_at)::date between l.completed_on and l.dlp_end
  ),
  clustered as (
    select m.*,
      extensions.ST_ClusterDBSCAN(extensions.ST_Transform(m.report_geom, m.utm_srid), eps => 15, minpoints => 1)
        over (partition by m.work_id, m.asset_id) as cluster_id
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
    having count(distinct reporter_hash) >= 3                                  -- D2: AND, not OR
  ),
  upserted as (
    insert into kasa_private.reality_signals as s (
      signal_type, work_id, asset_id, anchor_report_id, cluster_centroid, report_count,
      distinct_reporters, first_reported_on, latest_reported_on, heuristic_score)
    select 'DLP_DAMAGE_CLUSTER', g.work_id, g.asset_id, g.anchor_report_id, g.cluster_centroid,
           g.report_count, g.distinct_reporters, g.first_reported_on, g.latest_reported_on,
           least(0.50 + 0.10 * g.distinct_reporters, 1.00)                     -- A6, heuristic
    from groups g
    on conflict (work_id, asset_id, signal_type, anchor_report_id) do update set
      report_count      = excluded.report_count,
      distinct_reporters = excluded.distinct_reporters,
      cluster_centroid  = excluded.cluster_centroid,
      latest_reported_on = excluded.latest_reported_on,
      heuristic_score   = excluded.heuristic_score,
      computed_at       = now()
      -- status, reviewed_by, reviewed_at, review_note are never touched here
    returning 1
  )
  select count(*) into v_n from upserted;
  return v_n;
end $$;

revoke all on function kasa_private.reality_signals_dlp_run() from public, anon, authenticated;
```

Notes on the draft:
- Anchor = earliest report in the cluster. If an older report joins later, the anchor changes and a new `candidate` row appears. A moderator rejection on the old anchor does not carry over. Accepted for phase 2a; re-review needed (see §5).
- Runs only from a server-side job (service role or moderator RPC). Not exposed to any anon/authenticated path.
- Drafted, not executed. No PostGIS in this environment, so the geo parts are untested.

## 4. Public and private surfaces

- Private: `kasa_private.reality_signals` and `reality_signal_reports`; moderator queue in admin only.
- Public view (only after the legal gate, §6): `kasa_public_reality_signals()` returns signal label, work title, tender ref, source URL, dates, report count band, status, and a help-verify link. It never returns: contractor name, GSTIN, directors, reporter hashes, individual report ids, the heuristic score as a number.
- Public label: "Unverified signal: repeated damage reports on [asset] after the stated defect period. No official record of this yet. Help verify." Never "ghost", "fake", "failure of contractor".
- Publication route: approve → assertion + harm (`harm_reports` links reports) → `ev_publish_check` (≥1 approval; 2 distinct for sensitive; contractor or official-touching = sensitive) → `legal_gate_open`.

## 5. Flag rules (thresholds are assumptions, to confirm)

Internal codes stay private. Public labels are neutral (§4).

| Code (brief) | Internal code | Rule | Assumptions |
|---|---|---|---|
| PREMATURE_FAILURE | `DLP_DAMAGE_CLUSTER` | Confirmed work link; `works.status='completed'`; `dlp_months` and `dlp_source_url` set (cited); report captured within [completed_on, DLP end]; live photo; damage subtype; within 25 m; cluster 15 m; ≥3 distinct reporter hashes | A1 25 m buffer, A2 15 m cluster, A3 ≥3 reporters, A4 EXIF ≤50 m, A6 heuristic score |
| GHOST_WORK | `COMPLETION_CONTRADICTED` | Completed within 90 days; reports say no work / earthwork / impassable | **Blocked**: no citizen subtype for "work not visible". Needs D5. A5 90 days, 50 m |
| PAPER_CLOSURE | `CLOSURE_CONTRADICTED` | Report closed (`resolved_at`) then new report at same asset within 7 days | **Blocked**: "resolved" in our data is citizen-verified, not an official portal. Needs D6. A7 7 days, 25 m |
| (new) | `REUSED_PHOTO` | Same sha256, or dHash ≤ `near_duplicate_distance`, on reports >100 m apart | Moderation review only; never public |
| (brief) | reporter weight | Corroboration by independent reporters in the same polygon raises weight; single outliers stay in triage | A8 thresholds TBD; computed at read, not stored in 2a |

Assumptions (all to confirm; none is a fact):
- A1 25 m: membership buffer. A2 15 m: cluster eps. A3 3 reporters: spec. A4 50 m EXIF tolerance. A5 90 days, 50 m. A6 heuristic score formula. A7 7 days, 25 m. A8 reporter weights.
- Reporter hash distinct count is weak: one person with several devices passes. Mitigation is the device-level limits already in place. Not a proof of independence.

## 6. Data and legal rules

- Only authentic, cited sources. A `works` row needs `source_url`; DLP needs `dlp_source_url`. No sample tenders. No fabricated figures.
- Scrapers respect each portal's terms and robots rules. No CAPTCHA bypass. No proxies. (Earlier tender pipeline rule; IT Act s.43 and portal terms.)
- Contractors: firm name + GSTIN only. **No personal PAN** stored or published. Directors (MCA) are never exposed and never labelled "shell", "cartel" or "collusion".
- Naming risk (naming-risk note 2026-10-16): no contractor or official is named as a wrongdoer on any public page until counsel reviews. Phase 2 public view excludes contractor and official names entirely.
- Anti-fraud: report counts need live camera photo and real GPS. No gallery upload, no manual pin. The DLP rule reads only reports that pass these.
- Legal gate: `legal_gate_open` stays false until counsel signs off the publication model.

## 7. Phase 2: MCP-based tooling (designed, not built)

Phase 2 section, per coordinator note. MCP servers run server-side as workers. Browsers never hold service keys. Write tools never sit on a public path.

| Tool | Read / write | Purpose | Guardrails |
|---|---|---|---|
| `find_nearby_assets(lat, lng, radius_m)` | read | Assets within radius (PostGIS, geodesic metres) | Moderator-only output. Uses `assets.geom`. |
| `get_active_dlp_corridors(area_id)` | read | Confirmed works whose DLP is open in an area | Reads `works_dlp` view. Returns no contractor names to any public caller. |
| `calculate_discrepancy_score(asset_id)` | read | On-demand recompute of candidate signals for one asset | Computes only; writes nothing. Returns candidates. |
| `fetch_tender_by_id(portal, tender_id)` | read (external) | Fetch one tender page by ID | Manual lookup only (portal listing is captcha-gated). Respect robots and terms. Result is a candidate, stored only via `kasa_admin_add_tender_candidate`. |
| `search_works_by_keyword_and_ward(...)` | **disabled** | Portal search | Captcha-gated. Not built. |
| `extract_boq_and_estimates(pdf_url)` | read (parse) | Parse tender/BOQ PDF into candidate fields (sanctioned amount, dates, firm name, GSTIN, scope) | Output is a candidate. Strips personal PAN before any storage. Stores the PDF via `kasa_private.documents` (sha256) only with moderator approval. |
| `resolve_vernacular_location(text)` | read (external geocode) | Turn "from XYZ club to railway crossing" into a candidate line | Output is a candidate, needs moderator confirmation. No PIN-centroid placement. OSM/Overpass as basemap source, respecting usage policy. |
| `draft_rti_application(signal_id)` | write (draft only) | Compose RTI letter (s.6(1)) from the signal and its cited work | Reuses `rti-letter` template. Draft is saved to a moderator queue. Nothing is sent. |
| `generate_audit_dossier(signal_id)` | write (file) | Evidence PDF: photos, cited work record, tender clauses | Moderator-only. Every page carries the "Unverified signal" label. Publication only through the §4 gate. |

Sources and tools:
- MapLibre: already in use. No change.
- Docling / Marker / PyMuPDF / PaddleOCR: candidates. Check each licence and model-weight terms before adoption. Not decided.
- Playwright / Scrapy: only for portals whose terms allow it. Captcha-gated portals are out.
- Bhuvan / Bharat Maps: **not listed as a usable source**. Access needs registration. Check first, then add.
- Cloudflare R2: **not added.** Deferred until photos pass about 700 MB (R2 memory).
- pgmq / Redis+Celery: open decision D7. Supabase-only (pg_cron + edge functions) is the default.
- FastAPI vs Supabase edge functions: open decision D7. Existing stack is Supabase and Deno; a Python worker is new infrastructure.

## 8. Phase plan

- **2a (after D1–D3 answered):** install PostGIS if approved; apply `reality_signals` + `reality_signals_dlp_run` to a dev/branch database first; test against seeded fixtures in `supabase/tests/` (no fake tenders; synthetic report fixtures only, labelled as test data); moderator queue in `admin.html`; no public output.
- **2b:** manual tender ingest via `kasa_admin_add_tender_candidate` for a small set of sourced WB works; confirm `work_assets` links by moderator; first real DLP runs.
- **2c:** MCP read tools (§7) behind moderator auth; reporter weights computed at read; GHOST/PAPER signals once D5/D6 decided.
- **2d (gated):** public view only after counsel review and `legal_gate_open`. Dossier generator with the unverified label.
- Phase 3 (not planned here): OCR of ULB minutes, RTI drafting at scale.

## 9. Open decisions for Anupam

- **D1.** Install PostGIS on live Supabase (schema `extensions`)? Recommend yes, after a dev test. Live install needs your go-ahead.
- **D2.** Consensus: ≥3 distinct reporter hashes **AND** (as drafted), or OR with 5 reports? Recommend AND.
- **D3.** DLP: keep "blank unless the agreement states it" (recommended), or allow a default? Recommend blank.
- **D4.** Internal codes stay private (DLP_DAMAGE_CLUSTER etc.) with neutral public labels? Recommend yes.
- **D5.** GHOST_WORK needs a new citizen subtype ("work not visible / earthwork"). That changes the public report picker. Approve?
- **D6.** PAPER_CLOSURE: which closure counts? Our citizen-verified "resolved", or CPGRAMS/state portal status via dockets? Portal status is not in our data yet.
- **D7.** Python MCP workers (new infra) vs Supabase-only (Deno + pg_cron)? Recommend Supabase-only for 2a–2b, revisit for OCR.
- **D8.** Counsel review date before any contractor or official is named on a public page. Owner: Anupam.

## Non-goals

- No public mirror of records: no Git-hosted GeoJSON of reports or contractor IDs, no torrent or magnet snapshots of the database or map, no IPFS or Arweave pinning of citizen photos. Reasons: publishes contractor IDs and DLP findings before counsel sign-off (D8), makes citizen photos permanent and impossible to remove on request (privacy and DPDP risk), and is built to survive lawful takedown orders. The encrypted weekly backup stays the only copy outside the live database.
- No daily Git export of flagged records or contractor names (scripts/export_audit_records.py and a scheduled commit workflow, as proposed 2026-10-21), and no mirroring to other Git hosts for takedown resistance. It would publish flags and names before counsel sign-off (D8) and reads the old official_assets schema. If a gated export is wanted later, it is a separate design after counsel review, reading only moderator-approved records shown with the unverified label.
- No "distinct carrier network signature" or similar device/network checks for reporter independence (2026-10-21 legal-risk proposal). That is the passive network collection already declined. Independence comes from reporter hashes, per-device and per-network limits, and photo checks.
- No single-source clearing: a satellite reading, a reporter count or any one signal never clears a record for publication on its own.
- No passive Wi-Fi BSSID, cell-tower or other RF environment collection, and no device fingerprinting, unless a DPDP privacy review approves it first. It collects location data on citizens who have not consented.
- No community add-on or plugin feeds (manifest-based third-party data sources, shared repository links, on-device flagging of their contractor or violation data, 2026-10-21 proposal). Third-party feeds would put unverified allegations under our name. On-device flagging and the takedown-resistance design both conflict with D8 and with the counsel process. Not built, not designed further.
- No cell-tower or OpenCelliD location check, and no collection of cell IDs (MCC, MNC, LAC, Cell ID) from citizens' phones (Multi-INT plan, 2026-10-21). This is the same passive network collection declined above.
- No accelerometer or gyroscope buffer captured before the shutter. That is sensor monitoring of citizens with no consent basis.
- No fused percentage score (`P_truth` or Bayesian weights). Confidence is shown as counts and dates (§12). No "indestructible in court" or "no rebuttal can dismiss" wording anywhere, internal or public.
- No `CARTEL_BIDDING_SUSPECT` flag from shared PAN roots, addresses or phone numbers. It turns linked identifiers into an allegation. It stays out of the staging and public data. Parked until counsel review. If it is ever designed, it uses MCA public company records only, never personal phone numbers or PAN, and it is never shown as a finding.
- No CCTV, RTSP or HLS feeds of any kind, including "open or weakly secured" municipal or traffic cameras (3D/4D twin plan, 2026-10-21). Reaching feeds not offered to us risks IT Act s.43 and s.66 exposure, and those feeds are surveillance of people, not asset data. No object tracking (YOLO, ByteTrack or similar) on any feed.
- No dashcam, auto-rickshaw, bus or vehicle trajectory data. It tracks drivers.
- No step that captures or stores people's movement, even briefly or "erased in RAM" later.
- No published measurement from a 3D reconstruction (for example "18 mm against a billed 50 mm"). A splat or depth model needs calibration against a surveyed reference first. Until then, no measurement leaves the phone or the moderator queue, and none is shown as proof.

## 10. Verification done in this PR

- Read: existing migrations for reports, photo_meta, photo_checks, assets, works, work_assets, jurisdictions, evidence tables, public_works, road_tags, categories, legal gate.
- Not run: the §3 SQL. No PostGIS available here. Nothing applied to any database.
- CI: `kasa-tests.yml` is unaffected (no `migrations/` or JS change). This file is under `research/`, not published (`*.md` not deployed).

## 11. Zero-cost infrastructure review (2026-10-21)

Source: Anupam's zero-cost plan, relayed 2026-10-21. Vendor prices and free-tier limits in that plan are **unverified**. None are relied on here. Check each vendor's current pricing page before any decision that depends on a limit.

Added (as requirements or design notes, nothing built):
- Scheduled ingestion in GitHub Actions: cron only, portal terms and robots respected, no CAPTCHA bypass, no proxies. Matches §6.
- Image compression after the EXIF check: run `kasa_private.photo_meta` (live capture, EXIF vs GPS) on the original first, then compress. Keep the original's sha256 and dHash in `kasa_private.photo_checks`, so reuse checks still match. The existing `kasa-photo-shrink` function already shrinks after checks; no new compression path.
- Backups: `db-backup.yml` already runs weekly. Any nightly export to a private repo must exclude personal data and reporter identities. Hashed IDs only. Parked until a specific need.
- Open data: public GeoJSON of published records only, after the §4 gate. Phase 2d.
- Local-first MCP runner: phase 2c option. Read-only tools run on a moderator's own machine against the database under moderator auth. No new cloud service.

Parked (not in scope now):
- Telegram ward channels and bot alerts. Declined earlier by Anupam; not built. Naming contractors there would also need the counsel gate (D8).
- X or WhatsApp auto-posts. Declined earlier.
- PMTiles on R2 for map tiles. Revisit when live map traffic is a real cost.
- Cloudflare R2 for photos. Deferred until the R2 memory threshold (about 700 MB of photos).
- Third-party LLM extraction (for example Gemini free tier) on any document with personal data. Needs a decision from Anupam first.
- Client-side compression before upload, until the EXIF-first flow above is specified and tested.

## 12. Fraud countermeasures (phase 2c / 3 requirements, 2026-10-21)

Requirements only. Nothing here is built.

- Camera-only capture: existing rule. Gallery upload stays off.
- Duplicate photos: sha256 and dHash already in `photo_checks`. Reuse detection flags a repeat for moderation. Public output never shows a perceptual-hash match as proof.
- Velocity check (phase 2c): an account that files 5 or more reports 5 km apart within 10 minutes has that batch isolated for moderation.
- Disjoint witness consensus (phase 2c): a signal needs independent reporters. Weights come from corroboration across unrelated accounts. Raw report count alone never flags. Replaces the flat "≥ 3 distinct hashes" rule once weights are approved (assumption A8).
- Liveness micro-video (phase 3, high-stakes reports only, for example a claim that a road was never built): short capture with the live camera, reviewed by a moderator. No automatic verdict.
- Satellite NDBI (Sentinel-2, phase 3): supporting evidence only. Show it as one signal with its image date and cloud cover. Never describe it as proof, and never write "statistically impossible" on any page.
- Community boundary confirmation (phase 3): design only. Residents confirm start and end points of a vaguely described stretch. No build until designed and reviewed.
- Confidence display: show independent signals with dates and counts (for example "4 reports, 4 reporters, 3 Mar to 11 Mar"). No single percentage. Every signal keeps the "Unverified signal" label and the contractor response window (rule in §4).
- Signed community feeds (Ed25519 manifests, source-hash links): parked with the add-on non-goal.

## 13. Phase 2d: counsel-gated, read-only publication (design only, approved in principle 2026-10-21)

Anupam approved a counsel-gated pipeline. Nothing below is built. No public output exists today.

**Staged table.** `kasa_private.reality_signals` is the staged record. No `audit_records` or `official_assets` table (both replaced, §1).

**One status set** (replaces today's `candidate/approved/rejected/published/withdrawn` check in a later migration):

| Status | Meaning | Who moves it |
|---|---|---|
| `STAGED` | Raised by the run function (today `candidate`) | run function only |
| `INTERNAL_REVIEW` | Moderator checks photos, links, counts, noise | moderator |
| `NOTICE_ISSUED` | Inquiry, grievance or RTI sent to the responsible office; reply window open | moderator, with docket ref |
| `UNDER_COUNSEL_REVIEW` | Evidence brief with counsel | moderator |
| `APPROVED_PUBLIC` | Counsel signed off the public wording and cleared photos | counsel role only |
| `REJECTED_EVIDENCE` | Not enough proof; kept internal | moderator or counsel |
| `RECTIFIED_OFFICIALLY` | Office repaired or explained during review; never published as a failure | moderator |

Transitions are enforced by a trigger, the same way `work_assets` confirmation is guarded. `APPROVED_PUBLIC` needs a counsel role (new, separate from moderator) and every counsel field below. Every change goes to the append-only audit log.

**Counsel fields, stored separately from the investigative row** (new private table `kasa_private.reality_signal_publication`, one row per signal):
- `public_title`, `public_summary`: counsel-written, factual, no commentary. The only text the public sees.
- `counsel_signoff_by`, `signed_off_at`, `counsel_notes` (private).
- `notice_sent_on`, `notice_docket_id` (links `report_dockets`), `notice_window_days`, `agency_response_summary`.
- `cleared_photo_paths[]` and `photos_checked_faces_plates` (boolean, required true before `APPROVED_PUBLIC`). Counsel checks every photo for faces and vehicle plates before it is cleared.
- `contractor_named` (boolean, default false). The contractor's firm name appears publicly only if counsel sets this and the public wording includes it.

**Public read.** A `security definer` RPC or view (`kasa_public_reality_signals`) returns only `APPROVED_PUBLIC` rows and only these fields: public title and summary, work title, tender ref, source URL, dates, report count, cleared photos, notice date, agency response, and the firm name only when `contractor_named`. No direct table access and no RLS on private tables for anon. Any static GeoJSON is generated from this RPC only (not built; see Non-goals for what is excluded).

**Notice period.** The reply window before counsel review (proposed 14 days) is a **project policy**, not a legal requirement. Label it that way on any page. Where the notice is an RTI request, the RTI Act's own clock applies (reply due 30 days, s.7(1)), and the two are tracked separately.

**Defamation.** Design note only: criminal defamation is now under the Bharatiya Nyaya Sanhita, 2023 (s.356, replacing IPC ss.499/500). Counsel confirms the applicable provisions and exceptions before the gate opens.

**Relation to the existing gate.** `legal_gate_open` stays false until counsel signs off the whole model. Until then no row can reach `APPROVED_PUBLIC`.

**Open items for counsel**
1. Confirm BNS s.356 and the exceptions (truth for public good, fair comment on public conduct) that apply to the public wording.
2. Approve the notice policy: window length, who it goes to (Executive Engineer, PIO, ULB), and what counts as a reply.
3. Rule on naming: firm name only (no individuals), and on which facts it can be tied to (tender record, DLP clause, report counts).
4. Photo clearance standard: faces, plates, house numbers, children; blur or exclude.
5. Wording template for `public_summary` and the "Unverified signal" label after counsel approval: does the label stay, or change to "Reviewed record"?
6. Correction and takedown process for a published record, and the response time to commit to.
7. Retention of `REJECTED_EVIDENCE` and `RECTIFIED_OFFICIALLY` rows, and of citizen photos, under DPDP.

### §13 additions (legal-risk redesign, 2026-10-21)

Adopted:
- **No personal names.** Public records identify the asset, tender ref and sanction code only. No officials, engineers or contractors' staff by name. Firm names stay behind `contractor_named` and counsel (above).
- **Variance framing.** Public text states the documented spec against what was observed, with sources and dates (for example "Tender ref X specifies 40 mm premix carpet; reports from 3 Mar to 11 Mar show surface damage at this stretch"). No words of intent such as bribe, theft or corruption.
- **`DISPUTED_PAUSED` state.** Added between `NOTICE_ISSUED`/`UNDER_COUNSEL_REVIEW` and publication, and also reachable from `APPROVED_PUBLIC`. The office or firm uploads a rebuttal (document plus note). The record is hidden from the public view while a moderator and counsel check it. Rebuttals are kept with the record.
- **No open comments.** Public input is structured only: report, confirm, rebuttal upload, correction form. No free-text public thread on a record.
- **Grievance officer contact** published on every record page, and the takedown and correction route linked (existing RUNBOOK entry; response time is counsel item 6).
- **Response window: 21 business days, project policy.** Shown as policy, never as a statutory deadline. The IT Rules timelines for intermediaries are separate; counsel confirms them, they are not cited here from memory.
- **Face and plate blurring before upload.** Required step in the capture flow, done on the phone. The EXIF and live-capture check and the sha256/dHash run on the original first, as in §11. Open point for review: the server only sees the blurred file, so it cannot recompute the original's hash. Decide whether the client-sent original hash is accepted as is or replaced by a server-side check on the blurred file.
- **Satellite check** (Sentinel-2): supporting signal only, never a gate that clears a record (see Non-goals).
- **Sourced tender rows.** `kasa_private.works` stays the ledger (no new `public_assets` table). Every row keeps `source_url`. Add `source_kind` (`official` | `press`); a row sourced only from a press report shows as Unverified and cannot feed an `APPROVED_PUBLIC` record until an official source is linked.

Not adopted: carrier/network signatures (Non-goals), and the proposal's new `public_assets` table and enum names (the §13 status set above is used, with `DISPUTED_PAUSED` added).

### §13 workers (five-agent plan, 2026-10-21)

Anupam's five-worker plan, adopted with these limits. Every worker drafts or flags; every outward or publishing step is a human click. Workers never email an official, file an RTI, or set `APPROVED_PUBLIC`.

| Worker | Runs on | Does automatically | Never does automatically |
|---|---|---|---|
| 1. Redaction (on the phone) | kasa.js / mobile, before upload | Blurs every detected face and vehicle plate after the EXIF, live-capture and hash checks on the original (§11) | Age estimation or rejecting an upload because a child may be in it. Blurring covers children; anything further is counsel item 4 |
| 2. DLP run | `pg_cron`, nightly | `reality_signals_dlp_run()` raises `STAGED` rows (rules §5, consensus D2) | Any status beyond `STAGED` |
| 3. Notice drafter | `pg_cron`, daily | Writes a draft inquiry (neutral variance wording, tender ref, coordinates, DLP clause) to a moderator queue, with the office address from the cited `works`/`jurisdictions` row | Sending email, filing an RTI, or moving a row to `NOTICE_ISSUED`. A moderator reviews, sends, and records the docket ref; that click sets `notice_sent_on`. No 48-hour auto-advance |
| 4. Counsel brief | Admin page or local script, on demand | Assembles the brief: tender spec vs reports, notice docket and date, cleared photos, counsel's checklist | Sign-off. `APPROVED_PUBLIC` is a separate deliberate action by the counsel role, filling every counsel field above. No one-click link from the brief |
| 5. Dispute watchdog | Edge function (claims work in the DB first, per CLAUDE.md) | On a rebuttal or correction request citing a record: sets `DISPUTED_PAUSED` (hidden from the public RPC at once), sends a receipt to the filer, alerts moderators and counsel | Unpausing. Only moderator plus counsel return a record to review or publication |

**Scheduling.** Database work (workers 2 and 3) runs on `pg_cron` inside Supabase. GitHub Actions are used only for scrapers that fetch public tender pages (rules §6: robots and terms respected, no CAPTCHA bypass). No paid queue or VPS.

**Retention janitor: not built.** No automatic deletion of rejected reports or clearing of `reporter_hash` until counsel answers item 7. The proposed SQL targeted tables that don't exist (`citizen_reports`, `public_audit_records`). When counsel answers, the janitor is a `pg_cron` job over `kasa_private.reality_signals` and `kasa_private.reality_signal_publication`, plus whatever counsel rules for `public.reports` photos. The existing `wipe_old_ip_hashes(180)` is unchanged.

**Grievance receipt timing.** The receipt is immediate. The IT Rules acknowledgement and disposal timelines are for counsel to confirm (item 6); they are not cited here from memory.

### §13 supporting signals (Multi-INT plan, 2026-10-21)

Adopted, as internal supporting signals only. Each is logged with its inputs and date. None rejects an upload or clears a record on its own (Non-goals: no single-source clearing).
- **Solar-shadow check.** Compute the expected sun azimuth and elevation for the report's GPS point and claimed time with SunCalc (open source, MIT). Store it in `photo_checks` as an internal flag for a moderator to compare against the visible shadow. Shadow direction read from a photo is noisy: overcast skies, no clear caster, lens distortion. The check never rejects an upload or quarantines it automatically. The tolerance (proposed 15°) is an assumption to test on real reports first.
- **Sentinel-2 comparison.** As above: supporting evidence only. 10 m pixels and cloud cover limit what a single road stretch shows.

**Sentinel-2 worker (CDSE Statistical API, proposed 2026-10-21; not built).** Anupam's `sentinel_road_verifier.py` design, adopted with these limits:
- **Prerequisite: calibration.** The 25% and 6% cutoffs and the 0.04 to 0.09 and 0.20 to 0.40 reflectance ranges in the proposal are unsourced. Before any cutoff is used, run the worker on roads with known surfacing dates (official completion records plus dated photos) and record the observed change per surface type. Until that is done the output is a number, not a verdict: no `VERIFIED_SURFACING`, `GHOST_WORK_SUSPECT` or `INCONCLUSIVE` labels.
- **No auto-escalation.** The output goes to the moderator queue as a supporting signal, never as a status move (no automatic `TECHNICAL_AUDIT`). Stored with the work id, corridor geometry source, both windows, each clear pass date, its cloud cover and the clear-pixel count.
- **Same-season windows.** Compare before and after windows in the same season (for example post-monsoon against post-monsoon). Monsoon moisture and dry-season dust change reflectance on their own. The proposal's Nov 2025 against Feb 2026 example is not used.
- **Minimum clear passes.** Report clear passes per window. Below a minimum (to set during calibration), store "too few clear passes" and no figure.
- **Corridor size.** A 10 m pixel is wider than many village roads, so a narrow corridor mixes in roadside land. Record the corridor's pixel count; calibration sets the minimum.
- **Kept:** the evalscript on `sentinel-2-l2a` with the SCL mask (drops cloud shadow 3, cloud 8 to 10, snow 11) and `dataMask`. The band order in the response (`B0` = B04, `B1` = B08) is checked against a real API reply before use.
- **Credentials and runner:** GitHub Actions only (per the scheduling rule above). `CDSE_CLIENT_ID` and `CDSE_CLIENT_SECRET` live in GitHub secrets, never in the repo, logs or the database. No sample Purulia polygon in any shipped file; corridors come only from `kasa_private.assets` rows with an OSM or official source.
- **Terms:** CDSE quotas and terms of use are checked on dataspace.copernicus.eu before the first scheduled run. They are not quoted here from memory.

Rejected: cell-tower checks, motion-sensor buffers, the fused score and the cartel flag (Non-goals).

### Later research (not planned, 2026-10-21)

From the 3D/4D twin plan. None of this is scheduled or built.
- **Sentinel-1 InSAR** for subsidence on assets already flagged, using free Copernicus data. Calibration step first, as for Sentinel-2. Supporting signal only.
- **Dated passes over the same asset.** Comparing dated satellite passes or dated citizen photos of one asset over time, with the dates shown.
- **Citizen 3D video passes: parked** until the on-device blurring spec (§13) is done. Allowed only if every person and plate is erased on the phone before upload, the scan covers only the flagged asset, and no trajectory or movement data is kept. Measurements from it fall under the calibration rule in Non-goals.
