# Purulia tourism atlas and services

Open `tourism.html` through the existing static site. No framework or build step. The traveller interface supports Bengali (default), English and Hindi.

## Catalogue and map

The catalogue covers all 14 entries across both district tourism-directory pages and 9 additional official-source destinations / arrival base. `tourism-data.js` stores source links, multilingual suggestions, planning visit allowances, access flags and geometry provenance separately. No current opening, toilet, water, parking or step-free availability is asserted.

18 entries have source reference points; 5 remain unlocated pending reliable identification. These are retained in the catalogue and circuit stop lists with external map search links. Do not invent coordinates to remove the gap. Reference points are not verified entrances. The map uses the repository's self-hosted MapLibre library and OpenFreeMap. Its dashed circuit connections are schematic straight segments, not recorded tracks, roads, distance measurements or navigation. Unknown coordinates break a line rather than joining across a missing stop. External leg-by-leg directions calculate their own routes.

## Planner and offline use

Choose circuit, arrival base, first-day arrival in IST, 1–3 days, 1–30 travellers, daily hours, per-leg transfer allowance, pace, interests, conditions and mobility needs. Visit times and transfer budgets are explicit planning allowances, not measured road times. Plans reserve a 30-minute break plus outward/return transfer allowances and finish by 18:00. Slow/hot plans allow at most two stops; full plans three. Gentle/hot options remove steep stops; rain removes waterfalls. Overflow and excluded places remain visible. Public transport connections are unconfirmed.

Trip links contain only whitelisted options, not private notes, provider enquiries or GPS. Downloaded HTML trip packs work without JavaScript or internet and include the selected places, instructions, dates and source links. Maps and external links need internet. Printable plans, browser-local checklists, quote calculations and private notes remain available. Old checklist indices are migrated once. Missing quotes are not treated as confirmed free services.

## Provider and enquiry workflow

`tourism-operator.html` uses the existing moderator sign-in session. A provider is published only after consent, a public evidence URL and verification valid for at most 30 days. Expired records disappear. No providers are seeded or invented. A current record does not promise availability, safety, licensing or service quality; the operator must check the actual service.

Submitting an enquiry creates/uses a Supabase anonymous session. The enquiry is visible only to that session and authorised moderators, is idempotent by request UUID and payload, and is rate-limited per owner/network. Moderator replies appear in the browser's enquiry list. No email, provider message, booking, payment or dispatch is automatic. Cancellation changes status and retains the record. There is no automatic enquiry-erasure schedule; privacy deletion requests go to the existing grievance officer. Private tables are RLS-enabled with no direct public/authenticated table privileges. Public callers receive only current published provider fields. Existing civic reports still require the live-camera/GPS flow.

## Backend activation

The additive, idempotent migration is `supabase/migrations/20261113120000_kasa_tourism_services.sql`. It targets the existing Parishkar project, not a new database. `Set up tourism service backend` runs on main when relevant source changes or by manual dispatch. It requires repository Actions secret `SUPABASE_DB_URL`, validates that the URI matches config.js, applies only this migration transactionally and verifies table/RPC privileges and the public API. It never logs credentials or raw errors. Missing access is reported as not applied; merging is not proof that the migration ran. Without it, the public page displays a backend-unavailable state and no provider records.

## Launch instructions

1. Appoint a coordinator, interview 10 visitors and 10 providers, and field-check the proposed circuit.
2. Inspect transport, stays, toilets, water, parking and exact entrances; privately document consent, evidence, full quotes and cancellation terms.
3. Arrange paid artisan sessions directly; agree photography and group limits.
4. Before each departure confirm access, weather, host, vehicle, a backup and return pickup.
5. Record actual costs, punctuality, provider payments and complaint outcomes. Expand after 10 paid group trips with positive contribution and at least 9 timely pickups.

## Verification

`node --test tests/tourism.test.cjs` checks the catalogue, translations, all planner combinations, budgets, invalid shared data, schematic geometry and provider expiry. `python3 tests/test_tourism_setup.py` checks target restrictions. The migration suite runs `supabase/tests/test_tourism.py` against fresh and legacy-shaped databases, applying migrations twice first. Dedicated browser CI runs tourism desktop/mobile flows and the school-camera/district-card regressions. The complete browser workflow continues to run on main. Local server binding is restricted; CI supplies browser execution.
