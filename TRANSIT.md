# Parishkar Travel

`travel.html` adds a dependency-free, mobile-responsive transport page to the existing static site. It is linked from the home navigation and solutions search. Nothing is deployed from the feature branch; the existing main-branch deployment remains the release path.

## Current operational status

**GitHub Pages snapshot collection is implemented but not activated or tested against the authenticated live service.** No key is available in this checkout. Device GPS works locally; shared reports require the optional Supabase migration. See activation below. Production `places/transit/network.json` deliberately contains no services or vehicle observations. The page shows this state and links to NTES and Metro Railway Kolkata. Supporting a mode in the format does not claim it operates anywhere, including tram services. No timetables, fares, crowds, accessibility, platforms or GPS locations have been invented.

Official service references checked 8 November 2026:

- CRIS NTES project: https://cris.org.in/loadpage?page=proNTES — official train running enquiry service at https://enquiry.indianrail.gov.in/ntes/ . This is an outbound link, not a licensed API integration.
- Metro Railway Kolkata: https://mtp.indianrailways.gov.in/ — operator notices and information. Outbound link only.
- GTFS Schedule reference: https://gtfs.org/documentation/schedule/reference/ . The importer implements a strict subset, not the full standard.

## Connect the first timetable

1. Obtain an operator-published GTFS ZIP and written or published permission for reuse. Verify the publisher independently; HTTPS and metadata alone do not establish authority. Record the actual retrieval time and reuse-terms URL. Do not scrape commercial apps or bypass a private API.
2. Export a short service-date horizon. Run the offline importer (Python standard library only):

```bash
python3 tools/build-transit.py /absolute/path/operator.zip \
  --source-id operator-name \
  --source-url https://operator.example/official-feed \
  --license-url https://operator.example/reuse-terms \
  --retrieved-at 2026-11-08T08:00:00+00:00 \
  --start 2026-11-08 --days 2 \
  --output places/transit/network.json
```

The example URLs are command documentation, not real providers. Change dates and source values to the actual feed. The tool does not fetch or authenticate remote services. A supplied retrieval time is never replaced with import time.

3. Validate the resulting file with the browser contract before committing it:

```bash
node -e "require('./transit-core.js').validate(require('./places/transit/network.json'))"
node tests/transit.test.cjs
python3 tests/test_build_transit.py
```

4. Review calendar exceptions, source validity, source identity, permission and boarding times against the operator. Merge through the existing repository process. Refresh the short horizon before it expires; there is no scheduler or operator integration in this release. Never extend validity just to make stale data appear current.

The importer writes atomically and records a SHA-256 digest of the original ZIP. It replaces the network with **one operator feed**. A multi-agency GTFS is supported; combining separate files requires a reviewed aggregation step, which is not implemented. IDs are namespaced by operator; trips include the service date, so observations cannot attach accidentally to yesterday's trip.

## Schedule contract (schema version 1)

| Collection | Required fields |
| --- | --- |
| Root | `schema_version: 1`, `timezone: Asia/Kolkata`, `sources`, `stops`, `trips`, `positions` |
| Source | `id`, `name`, HTTPS `url`, HTTPS `license_url`, `retrieved_at`, `valid_from`, exclusive `valid_until` (all timestamps with offsets) |
| Stop | `id`, `source_id`, `name`, finite WGS84 `lat`, `lon` |
| Trip instance | `id`, `source_id`, `name`, `operator`, `mode`, `wheelchair` (`yes/no/unknown`), ordered `calls` |
| Call | `stop_id`, absolute `arrival`, absolute `departure`, boolean `pickup`, boolean `dropoff` |
| Position | `trip_id`, `source_id`, actual `observed_at`, finite WGS84 `lat`, `lon` |

Modes: bus, train, tram, metro, ferry, cable. All timestamps are absolute instants; the display always uses IST, regardless of device timezone. Stop names and source strings are inserted with `textContent`, never HTML.

A source may set `timing_quality: published|estimated` (legacy missing values mean published). The importer forces Delhi OTD to `estimated`, even if its `timepoint` flags claim exactness. Estimated sources can supply stop/route context but are excluded from the exact-time journey planner, including transfers. This is required by the publisher warning: https://otd.delhi.gov.in/documentation/ .

The source window bounds the exported snapshot, including overnight calls. The importer expands `calendar.txt` weekdays plus `calendar_dates.txt` additions/removals. Times such as `24:30:00` belong to the following civil day. Up to seven service days and times below 48:00 are supported. Stop times must be monotonic and populated; estimated times require `--timing-quality estimated` and cannot be used for exact journey recommendations. A source is unavailable before its validity window, after expiry, or if its retrieval timestamp is in the future. No result is proof that no service exists.

Unsupported features **reject the entire import**: nonempty frequency, transfer-rule, station-pathway and booking-rule tables; on-demand/continuous boarding; flexible stop windows; estimated stop times without an estimated-source label; extended/nonstandard route types; non-India agency timezones. This deliberately limits coverage until those semantics are correctly implemented. No inferred stop-time interpolation or station walking links.

## Journey and location behavior

- Direct journeys or one change at the **same stop ID**, departure from now onwards, within a 24-hour search horizon. Earliest arrival first, up to 12 options.
- Transfer buffer is a fixed planning rule: at least 10 and at most 120 minutes. It is not an operator guarantee. A missed connection is not replanned using live delays. Different platforms/stations are never merged by proximity or name.
- Wheelchair filter requires an explicit vehicle flag. Station accessibility, lifts, and step-free interchange are not verified.
- Every journey remains labelled **Scheduled** for published timetable sources even when a recent vehicle observation exists. No ETA, fare, fare integration, ticketing, occupancy or cancellation prediction is implemented.
- Live position requires a matching dated trip ID, valid source, and observation age between 0 and 90 seconds inclusive. Future, stale, invalid or absent observations never produce a position link. Polling is once a minute and on tab visibility; no continuous animation or background location collection.
- Source data is fetched same-origin without browser cache. The service worker explicitly bypasses `places/transit/` so cached telemetry cannot masquerade as a network refresh. On load/validation failure search is disabled and previous results removed. Position freshness is re-evaluated every second on the open screen; expired position links are removed without waiting for a network refresh. Background browser timer throttling can pause updates until the tab becomes visible.
- No GPS permission, user account, travel-history storage, external search API, credential, booking request, or database migration. Queries remain in memory; opening an operator or map link navigates to that external service.

The original network `positions` array remains a separate timetable-matched contract. The Delhi adapter below supplies a standalone vehicle board without requiring static schedule publication. It does not attach observations to itinerary legs or claim verified route names. There is no ETA, static-feed scheduler, TripUpdates/Alerts integration or comprehensive cancellation handling. Vehicle records explicitly marked with a non-scheduled relationship are omitted; absence of such a record is not proof of normal service.

## First 72 hours of a real pilot

Pick one operator and one corridor. Obtain the permitted timetable and telemetry access; integrate them before expanding geography. Compare scheduled boarding and dated trip identity against the operator and ride the corridor. Keep schedules and live observations separately visible. Add station pathways, cancellation handling and transfer guarantees before claiming reliable multimodal door-to-door navigation.

Acceptance gate: for 20 observed departures, record matching trip IDs, scheduled and actual timestamps, and whether each observation was correctly marked live/stale/unavailable. Require zero false live labels and zero fabricated services. Measure ETA accuracy only after a real ETA model and ground-truth dataset exist. This is a pilot gate, not a claim of completed field testing.

## Validation in this change

`node tests/transit.test.cjs` (also UTC / Asia/Kolkata / America/New_York); `python3 tests/test_build_transit.py`; JS syntax checks; `git diff --check`. Browser review covers the real empty-production state and refresh, not a connected operator or live vehicle. CI runs routing/importer checks when transport files change. Desktop/mobile end-to-end tests against a real feed remain a deployment gate for activating that feed.


## Activate Delhi OTD with GitHub Secrets and GitHub Pages

Vercel is not required. The Vercel API function has been removed. The static browser reads project-relative `places/transit/delhi.json`; the only code using the key runs in GitHub Actions.

1. In **archiboltmusk/Purulia → Settings → Secrets and variables → Actions → New repository secret**, set **`DELHI_OTD_API_KEY`** to the authorised Delhi OTD key. Never put the key in a normal repository variable, config.js, HTML, a JSON file, a commit or chat.
2. Merge the reviewed PR into `main`. The existing **Deploy to GitHub Pages** workflow collects a snapshot during publication. To test without waiting for cron, open **Actions → Deploy to GitHub Pages → Run workflow → main**. Existing Pages main-only deployment protection remains intact.
3. Open `travel.html` on the Pages site. It fetches `places/transit/delhi.json` beneath the repository path, not a root `/api` URL. The browser never calls the authenticated upstream API.
4. Confirm the published JSON says `status: ok`, contains source timestamps, and contains no key. A successful response with zero positions means no records met validation, not that all services stopped.

The schedule requests one refresh every five minutes, offset from the start of the hour. GitHub can delay or drop scheduled work, disable inactive repository schedules, or queue deployments. This is a **snapshot service**, not continuous live tracking. Each run rebuilds/uploads the static Pages artifact; monitor Actions/artifact usage and adjust the interval if needed. No infinite runner loops, browser API key, external scheduler, data branch or telemetry commits. No refresh SLA or claim of nationwide live coverage.

The decoder requires a full-dataset header and individual vehicle observations no older than 90 seconds when collected. Missing observation time is never replaced by collection time. The browser subsequently shows these as historical **last-observed** positions for at most 15 minutes after their actual observation timestamp; a vehicle may already have moved. It hides older, future or invalid positions and never relabels historical snapshots as live. `generated_at` is artifact preparation time, not deployment completion or vehicle observation time. UI reloads every 30 seconds and rechecks expiry every second while visible. Reloading the page does not force a new operator fetch. Pages/CDN caching may delay newer snapshots; age checks remain authoritative.

The workflow writes a fresh JSON file inside `deploy/` only. Raw Protobuf, keys, upstream URLs with query keys, provider errors and past vehicle positions are not committed. Failed collection publishes empty positions and a controlled status, never an old location disguised as fresh. Missing key yields `not_configured`; `access_denied`, `rate_limited`, `stale_feed`, `invalid_feed` and `upstream_unavailable` identify safe failure categories. If publication itself fails, the prior deployed snapshot expires in the browser. No raw upstream response is logged. Static deployment exclusions omit collector code, dependencies and local credential files.

Collector: `tools/transit/delhi-otd.mjs`, using MobilityData bindings 2.2.0. Fixed HTTPS provider host, no redirects, 8 MiB input limit and 10-second fetch/body timeout. Source route/vehicle IDs are shown as identifiers, not inferred names. Candidate dated trip identity requires explicit valid `startDate`; no static-feed match is claimed. Non-scheduled vehicle relationships are rejected; comprehensive cancellations/TripUpdates/Alerts and arrival predictions are not implemented. Provider use must match the purpose authorised under https://otd.delhi.gov.in/terms .

## Device GPS and passenger reports

**Start my location** requests foreground browser GPS only after a click. Stop, page hiding and page exit clear the watch and in-memory samples. No GPS history is saved. Accurate fixes (50 m or better) from the last two minutes are used for a **moving-time estimate**, requiring at least three fixes over 30 seconds and sufficient movement to reject jitter. Stale samples, jumps, time reversal, stationary or unstable movement cannot produce an estimate.

The passenger enters the **remaining route distance** from their own route/map and must update it as the trip progresses. Estimate = that distance / recent median GPS segment speed. It is not an ETA for a bus the passenger is waiting for; it excludes delays, stops and transfers. No straight-line distance is substituted for road distance. Route geometry, automated destination search, traffic prediction, automatic remaining-distance calculation and offline rail positioning are not implemented.

**Share one location report** is a separate, explicit consent action. No location is automatically uploaded by GPS tracking. A current fix and route ID are sent once to the existing Supabase project. The private table stores only a 0.01-degree rounded cell (roughly kilometre scale), observation/receipt times, route and a hashed random session token. Public groups require at least three recent reporting sessions in a cell, are labelled unverified, and reveal neither session tokens nor individual positions. Sessions are not verified people or independent corroboration and must not be used to claim a bus location or prediction. The route ID is passenger-supplied, not operator-validated.

Reports expire from public results after ten minutes. Each session has only one current report; sending another overwrites it. A token is held in sessionStorage (no coordinates), enabling **Withdraw my report** in the same tab. Old database rows are physically purged on subsequent submissions; there is no guaranteed background deletion schedule. Supabase request infrastructure may retain ordinary service logs. Consent wording refers to public availability, not guaranteed erasure of all infrastructure logs.

Backend activation requires applying `supabase/migrations/20261108160000_kasa_transit_passengers.sql` to the existing Supabase project and verifying its RPCs. It is idempotent; no public table access. Submissions require a recent, accurate fix, 30-second per-token cooldown, a request network identity and serialised network quotas. The page probes `kasa_transit_status` and disables sharing until that backend exists. GitHub Pages hosts the UI; Supabase stores passenger submissions. No service-role key is needed in the browser or GitHub.

Run the database scenarios with the repository's normal `supabase/tests/run.sh`; it applies migrations twice and checks privacy thresholds, rounding, withdrawal, stale rejection and direct-table permissions. **The migration has not been applied to production by this change.** No backend credentials are available in this session.

## Verification and first pilot

`npm ci --ignore-scripts && npm run test:transit` tests encoded Protobuf, timestamps, key redaction, snapshot publication/expiry, repository-relative URLs, routing, timetable conversion and GPS movement. CI additionally runs the database scenarios. No real key has been read in this environment and no real passenger location has been collected. New UI browser QA and authenticated provider verification remain pending.

Acceptance gate after secret setup/publication: obtain a source-dated snapshot without leaking the key; check its age changes and old positions disappear. On a real journey, consent to local GPS, obtain three accurate fixes over at least 30 seconds, enter the actual remaining route distance, and confirm the estimate is labelled moving time. Verify sharing sends nothing until its separate button/consent and withdrawal removes the token's report. Do not advertise live nationwide arrival prediction before operator and field validation.
