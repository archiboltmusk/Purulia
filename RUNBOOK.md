# Purulia Kasa runbook

For whoever runs the site next. Not published on the website (`*.md` files are excluded from the Pages deploy).

## What runs where

| Part | Where | Notes |
|---|---|---|
| Website (Purulia 2040, Kasa map, analytics, admin) | GitHub Pages, from `main` only | `.github/workflows/github-pages.yml` deploys the repo root on every push to `main`. |
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

## Legal notices and takedown requests

1. Every request goes to the Grievance Officer (`grievance@puruliakasa.in`, see `grievance.html`). Acknowledge it within 24 hours.
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
