# Municipal sanitation dispatch: design (draft, not built)

Status: design + offline prototype. No migration, no site wiring, no contact with any municipality, no SMS.
Builds on: `partner.html`, `kasa_admin_partner_*`, `kasa_partner_*` (phases 1–3), `design/municipal-partner-workflow.md`.
Prototype: `tools/dispatch/dispatch.mjs` (synthetic data only), tests `tests/dispatch.test.mjs` (`node tests/dispatch.test.mjs`).

## 0. Summary

Blinkit-style routing is the wrong shape for municipal waste. Three things change the design:

1. Crews already run fixed daily beats. Complaints get dedicated quick-response (QRT) vehicles per ward. Dispatch never pulls beat crews.
2. Volume and machine are unknown from a photo. A human supervisor triages each ticket (machine type) before routing. The algorithm routes only triaged tickets.
3. A full vehicle is not a free vehicle. It goes to the transfer station or dump yard (45–90 min deadhead, per Anupam). Stops are not assigned to it until it is empty.

Pipeline (the blueprint's four stages, with Anupam's additions):

```
report (live photo + GPS, existing)
  → dedupe: 30 m + 12 h → child of a master ticket (new)
  → ward bucket (existing place code)
  → supervisor triage: machine type + accept (new, one screen)
  → cluster per ward: DBSCAN 800 m, min 2 (new)
  → split by QRT capacity; route to transfer site (new)
  → assign: score, gates, one-click approve by supervisor (new; extends kasa_admin_partner_assign)
  → worker: live-camera closure within 40 m of geotag (extends partner_work_photos)
  → citizen: "Was this cleared?" 4 h window; No → reopen + flag supervisor (new)
```

## 1. Decisions taken from the blueprint and project rules

| Blueprint says | Choice | Why |
|---|---|---|
| Pure auto-dispatch, one click auto-assign | Suggest + supervisor approves (blueprint's own phase 1) | Anupam's notes; wrong-vehicle and volume risk |
| Algorithm routes any ticket | Only triaged tickets (machine picked by supervisor) | Photo cannot show weight or hidden debris |
| Dispatch any free worker | Dedicated QRT per ward; beats are never touched | Beats are legal daily duty |
| Cluster 500 m–1 km, min 2 | 800 m, min 2, per ward only; noise = solo run, low priority | Ward is the jurisdiction; no cross-ward runs |
| Dedupe not mentioned | 30 m + 12 h → child report, reporter told the spot is queued | Stops inflated demand |
| OR-Tools in Python worker, OSRM self-hosted | Phase 1: haversine + nearest neighbour + 2-opt in JS (prototype). Phase 2: road distances from OSRM/ORS, decision needed | No new service in phase 1 |
| Worker geofence 50 m | 40 m of the geotag for closure (Anupam); existing proposal `work_site_radius_m` set to 40 | Matches closure rule |
| Automatic SMS to citizen | No SMS. Public line + app/web prompt only. SMS needs Anupam's go-ahead | Project rule: no outbound messages without a decision |
| Next.js / Flutter / Python worker | Stay on static HTML + Supabase RPCs; worker screen = existing `mobile/` Expo app or PWA; OR-Tools only if phase 2 needs it | Project stack; no framework |
| Live vehicle tracking, heatmaps | Phase 4, and only with a stated retention rule | Privacy; worker location is sensitive |

Project rules that apply unchanged: live camera + real GPS only, no gallery, no manual pin. Only cited data; synthetic data labelled and kept out of the site.

## 2. Algorithm details

### 2.1 Dedupe (new)
- Within a ward, a new report within 30 m and 12 h of an open master becomes its child (`dedupe` in prototype).
- Child keeps its own photo and reporter; the reporter gets "this spot is already queued". Reporter's phone is kept only for the resolution check (see §5), not shown publicly.
- Demand counts use masters only.

### 2.2 Cluster
- DBSCAN, haversine, eps 800 m, min_pts 2, run per ward (`dbscan`, `buildRuns`).
- Brute force in prototype. Production: grid or H3 index per ward (a ward holds hundreds of tickets, so brute force is fine for a pilot; city-wide needs an index).
- Cadence: every 15–30 min, or when a ward's pending volume crosses a threshold. Must run as a DB-claimed job (Edge functions take the anon key; claim in DB first, per project rule).

### 2.3 Split by capacity
- Greedy fill from the cluster's nearest point: add the nearest stop that still fits the vehicle's capacity; start a new run when none fits (`splitByCapacity`).
- A single ticket above capacity → its own run, flagged "needs larger vehicle" for the supervisor.

### 2.4 Route
- Open path: vehicle position → stops → transfer site. Nearest neighbour, then 2-opt (`routeRun`).
- Phase 2: replace haversine with road distance (OSRM table). Keep the function signature.

### 2.5 Score (lower is better)
`score = 0.35·distance + 0.30·age + 0.20·vehicle_fit + 0.15·load`, each term normalised 0..1 (`scoreWorker`):
- distance: km from vehicle to run centroid, capped at 5 km.
- age: 1 − min(oldest hours, 72)/72. Same for every worker on a run, so it orders runs (oldest first), not workers. Kept so one function serves both.
- vehicle_fit: 0 when the vehicle is about right for the run; penalty rises toward 5× oversize; 1 when the vehicle is too small.
- load: backlog / capacity.

### 2.6 Assign (gates first, then score)
`assignRuns`: runs in priority order; a run goes to the lowest-score worker that passes all gates:
1. run is triaged (`machine` set) — else `needs_triage`;
2. vehicle type matches the triaged machine;
3. vehicle is free (`availableAt ≤ now`): a loaded vehicle is on deadhead until its dump time;
4. capacity has room.
No free vehicle → `no_free_vehicle` (stays queued, shown to supervisor). Greedy is enough for a pilot; Hungarian assignment is a later option if runs and crews grow.

### 2.7 Deadhead (Loophole 4)
- When a vehicle is full, status `to_site` with `availableAt` = now + estimated return (from route km and a supervisor-set turnaround, default 90 min). Supervisor corrects it after the first real run. The estimate is labelled as an estimate on screen.

## 3. Mapping onto existing tables

| Need | Existing | Change |
|---|---|---|
| Ticket | `reports` (live photo, GPS, `waste_type`, `place`) | add `master_report_id` (or a separate `kasa_private.dispatch_links` table, so `reports` stays clean) |
| Ward | `kasa_private.areas`, `kasa_jurisdictions_at` | none |
| Body / office | `partner_orders.office_key` | none |
| Work order per report | `kasa_private.partner_orders` (one live order per report) | none for the ticket; a run is a grouping of orders |
| Run | none | new `kasa_private.partner_runs` (id, ward, office_key, machine, volume_kg est, status, created_at) and `partner_orders.run_id` + `seq` |
| Triage | none | new `partner_orders.machine` set by supervisor; `triaged_by`, `triaged_at` (audit) |
| Vehicle / crew | `kasa_private.partner_workers` (firm, phone, active) | add `vehicle_type`, `capacity_kg`, `ward_key`, `available_at` (vehicle-level, because a firm may own several vehicles: consider `partner_vehicles`) |
| Transfer site / dump yard | legacy dumpsites layer (`addLegacyDumpsites` in kasa.js, source TBC) | new `kasa_private.transfer_sites` (name, lat/lng, source_url, verified_by), moderator-entered, cited |
| Assign | `kasa_admin_partner_assign(order, worker, order_no)` | extend to take `run_id` and sequence; keep single-order path |
| Closure proof | `partner_work_photos` + `kasa_partner_add_work_photo` (live, GPS) | radius 40 m for closure; server check on upload |
| Citizen check | `kasa_report_followup`, claim/verify flow | new 4 h "Was this cleared?" window → `reopen` event on `partner_order_events` |
| Public | `kasa_partner_board()`, `kasa_office_board()` | counts only; no vehicle or worker names |

Only `kasa_private` tables and `security definer` RPCs. Each new RPC/table gets one line in CLAUDE.md when it ships.

## 4. Phases and estimates

Estimates are rough working-day guesses for one developer, not commitments. They assume Anupam answers the decisions in §6 on time.

| Phase | Scope | Est. | Gate |
|---|---|---|---|
| 0 (this PR) | Design doc + offline prototype + tests. Not wired. | done in this PR | Anupam confirms design |
| 1 | Schema: runs, triage field, vehicles, transfer sites, dedupe links. RPCs: `kasa_admin_dispatch_suggest` (returns proposed runs, read-only), `kasa_admin_dispatch_approve`. Supervisor screen in `partner.html`: triage + suggest + one-click approve. Haversine only. Dedupe on report insert (trigger). | 6–9 days | migration named by Anupam (or auto-apply if approved in thread); live check |
| 2 | Road distance (OSRM or ORS, decision), deadhead model, reopen check (4 h), public counts on `offices.html`, `case.html`. | 5–8 days | road-distance provider decision |
| 3 | Worker closure: photo within 40 m, offline capture rules, run card view (sequence list). PWA or `mobile/` screen. Blueprint's worker screen comes here, not before. | 8–12 days | Anupam confirms worker flow; phone-number privacy rule |
| 4 | Auto-suggest on a timer, vehicle tracking, heatmap. Only if phases 1–3 show accuracy. | open | data from phases 1–3 |

Total to usable pilot (phases 1–3): roughly 3–5 weeks of focused work. Phase 1 alone shows the supervisor workflow with no worker app.

## 5. Proof of work and citizen loop

- Closure: live camera only; GPS within 40 m of the geotag; time after `in_progress`; two photos (wide, close). Reuses `partner_work_photos` review.
- Fraud signals (flags, not auto-reject): EXIF time older than token; same sha256 on two orders; same GPS fix on consecutive jobs; too many orders per day per vehicle.
- Citizen: "Was this cleared?" shown in the report sheet/case file with the after photo. No SMS. A "No" within 4 h reopens the order and flags the supervisor. No answer = no change (silence is not a yes).
- Verification still needs officer sign-off AND citizen verification (existing rule, `partner_try_verify`).

## 6. Open decisions (need Anupam)

1. **SMS to citizens** (blueprint: after-clearance SMS, dedupe confirmation SMS). Default in this design: no SMS; app/web/case-file line only. Yes/no?
2. **Volume**: no field gives weight. Options: supervisor enters a band (small/medium/large) at triage; no kg estimate on the public side. Which?
3. **Transfer site source**: who names it and cites it (municipality letter or official page)? Is the legacy dumpsites layer a source we can cite?
4. **Road-distance provider** for phase 2: self-hosted OSRM, OpenRouteService (key), or Google (paid, terms)? Haversine until decided.
5. **Who triages** when no supervisor exists for a ward (pilot body is Purulia Municipality; moderator stand-in)?
6. **Deadhead turnaround default**: 90 min (blueprint upper bound) or ask the municipality?
7. **Worker phone numbers**: keep in `partner_workers` (private) as now, or move to a consented table (DPDP Act 2023 notice and consent; links to design doc §8)?
8. **Migration apply**: phase 1 migration applied to live when merged, or after a named approval each time? (Anupam's standing approval covers only migrations this thread writes that pass local tests.)

## 6a. Operational constraints (Anupam, 2026-10-16, second message) and how they land

Software can enforce some of these. Others are policy and need a decision before any build.

| Constraint | Design response | Phase | Conflict or decision |
|---|---|---|---|
| Incentives: fixed-wage staff and agency crews gain nothing from extra pickups; slow-walking, fake punctures, data off | Not software. Ticket metrics feed the ward's monthly scorecard and contractor review (`partner_order_events` counts per firm, public only as cited counts). Bonuses or fuel allowances are a municipal decision and touch the payment rules in `design/municipal-partner-workflow.md` §8 | policy | Decision: does Parishkar publish per-firm closure counts at all? Risk: metric gaming. Recommend counts only, no ranking, until data exists |
| Out of jurisdiction (railway, NH/SPWD, canal bank, private plot) | New triage state `out_of_jurisdiction`, not `rejected`. Route via `kasa_jurisdictions_at` and `escalate.html` to the owning body. Owner notice is an outbound message | 1 (state) / 2 (routing) | Decision: notice to a plot owner or authority is outbound. Needs a yes before any letter or message is sent |
| Chronic hotspot: more than 4 tickets within 25 m over 14 days | Hotspot flag computed from reports; shown on `offices.html` and the dashboard as a vulnerable point. Separate from dedupe (30 m / 12 h). Response options are suggestions in a queue, not automatic | 2 | Decision: rule thresholds OK? Hotspot counts are public (counts only) |
| Hotspot responses: night camera, early vehicle, shrubs, wall painting, bench | Dispatch can add a "scheduled early-morning visit" for a flagged spot. Painting, shrubs, bench are works: they go to the works/tender side (`works`, `kasa_admin_add_tender_candidate`), not dispatch. CCTV in public space is out of scope | 2 (visit) / later (works) | Decision: CCTV needs legal review (privacy, DPDP 2023, municipal approval). I recommend no camera in phase 1–3 |
| Citizen verification deadlock: apathy (70 % never confirm); citizens reject because they wanted a dustbin or drain fix | Provisional closure after geotagged after-photo within radius. Citizen gets the photo; "Still dirty" within 8 h reopens. No dispute in 8 h → resolved. Resolved ≠ permanent fix: say so in the public line; "wanted something else" becomes a new ticket, not a dispute | 2 | Conflicts with §5 (4 h window, silence = no change). Decision needed: 8 h or 4 h; auto-resolve on silence yes or no (I recommend yes with a visible "resolved by no reply" label and a moderator audit sample). Delivery of the photo over WhatsApp or SMS is outbound: needs your go-ahead |
| Citizen verification and officer sign-off (existing rule) | Keep: `partner_try_verify` still needs officer sign-off AND report verification. The 8 h auto-resolve applies to the citizen step only | 2 | Clarify: does auto-resolve count as "citizen verification" for the officer gate? Recommend no: it closes the ticket, not the payment gate |
| Ground devices: battery drain, GPS drift 60–100 m in lanes, offline pockets | Offline-first PWA (or `mobile/`): cache the day's route and stops on device; log checkpoints and captures locally; sync when online. GPS only at checkpoints and captures, not continuous. Store reported accuracy on every fix | 3 | Conflicts on geofence: 40 m (earlier) vs 50–75 m (this message). Proposal: 40 m to geotag as the base rule; accept up to 75 m only when the device reports accuracy worse than 40 m, and flag it for audit. Decision: 40 m only, or the accuracy-aware rule? |

Net effect on the design: no change to dedupe, clustering, scoring or routing. New states and rules touch §3 (triage state `out_of_jurisdiction`, hotspot flag, provisional closure state), and phase 3 becomes the offline PWA. Phase 1 gains the triage state only.

Added open decisions (on top of §6):
9. Publish per-firm closure counts (no ranking) or nothing?
10. Out-of-jurisdiction: is an owner or authority notice ever sent by Parishkar, or only a link to the authority's own grievance page?
11. Closure window 4 h or 8 h, and auto-resolve on silence yes/no.
12. Geofence: 40 m only, or 40 m plus accuracy-aware up to 75 m?
13. Hotspot thresholds (>4 tickets, 25 m, 14 days) and whether CCTV is ever in scope (recommend no).

## 6b. Simpler alternative proposed by Anupam (2026-10-16, third message): batch + Google Maps link

Proposal: no real-time dispatch and no routing server. Two fixed batches a day per ward (08:30 covers overnight reports, 14:30 covers the morning); reports after 14:30 roll to next morning unless flagged urgent. The supervisor clicks "Generate route": tickets grouped by ward, deduped within 30 m, ordered, and turned into a Google Maps directions link (origin = ward office, destination = transfer site, up to 10 waypoints). Driver gets it on WhatsApp. A single mobile page lists 5–8 spots with "Open in Maps" and "Take after photo" (live camera + GPS, marks the spot provisionally resolved). One dedicated QRT vehicle per 3–5 wards. Dedupe SQL: PostGIS `ST_DWithin` 30 m on pending tickets.

Assessment:
- Fits the project better than §2: no OR-Tools, no OSRM, no routing server, ops-simple. Fixed batches also protect beats and match the deadhead reality (one or two runs a day, not a zigzag).
- Keeps from our design: ward scoping, dedupe, triage gate (supervisor picks machine before a stop enters a batch), full-vehicle gate (a vehicle heading to the transfer site is not in the next batch), live camera + 40 m closure, provisional closure with citizen window.
- Our prototype's ordering (nearest neighbour + 2-opt) still computes the sequence. The Google link preserves waypoint order (do not use `optimize:true`). Sequence matters more than the algorithm; the prototype becomes the sequencer and the link builder is a thin function.
- Google Maps link: the 10-waypoint cap and the URL format must be checked against Google's current docs before building. Coordinates leave the site to Google when a driver taps the link: a privacy note is needed (ward and complaint locations, no citizen identity). Cost: none for the link itself.
- The SQL snippet names `garbage_reports` with `geom` and `status = 'pending'`. Our table is `reports` (lat/lng, existing). It also lacks the 12 h window; keep it, because a spot re-reported after a clear should be a new ticket.
- Cadence: batches replace the "every 15–30 min" clustering trigger. Batch timing is a decision for each ward (08:30 / 14:30 is a proposal).
- "Take after photo marks resolved": keep it as provisional closure, as in §6a. Resolution is not final on the driver's tap.
- Auto reply to the citizen "A cleanup request for this spot is already in progress": outbound-facing message to a citizen. Needs a decision whether it shows as a public line only or as a message.

Recommendation: adopt 6b as phase 1 (batch dispatch + link + driver page + triage gate). Keep clustering and scoring for phase 2 only if batch counts show a need. Add to §4: phase 1 becomes smaller (no optimizer). Decisions: batch times per ward; 10-waypoint cap per batch (split into two links if needed); driver page auth (vehicle number only: low security, acceptable only if the page shows no citizen identity and no moderator action).

## 7. Prototype: what it does and does not do

Does: dedupe, ward-scoped DBSCAN, capacity split, open-path route (NN + 2-opt), weighted score, gated greedy assignment (triage, vehicle type, deadhead, capacity), seeded synthetic demo.

Does not: road distance, real data, any DB or site call, persistence, UI, OR-Tools, time windows, multi-trip vehicles (a full vehicle is simply unavailable until `availableAt`).

Synthetic data is labelled `SYNTHETIC` in the demo output and in the file header. Nothing loads it into the live site.

## 8. Risks

- Supervisor triage becomes the bottleneck. Mitigation: triage is one tap with a photo; suggest default machine from waste type; SLA on triage time.
- Wrong machine picked. Mitigation: vehicle-type gate; "needs larger vehicle" flag; supervisor re-triage.
- Gaming closure (tight close-up, gallery). Mitigation: live camera, 40 m geofence, wide photo required, citizen "Was this cleared?", random moderator audit.
- Full vehicle assigned by mistake. Mitigation: `availableAt` gate; turnaround corrected from real runs.
- Dedupe merges two real problems 25 m apart. Mitigation: child stays visible on the master's sheet; reporter can flag "different problem".
- Public exposure of crew location. Mitigation: no live tracking in phases 1–3; public shows counts and dates only.
