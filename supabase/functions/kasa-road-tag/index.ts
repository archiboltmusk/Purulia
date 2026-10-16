// Supabase Edge Function: tags each report with the authority of the road it is on.
//
// The database pings this after every new report, and hourly. It only works on
// reports the database hands out (kasa_road_tag_claim), so calling it directly
// can't write a tag anyone chose. For each one it asks Overpass for the nearest
// road with an OpenStreetMap network or ref tag (within 40 m) and sends the raw
// tags back; the database turns IN:NH / IN:SH / IN:MDR / IN:ODR / IN:VR into an
// authority. Nothing found → checked, no authority.
//
// Deploy:  supabase functions deploy kasa-road-tag
// Map data © OpenStreetMap contributors (ODbL).

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter',
                  'https://overpass.kumi.systems/api/interpreter'];
const UA = 'ParishkarPurulia/1.0 (civic reporting; https://github.com/archiboltmusk/Purulia)';

type El = { type: string; id: number; tags?: Record<string, string>; center?: { lat: number; lon: number } };

function metres(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const r = 6371000, p = Math.PI / 180;
  const dLat = (bLat - aLat) * p, dLng = (bLng - aLng) * p;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * p) * Math.cos(bLat * p) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

async function lookupOverpass(lat: number, lng: number): Promise<El[]> {
  const q = `[out:json][timeout:20];
    (way(around:40,${lat},${lng})["highway"]["ref"];
     way(around:40,${lat},${lng})["highway"]["network"];);
    out tags center 30;`;
  let res: Response | null = null;
  for (const url of OVERPASS) {
    res = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), signal: AbortSignal.timeout(15000),
                             headers: { 'User-Agent': UA, 'Accept': 'application/json',
                                        'Content-Type': 'application/x-www-form-urlencoded' } }).catch(() => null);
    if (res?.ok) break;
    console.warn('overpass', url, res?.status ?? 'timeout');
  }
  if (!res?.ok) throw new Error(`overpass ${res?.status ?? 503}`);
  return ((await res.json()).elements ?? []) as El[];
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data, error } = await admin.rpc('kasa_road_tag_claim', { p_limit: 12 });
  if (error) return reply(500, { error: error.message });
  const rows = (data ?? []) as { id: string; lat: number; lng: number }[];
  let done = 0, busy = false;
  for (const [i, r] of rows.entries()) {
    if (busy) { await admin.rpc('kasa_road_tag_done', { p_report_id: r.id, p_way_id: null, p_road_name: null, p_road_ref: null, p_network: null, p_retry: true }); continue; }
    if (i) await new Promise(ok => setTimeout(ok, 1200));  // be gentle with the free public servers
    const lat = Number(r.lat), lng = Number(r.lng);
    let pick: El | null = null, retry = false;
    try {
      const els = (await lookupOverpass(lat, lng)).filter(e => e.type === 'way' && e.center && e.tags &&
        (e.tags.network || e.tags.ref));
      pick = els.sort((x, y) => metres(lat, lng, x.center!.lat, x.center!.lon) - metres(lat, lng, y.center!.lat, y.center!.lon))[0] ?? null;
    } catch (e) {
      console.error('road tag failed', r.id, e);
      retry = busy = /overpass (4\d\d|50\d)/.test(String(e));
    }
    await admin.rpc('kasa_road_tag_done', {
      p_report_id: r.id, p_way_id: pick?.id ?? null, p_road_name: pick?.tags?.name ?? null,
      p_road_ref: pick?.tags?.ref ?? null, p_network: pick?.tags?.network ?? null, p_retry: retry,
    });
    if (pick) done++;
  }
  return reply(200, { claimed: rows.length, tagged: done, busy });
});

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
