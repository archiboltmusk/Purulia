// Daily tamper-evident record of Purulia Kasa's public data.
//
// Fetches the public views (the same data anyone can read through the API),
// fingerprints every row, and appends one day to record/: a file of
// "<kind> <id> <sha256>" lines plus a chained manifest entry. Only
// fingerprints are kept, never the content, so reports can still be taken
// down; a fingerprint proves a saved copy of a row existed unchanged.
//
//   node tools/public-record.mjs            # write today's entry
//   node tools/public-record.mjs verify     # re-check the whole chain
//   node tools/public-record.mjs row <file> # fingerprint a saved API row (JSON)

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';

const DIR = 'record';
const MANIFEST = `${DIR}/MANIFEST.txt`;
const GENESIS = '0'.repeat(64);
const SOURCES = [
  ['report', 'kasa_public_reports'],
  ['event', 'kasa_public_events'],
  ['reply', 'kasa_public_replies'],
];

const sha256 = s => createHash('sha256').update(s).digest('hex');

// Keys sorted at every level, so the same row always gives the same fingerprint.
function canonical(v){
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}
export const fingerprint = row => sha256(canonical(row));

function config(){
  const src = existsSync('config.js') ? readFileSync('config.js', 'utf8') : '';
  const get = k => (src.match(new RegExp(`${k}:\\s*'([^']+)'`)) || [])[1];
  const url = process.env.SUPABASE_URL || get('SUPABASE_URL');
  const key = process.env.SUPABASE_ANON_KEY || get('SUPABASE_ANON_KEY');
  if (!url || !key) throw new Error('Supabase URL / public key not found');
  return { url, key };
}

async function fetchAll({ url, key }, view){
  const rows = [];
  for (let from = 0; ; from += 1000){
    const res = await fetch(`${url}/rest/v1/${view}?select=*&order=id`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${from}-${from + 999}`, 'Range-Unit': 'items' }
    });
    if (!res.ok && res.status !== 206) throw new Error(`${view}: HTTP ${res.status} ${await res.text()}`);
    const page = await res.json();
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

function manifestLines(){
  return existsSync(MANIFEST) ? readFileSync(MANIFEST, 'utf8').split('\n').filter(l => l && !l.startsWith('#')) : [];
}

// Manifest line: <date> <day-file sha256> <rows> <previous entry sha256> <this entry sha256>
function entryHash(date, dayHash, count, prev){ return sha256(`${date} ${dayHash} ${count} ${prev}`); }

function verify(){
  let prev = GENESIS, n = 0;
  for (const line of manifestLines()){
    const [date, dayHash, count, p, h] = line.split(' ');
    const file = `${DIR}/${date.slice(0, 4)}/${date}.txt`;
    if (p !== prev) throw new Error(`${date}: chain broken (previous entry mismatch)`);
    if (entryHash(date, dayHash, count, p) !== h) throw new Error(`${date}: entry fingerprint mismatch`);
    if (!existsSync(file) || sha256(readFileSync(file)) !== dayHash) throw new Error(`${date}: day file missing or changed`);
    prev = h; n++;
  }
  console.log(`record intact: ${n} day(s), head ${prev}`);
  return prev;
}

async function snapshot(){
  const head = verify();
  const date = new Date().toISOString().slice(0, 10);
  if (manifestLines().some(l => l.startsWith(date + ' '))){ console.log(`${date} already recorded`); return; }
  const cfg = config();
  const lines = [];
  for (const [kind, view] of SOURCES){
    for (const row of await fetchAll(cfg, view)) lines.push(`${kind} ${row.id} ${fingerprint(row)}`);
  }
  lines.sort();
  const body = `# Purulia Kasa public record, ${date} (UTC). Lines: <kind> <id> <sha256 of the canonical API row>\n` + lines.join('\n') + '\n';
  mkdirSync(`${DIR}/${date.slice(0, 4)}`, { recursive: true });
  const file = `${DIR}/${date.slice(0, 4)}/${date}.txt`;
  writeFileSync(file, body);
  const dayHash = sha256(body);
  if (!existsSync(MANIFEST)){
    writeFileSync(MANIFEST, '# <date> <day-file sha256> <rows> <previous entry sha256> <this entry sha256>\n');
  }
  appendFileSync(MANIFEST, `${date} ${dayHash} ${lines.length} ${head} ${entryHash(date, dayHash, lines.length, head)}\n`);
  console.log(`${date}: ${lines.length} rows recorded`);
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'verify') verify();
else if (cmd === 'row') console.log(fingerprint(JSON.parse(readFileSync(arg, 'utf8'))));
else await snapshot();
