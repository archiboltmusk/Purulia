# Purulia shared place and service system

`system.html` is a public Purulia pilot. It does not operate government systems,
book services, collect health identities, adjudicate claims or control equipment.

## Six architectural upgrades

| Mechanism | Implementation | Boundary |
|---|---|---|
| Shared geography | Typed places, entrances, services, paths, assets and organisations; reviewed dependency/access links; existing evidence entity/document/assertion references | Directory area points are not verified entrances. No utility survey or subterranean precision is claimed. |
| Time-dependent evidence | Append-only observations and reviews, field-specific expiry, sources and observation dates; latest ever-approved assertion chosen before expiry/withdrawal | Expired/withdrawn evidence never revives an older assertion. Unreviewed proposals remain private. |
| Constrained routing | OSRM driving-time matrix, opening/visit windows, quoted paise costs, party size, mobility evidence and user-selected allowance; bounded beam search | Not globally optimal, live traffic, booking, emergency routing or certainty about future access. Unknown costs are not zero. |
| Durable commands | Actor/request idempotency with payload hash; row locks; append-only events, leased/retry/dead-letter outbox; reverse dependency revisions | Public versions reject stale plans immediately. Scheduled processing updates projections; it sends no notifications. |
| Independent outcomes | Separate author/reviewer, declared interests, fresh worker evidence after assignment, explicit expected outcome, independent post-completion evidence and 7-day then 30-day rechecks | The moderator role is an operator stand-in. Existing camera/GPS civic workflow remains the on-site reporting path. |
| Capacity allocation | Reviewed interventions, shared-asset impact on published circuits, quote and crew limits; explicit lexicographic greedy policy | Not an economic impact estimate or an optimal allocation guarantee. |

The directory seed derives all 56 names from `tourism-engine.js`; eight approximate
area points remain reference coordinates. No provider, price, opening time,
working toilet, surveyed entrance or live sensor is invented. A useful service
network requires operators to collect and independently review those facts.

## Operator commissioning

1. Two distinct moderator accounts sign in at `system-admin.html`.
2. Create a sourced node; a different non-conflicted moderator publishes it.
3. Submit structured observations with actual source and observation/expiry times.
   Another moderator approves or rejects them. Register known ownership,
   employment and contractor interests before reviewing.
4. For an entrance, review coordinates, open access, opening window, visit duration,
   price (explicit INR zero allowed) and mobility evidence. Link shared access
   assets using reviewed `depends`/`access` edges. Cycles are rejected.
5. Publish a circuit only after its entrances are currently usable. Plan calculation
   checks authoritative revisions before and after the road matrix request.
6. An intervention proposal specifies `outcome_field` and `outcome_value`, money
   and crew estimates. Review, assign `worker_id`, submit new worker evidence,
   complete, obtain independent evidence matching the expected outcome, accept.
   After recheck is due, obtain new matching independent evidence and use
   `recheck`; observed failures use `reopen` with a reason. Historical worker
   evidence cannot complete a new work cycle.

The operator command RPC is
`kasa_system_command(p_request uuid,p_action text,p_data jsonb)`. Reuse the same
request UUID and identical data after an uncertain timeout; changed data requires
a new UUID. `admin_snapshot` is a read-only moderator operation and is not cached
in the commands table. Public APIs are `kasa_system_snapshot(text)`,
`kasa_system_versions(uuid[])` and `kasa_system_telemetry(text)`. Private tables
have RLS and no anonymous/authenticated direct grants.

Observation windows: access/open 4 hours; water/toilet/stock 24 hours; price 7
days; hours/contact 30 days; coordinates/step-free/visit duration 180 days. These
are pilot review policies, not legal or engineering guarantees.

## Signed device protocol

The Edge Function source is provided at `supabase/functions/kasa-system-ingest`.
**It requires separate deployment, actual devices and calibration before a live
feed exists.** Database deployment does not deploy that function or connect
hardware. Deploy with Supabase CLI to the intended project after configuring
its normal server-side service-role environment; `supabase/config.toml` disables
JWT verification for this function because packets authenticate with Ed25519.
No private signing key belongs in the website or database.

Enrol with command `device`: `node_id`, `name`, `metric`, `unit`, base64 32-byte
Ed25519 `public_key`, calibration source URL, `calibration_until`, expected
`min_value`, `max_value`, and optional `public` boolean. Another non-conflicted
moderator checks the binding/calibration and runs `activate_device`. `revoke_device`
is immediate. Key rotation uses a new device/key enrolment; revoked keys cannot
be reactivated.

POST `{ "payload": ..., "signature": "BASE64_SIGNATURE" }` to the deployed
function. Envelope limit is 8192 bytes. Exact payload fields, in canonical order:

```json
{"version":1,"device_id":"UUID","key_id":"UUID","node_id":"UUID","metric":"flow_lps","unit":"L/s","sequence":1,"measured_at":"2026-11-15T12:00:00.000Z","value":5,"nonce":"16-or-more-safe-characters"}
```

The device signs UTF-8 JSON of the **array of these values in that order**, not
arbitrary object serialization. `canonicalReading` is the single protocol
implementation. Valid metric/unit pairs are defined in that module. Sequence
numbers increase per enrolled device, timestamps are canonical ISO UTC, and
packets older than 24 hours or more than two minutes in the future are rejected.
Exact retries are idempotent; changed content with a reused sequence and
out-of-order packets are rejected. Service-role-only ingestion rechecks device
status while holding its row lock. Public/authenticated callers cannot mark
readings verified. The trusted Edge Function verifies the actual Ed25519 signature
before using the service-only ingestion RPC. That service role remains a privileged
trust boundary, not a claim of immunity to an administrator compromise.

Signatures prove key control and byte integrity. Calibration, inspections,
independent samples and installation checks establish measurement credibility.
Expired calibration, stale values and out-of-range thresholds remain explicit.
Out-of-range packets open a private review alert, never an actuator command,
fine, water-safety assertion or automatic road closure.

The two public models are manual, versioned 0-D water balance and event runoff/
storage calculations. No calibrated hydrodynamics, utility depths, structural
fatigue prediction, precise leak location, telecom mobility, power dispatch,
traffic signal control or emergency evacuation is implemented.

## Private cases and sector proposals

Sensitive dossier fields stay in page memory. Export is opt-in AES-256-GCM with
PBKDF2-SHA256 (310,000 iterations, random salt/IV). No account recovery or plaintext
autosave. Public evidence cache and explicitly saved travel plans are distinct
from the private dossier. User-entered official references are marked unverified;
the app does not file a complaint or guarantee anonymity/protection.

Source guidance: [WB ACB](https://acb.wb.gov.in/faq),
[WB Vigilance](https://svc.wb.gov.in/), [CPGRAMS](https://pgportal.gov.in/),
[PIDPI procedure](https://dda.gov.in/vigilance/PIDPI_complaints).
Check jurisdiction and official procedure before submitting; PIDPI is a separate
postal process, not this app's electronic workflow.

Governance, economy, healthcare, education, environment and institutional trust
are represented by reusable mechanisms and explicitly labelled policy proposals
in `system-policies.js`. Automated fines, deemed legal approvals, patient-ID
mandates, payroll deductions, insurance holds, accreditation cuts and automatic
escrow clawbacks are not platform powers. Healthcare review helpers operate only
on synthetic/consented metadata in tests; no hospital, ABDM, NMC, NHCX, insurer,
Aadhaar, ABHA, biometric, patient-record or diagnostic-device integration exists.

Primary references:
- [ABDM FHIR implementation guide](https://www.nrces.in/ndhm/fhir/r4/index.html)
- [ABHA information / voluntary access](https://ors.gov.in/healthid/index.jsp)
- [NMC regulations](https://nmc.org.in/page/rules-regulations-rules-regulations-nmc)
- [NBEMS accreditation](https://accr.natboard.edu.in/)
- [UIDAI biometric devices](https://uidai.gov.in/hi/biometric-devices)
- [IIIT Hyderabad digital twin project](https://smartcityresearch.iiit.ac.in/partners/projects/digitaltwin/)

## Verification and deployment

- `node --test tests/system.test.cjs`: constraints, invalidation, privacy encryption,
  cryptographic verification, policy boundaries and scenario conservation.
- `bash supabase/tests/run.sh`: every migration twice against fresh and legacy
  databases, existing scenarios and new graph/command/intervention/device tests.
- `cd tests/browser && npx playwright test system.spec.mjs`: desktop and phone
  navigation, no overflow, actual road-matrix flow, concurrent closure refusal,
  and private facts excluded from storage/network.
- `node tools/build-system-seed.mjs --check`: directory reproducibility.

`system-upgrade-deploy.yml` applies only these three new migrations atomically
using the existing database secret and checks API grants and directory count.
`system-maintenance.yml` drains internal projection events and flags follow-ups
on a 15-minute GitHub schedule (scheduling is not a deadline guarantee).
Public access validity is computed at read time and does not depend on that cron.
