// Cloudflare Worker in front of the static site (wrangler.jsonc). Everything is served from the
// repo as before, except /r/<report id>: a small page whose preview tags (og:image = the report's
// photo) make WhatsApp, X and Facebook show the actual problem, and which then opens the report.
// Point KASA_CONFIG.SHARE_URL (config.js) at this worker's address to make share links use it.

// Public values, the same ones config.js ships to every browser (preview builds don't get wrangler vars).
const SUPABASE_URL = 'https://cnmikcyvyamplbldiivp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNubWlrY3l2eWFtcGxibGRpaXZwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyMzY0MDEsImV4cCI6MjEwNTgxMjQwMX0.h4nOvb0GWz92A_GuH-RPX90wUIRvza4RvsD9TA-XiM0';

// English labels from kasa-i18n.js.
const CATS = {
  garbage: 'Garbage / dumping', dumpsite: 'Dumping ground', toilet: 'Public toilet — locked, unusable or unclean',
  drain: 'Blocked drain / sewage', road: 'Pothole / broken road', streetlight: 'Streetlight not working',
  water: 'Water supply / leak', missing: 'Missing or broken public property', encroachment: 'Encroachment',
  illegal_construction: 'Illegal construction', illegal_mining: 'Illegal sand / stone mining',
  illegal_other: 'Other illegal activity', other: 'Other civic problem',
  hand_pump: 'Broken hand pump', health_centre: 'Health centre', rural_jobs: 'Rural jobs (MGNREGA) work',
};
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function reportPage(id, url){
  const target = `${url.origin}/kasa.html?report=${encodeURIComponent(id)}`;
  let r = null, why = 'not found';
  try {
    const q = `${SUPABASE_URL}/rest/v1/kasa_public_reports?id=eq.${encodeURIComponent(id)}`
      + '&select=id,created_at,category,status,landmark,ward_no,block_name,photo_url,resolved_photo_url&limit=1';
    const res = await fetch(q, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
                                 cf: { cacheTtl: 300, cacheEverything: true } });
    if (res.ok) r = (await res.json())[0] || null;
    else why = `database ${res.status}`;
  } catch (e) { why = String(e).slice(0, 100); }
  // Falls back to the plain report link; the header says why, for debugging from the outside.
  if (!r) return new Response(null, { status: 302, headers: { Location: target, 'X-Preview-Fallback': why } });

  const fixed = r.status === 'resolved';
  const days = Math.max(0, Math.floor((Date.now() - Date.parse(r.created_at)) / 86400000));
  const place = [r.landmark, r.ward_no ? `Ward ${r.ward_no}` : r.block_name ? `${r.block_name} block` : ''].filter(Boolean).join(' · ');
  const title = `${CATS[r.category] || 'Civic problem'}${place ? ' — ' + place : ''}`;
  const desc = fixed ? 'Fixed, and confirmed by neighbours on the spot. Parishkar Bengal.'
    : `Reported ${days < 1 ? 'today' : days === 1 ? '1 day ago' : days + ' days ago'}, still unresolved. See it on the map and help get it fixed. Parishkar Bengal.`;
  const image = (fixed && r.resolved_photo_url) || r.photo_url || `${url.origin}/og-bengal.jpg`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Parishkar Bengal</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="article"><meta property="og:site_name" content="Parishkar Bengal">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(image)}"><meta property="og:url" content="${esc(url.href)}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${esc(image)}">
<link rel="canonical" href="${esc(target)}"><meta http-equiv="refresh" content="0;url=${esc(target)}">
</head><body><p><a href="${esc(target)}">Open the report</a></p>
<script>location.replace(${JSON.stringify(target)})</script></body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' } });
}

// Open311 GeoReport v2, read-only (https://wiki.open311.org/GeoReport_v2/): GET services,
// requests and one request, JSON only, from the public report views. No POST: a report needs a live
// camera photo and real GPS, which only the site's own report flow checks.
const O311_COLS = 'id,created_at,category,status,description,landmark,lat,lng,photo_url,resolved_at,resolved_photo_url';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: {
  'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=300' } });
const o311Error = (status, description) => json([{ code: status, description }], status);
const toRequest = (r, origin) => ({
  service_request_id: String(r.id),
  status: r.status === 'resolved' ? 'closed' : 'open',
  status_notes: r.status === 'resolved' ? 'Fixed, confirmed on the spot.' : null,
  service_name: CATS[r.category] || 'Civic problem',
  service_code: r.category,
  description: r.description || null,
  requested_datetime: r.created_at,
  updated_datetime: r.resolved_at || r.created_at,
  address: r.landmark || null,
  lat: r.lat, long: r.lng,
  media_url: (r.status === 'resolved' && r.resolved_photo_url) || r.photo_url || null,
  service_notice: `${origin}/kasa.html?report=${encodeURIComponent(r.id)}`,
});
async function rest(path){
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` }, cf: { cacheTtl: 300, cacheEverything: true } });
  if (!res.ok) throw new Error(`database ${res.status}`);
  return res.json();
}
async function open311(path, url){
  const fmt = path.match(/\.(json|xml)$/);
  if (fmt && fmt[1] !== 'json') return o311Error(400, 'Only JSON is supported here.');
  path = path.replace(/\.(json|xml)$/, '');
  if (path === 'services') return json(Object.entries(CATS).map(([code, name]) => ({
    service_code: code, service_name: name, description: name, metadata: false, type: 'realtime', keywords: '', group: 'civic' })));
  if (path.startsWith('services/')) return o311Error(404, 'No extra fields: every service takes a live photo, GPS and a short note.');
  try {
    const one = path.match(/^requests\/([A-Za-z0-9-]{1,64})$/);
    if (one){
      const q = `id=eq.${encodeURIComponent(one[1])}&select=${O311_COLS}&limit=1`;
      const rows = [...await rest(`kasa_public_reports?${q}`), ...await rest(`kasa_public_place_reports?${q}`).catch(() => [])];
      return rows.length ? json([toRequest(rows[0], url.origin)]) : o311Error(404, 'No such request.');
    }
    if (path !== 'requests') return o311Error(404, 'Not found.');
    const p = url.searchParams, f = [`select=${O311_COLS}`, 'order=created_at.desc'];
    const day = v => v && !isNaN(Date.parse(v)) ? new Date(v).toISOString() : null;
    const start = day(p.get('start_date')), end = day(p.get('end_date'));
    if (start) f.push(`created_at=gte.${start}`);
    if (end) f.push(`created_at=lte.${end}`);
    const st = p.get('status');
    if (st === 'open') f.push('status=neq.resolved'); else if (st === 'closed') f.push('status=eq.resolved');
    const codes = (p.get('service_code') || '').split(',').filter(c => CATS[c]);
    if (codes.length) f.push(`category=in.(${codes.join(',')})`);
    if (p.get('service_request_id')) f.push(`id=in.(${p.get('service_request_id').split(',').filter(x => /^[A-Za-z0-9-]{1,64}$/.test(x)).join(',')})`);
    // Default: the last 90 days, up to 1000 (as the spec suggests).
    if (!start && !end && !p.get('service_request_id')) f.push(`created_at=gte.${new Date(Date.now() - 90 * 86400000).toISOString()}`);
    const lim = Math.min(1000, Math.max(1, Number(p.get('limit')) || 1000));
    f.push(`limit=${lim}`);
    const q = f.join('&');
    const rows = [...await rest(`kasa_public_reports?${q}`), ...await rest(`kasa_public_place_reports?${q}`).catch(() => [])]
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, lim);
    return json(rows.map(r => toRequest(r, url.origin)));
  } catch (e){ return o311Error(503, 'The report database did not answer. Please try again.'); }
}

export default {
  async fetch(request, env){
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/r\/([A-Za-z0-9-]{1,64})\/?$/);
    if (m) return reportPage(m[1], url);
    const o = url.pathname.match(/^\/open311\/v2\/(.+)$/);
    if (o){
      if (request.method === 'OPTIONS') return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' } });
      if (request.method !== 'GET') return o311Error(405, 'Read only: report a problem with a live photo on the site.');
      return open311(o[1], url);
    }
    return env.ASSETS.fetch(request);
  },
};
