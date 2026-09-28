## Response Style
- Deliver minimal, direct answers without conversational filler or post-execution summaries.
- Return targeted diffs or minimal code snippets instead of full-file rewrites.
- Ask targeted clarifying questions only when critical ambiguity blocks execution.

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
