# Parishkar Purulia runbook

For whoever runs the site next. Not published on the website (`*.md` files are excluded from the Pages deploy).

## What runs where

| Part | Where | Notes |
|---|---|---|
| Website (Purulia 2040, Parishkar map, analytics, admin) | GitHub Pages, from `main` only | `.github/workflows/github-pages.yml` deploys the repo root on every push to `main`. |
| Database, sign-in, photo storage | Supabase project `cnmikcyvyamplbldiivp` | All rules run in Postgres functions; the pages can't skip them. |
| Edge functions | Supabase | `kasa-photo-token`, `kasa-photo-check`, `kasa-notify`, `kasa-cleanup`, `p2040-signup-alert` |
| Claim finalisation | `pg_cron` job `kasa-finalize`, every 10 min | Calls `public.kasa_finalize_due()`. |
| Public record | `.github/workflows/public-record.yml`, daily 06:13 IST | Writes fingerprints to `record/` and saves them to the Internet Archive. |
| Keep-alive | `.github/workflows/keep-alive.yml` | Pings the free Supabase project so it isn't paused. |

## Deploying

- Push to `main`. That's the only branch that deploys; the `github-pages` environment refuses others.
- Don't give `jekyll-gh-pages.yml` a push trigger, and don't create a `gh-pages` branch.
- After any front-end change, bump `VERSION` in `sw.js` so phones pick up the new files.

## Database changes

1. Add a new file in `supabase/migrations/` (timestamped name). Never edit an old migration that is already live.
2. Run the tests (below).
3. Apply the same SQL to the live project (Supabase dashboard → SQL editor, or `supabase db push`).
4. Check that the live function signatures match what the pages call.

Every new function or table is private by default. Grant `execute` / `select` explicitly, and only to the roles that need it.

## Tests

```sh
# needs a local Postgres 16; the CI workflow kasa-tests.yml does the same
PGHOST=/path/to/socket PGPORT=5432 bash supabase/tests/run.sh
```

It builds a legacy-shaped DB and an empty one, applies every migration twice, and runs `supabase/tests/test_migration.py` against both. Everything must pass before a migration goes live.

## Adding or removing a moderator

A moderator signs in on `admin.html` with e-mail. When they have signed in once, find their user id in Supabase → Authentication → Users, then run:

```sql
insert into public.admins (user_id) values ('<their user id>');
-- to remove:
delete from public.admins where user_id = '<their user id>';
```

Only add people you trust. A moderator can hide reports, reject claims and void votes, and every one of those actions shows in the report's public history.

## Secrets (Supabase → Edge Functions → Secrets)

| Secret | Used by | If missing |
|---|---|---|
| `KASA_PHOTO_TOKEN_SECRET` | `kasa-photo-token`, `kasa-photo-check` (old token path; the page no longer calls it) | Nothing breaks. Live-camera tokens are now issued by the database (`kasa_issue_capture_token`). |
| `GOOGLE_VISION_API_KEY` | `kasa-photo-check` | Photos still get fingerprint checks, but no garbage/unsafe scoring. |
| `RESEND_API_KEY`, `SIGNUP_ALERT_FROM`, `SIGNUP_ALERT_TO` | `p2040-signup-alert` | No e-mail for new Join/Follow sign-ups; they're still saved. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | `kasa-notify` | No push alerts for nearby reports. |
| `KASA_PAGE_URL` | `kasa-notify` | Links in alerts point to the default URL. |

Never commit a secret. The anon key in `config.js` is public by design.

## Tuning the rules

Rules live in `kasa_private.settings`. Change a value with SQL; no deploy is needed:

```sql
update kasa_private.settings set value = '12' where key = 'challenge_hours';
```

The main ones are `verify_quorum`, `dispute_quorum`, `min_distinct_networks`, `challenge_hours`, `quiet_start_hour`/`quiet_end_hour` (night hours don't count toward the dispute window), `voter_min_account_hours`, `voter_min_prior_actions`, `trusted_prior_actions`, `ring_min_shared`/`ring_window_days` (confirmers who keep confirming together), `failed_claims_limit`/`failed_claims_window_days`/`failed_claims_block_days`, `flag_review_threshold`, `max_strikes`, and `require_live_report_photo`/`capture_token_minutes` (report photos without a valid camera token wait for a moderator). If you change one that is described on `methodology.html`, update that page too.

## Photo self-moderation (Google Vision, after the fact)

A report is created and published before the Google Vision check on its photo comes back — `kasa.js` fires it and moves on, so a slow connection isn't held up. When Vision's result lands (`kasa_record_photo_check`, called by the `kasa-photo-check` Edge Function), `kasa_private.self_moderate_photo` can move a still-`approved` report to `review` (never `hidden` — that stays a moderator's call) if the photo turns out unsafe, shows a face, or every label Vision returned is on the `off_topic_labels` list (selfies, pets, food, screenshots, ...) with no civic label among them. Each hold is logged as a `moderation_hold` event with its reason, in `admin.html`'s moderation queue and the report's private history.

It deliberately does **not** use `garbage_score` as a general relevance filter — that score is scoped to "does this look like garbage" for the `garbage`/`drain` categories (see `clean_max_garbage_score`), and a legitimate road, streetlight, hand-pump, school or health-centre photo will always read near 0 there.

- Turn it off without a deploy: `update kasa_private.settings set value = 'false' where key = 'self_moderate_photos';`
- Edit the denylist the same way, via the `off_topic_labels` setting (a JSON array of lowercase Vision label fragments).
- It only ever touches `reports/` photos and only while a report is still `approved`; claim/vote photos and anything a moderator or the synchronous checks already moved off `approved` are left alone.
- If Google Vision is down or misconfigured (`GOOGLE_VISION_API_KEY` missing, API not enabled, billing off — check the Edge Function logs for `kasa-photo-check`, or a `vision 403`/`vision 401` there), `photo_checks.labels` stays empty and this simply never fires; nothing is blocked by its absence.

## Repeat-offender pause for reports

Mirrors the failed-claim cooldown just above it, keyed to reports instead of claims: `kasa_private.reports_paused_until`, enforced by the `guard_reports_paused` trigger on `public.reports`. A person whose reports a moderator hides (`kasa_admin_moderate`, action `hide`) `hidden_reports_limit` times within `hidden_reports_window_days` can't file a new report for `hidden_reports_block_days` — the error (`KASA_REPORTS_PAUSED`) tells them so, the same way `KASA_CLAIMS_PAUSED` does; it isn't a silent throttle. They can still confirm, dispute and flag other people's reports while paused.

Deliberately keyed to a moderator's own `hide` action only — never to a `self_moderate_photo` hold (still just a flag, unreviewed) or a public flag on its own (same reasoning as `kasa_private.profiles.strikes`, which only `reject_claim` increments). Tune the three settings the same way as any other rule; no deploy needed.

## District coverage and boundaries

Parishkar takes reports from the whole district. The server places each report from its GPS point (`kasa_private.locate`): inside a Purulia municipality ward it's "town" with that ward; otherwise it's "rural" with its CD block; outside every block it's refused.

- Boundary data lives in `kasa_private.areas`, generated from `purulia_blocks.geojson` (OpenStreetMap blocks) and `purulia_wards.geojson` by `tools/build-areas.py`. To update it, change the GeoJSON, run the script, and put the output in a new migration.
- `purulia_wards.geojson` has 22 of the 23 wards. Near the town edge, the reporter's chosen ward decides (within `town_ward_margin_m`).
- Jhalda and Raghunathpur municipalities have no ward map yet, so their reports count under their block. Adding their ward outlines to the areas data would fix that.
- Rural cleanups use `rural_verify_quorum`, `rural_min_distinct_networks` and `rural_claim_expiry_days`.
- Village accountability shows roles (Pradhan, BDO, DM, CDPO, BMOH and others), not names. MLA and MP names are shown only for Purulia town.

## Official complaint channels on reports

Every report's "Take it further" panel (`renderEscalate` in `kasa.js`) links the Chief Minister's helpline, the CM grievance e-mail, CPGRAMS for central schemes, WBSEDCL for power faults, and the state RTI portal. The state helpline changed after the 2026 election (now "Apnar Sarkar Apnar Pashe", 82820 82820, asap@wb.gov.in — checked September 2026). Re-check these whenever the government or a department changes them; a wrong number wastes people's time.

On a report that's overdue (`isOverdue`: open past its `sla_days`), the panel adds one more option: "Generate an RTI application" (`openRTI`/`rtiHTML` in `kasa.js`). It builds a filled RTI draft — addressed using the report's own authority chain (`chainFor`/`CHAINS`), with the report's category, location, filed date and public link already in it — and opens it as a standalone HTML page for the person to print, sign with their own name and address, and file themselves. It is never auto-submitted and this site is never the applicant: RTI legally needs a named, addressed applicant, which the anonymous report itself deliberately isn't. Don't add auto-filing, auto-escalation timers, or anything that submits on a person's behalf without them reviewing and choosing to send it — that was a deliberate call, not an oversight, given the platform's anonymity model and the legal exposure of filing on someone's behalf without review.

## Legal notices and takedown requests

1. Every request goes to the Grievance Officer (`thelosthillproject@gmail.com`, see `grievance.html`). Acknowledge it within 24 hours.
2. **Court orders or notices from a government agency under IT Act s.79(3)(b):** hide the content within 36 hours (`admin.html` → Hide, with the order's reference as the reason). Keep a copy of the order.
3. **Private complaints (for example, "this report defames me"):** check the report against the Terms. Remove it if it breaks them (a named private person, an unsupported accusation, an identifiable face or number plate). If it's a real civic problem described fairly, leave it up and offer the complainant the right of reply. Decide within 15 days and tell them what you decided.
4. **Requests for user data:** we keep very little (see `privacy.html`): anonymous account ids, scrambled network codes, GPS of reports and votes. Hand it over only for a written legal demand that names the report, and write down what was shared and when.
5. **Content involving a child, or a threat of violence:** hide it immediately, then deal with the paperwork.
6. Never delete or edit anything in `record/`. Hiding a report keeps its fingerprint in the record; that is intended, because the fingerprint contains none of the content.

## Paid or arranged confirmations

The Terms forbid paying for or arranging claims, confirmations or disputes. The server holds a claim for a moderator when two of its confirmers keep confirming together. If you see a pattern (the same confirmers again and again, or a claimant who only ever gets confirmed by the same group):

- reject the claim in `admin.html` with a short reason (this gives the claimant a strike);
- void the confirmers' votes on that claim;
- don't publish anyone's identity or guesses about it. The report's public history already shows what happened.

## The public record

`record/` is append-only and written only by the `public-record.yml` workflow. Never edit, reorder or delete anything in it. If a day's run fails, re-run the workflow for that day from the Actions tab; the chain continues from the last good entry. `record/README.md` explains how anyone can check a report against it.

## Still to do

- **Two-moderator rule:** once there is a second moderator, require two different moderators to approve risky actions (hiding a report that has confirmations, clearing a held claim).
