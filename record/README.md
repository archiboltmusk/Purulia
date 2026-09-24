# Purulia Kasa public record

Every day a scheduled job fingerprints every public report, event and reply on Purulia Kasa and adds one file here. It stores fingerprints (SHA-256), not the reports themselves, so content can still be taken down, but no past day can be changed without it showing.

- `YYYY/YYYY-MM-DD.txt`: one line per public row: `<kind> <id> <sha256>`.
- `MANIFEST.txt`: one line per day: `<date> <sha256 of that day's file> <rows> <previous entry> <this entry>`. Each entry includes the one before it, so changing any past day breaks every later entry.
- Each day's files are also sent to the Internet Archive (web.archive.org), an independent timestamp outside this repository.

## Check it yourself

Requires Node.js 20 or later, run from the repository root.

- **The whole chain is intact:** `node tools/public-record.mjs verify`
- **A report existed unchanged on a date:** save the report's row as JSON from the public API, for example
  `https://cnmikcyvyamplbldiivp.supabase.co/rest/v1/kasa_public_reports?id=eq.<id>&select=*`
  (with the public key from `config.js` as the `apikey` header; save the single object, not the list). Then run
  `node tools/public-record.mjs row saved-row.json`
  and look for that fingerprint in the day's file.

A fingerprint match proves the saved data is exactly what was public that day. Reports are still citizen allegations, not verified facts.
