# Run Parishkar in your own town

Parishkar is a free, open civic reporting app: people photograph a problem, it lands on a public map, and it is only marked fixed when neighbours on the spot confirm it with their own live photos. This guide is for a local civic group or municipal body that wants to run it for another town or district.

You need: a GitHub account, a free [Supabase](https://supabase.com) project, and someone comfortable pasting SQL. No server to run. Budget a day for the first setup.

`SETUP-KASA.md` has the detail behind each database step; this page is the order to do things in and everything that is specific to Purulia.

## 1. Copy the code

1. Fork this repository.
2. In your fork, **empty the `record/` folder** (it is Purulia's public fingerprint record) and delete `.github/workflows/public-record.yml` until your own database is live.
3. Pick hosting (both free):
   - **GitHub Pages:** Settings → Pages → Source: GitHub Actions. `.github/workflows/github-pages.yml` deploys `main`.
   - **Cloudflare Workers:** connect the fork in the Cloudflare dashboard; `wrangler.jsonc` and `.assetsignore` are already set up. Change `"name"` in `wrangler.jsonc` to your project's name.

Both leave out `supabase/`, `tests/`, `tools/`, `*.md` and the internal documents. If you add private files, add them to both `.assetsignore` and the `rsync` excludes in `github-pages.yml`.

## 2. Database

1. Create a Supabase project. Put its URL and anon (public) key in `config.js`, and set `GRIEVANCE_EMAIL`.
2. Apply every file in `supabase/migrations/`, in name order (`SETUP-KASA.md` §1).
3. Create the ward table and fill in your councillors:

   ```sql
   create table if not exists public.wards (
     ward_no         integer primary key,
     councillor_name text not null,
     party           text not null,
     created_at      timestamptz default now()
   );
   alter table public.wards enable row level security;
   create policy wards_public_read on public.wards for select using (true);
   insert into public.wards (ward_no, councillor_name, party) values
     (1, 'Name', 'Party'), (2, 'Name', 'Party');  -- one row per ward
   ```

4. Set the area reports must fall inside (the server rejects anything outside it):

   ```sql
   update kasa_private.settings
   set value = '{"min_lat":0,"max_lat":0,"min_lng":0,"max_lng":0}'
   where key = 'bbox';
   ```

5. Turn on anonymous sign-ins, Turnstile and Google Vision photo checks (`SETUP-KASA.md` §2–4).
6. Make yourself the first admin. Sign in once on `admin.html` with an email account created in Supabase → Authentication, then:

   ```sql
   insert into public.admins (user_id, role)
   select id, 'admin' from auth.users where email = 'you@example.org';
   ```

   Add moderators afterwards from the Team section of `admin.html`.

## 3. Boundaries

Replace the two boundary files, keeping their names:

| File | What | Each feature needs |
|---|---|---|
| `purulia_wards.geojson` | Town wards | a `ward` property (number) |
| `purulia_blocks.geojson` | Rural blocks / villages around the town | a `block` property (name) |

Get ward boundaries from your municipality or State Election Commission; block outlines can come from OpenStreetMap (ODbL, credit it). Check the wards with `node tools/validate-wards.mjs purulia_wards.geojson`, then load them into the database:

```
python3 tools/build-areas.py > areas.sql
```

and run `areas.sql` in the Supabase SQL editor. It replaces Purulia's areas.

### Schools (optional)

Ask the district education office (Samagra Shiksha District Project Office, or the DI of Schools) for the UDISE+ school list with latitude and longitude, and save it as CSV. Then:

```
python3 tools/load-schools.py schools.csv > schools.sql
```

and run `schools.sql` in the Supabase SQL editor. Rows with a bad UDISE code or a location outside your district are skipped and listed. Re-run with a newer list any time; it updates schools by UDISE code. `kasa_school_coverage()` then shows which schools have been audited.

## 4. `city.js` — your town's details

Everything local the app shows lives in `city.js`: town name, map centre and zoom, the municipality's WhatsApp number and email, the MLA's X handle, your MLA / MP / municipal chairperson (with photos in `reps/` — only use photos whose licence allows it), and the official complaint channels under "Take it further" (state helpline, power utility, RTI portal). Leave a channel empty to hide it.

## 5. Words and rules

- **Text:** search for `Purulia` in `kasa-i18n.js`, `kasa.html`, `analytics.html`, `methodology.html`, `rules.html`, `terms.html`, `privacy.html`, `grievance.html` and `changelog.html`, and replace it. `kasa-i18n.js` has English, Bengali and Hindi; add or remove languages there.
- **Who is responsible:** `CATEGORIES` and `CHAINS` in `kasa.js` name West Bengal's departments and officers for each kind of problem. Check them against your state (`SETUP-KASA.md` §8).
- **Legal pages:** name a real Grievance Officer and read `SETUP-KASA.md` §6 before launch.
- **`changelog.html`:** clear the entries and start your own.

## 6. Before you launch

- [ ] Report a test problem from a phone, standing inside your area. It should appear on the map in the right ward.
- [ ] A report from outside `bbox` is refused.
- [ ] The test report shows up in `admin.html` when flagged, and you can hide it.
- [ ] `analytics.html` loads, including the moderation counts.
- [ ] `/supabase/` and `/README.md` return "not found" on your live site.
- [ ] Delete the test report.

## Keeping up with this repository

Improvements land here first. To take them, merge this repository's `main` into your fork; `city.js`, the boundary files and your `config.js` are yours and won't normally conflict. New database changes arrive as new files in `supabase/migrations/` — apply each one once, in order. `changelog.html` here lists what changed.
