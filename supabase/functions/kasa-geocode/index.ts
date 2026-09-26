// Supabase Edge Function: gives reports a short written address from OpenStreetMap.
//
// The database pings this after every new report, and hourly. It only works on
// reports the database hands out (kasa_geocode_claim), so calling it directly
// can't write an address anyone chose. For each one it asks Overpass for the
// nearest named road (within 150 m) and the nearest named place (within 120 m),
// e.g. "NC Dasgupta Road · near Town Hall". Nothing found → no address; the app
// falls back to the ward or block.
//
// Deploy:  supabase functions deploy kasa-geocode
// Map data © OpenStreetMap contributors (ODbL).

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const OVERPASS = 'https://overpass-api.de/api/interpreter';
const UA = 'ParishkarPurulia/1.0 (civic reporting; https://github.com/archiboltmusk/Purulia)';

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

interface El { type: string; lat?: number; lon?: number; center?: { lat: number; lon: number };
  geometry?: { lat: number; lon: number }[]; tags?: Record<string, string> }

function dist(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000, r = Math.PI / 180;
  const x = (bLng - aLng) * r * Math.cos(((aLat + bLat) / 2) * r), y = (bLat - aLat) * r;
  return Math.sqrt(x * x + y * y) * R;
}

function nearest(el: El, lat: number, lng: number): number {
  const pts = el.geometry ?? (el.center ? [el.center] : el.lat != null ? [{ lat: el.lat, lon: el.lon! }] : []);
  return pts.reduce((m, p) => Math.min(m, dist(lat, lng, p.lat, p.lon)), Infinity);
}

const nameOf = (t: Record<string, string> = {}) => (t['name:en'] || t.name || '').trim();

async function lookup(lat: number, lng: number): Promise<string | null> {
  const a = `${lat},${lng}`;
  const q = `[out:json][timeout:20];
    (way(around:150,${a})["highway"]["name"];
     nwr(around:120,${a})["name"]["amenity"];
     nwr(around:120,${a})["name"]["shop"];
     nwr(around:120,${a})["name"]["office"];
     nwr(around:120,${a})["name"]["leisure"];
     nwr(around:120,${a})["name"]["tourism"];
     nwr(around:120,${a})["name"]["building"];
     nwr(around:120,${a})["name"]["healthcare"];
     node(around:400,${a})["place"]["name"];);
    out tags geom 60;`;
  const res = await fetch(OVERPASS, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
                                      body: 'data=' + encodeURIComponent(q) });
  if (!res.ok) throw new Error(`overpass ${res.status}`);
  const els = ((await res.json()).elements ?? []) as El[];
  const scored = els.filter(e => nameOf(e.tags)).map(e => ({ e, d: nearest(e, lat, lng), name: nameOf(e.tags) }));
  const by = (f: (e: El) => boolean) => scored.filter(s => f(s.e)).sort((x, y) => x.d - y.d)[0];
  const road = by(e => !!e.tags?.highway && e.type === 'way');
  const poi = by(e => !e.tags?.highway && !e.tags?.place);
  const place = by(e => !!e.tags?.place);
  const parts: string[] = [];
  if (road) parts.push(road.name);
  if (poi && poi.name !== road?.name) parts.push('near ' + poi.name);
  if (!parts.length && place) parts.push(place.name);
  return parts.length ? parts.join(' · ').slice(0, 120) : null;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data, error } = await admin.rpc('kasa_geocode_claim', { p_limit: 12 });
  if (error) return reply(500, { error: error.message });
  const rows = (data ?? []) as { id: string; lat: number; lng: number }[];
  let done = 0, busy = false;
  for (const [i, r] of rows.entries()) {
    if (busy) { await admin.rpc('kasa_geocode_done', { p_id: r.id, p_address: null, p_retry: true }); continue; }
    if (i) await new Promise(ok => setTimeout(ok, 2500));  // be gentle with the public Overpass server
    let address: string | null = null, retry = false;
    try { address = await lookup(Number(r.lat), Number(r.lng)); }
    catch (e) { console.error('geocode failed', r.id, e); retry = busy = /overpass (429|50\d)/.test(String(e)); }
    await admin.rpc('kasa_geocode_done', { p_id: r.id, p_address: address, p_retry: retry });
    if (address) done++;
  }
  return reply(200, { looked_up: rows.length, found: done });
});
