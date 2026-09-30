# Parishkar Bengal

[![Live Site](https://img.shields.io/badge/live-site-brightgreen)](https://archiboltmusk.github.io/Purulia/)

> *This is not a complaint. It is a claim to dignity.*

Parishkar Bengal is a civic website for West Bengal: report a broken street, drain, tap or heap of garbage with a live photo, see who is responsible for it, and follow whether it gets fixed. It began in Purulia as Parishkar Purulia and is now open across the state.

**Live:** [archiboltmusk.github.io/Purulia](https://archiboltmusk.github.io/Purulia/) · report map: [kasa.html](https://archiboltmusk.github.io/Purulia/kasa.html) · mirror: [purulia.vercel.app](https://purulia.vercel.app/)

---

## The goal

To hold a mirror to West Bengal, starting with Purulia: not to shame it, but to awaken it.

- **Trace the circle.** Health, schooling, work, water and roads fail together: a mother lost to a preventable death, a girl pulled from school, a father who migrates because the land cannot feed his children, a village waiting for water. The site shows how each sector pulls the next one down.
- **Name who promised.** The Centre, the state, the district, the block and the panchayat. Ask each, with evidence and dignity, why the gap between announcement and reality keeps growing.
- **Build a blueprint, not just a record.** A plan for self-reliance built on the state's own resources and people, where every starting figure is sourced and every proposal is marked as ours.

Two rules hold everywhere on the site:

1. **Only authentic, cited data.** No placeholder or unsourced figures.
2. **Reports need a live camera photo and real GPS.** No gallery uploads, no dropping a pin by hand.

---

## What is on the site today

### Report map (`kasa.html`)
- Report a civic problem with a live photo and GPS. Each report gets a deadline by severity and is routed to the office responsible.
- A report closes only when someone takes a new live photo at the spot (within 50 metres) showing it fixed.
- Works in English, Bengali, Hindi and Santali (Ol Chiki); works offline and queues reports until a connection returns; push alerts for a watched area.
- The whole state is on the map: district outlines, every block and gram panchayat, Purulia and Kolkata wards, and other towns' wards as they are added.
- Tap any district, block, gram panchayat or ward to see its open reports, its MLA and MP, and its officials (DM, Zilla Parishad officer, BDO) with what each tier is legally responsible for under the West Bengal Panchayat Act, 1973.
- Leader profiles for every West Bengal minister, MLA and MP, with MPLADS works for MPs.
- Anyone can suggest a missing official or a wrong ward border; moderators check it before it goes live.

### Accountability and research pages
- **Promises** (`promises.html`) tracks sourced promises by named leaders; **Noticeboard** (`noticeboard.html`) puts public demands to them.
- **The Circle** (`circle.html`) and **district pages** show how sectors connect, using NFHS-5, Census 2011, UDISE+ and Jal Jeevan Mission figures.
- **Schools** (`schools.html`) compares schools with state and national figures; anyone can check a school with a live photo.
- **Ward pages**, a weekly **ward digest** with email sign-up, public **analytics**, **Adopt-a-Spot** for shops, clubs and ward offices, and **Communities** for volunteer groups.
- **Blueprint** (`blueprint.html`): the self-reliance plan, starting from official figures.
- **Add a town** (`add-town.html`): upload or draw ward maps for any town; moderators approve them.

### Trust
- Every report and change is reviewed through a moderator queue (`admin.html`).
- A daily tamper-evident fingerprint of all public data is published in [`record/`](record/README.md).
- Report data is published under CC BY 4.0.

---

## What's next

The full, current plan is the **What's next** section at the top of [changelog.html](https://archiboltmusk.github.io/Purulia/changelog.html#next), tagged Done, Being built, Waiting on an RTI, or Planned. In short:

- **Health:** health-centre checks (doctor present, medicines, water, toilet) with a live photo, like school checks; maternal deaths by block and cause, asked for by RTI.
- **Schools:** each school's official UDISE+ record beside residents' checks; dropout figures once the data arrives.
- **Work and migration:** rural-jobs worksite checks against each work's geotagged record; migrant registrations by block, asked for by RTI.
- **Water:** report a tap that is fitted but gives no water, sent to the public health engineering office.
- **Naming who promised:** a dated verdict on each promise (in progress, delivered or broken), shown only with proof; DISHA committee minutes published.
- **Statewide:** more town ward maps from contributors, and officials and leaders filled in for every district.
- **Blueprint:** recheck every starting figure against its source each year; publish days pending on Silpasathi applications.
- **Keeping it going:** Bengali and Hindi on every page, a second admin, and ward drives with college NSS and NCC units.

No dates are given where nobody has committed to one.

---

## Running it

A static site: plain HTML, CSS and JavaScript, no build step. The backend is Supabase (Postgres RPCs and edge functions).

```bash
git clone https://github.com/archiboltmusk/Purulia.git
cd Purulia
python3 -m http.server 8000   # then open http://localhost:8000/
```

- **Map of the code:** [CLAUDE.md](CLAUDE.md) lists every page, shared module, table, RPC and tool.
- **Backend:** `supabase/migrations/` (database), `supabase/functions/` (edge functions), `supabase/tests/`.
- **Deploy:** pushing to `main` publishes to GitHub Pages and Vercel; a Cloudflare worker serves share previews. See [DEPLOY.md](DEPLOY.md) and [RUNBOOK.md](RUNBOOK.md).
- **Run it in your own town:** see [DEPLOY.md](DEPLOY.md); Purulia-specific settings live in `city.js`, other towns in `places.js`.

---

## Contributing

Contributions are welcome: code, ward maps, officials' contacts, sourced data, and translations. Start with [CONTRIBUTING.md](CONTRIBUTING.md) and follow the [Code of Conduct](CODE_OF_CONDUCT.md). Report security problems privately as described in [SECURITY.md](SECURITY.md). How the project is run: [GOVERNANCE.md](GOVERNANCE.md).

## Licence

Code: [MIT](LICENSE). Report data published by Parishkar: CC BY 4.0 (see `terms.html`).
