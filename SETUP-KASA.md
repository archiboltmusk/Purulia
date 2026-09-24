# Purulia Kasa — setup and operations

The Kasa page (`kasa.html`) works in two modes:

- **Legacy** (until the database migration is applied): the old tables and
  functions. Reporting works; cleanup proof goes to an admin for review.
- **v2** (after the migration): every rule below is enforced by the database.
  The page detects this automatically — no redeploy needed.

## 1. Apply the database migration

Run the files in `supabase/migrations/` in name order, once each, in the
Supabase SQL editor (or with the Supabase CLI). Each is safe to re-run.

- `20260924120000_kasa_v2_accountability.sql` — the v2 rules below.
- `20260924160000_kasa_unlinkable_photo_paths.sql` — photo links no longer
  contain the uploader's anonymous ID, so nobody can link one person's reports
  and confirmations together.
- `20260924180000_kasa_photo_evidence_checks.sql` — evidence photos: AI-edited
  or older than 2 hours → refused; photo GPS more than 500 m from the spot →
  held for a moderator (a held confirmation doesn't count, a held claim can't
  become final); no metadata → recorded, never refused.

If you ever re-run an earlier file on its own, re-run the later ones after it.

What it changes on the live project (audited 24 Sep 2026):

| Before | After |
|---|---|
| `mark_resolved()` let anyone with the public key resolve any report with any photo | Retired. A report is resolved only after an on-site claim, 3 on-site confirmations from other people on 2+ networks, and a 12-hour window with fewer than 2 on-site disputes |
| Anyone could insert reports that were already `resolved`/`approved` with any vote counts | No direct writes to `reports`; everything goes through checked functions |
| `cleanup_orphaned_photos()` (weekly cron, and callable by anyone) deleted every photo the old page uploaded | Deletes only uploads nothing refers to, older than two days |
| `run_auto_cleanup()` hid resolved reports after 90 days by marking them `rejected` | Reports stay on the record; the map hides resolved reports after 90 days |
| `admin_all_reports`, `analytics_*`, `pending_resolutions` were readable by anyone (all reports, hidden ones included, with reporter hashes) | Closed to the browser |
| `upvote_report`/`flag_report` counts could be inflated without limit | One sighting/flag per person, rate limited |
| Admins could approve a resolution | Moderators can hide content, reject a fake claim or void a fake vote — on the public record — but cannot resolve anything |

Your existing cron jobs keep working. The 2-hourly moderation job now finalises
cleanup claims whose challenge window has ended.

## 2. Turn on anonymous sign-ins (required for v2)

Supabase dashboard → **Authentication → Sign In / Providers → Allow anonymous
sign-ins**. Every browser gets a random ID (no name, email or phone) the first
time it reports, confirms, rates or flags. Without this, v2 actions fail with
"Couldn't start a secure session".

## 3. Cloudflare Turnstile (recommended)

1. Cloudflare dashboard → Turnstile → add a widget for your site's domain(s).
2. Put the **site key** in `config.js` → `TURNSTILE_SITE_KEY`.
3. Supabase → **Authentication → Attack Protection → Enable CAPTCHA protection**
   → provider *Turnstile* → paste the **secret key**.

Do 2 and 3 together: once CAPTCHA is on in Supabase, every sign-in (including
the admin login) needs a token.

## 4. Photo checks with Google Vision (recommended)

```
supabase functions deploy kasa-photo-check
supabase secrets set GOOGLE_VISION_API_KEY=...   # restrict the key to the Vision API
```

Without the Vision key the function still fingerprints photos, so reused photos
are caught. Once you've seen it working, make the check mandatory:

```sql
update kasa_private.settings set value = 'true' where key = 'require_photo_check';
```

## 5. Nearby-report alerts (optional)

```
npx web-push generate-vapid-keys
supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... \
  VAPID_SUBJECT=mailto:grievance@puruliakasa.in KASA_PAGE_URL=https://<your-site>/kasa.html
supabase functions deploy kasa-notify
```

Put the public key in `config.js` → `VAPID_PUBLIC_KEY`. The "Alert me about
reports near me" button appears only when it is set. On iPhones, alerts work
only after "Add to Home Screen".

## 6. Before you rely on the legal pages

- `terms.html`, `privacy.html` and `grievance.html` publish
  **grievance@puruliakasa.in** and **hello@puruliakasa.in**. The grievance
  mechanism only protects you if that inbox exists and is read — check the
  domain and mailboxes, or change the address in all three pages and in
  `config.js` → `GRIEVANCE_EMAIL`.
- These pages were written to match how the system actually works. Have a
  lawyer review them.

## 7. Ward boundaries

`purulia_wards.geojson` is a traced map and has **no boundary for ward 23**
(reports there ask the reporter to pick the ward). Get the current boundaries
from Purulia Municipality or the West Bengal State Election Commission, then:

```
node tools/validate-wards.mjs official_wards.geojson
```

and replace `purulia_wards.geojson` when it passes. Each feature needs a
`ward` property (1–23).

## 8. Check the accountability chains

The "who's responsible" chains (e.g. Conservancy Supervisor → Sanitary
Inspector → Executive Officer → Chairman) are roles under the West Bengal
municipal set-up, not named officers. Check them with someone at the
Municipality and edit the `role_*` / `note_*` strings in `kasa-i18n.js`
(and `CHAINS` in `kasa.js`) if anything differs.

## 9. Moderators

A moderator is any Supabase Auth user listed in `public.admins`. They use
`admin.html` to publish or hide reports, reject fake cleanup claims, void fake
votes, and publish officials' responses (right of reply).

## 10. Evidence photos

Cleanup claims, confirmations and disputes are photographed with the camera
inside the page (no gallery step). If a browser can't open the camera — some
in-app browsers can't — the page lets people choose a photo instead; its
metadata is read on the phone and checked (see migration 3 above). Held photos
appear first in `admin.html` with a **Clear** button; clearing needs a public
reason, like every moderator action.

To refuse anything that isn't from the in-page camera:

```sql
update kasa_private.settings set value = 'true' where key = 'require_live_capture';
```

This blocks people whose browser can't open the camera, so leave it off unless
you see abuse. The metadata is sent by the phone, so it stops careless cheating,
not a determined cheat; the people confirming on the spot are still the real check.

## 11. Tuning

All thresholds live in `kasa_private.settings` (quorum, dispute count,
challenge window, GPS radius and accuracy, rate limits, neighbour-rating
thresholds, the town bounding box…). For example:

```sql
update kasa_private.settings set value = '2' where key = 'verify_quorum';
```

## What is still possible, honestly

Server rules make cheating slow, visible and risky, not impossible. Someone
who prepares several anonymous accounts in advance, uses a GPS-spoofing app
and switches between networks could still fake a cleanup. Every confirmation
photo is public, and anyone on the spot can dispute it for 12 hours. The live
camera and photo-metadata checks catch careless cheating (an old photo, a
photo from elsewhere, an AI-erased pile of garbage), but a phone can be made
to send any metadata. To close this further, require phone-number (OTP)
sign-in for confirmations; that needs an SMS provider and costs money per
message. CAPTCHAs, including free proof-of-work ones, don't help here: they
stop bots, not one person with three phones.

## Tests

```
PGHOST=... PGPORT=... bash supabase/tests/run.sh          # database rules (needs Postgres 16 + psycopg)
npm i --no-save imagescript@1.3.0 jpeg-js@0.4.4 && node --experimental-strip-types supabase/tests/photo_fingerprint.test.mts
node tests/kasa_photo_meta.test.mjs                        # on-phone photo metadata reader
```

All run in GitHub Actions (`.github/workflows/kasa-tests.yml`).
