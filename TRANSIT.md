# Parishkar Travel

`travel.html` adds a dependency-free, mobile-responsive transport page to the existing static site. It is linked from the home navigation and solutions search. Nothing is deployed from the feature branch; the existing main-branch deployment remains the release path.

## Current operational status

**Delhi OTD adapter is implemented but not activated or tested against the authenticated live service.** No secret is configured in this checkout. See activation below. Production `places/transit/network.json` deliberately contains no services or vehicle observations. The page shows this state and links to NTES and Metro Railway Kolkata. Supporting a mode in the format does not claim it operates anywhere, including tram services. No timetables, fares, crowds, accessibility, platforms or GPS locations have been invented.

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


## Activate Delhi OTD on the existing Vercel project

The endpoint is `GET /api/transit/delhi` on the **Vercel deployment of this branch**. GitHub Pages cannot run server functions. The Cloudflare share-preview worker has not been changed to provide this API. Those hosts show a clear unavailable state for the vehicle board; do not send the private key to them.

1. In the existing Vercel project's server-side environment variables, add **`DELHI_OTD_API_KEY`** with the authorised key. Select the intended deployment environment. Do not add a `PUBLIC_` or `NEXT_PUBLIC_` prefix, query parameter, HTML field or value to config.js. Never put the real key in chat, git, screenshots or a `.env` file in a publicly served directory.
2. Deploy the reviewed PR source to that project. Existing vercel.json permits automatic production deployment only from main; this PR does not change that rule or merge itself. A key added after a build requires a new deployment to become available to that deployment.
3. Open `/api/transit/delhi` on that deployment, then `travel.html`. The endpoint returns normalised JSON without the key. A 503 `not_configured` means the secret has not reached the function; `access_denied` means the provider rejected the request; `rate_limited` means back off. Other failures, stale or invalid feeds return empty positions. Do not expose upstream response bodies when diagnosing errors.
4. Confirm authorisation covers the application's stated use under https://otd.delhi.gov.in/terms . The adapter supplies prominent source attribution. No account signup, purpose submission or terms acceptance was performed by this code change.

Server implementation: `server/delhi-otd.mjs`, using MobilityData's `gtfs-realtime-bindings` 2.2.0. The only upstream target is the documented HTTPS OTD VehiclePositions endpoint. Redirects are rejected, the query key is encoded server-side, downloads are limited to 8 MiB, and the entire fetch/body read has a 10-second timeout. No URLs, provider bodies or exception text are logged or returned. Secrets come from the function runtime only.

A recent full-dataset header and actual vehicle timestamp are both required. Feed and vehicle age must be 0–90 seconds; a vehicle newer than its feed header is omitted. Missing timestamp is never replaced by request time. Future, invalid, duplicate and deleted observations are excluded. Service dates must be explicit and valid before a dated candidate trip identity is emitted; it is not a verified static-feed match. Source route IDs are displayed literally as IDs, never guessed destination names. Only fresh positions get OpenStreetMap observation links. No vehicle history or user location is stored.

The UI polls once every 30 seconds while visible, rechecks ages every second, and removes expired observations even when the next network refresh fails. Each server instance coalesces concurrent requests and caches a successful response for up to 15 seconds, rechecking observation age before serving it. Failures have a 30-second per-instance cooldown. **This is not a global provider quota.** Before public rollout, configure Vercel platform request limits according to the provider-approved allowance; multiple instances can each make upstream requests. No persistent KV/store or scheduled collector is provisioned.

Install/test with `npm ci --ignore-scripts && npm run test:transit`. Root package.json adds only server adapter dependencies; the frontend remains plain static files. CI installs the lockfile and tests encoded protobuf fixtures, absent timestamps, stale/future records, duplicate identities, missing keys, auth/rate errors, transport failures, oversized bodies, timeout, cache expiry and credential redaction. GitHub Pages and Cloudflare asset exclusions omit server code, package manifests and local secret files. `.gitignore` also excludes local credential files.

**Verification limit:** all adapter checks use synthetic protobuf data. No real key has been supplied to this environment, so provider authorisation, live data quality, request allowance and production deployment remain unverified. Next operational gate: configure the secret, obtain a successful fresh response, then run the documented corridor/24-hour feed audit.
