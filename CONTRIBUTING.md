# Contributing to Parishkar Purulia

Thanks for helping. This repo holds two things: the **Purulia 2040** blueprint pages and **Parishkar**, the civic reporting app (`kasa.html` + `kasa.js`, backed by Supabase). Both are plain HTML, CSS and JavaScript with no build step.

## Ways to help

- **Report a problem with the site** — open an issue with the *Bug report* template.
- **Suggest a feature** — use the *Feature request* template, or the public [suggestions page](https://archiboltmusk.github.io/Purulia/suggest-feature.html).
- **Report a civic problem in Purulia** — use the app itself, not GitHub issues.
- **Security issue** — never open a public issue; follow [SECURITY.md](SECURITY.md).
- **Run it in your own town** — see [DEPLOY.md](DEPLOY.md).

## Running it locally

Any static file server works:

```sh
git clone https://github.com/archiboltmusk/Purulia.git
cd Purulia
python3 -m http.server 8000   # then open http://localhost:8000/kasa.html
```

`config.js` points at the live Supabase project with its **anon (public) key**, which is safe to publish: every rule is enforced in Postgres functions and row-level security. To avoid touching live data while developing, create your own free Supabase project, apply `supabase/migrations/` in name order (see [SETUP-KASA.md](SETUP-KASA.md) §1), and put its URL and anon key in `config.js` locally. Don't commit that change.

## Tests

| What | Command | Needs |
|---|---|---|
| JS syntax | `node --check kasa.js` (and any JS file you touched) | Node 22 |
| Photo metadata reader | `node tests/kasa_photo_meta.test.mjs` | Node 22 |
| Database rules | `PGHOST=localhost PGPORT=5432 bash supabase/tests/run.sh` | Postgres 16, `pip install "psycopg[binary]==3.2.*"` |
| Browser smoke tests | `cd tests/browser && npm ci && npx playwright install chromium && npx playwright test` | Node 22 |

CI (`.github/workflows/kasa-tests.yml`, `browser-tests.yml`) runs the same checks on every pull request.

## Making a change

1. Fork, then branch from `main`.
2. Keep the change focused; one topic per pull request.
3. Front-end change: bump `VERSION` in `sw.js` so phones pick up the new files.
4. Database change: add a **new** timestamped file in `supabase/migrations/`; never edit one that is already live. New functions and tables are private by default, so grant `execute`/`select` only to the roles that need it. Migrations must be safe to re-run.
5. User-visible change: add a line at the top of `changelog.html` in plain words.
6. Open a pull request and fill in the template. A maintainer applies migrations to the live project after merge.

## Things not to touch

- `record/` is an append-only public record written only by `public-record.yml`. Never edit, reorder or delete files in it.
- Only `main` deploys (GitHub Pages via `github-pages.yml`). Don't add other branches to it, don't give `jekyll-gh-pages.yml` a push trigger, and don't create a `gh-pages` branch.
- New files that shouldn't be public must be added to both the `rsync` excludes in `github-pages.yml` and `.assetsignore`.

## Secrets

Never commit a secret. Public-by-design values (Supabase anon key, VAPID public key, WAQI token, Turnstile site key) live in `config.js`. Everything else is a Supabase Edge Function secret; the list is in [RUNBOOK.md](RUNBOOK.md#secrets-supabase--edge-functions--secrets). GitHub secret scanning and push protection are on.

## Style

- Vanilla JS, no frameworks or bundlers. Match the surrounding code.
- Pages must work on low-end Android phones over slow networks.
- Write interface text a Purulia resident would understand; Bengali and Hindi strings live in `kasa-i18n.js`.

## Licence

Code is MIT ([LICENSE](LICENSE)). Report data published by the app is CC BY 4.0 (see `terms.html`). By contributing you agree your contribution is released under these terms.

## Conduct

Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## Maintainers

- [@archiboltmusk](https://github.com/archiboltmusk) — reviews and merges pull requests, applies database migrations, holds the Supabase and GitHub admin access.

How decisions are made and how to become a maintainer: [GOVERNANCE.md](GOVERNANCE.md). The project is looking for a second maintainer; if that could be you, say so in an issue.
