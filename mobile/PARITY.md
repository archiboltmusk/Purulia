# Website ↔ app parity

What the website does, and where the app stands. **Native** = built in the app. **In-app web** = the app's More menu opens the site page in the in-app browser (the site's own code and server rules). **Planned** = the batch that turns it native.

Report sheet wording comes from `kasa-i18n.js` through `src/siteText.ts` (regenerate with `node scripts/site-text.mjs`).

Rules that hold for every batch: reports and evidence need a live camera photo and real GPS (no gallery, no map pin); only cited, server-held data is shown; no server limit is loosened for the app.

## Report app (`kasa.html`)

| Feature | Website | App now | Planned |
|---|---|---|---|
| New report: live photo + GPS + category + note | ✓ | Native | — |
| Offline queue, retry when online | ✓ (service worker) | Native (SQLite + background task) | — |
| Server error wording en/bn/hi | ✓ | Native | — |
| Result: duplicate / recurrence / moderation | ✓ | Native | — |
| Public works warranty near the spot (`kasa_report_warranty`) | ✓ | Native (result card) | — |
| Sub-type picker ("What's the problem?", `ISSUE_GROUPS`) | ✓ | Native (`src/issues.ts`) | — |
| Extra photos on a report (`kasa_add_report_photo`) | ✓ | Native (2 more live photos, queued offline too) | — |
| Recent reports list, flag, hide | ✓ | Native | — |
| Report sheet: photos, timeline, replies, dockets, warranty | ✓ | Native (`ReportSheet`); who's responsible opens the web sheet | Batch 4 for the tree |
| "I saw it too" (`kasa_mark_seen`), rate (`kasa_rate_report`) | ✓ | Native | — |
| Cleanup claim / verify / dispute with live photo | ✓ | Native (`EvidenceCamera`, radius + GPS checked before send) | — |
| Filed officially: add docket number | ✓ | Native | — |
| Share report link | ✓ | Native (share sheet, worker `/r/<id>` link) | — |
| Map: report dots, district + assembly-seat outlines | ✓ | Native (`MapScreen`, MapLibre, same basemap + files as the site) | — |
| Map: wards, blocks, GPs, India layers | ✓ | In-app web (area card → full place card) | Later |
| Area card: district, MLA, MP with cited sources | ✓ | Native (tap a place on the map) | — |
| Area card: officials, duties, "add who's responsible" | ✓ | In-app web (full place card link) | Later |
| Leader profiles, MPLADS works, `?rep=` links | ✓ | In-app web | Later |
| Cleanup drives | Removed from the site 2026-10-08 | — | — |
| School check (UDISE, six answers, live photo) | ✓ | In-app web (More → At this spot) | Later (block/school search + fix flows) |
| Snake sighting / rescuer sign-up | ✓ | Native (`SpotForm`: live photo, rescuers with call/WhatsApp) | — |
| Dog feeding spot | ✓ | Native (`SpotForm`) | — |
| Swachh Pandal | ✓ | Native (`SpotForm`) | — |
| Public works board (live board photo) | ✓ | Native (`SpotForm`) | — |
| Adopt a spot | ✓ | Native (`SpotForm`) | — |
| Nearby alerts / watch a report (web push) | ✓ | — | Batch 5 (native push) |
| Translation fix, source correction, bug report | ✓ | In-app web | Batch 5 |

## Other pages

All open from **More** in the in-app browser: ward, districts, ground truth (data), works, promises, noticeboard, municipality, analytics, digest, schools, toilets, waste, snakes, dogs, pandals, adopt, communities, routes, Ask Parishkar, add a town, suggest a feature, join, circle, blueprint, methodology, rules, privacy, terms, grievance, what's new. Static reading pages stay web; interactive ones move native in the batches above when a native screen is better than the page.

Admin (`admin.html`) stays web-only.
