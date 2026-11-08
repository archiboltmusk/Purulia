# Parishkar Travel

`travel.html` adds a dependency-free, mobile-responsive transport page to the existing static site. It is linked from the home navigation and solutions search. Nothing is deployed from the feature branch; the existing main-branch deployment remains the release path.

## Current operational status

**No operator feed is connected.** Production `places/transit/network.json` deliberately contains no services or vehicle observations. The page shows this state and links to NTES and Metro Railway Kolkata. Supporting a mode in the format does not claim it operates anywhere, including tram services. No timetables, fares, crowds, accessibility, platforms or GPS locations have been invented.

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

The source window bounds the exported snapshot, including overnight calls. The importer expands `calendar.txt` weekdays plus `calendar_dates.txt` additions/removals. Times such as `24:30:00` belong to the following civil day. Up to seven service days and times below 48:00 are supported. Stop times must be exact and monotonic; blanks and estimated times are rejected. A source is unavailable before its validity window, after expiry, or if its retrieval timestamp is in the future. No result is proof that no service exists.

Unsupported features **reject the entire import**: nonempty frequency, transfer-rule, station-pathway and booking-rule tables; on-demand/continuous boarding; flexible stop windows; estimated stop times; extended/nonstandard route types; non-India agency timezones. This deliberately limits coverage until those semantics are correctly implemented. No inferred stop-time interpolation or station walking links.

## Journey and location behavior

- Direct journeys or one change at the **same stop ID**, departure from now onwards, within a 24-hour search horizon. Earliest arrival first, up to 12 options.
- Transfer buffer is a fixed planning rule: at least 10 and at most 120 minutes. It is not an operator guarantee. A missed connection is not replanned using live delays. Different platforms/stations are never merged by proximity or name.
- Wheelchair filter requires an explicit vehicle flag. Station accessibility, lifts, and step-free interchange are not verified.
- Every journey remains labelled **Scheduled** even when a recent vehicle observation exists. No ETA, fare, fare integration, ticketing, occupancy or cancellation prediction is implemented.
- Live position requires a matching dated trip ID, valid source, and observation age between 0 and 90 seconds inclusive. Future, stale, invalid or absent observations never produce a position link. Polling is once a minute and on tab visibility; no continuous animation or background location collection.
- Source data is fetched same-origin without browser cache. The service worker explicitly bypasses `places/transit/` so cached telemetry cannot masquerade as a network refresh. On load/validation failure search is disabled and previous results removed. Position freshness is re-evaluated every second on the open screen; expired position links are removed without waiting for a network refresh. Background browser timer throttling can pause updates until the tab becomes visible.
- No GPS permission, user account, travel-history storage, external search API, credential, booking request, or database migration. Queries remain in memory; opening an operator or map link navigates to that external service.

`positions` is an adapter boundary only. There is **no GTFS-Realtime parser, vehicle publisher, authenticated telemetry endpoint, operator agreement, or refresh infrastructure** in this change. A future adapter must validate trip/service-date identity, actual observation time, cancellation/service alerts and publisher provenance server-side. Do not put operator secrets in static JSON or browser JS.

## First 72 hours of a real pilot

Pick one operator and one corridor. Obtain the permitted timetable and telemetry access; integrate them before expanding geography. Compare scheduled boarding and dated trip identity against the operator and ride the corridor. Keep schedules and live observations separately visible. Add station pathways, cancellation handling and transfer guarantees before claiming reliable multimodal door-to-door navigation.

Acceptance gate: for 20 observed departures, record matching trip IDs, scheduled and actual timestamps, and whether each observation was correctly marked live/stale/unavailable. Require zero false live labels and zero fabricated services. Measure ETA accuracy only after a real ETA model and ground-truth dataset exist. This is a pilot gate, not a claim of completed field testing.

## Validation in this change

`node tests/transit.test.cjs` (also UTC / Asia/Kolkata / America/New_York); `python3 tests/test_build_transit.py`; JS syntax checks; `git diff --check`. Browser review covers the real empty-production state and refresh, not a connected operator or live vehicle. CI runs routing/importer checks when transport files change. Desktop/mobile end-to-end tests against a real feed remain a deployment gate for activating that feed.
