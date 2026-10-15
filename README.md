# Parishkar

[![Live Site](https://img.shields.io/badge/live-site-brightgreen)](https://archiboltmusk.github.io/Purulia/)

Parishkar is a civic website for all of India. A resident reports a civic problem at a place with a live photo and GPS; the report is routed to the office responsible and stays open until someone takes a new photo of the spot showing it fixed. Records of public data (officials, leaders, schools, districts, promises) sit alongside it, each figure with its source.

West Bengal and Purulia are the first test bed: the most detailed data is there, and each feature is built so it can be applied to any district or town in India.

**Live:** [archiboltmusk.github.io/Purulia](https://archiboltmusk.github.io/Purulia/) · report map: [kasa.html](https://archiboltmusk.github.io/Purulia/kasa.html) · mirror: [purulia.vercel.app](https://purulia.vercel.app/)

---

## Rules

1. **Only authentic, cited data.** Every figure has a source. No placeholder, estimated or unsourced numbers.
2. **Reports need a live camera photo and real GPS.** No gallery uploads and no manual map pin. The server places each report from its GPS point.

---

## Finding a place

- **Report map (`kasa.html`):** the whole of India is on the map. Tap a state, district, block, gram panchayat or ward to open its area card: open reports, MLA and MP, officials, and what each tier is responsible for.
- **Share a view:** `kasa.html?at=<lat>,<lng>,<zoom>`.
- **Data pages** (`data.html`, `circle.html`, `municipality.html`, `promises.html`, `noticeboard.html`): pick a district with `?d=<district-slug>`; otherwise the page uses the district chosen on the map, then Purulia.
- **Reports outside West Bengal:** placed by `kasa_private.locate_india` from the district outlines in `places/in/`.
- **Towns without a ward map:** `add-town.html` takes a ward map upload or drawing; moderators approve it before it goes live.

---

## Where the data comes from

Every dataset below is produced by a script in `tools/`. Do not edit the output files by hand; change the script or its source and re-run it.

| Data | Files | Built by | Refreshed |
| --- | --- | --- | --- |
| State, district and seat outlines, all India | `places/in_states.geojson`, `places/in/` | `tools/build-in-map.py` | by hand |
| Town ward maps, all India (SBM Urban GIS) | `places/in/wards/`, `places/in/towns.json` | `tools/build-in-wards.py` | by hand |
| West Bengal blocks, GPs, districts | `places/wb/`, `places/wb_districts.geojson` | `tools/build-wb-local.py` | by hand |
| West Bengal towns (AMRUT limits, SEC ward counts) | `places/wb_towns.geojson` | `tools/build-wb-towns.py` | by hand |
| District facts (Census 2011, NFHS-5, JJM, NITI) | `places/wb_district_facts.json` | `tools/build-wb-district-facts.py` | monthly |
| District officers (DM, ADM, BDO) | `places/wb_officials.json` | `tools/build-wb-officials.py` | monthly |
| Town councillors (SEC results portal) | `places/councillors/` | `tools/build-wb-councillors.py` | monthly |
| Ministers, MPLADS | `places/wb_ministers.json`, `places/wb_mplads.json`, `places/mplads/` | `tools/build-wb-reps.py` | monthly |
| MLA and MP affidavits (ADR/MyNeta) | `places/wb_affidavits.json` | `tools/build-wb-affidavits.py` | monthly |
| MLAs and MPs (Wikipedia results) | `places/wb_leaders.json`, `places/wb_assembly.geojson` | `tools/build-wb-leaders.py` | by hand |
| MP work in Lok Sabha (PRS) | `places/wb_record.json` | `tools/build-wb-record.py` | by hand |
| Other states' MLAs and MPs | `places/in/*.geojson` | `tools/build-in-map.py` | by hand |
| School data (UDISE+) | Supabase `schools` | `tools/load-wb-schools.sql`, `tools/load-schools.py` | by hand |
| God's-eye live readings (weather, AQI, fires) | `places/godseye.json` | `tools/build-godseye.py` | every 12 h |
| State finances (RBI, CAG, MPLADS) | `places/money.json` | `tools/build-money.py` | by hand |
| Daily public-data fingerprint | `record/` | `tools/public-record.mjs` | daily |

- Monthly rebuilds run in `.github/workflows/refresh-place-data.yml`; `tools/keep-if-changed.py` drops rebuilds that only change the date or shrink the file.
- The public record (`record/`) is append-only and written only by `.github/workflows/public-record.yml`.
- Source-data policy and the method for each figure: `methodology.html`.

---

## Running it

A static site: plain HTML, CSS and JavaScript, no build step. The backend is Supabase (Postgres RPCs and edge functions).

```bash
git clone https://github.com/archiboltmusk/Purulia.git
cd Purulia
python3 -m http.server 8000   # then open http://localhost:8000/
```

- **Code map:** [CLAUDE.md](CLAUDE.md) lists every page, shared module, table, RPC and tool.
- **Backend:** `supabase/migrations/` (database; idempotent, applied to the live project after merge), `supabase/functions/` (edge functions), `supabase/tests/` (`bash supabase/tests/run.sh`).
- **Tests:** `node --check <file>.js`; `node tests/kasa_photo_meta.test.mjs`; `cd tests/browser && npm ci && npx playwright test`.
- **Deploy:** pushing to `main` publishes to GitHub Pages (`.github/workflows/github-pages.yml`) and Vercel (`vercel.json`). A Cloudflare worker (`worker.js`, `wrangler.jsonc`) serves share previews.
- **Run it for another town or district:** [DEPLOY.md](DEPLOY.md). Purulia-specific settings are in `city.js`; other towns in `places.js`.
- **Operations:** [RUNBOOK.md](RUNBOOK.md); database setup: [SETUP-KASA.md](SETUP-KASA.md).

---

## Contributing

Code, ward maps, officials' contacts, sourced data and translations are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md) and follow the [Code of Conduct](CODE_OF_CONDUCT.md). Report security problems privately as described in [SECURITY.md](SECURITY.md). Governance: [GOVERNANCE.md](GOVERNANCE.md).

## Licence

Code: [MIT](LICENSE). Report data published by Parishkar: CC BY 4.0 (see `terms.html`).
