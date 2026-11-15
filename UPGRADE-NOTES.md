# Civic and tourism completion — 15 November 2026

- Homepage foregrounds reporting, followed cases and tourism.
- Partner workers can capture live camera/GPS evidence, upload/retry it in the current tab, and inspect their photos. Officers review evidence and handle reopened work. Residents can reopen verified/paid orders from the public case page.
- Migration `20261115120000_partner_evidence_completion.sql` adds actor-only photo reads, a worker-only storage policy and guards for new work cycles, self-review and independent community resolution. `report_is_verified` validates original report provenance; it is insufficient to close work. Existing photos stay in history and must be replaced on first sign-off after this migration. No existing data is deleted.
- Tourism shows all seven existing destinations on MapLibre, numbers the selected day's stops and offers optional OSRM road routing and daily Google Maps navigation. Approximate centres are not represented as surveyed entrances. OSRM is a best-effort public demo service; failures leave schematic lines and navigation links.
- Station/arrival/departure/transport inputs constrain itinerary capacity. Durations are disclosed planning assumptions; public-transport schedules, live closures and exact entrances remain unverified. Unscheduled days and omitted stops are explicit. No booking/payment system is introduced.
- Destination cards distinguish reference checks from unverified access/facilities. District-data pages show original source names, check dates, missing dates, review windows and a correction link. Source dates and Census/NFHS reporting periods remain distinct.
- Viewport requests cancel obsolete work, handle wrapped longitude ranges, replace same-id changes, bound the cache to 1,000 rows and disclose truncation/errors.

## Deployment

Publish frontend and apply the new migration together. `partner-upgrade-deploy.yml` applies the four partner migrations atomically on main using the existing `SUPABASE_DB_URL` secret and checks deployed RPCs/guards. A missing secret fails explicitly; a successful static deployment does not prove the database changed. Check that workflow, then verify with real worker and officer accounts. Do not claim real-world service verification from automated tests.

## Validation

- `node --test tests/tourism.test.cjs tests/data-freshness.test.cjs`
- `bash supabase/tests/run.sh` (includes partner evidence scenarios; legacy/fresh databases, migrations twice)
- `cd tests/browser && npx playwright test tourism.spec.mjs partner.spec.mjs viewport.spec.mjs`
