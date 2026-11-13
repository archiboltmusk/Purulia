# Tourism page

Open `tourism.html` through the same static server as the rest of Parishkar. No installation, build, credentials or schema changes are needed. The homepage desktop/mobile navigation and solution finder link to it.

## Traveller instructions

1. Choose a circuit, duration, pace, party size, mobility needs and conditions; generate the plan. Confirm exact entrances and access with a local operator. Map centres are approximate area references, not verified entrances or accessible routes.
2. Use the map selector or open the external Maps search. External maps need internet. No location permission is requested on this page.
3. Prepare an editable driver, stay or artisan enquiry. Copy it to your chosen provider. Nothing is sent automatically. Get written acceptance of the final quote and cancellation terms.
4. Enter whole-trip, whole-group quotes into the calculator. Zero means a confirmed zero-cost item; blank means a missing quote. Per-person amounts are rounded to paise; actual provider payments may require rounding reconciliation.
5. Complete the departure checklist and print/save the itinerary. Plans, checklist and private issue notes remain on this browser; export important notes before clearing browser storage.
6. Civic reporting uses `kasa.html?d=purulia` with the existing real GPS and live photo requirements. Tourism notes are private planning notes, not public evidence, a report queue or official complaints. For emergencies use your phone's emergency calling feature or seek local assistance; this page is not monitored.

## Algorithms

`tourism-engine.js` is shared by the browser and Node tests. Options are validated against enumerated circuit, pace, mobility and weather choices, 1–3 days and 1–30 travellers. Destinations stay in one circuit. Slow or hot plans allow at most two stops/day; full plans allow three. Gentle or hot plans remove steep stops; rain removes waterfalls. Unfilled days are flexible. These are conservative itinerary heuristics, not a weather forecast, road optimiser or accessibility certification.

Quotes are summed in rounded integer paise. Missing quotes are counted separately. Private issue notes sort by impact × 10 plus age in days capped at 9; locally resolved notes lose the impact component. Resolution is only a device-local note, never Parishkar verification.

## Operator launch instructions

Appoint a coordinator; interview 10 visitors and 10 providers; travel the full circuit. Inspect five stays and recruit transport providers with backup capacity. Verify identity/consent privately, capacity, water, toilets, road/site access and written prices. Arrange paid sessions with artisans and ask permission for photographs. Establish a collection/disposal arrangement before adding bins. Assign every service complaint an owner and deadline; check the outcome before closure. Record punctuality, actual costs and local provider payments. Expand after 10 paid group trips with positive contribution after direct operating costs and at least 9/10 timely pickups.

## Functional boundary

Implemented: destination filters/search, area map and external directions, itinerary rules, printable plans, service request templates, quoted-cost calculator, local checklist and private issue notes with export/delete, visitor instructions and operator playbook. No fabricated providers, rates, availability, live safety status or completed trips.

Not connected: bookings, payments, dispatch, provider verification, public tourism submissions, shared moderation, live closures and emergency response. These need actual operators and a secure, permission-controlled backend. The existing civic-report flow remains the public evidence channel. No Supabase migration or RPC is added. The page is English; the Bengali phrase in the illustration is decorative, not a claim of a translated interface.

## Sources and data

Destination descriptions are concise summaries of the district tourism directory at https://purulia.gov.in/tourist-places/ and state tourism information. Map centres are approximate references and all access status is explicitly unconfirmed. The illustrations are original CSS artwork rather than site photographs. The page is specifically for Purulia and does not change with the site's saved district selection.

## Validation

Run `node --check tourism.js`, `node --check tourism-engine.js` and `node --test tests/tourism.test.cjs`. Browser checks: `cd tests/browser && npm ci && npx playwright install chromium && npx playwright test tourism.spec.mjs`. The dedicated tourism CI runs those checks for desktop and mobile on PRs; the existing global browser workflow is unchanged. Local browser execution was unavailable because the execution environment blocked HTTP server binding. Do not treat unit checks as browser/layout verification.

Static hosting automatically includes the new page/assets after merge to main. There is no separate application deployment, native app build, database change, changelog release or service-worker shell change in this feature.
