# Website ↔ app parity

What the website does, and where the app stands. **Native** = built in the app. **In-app web** = the app's More menu opens the site page in the in-app browser (the site's own code and server rules). **Planned** = the batch that turns it native.

Rules that hold for every batch: reports and evidence need a live camera photo and real GPS (no gallery, no map pin); only cited, server-held data is shown; no server limit is loosened for the app.

## Report app (`kasa.html`)

| Feature | Website | App now | Planned |
|---|---|---|---|
| New report: live photo + GPS + category + note | ✓ | Native | — |
| Offline queue, retry when online | ✓ (service worker) | Native (SQLite + background task) | — |
| Server error wording en/bn/hi | ✓ | Native | — |
| Result: duplicate / recurrence / moderation | ✓ | Native | — |
| Public works warranty near the spot (`kasa_report_warranty`) | ✓ | Native (result card) | — |
| Sub-type picker ("What's the problem?", `ISSUE_GROUPS`) | ✓ | 7 top categories | Batch 2 |
| Extra photos on a report (`kasa_add_report_photo`) | ✓ | — | Batch 2 |
| Recent reports list, flag, hide | ✓ | Native | — |
| Report sheet: photos, timeline, replies, dockets, warranty | ✓ | In-app web | Batch 2 |
| "I saw it too" (`kasa_mark_seen`), rate (`kasa_rate_report`) | ✓ | In-app web | Batch 2 |
| Cleanup claim / verify / dispute with live photo | ✓ | In-app web | Batch 2 |
| Filed officially: add docket number | ✓ | In-app web | Batch 2 |
| Share report link | ✓ | In-app web | Batch 2 |
| Map with wards, blocks, GPs, districts, India layers | ✓ | In-app web | Batch 4 (MapLibre native) |
| Area card: leaders, officials, duties, "add who's responsible" | ✓ | In-app web | Batch 4 |
| Leader profiles, MPLADS works, `?rep=` links | ✓ | In-app web | Batch 4 |
| Cleanup drives banner, "I'm coming" | ✓ | In-app web | Batch 3 |
| School check (UDISE, six answers, live photo) | ✓ | In-app web | Batch 3 |
| Snake sighting / rescuer sign-up | ✓ | In-app web | Batch 3 |
| Dog feeding spot | ✓ | In-app web | Batch 3 |
| Swachh Pandal | ✓ | In-app web | Batch 3 |
| Public works board (live board photo) | ✓ | In-app web | Batch 3 |
| Nearby alerts / watch a report (web push) | ✓ | — | Batch 5 (native push) |
| Translation fix, source correction, bug report | ✓ | In-app web | Batch 5 |

## Other pages

All open from **More** in the in-app browser: ward, districts, ground truth (data), works, promises, noticeboard, municipality, analytics, digest, schools, toilets, waste, snakes, dogs, pandals, adopt, communities, routes, Ask Parishkar, add a town, suggest a feature, join, circle, blueprint, methodology, rules, privacy, terms, grievance, what's new. Static reading pages stay web; interactive ones move native in the batches above when a native screen is better than the page.

Admin (`admin.html`) stays web-only.
