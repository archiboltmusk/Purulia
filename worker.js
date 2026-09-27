// Cloudflare Worker in front of the static site (wrangler.jsonc). Everything is served from the
// repo as before, except /r/<report id>: a small page whose preview tags (og:image = the report's
// photo) make WhatsApp, X and Facebook show the actual problem, and which then opens the report.
// Point KASA_CONFIG.SHARE_URL (config.js) at this worker's address to make share links use it.

// English labels from kasa-i18n.js.
const CATS = {
  garbage: 'Garbage / dumping', dumpsite: 'Dumping ground', toilet: 'Public toilet — locked, unusable or unclean',
  drain: 'Blocked drain / sewage', road: 'Pothole / broken road', streetlight: 'Streetlight not working',
  water: 'Water supply / leak', missing: 'Missing or broken public property', encroachment: 'Encroachment',
  illegal_construction: 'Illegal construction', illegal_mining: 'Illegal sand / stone mining',
  illegal_other: 'Other illegal activity', other: 'Other civic problem',
};
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function reportPage(id, env, url){
  const target = `${url.origin}/kasa.html?report=${encodeURIComponent(id)}`;
  let r = null;
  try {
    const q = `${env.SUPABASE_URL}/rest/v1/kasa_public_reports?id=eq.${encodeURIComponent(id)}`
      + '&select=id,created_at,category,status,landmark,ward_no,block_name,photo_url,resolved_photo_url&limit=1';
    const res = await fetch(q, { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.SUPABASE_ANON_KEY}` },
                                 cf: { cacheTtl: 300, cacheEverything: true } });
    if (res.ok) r = (await res.json())[0] || null;
  } catch (e) {}
  if (!r) return Response.redirect(target, 302);

  const fixed = r.status === 'resolved';
  const days = Math.max(0, Math.floor((Date.now() - Date.parse(r.created_at)) / 86400000));
  const place = [r.landmark, r.ward_no ? `Ward ${r.ward_no}` : r.block_name ? `${r.block_name} block` : ''].filter(Boolean).join(' · ');
  const title = `${CATS[r.category] || 'Civic problem'}${place ? ' — ' + place : ''}`;
  const desc = fixed ? 'Fixed, and confirmed by neighbours on the spot. Parishkar Purulia.'
    : `Reported ${days < 1 ? 'today' : days === 1 ? '1 day ago' : days + ' days ago'}, still unresolved. See it on the map and help get it fixed. Parishkar Purulia.`;
  const image = (fixed && r.resolved_photo_url) || r.photo_url || `${url.origin}/og-image.jpg`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Parishkar Purulia</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="article"><meta property="og:site_name" content="Parishkar Purulia">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(image)}"><meta property="og:url" content="${esc(url.href)}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${esc(image)}">
<link rel="canonical" href="${esc(target)}"><meta http-equiv="refresh" content="0;url=${esc(target)}">
</head><body><p><a href="${esc(target)}">Open the report</a></p>
<script>location.replace(${JSON.stringify(target)})</script></body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' } });
}

export default {
  async fetch(request, env){
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/r\/([A-Za-z0-9-]{1,64})\/?$/);
    if (m) return reportPage(m[1], env, url);
    return env.ASSETS.fetch(request);
  },
};
