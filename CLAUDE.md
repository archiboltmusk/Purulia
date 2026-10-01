## Response Style
- Deliver minimal, direct answers without conversational filler or post-execution summaries.
- Return targeted diffs or minimal code snippets instead of full-file rewrites.
- Ask targeted clarifying questions only when critical ambiguity blocks execution.

# Map (read this first; open only the files it points to)

Static HTML/JS site, no build step, no framework. Backend = Supabase (Postgres RPCs + edge functions). Brand: "Parishkar Bengal"; map open for all West Bengal.

## Pages (`page.html` -> its own `page.js` unless noted)
- `kasa.html` + `kasa.js` (~4.6k lines) — the report app: map, list, new report (live camera + GPS), report sheet, cleanup claims, school check, push alerts. Section index: `grep -A1 '^/\* ═' kasa.js`. Styles `kasa.css`; strings `kasa-i18n.js`.
- `admin.js` / `admin.html` — moderation queues (reports, photos, claims, duplicates, bugs, places, schools, demands, promises, team roles).
- `index.html`, `data.html`, `blueprint.html`, `join.html` — landing + static research pages; share `script.js` + `styles.css`.
- `ward.html` (ward page), `analytics.html` (public transparency; office letters via `kasa_office_letters_public`), `digest.html` (weekly ward digest + subscribe), `schools.html`, `toilets.html`, `waste.html`, `adopt.html` (Adopt-a-Spot), `communities.html`, `noticeboard.html` (demands to leaders), `promises.html`, `add-town.html` (ward map editor: upload/draw, JPG/PNG trace background, reshape, ward name/notes, GeoJSON download; `?fix=<slug|purulia>&ward=<n>` from ward cards/ward page, `?fix=area&level=&district=&block=&gp=` from place cards, fixes or note+pin to moderators via `kasa_submit_place`), `suggest-feature.html`.
- Static text only: `circle.html`, `municipality.html` (use `page-lang.js` + `<page>-i18n.js`), `methodology.html`, `rules.html`, `grievance.html`, `privacy.html`, `terms.html`, `changelog.html`, `poster.html`.
- Redirect stubs only (don't add features): `map.html`, `audience.html`, `digest-subscribe.html`, `suggestions.html`, `app/index.html`.
- `og-card.html` — OG image source, not published.

## Shared modules
- `config.js` — `window.KASA_CONFIG` (Supabase URL, anon key, Turnstile, share URL). Public keys only.
- `city.js` — everything Purulia-specific (names, boundary files, reps). `places.js` — other towns (`places/*_wards.geojson`) + district fallback (`places/wb_districts.geojson`).
- `categories.js` — report categories; mirrors `categories.yaml` (no generator in repo, keep both in sync).
- `bug-report.js` — "Report a bug" button on every page (load early, no defer).
- `translate-fix.js` — "অনুবাদ ঠিক করুন" toggle (Bengali only; kasa drawer / next to page-lang switch): tap Bengali text → `kasa_suggest_translation` → `kasa_private.translation_suggestions` → admin `kasa_admin_translation_queue`/`kasa_admin_review_translation` → public `kasa_translations()` patches `KASA_I18N.bn` (ns `kasa`) / `PAGE_I18N.bn` (ns = page name). Load after the dictionaries.
- `page-lang.js` — bn/hi for static pages via `data-t` keys. `digest-sheet.js`/`.css` — digest sign-up banner.
- `kasa-photo-meta.js` — EXIF time/GPS/AI-marker reader. `version.js` — generated, see Changelog.
- `sw.js` — service worker (offline queue, push). Bump `VERSION` when cached files change.
- `worker.js` + `wrangler.jsonc` — Cloudflare worker: `/r/<id>` share previews.
- Boundaries: `purulia_wards|blocks|gps|towns.geojson`, `WEST BENGAL_*.geojson` (raw source files).
- `places/wb/<district>.geojson` + `index.json` — blocks + gram panchayats for every WB district except Purulia/Kolkata (from the raw villages file, `tools/build-wb-local.py`); kasa.js lazy-loads each district in view from zoom 8. District outlines (`places/wb_districts.geojson`) draw statewide. `places/wb_blocks.geojson` (same script, `--blocks`) = all blocks at ~300 m, lines + names below zoom 8, styled like Purulia's.
- `places/wb_leaders.json` (MLA/MP per seat, Wikipedia results) + `places/wb_assembly.geojson` (294 AC outlines) — `tools/build-wb-leaders.py`; kasa.js area card (tap any district/block/GP, `?at=lat,lng,zoom` share links).
- `places/wb_towns.geojson` — every WB municipality/corporation outside Kolkata and Purulia: AMRUT GIS limits (56) or a Wikipedia-coordinate dot (59), 2022 SEC ward counts (`tools/build-wb-towns.py`). The 50 with AMRUT ward maps are also server places (migration `20260930160000_kasa_wb_towns.sql`), so ward taps/report filing use the normal place code. Area card level `town`; towns with no ward map link to add-town.html `?town=&body=&district=`.
- `places/wb_ministers.json` (ministers + departments, Wikipedia) + `places/wb_mplads.json` (MPLADS summary per MP) + `places/mplads/<pc-N|rs-name>.json` (works lists) — `tools/build-wb-reps.py`; kasa.js leader profiles (`findRep`, keys `ac:N`/`pc:N`/`rs:i`/`min:i`, Purulia keeps `mla:`/`mp:`), statewide search in the reps section, `?rep=<key>` share links.
- `places/wb_district_facts.json` — per-district sourced facts (Wikidata/Census 2011, Wikipedia lead, NFHS-5+4, JJM tap water, NITI aspirational) from `tools/build-wb-district-facts.py`, refreshed monthly by `refresh-place-data.yml` (commits to main). `place-facts.js` = chosen district (`?d=<slug>`, else map's `parishkar_place`, else Purulia) + loader/rank helpers; `data-place.js` renders data.html from it, `home-place.js` the index.html hero, ticker and numbers, `circle-place.js` the circle.html steps (hand cards/sections with `data-only="<slug>"`); `PF.towns()`/`PF.bodies(slug)` (municipalities, for RTI pickers) and `PF.reportFilter(slug)` (reports by `place`) drive toilets/waste/analytics; `PF.reps(slug)` (MPs/MLAs from `wb_assembly`+`wb_leaders`), `PF.textFilter(slug)`/`PF.statewide` (free-text area → district) drive promises/noticeboard; `municipality-place.js` renders municipality.html outside Purulia. Use these for any page that should follow the place.
- `places/wb_officials.json` — DM, Zilla Parishad ADM and BDOs (phone/email) per district from each district site's Who's Who (`tools/build-wb-officials.py`; unreachable sites keep old entries). Area card also shows each tier's duties from the WB Panchayat Act 1973.
- `places/councillors/<slug>.json` — ward councillors per WB town from the SEC results portal (portal.wbme.org; 2022 + by-elections, `tools/build-wb-councillors.py`); kasa.js `councillorsOf` falls back to it when places.js names no `councillors` file. Dissolved boards get a cited `board` note.
- "Add who's responsible here" on the area card: `kasa_submit_official` (anyone, cited link) → `kasa_private.official_suggestions` → admin `kasa_admin_official_queue`/`kasa_admin_review_official` → public `kasa_officials(district)`.

## Supabase (`supabase/`)
- Public tables: `reports`, `schools`, `promises`, `promise_news`, `demands` (+`_supports`, `_replies`), `digest_subscribers`, `feature_suggestions`, `bug_reports`, `admins`. Everything else is in schema `kasa_private` (votes, flags, claims, photos, places, areas, adoptions, communities, settings…), reached only through `security definer` RPCs and `kasa_public_*` views.
- Pages call RPCs named `kasa_*` (`kasa_admin_*` = moderator-only, checked server-side). Find callers: `grep -n "rpc('kasa_x'" *.js`; definition: `grep -ln 'function public.kasa_x' supabase/migrations`, newest file wins.
- Edge functions `supabase/functions/<name>/index.ts` (first line says what it does): photo check/token/shrink/cleanup, geocode, notify + notify-watch, flag/bug alerts, weekly digest/pattern, office letters, promise news, team invite, unsubscribe, p2040 signup alert.
- New migration: `supabase/migrations/<YYYYMMDDHHMMSS>_kasa_<what>.sql`, idempotent (`create or replace`, `if not exists`); tests run every migration twice.

## Tests (CI: `kasa-tests.yml`, `browser-tests.yml`)
- DB: `bash supabase/tests/run.sh` (needs local Postgres; PGHOST/PGPORT) — applies all migrations to legacy + fresh DBs, then `test_migration.py`.
- JS syntax: `node --check <file>.js`. Photo meta: `node tests/kasa_photo_meta.test.mjs`. Version: `node tools/version.mjs --check`.
- Browser: `cd tests/browser && npm ci && npx playwright test` (Supabase mocked in `fixtures.mjs`).
- New `.js` file: add it to the `node --check` list and `paths:` in `kasa-tests.yml`.

## Tools (`tools/`)
`build-areas|build-districts|build-local-bodies|build-places|build-wb-local|build-wb-leaders.py` boundary -> geojson/SQL; `build-wb-officials.py` district officers; `build-wb-reps.py` ministers + MPLADS; `validate-wards.mjs` checks ward GeoJSON; `load-schools.py`, `udise-benchmarks.py` school data; `load-wb-schools.sql` (Supabase SQL editor, pg_net) loads every WB school from India Data Portal's UDISE+ list into `schools` (`district` slug from the UDISE code; `kasa_school_coverage(p_district)`, `kasa_school_blocks(p_district)`); `public-record.mjs` daily record; `keep-if-changed.py` drops date-only or shrunken data rebuilds (monthly `refresh-place-data.yml` also reruns officials, councillors, reps/MPLADS); `db-backup.yml` weekly also backs up report photos; `version.mjs` version badge.

## Deploy targets
GitHub Pages (main, `github-pages.yml`); Vercel purulia.vercel.app (main, `vercel.json`); Cloudflare worker (share previews). Longer docs: `DEPLOY.md`, `RUNBOOK.md`, `SETUP-*.md` (read only when needed).

# Project rules
- Only authentic, cited source data on the site. No placeholder or unsourced figures.
- Reports need a live camera photo AND real GPS. No gallery upload, no manual map-pin fallback.
- One entry point per feature per page; don't repeat buttons/features across places.
- Keep the report map page clean (Namma Kasa style).
- After merging a migration, apply it to live Supabase and verify (merged ≠ applied).
- New page, table, RPC or edge function: add one line to this file.

# Deployment rules

- GitHub Pages deploys only from `main`, via `.github/workflows/github-pages.yml` (the static site; `*.md`, `tools/`, `supabase/`, `tests/` and `og-card.html` are not published). The report app is `kasa.html` + `kasa.js`; `/app/` only redirects there. The `github-pages` environment rejects every other branch, so never add another branch to its `on.push.branches`.
- `jekyll-gh-pages.yml` is manual-only; don't give it a push trigger (two Pages deploys race and one overwrites the other).
- Don't create or push a `gh-pages` branch; Pages uses GitHub Actions, not a branch.
- Database changes go in `supabase/migrations/` and must also be applied to the live project; check the live function signatures match what the pages call.
- `record/` is an append-only public record written by `.github/workflows/public-record.yml`. Never edit, reorder or delete anything in it; only the workflow adds files.

# Changelog

- Every user-visible change adds a line at the top of `changelog.html` (newest date first, plain words a reporter would use). Internal-only changes (CI, refactors, config) don't need one.
- After editing `changelog.html`, run `node tools/version.mjs` and commit `version.js` (the version badge on the report map: v1.<dated sections>.<entries on the newest day>). CI fails if it is out of date.

# Pull requests

- Merge your own PRs once every check has passed; don't wait to be asked. If a check fails, fix it first; if you can't, leave the PR open and say why.
