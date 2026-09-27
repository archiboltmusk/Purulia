## Summary

<!-- What changed and why, in a few bullets. -->

-

## Test plan

<!-- What you actually ran/checked, as a checklist. Delete lines that don't apply. -->

- [ ] `node --check` on edited JS files
- [ ] Ran the relevant test suite (`supabase/tests/run.sh`, `tests/*.test.mjs`) and it passes
- [ ] Checked the change in a browser (note any part you couldn't test, e.g. blocked network)
- [ ] Database migration applied to the live project, and live function signatures checked against what the pages call
- [ ] Added a `changelog.html` entry (skip only for internal-only changes: CI, refactors, config)
