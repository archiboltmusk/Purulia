# Deployment rules

- GitHub Pages deploys only from `main`, via `.github/workflows/github-pages.yml` (static site + `kasa-app` build at `/app/`). The `github-pages` environment rejects every other branch, so never add another branch to its `on.push.branches`.
- `jekyll-gh-pages.yml` is manual-only; don't give it a push trigger (two Pages deploys race and one overwrites the other).
- Don't create or push a `gh-pages` branch; Pages uses GitHub Actions, not a branch.
- Database changes go in `supabase/migrations/` and must also be applied to the live project; check the live function signatures match what the pages call.
- `record/` is an append-only public record written by `.github/workflows/public-record.yml`. Never edit, reorder or delete anything in it; only the workflow adds files.
