/* routes.html: record a walk, run or cycle ride with the phone's GPS. Everything stays in
   localStorage; a route leaves the phone only as a GPX download or a share link
   (?r=<encoded polyline>&m=<mode>&s=<seconds>), never through the server. */
(function(){
  'use strict';
  const KEY = 'parishkar_routes', LIVE = 'parishkar_route_live';
  const MODES = { walk: '🚶 Walk', run: '🏃 Run', cycle: '🚲 Cycle' };
  // Fixes worse than this are skipped; steps shorter than MIN_STEP are GPS jitter while standing.
  const MAX_ACC = 30, MIN_STEP = 4, MAX_SPEED = { walk: 4, run: 8, cycle: 20 }; // m/s
  const HIDE_M = 200;
  const $ = (id) => document.getElementById(id);

  let mode = 'walk', rec = null, watch = null, tick = null, wake = null, map = null, mapReady = false, follow = true;
  let pendingLine = null, pendingFit = null;

  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ── maths ── */
  function dist(a, b){
    const R = 6371000, r = Math.PI / 180;
    const dLat = (b[1] - a[1]) * r, dLng = (b[0] - a[0]) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  const length = (pts) => pts.reduce((s, p, i) => i ? s + dist(pts[i - 1], p) : 0, 0);
  function clock(secs){
    secs = Math.round(secs);
    const h = Math.floor(secs / 3600), m = Math.floor(secs / 60) % 60, s = secs % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
  }
  function pace(m, secs, md){
    if (m < 50 || secs < 10) return '—';
    if (md === 'cycle') return (m / secs * 3.6).toFixed(1);
    return clock(secs / (m / 1000));
  }
  // Douglas-Peucker on a local flat projection, tolerance in metres; keeps share links short.
  function simplify(pts, tol){
    if (pts.length < 3) return pts.slice();
    const lat0 = pts[0][1] * Math.PI / 180, k = 111320;
    const xy = pts.map((p) => [p[0] * k * Math.cos(lat0), p[1] * k]);
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length){
      const [a, b] = stack.pop();
      const [x1, y1] = xy[a], [x2, y2] = xy[b], dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1;
      let far = -1, fd = tol;
      for (let i = a + 1; i < b; i++){
        const d = Math.abs(dy * xy[i][0] - dx * xy[i][1] + x2 * y1 - y2 * x1) / L;
        if (d > fd){ fd = d; far = i; }
      }
      if (far > 0){ keep[far] = 1; stack.push([a, far], [far, b]); }
    }
    return pts.filter((_, i) => keep[i]);
  }
  // Drops the first and last HIDE_M metres so a shared route doesn't start at someone's door.
  function trimEnds(pts){
    if (length(pts) < HIDE_M * 3) return pts;
    let i = 0, j = pts.length - 1, d = 0;
    while (i < j && d < HIDE_M){ d += dist(pts[i], pts[i + 1]); i++; }
    d = 0;
    while (j > i && d < HIDE_M){ d += dist(pts[j - 1], pts[j]); j--; }
    return pts.slice(i, j + 1);
  }
  // Google encoded polyline, precision 5 (~1 m).
  function encode(pts){
    let out = '', pLat = 0, pLng = 0;
    const enc = (v) => { v = v < 0 ? ~(v << 1) : v << 1; let s = ''; while (v >= 0x20){ s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; } return s + String.fromCharCode(v + 63); };
    for (const p of pts){
      const lat = Math.round(p[1] * 1e5), lng = Math.round(p[0] * 1e5);
      out += enc(lat - pLat) + enc(lng - pLng); pLat = lat; pLng = lng;
    }
    return out;
  }
  function decode(str){
    const pts = []; let i = 0, lat = 0, lng = 0;
    const dec = () => { let r = 0, s = 0, b; do { b = str.charCodeAt(i++) - 63; r |= (b & 0x1f) << s; s += 5; } while (b >= 0x20 && i < str.length); return r & 1 ? ~(r >> 1) : r >> 1; };
    while (i < str.length){ lat += dec(); lng += dec(); pts.push([lng / 1e5, lat / 1e5]); }
    return pts.filter((p) => Math.abs(p[1]) <= 90 && Math.abs(p[0]) <= 180);
  }

  /* ── map ── */
  function initMap(){
    if (!window.maplibregl){ $('rt-map').textContent = 'The map could not load. Recording still works.'; return; }
    const light = window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches;
    map = new maplibregl.Map({ container: 'rt-map', style: 'https://tiles.openfreemap.org/styles/' + (light ? 'positron' : 'dark'), center: [87.9, 23.3], zoom: 6.3, attributionControl: { compact: true } });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.on('dragstart', () => { follow = false; });
    map.on('load', () => {
      map.addSource('rt-line', { type: 'geojson', data: line([]) });
      map.addLayer({ id: 'rt-line', type: 'line', source: 'rt-line', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#d4882a', 'line-width': 5 } });
      map.addSource('rt-me', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'rt-me', type: 'circle', source: 'rt-me', paint: { 'circle-radius': 7, 'circle-color': '#6db88a', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
      mapReady = true;
      if (pendingLine) draw(pendingLine, pendingFit);
    });
  }
  const line = (pts) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts.map((p) => [p[0], p[1]]) } });
  function draw(pts, fit){
    if (!mapReady){ pendingLine = pts; pendingFit = fit; return; }
    map.getSource('rt-line').setData(line(pts));
    if (fit && pts.length > 1){
      const b = pts.reduce((bb, p) => bb.extend([p[0], p[1]]), new maplibregl.LngLatBounds([pts[0][0], pts[0][1]], [pts[0][0], pts[0][1]]));
      map.fitBounds(b, { padding: 40, maxZoom: 17, duration: 0 });
    }
  }
  function me(p){
    if (!mapReady) return;
    map.getSource('rt-me').setData({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [p[0], p[1]] } }] });
    if (follow) map.easeTo({ center: [p[0], p[1]], zoom: Math.max(map.getZoom(), 16), duration: 500 });
  }

  /* ── recording ── */
  const elapsed = () => rec ? rec.secs + (rec.since ? (Date.now() - rec.since) / 1000 : 0) : 0;
  function show(){
    const m = rec ? rec.m : 0, s = elapsed(), md = rec ? rec.mode : mode;
    $('rt-dist').textContent = (m / 1000).toFixed(2);
    $('rt-time').textContent = clock(s);
    $('rt-pace').textContent = pace(m, s, md);
    $('rt-pace-l').textContent = md === 'cycle' ? 'km / h' : 'min / km';
  }
  function onFix(pos){
    const c = pos.coords, p = [c.longitude, c.latitude, Math.round(pos.timestamp / 1000)];
    $('rt-gps').textContent = 'GPS ±' + Math.round(c.accuracy) + ' m';
    me(p);
    if (!rec || !rec.since || c.accuracy > MAX_ACC) return;
    const last = rec.pts[rec.pts.length - 1];
    if (last && rec.gap) rec.gap = false;
    else if (last){
      const d = dist(last, p), dt = Math.max(1, p[2] - last[2]);
      if (d < MIN_STEP || d / dt > MAX_SPEED[rec.mode]) return;
      rec.m += d;
    }
    rec.pts.push(p);
    save(LIVE, rec);
    draw(rec.pts, false);
  }
  function onErr(e){
    $('rt-gps').textContent = e.code === 1 ? 'Location is blocked. Allow it for this site to record.' : 'Waiting for GPS…';
  }
  async function keepAwake(){
    try { if ('wakeLock' in navigator && !wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch (e) {}
  }
  function startWatch(){
    if (!navigator.geolocation){ $('rt-gps').textContent = 'This browser has no GPS access.'; return; }
    if (watch == null) watch = navigator.geolocation.watchPosition(onFix, onErr, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
    if (!tick) tick = setInterval(show, 1000);
    keepAwake();
  }
  function stopWatch(){
    if (watch != null) navigator.geolocation.clearWatch(watch);
    watch = null; clearInterval(tick); tick = null;
    if (wake) wake.release().catch(() => {});
  }
  function controls(){
    $('rt-go').textContent = rec ? 'Finish' : 'Start';
    $('rt-go').classList.toggle('rt-stop', !!rec);
    $('rt-pause').hidden = !rec;
    $('rt-pause').textContent = rec && !rec.since ? 'Resume' : 'Pause';
    document.querySelectorAll('.rt-modes button').forEach((b) => { b.disabled = !!rec; });
  }
  function start(){
    rec = { id: Date.now().toString(36), mode, start: Date.now(), secs: 0, since: Date.now(), m: 0, pts: [] };
    follow = true; save(LIVE, rec); draw([], false); startWatch(); controls(); show();
  }
  function pause(){
    if (rec.since){ rec.secs = elapsed(); rec.since = null; }
    else { rec.since = Date.now(); rec.gap = true; } // ground covered while paused doesn't count
    save(LIVE, rec); controls(); show();
  }
  function finish(){
    rec.secs = elapsed(); rec.since = null;
    if (rec.pts.length > 1){
      const all = load(KEY, []);
      all.unshift({ id: rec.id, mode: rec.mode, start: rec.start, secs: Math.round(rec.secs), m: Math.round(rec.m), pts: rec.pts });
      save(KEY, all);
    }
    try { localStorage.removeItem(LIVE); } catch (e) {}
    rec = null; stopWatch(); controls(); show(); list();
  }

  /* ── saved routes ── */
  function gpx(r){
    const t = (s) => new Date(s * 1000).toISOString();
    const pts = r.pts.map((p) => `<trkpt lat="${p[1].toFixed(6)}" lon="${p[0].toFixed(6)}">${p[2] ? `<time>${t(p[2])}</time>` : ''}</trkpt>`).join('\n');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Parishkar Bengal" xmlns="http://www.topografix.com/GPX/1/1">\n<trk><name>${esc(MODES[r.mode] || r.mode)} ${new Date(r.start).toLocaleDateString()}</name><type>${r.mode}</type><trkseg>\n${pts}\n</trkseg></trk>\n</gpx>\n`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([xml], { type: 'application/gpx+xml' }));
    a.download = 'route-' + new Date(r.start).toISOString().slice(0, 10) + '-' + r.mode + '.gpx';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  async function share(r, btn){
    let pts = $('rt-hide').checked ? trimEnds(r.pts) : r.pts;
    pts = simplify(pts, 5);
    const url = location.origin + location.pathname + '?m=' + r.mode + '&s=' + r.secs + '&r=' + encodeURIComponent(encode(pts));
    const text = `${MODES[r.mode] || r.mode}: ${(r.m / 1000).toFixed(2)} km in ${clock(r.secs)}`;
    try {
      if (navigator.share){ await navigator.share({ title: 'My route', text, url }); return; }
      await navigator.clipboard.writeText(url);
      btn.textContent = 'Link copied';
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      prompt('Copy this link', url);
    }
  }
  function list(){
    const all = load(KEY, []), ul = $('rt-list');
    if (!all.length){ ul.innerHTML = '<li class="rt-empty">No routes yet. Press Start and go.</li>'; return; }
    ul.innerHTML = all.map((r, i) => `<li class="rt-item">
      <div class="rt-item-main" data-i="${i}">${MODES[r.mode] || esc(r.mode)} · ${(r.m / 1000).toFixed(2)} km · ${clock(r.secs)}
        <small>${esc(new Date(r.start).toLocaleString())} · ${pace(r.m, r.secs, r.mode)} ${r.mode === 'cycle' ? 'km/h' : 'min/km'}</small></div>
      <div class="rt-item-acts">
        <button type="button" class="rt-btn" data-act="share" data-i="${i}">Share</button>
        <button type="button" class="rt-btn" data-act="gpx" data-i="${i}">GPX</button>
        <button type="button" class="rt-btn" data-act="del" data-i="${i}" aria-label="Delete">✕</button>
      </div></li>`).join('');
  }
  $('rt-list').addEventListener('click', (e) => {
    const el = e.target.closest('[data-i]'); if (!el) return;
    const all = load(KEY, []), r = all[+el.dataset.i]; if (!r) return;
    const act = el.dataset.act;
    if (act === 'gpx') gpx(r);
    else if (act === 'share') share(r, el);
    else if (act === 'del'){ if (confirm('Delete this route from this phone?')){ all.splice(+el.dataset.i, 1); save(KEY, all); list(); } }
    else if (!rec){ follow = false; draw(r.pts, true); window.scrollTo({ top: $('rt-map').offsetTop - 60, behavior: 'smooth' }); }
  });

  /* ── a route someone shared ── */
  function shared(){
    const q = new URLSearchParams(location.search), raw = q.get('r');
    if (!raw) return;
    const pts = decode(raw); if (pts.length < 2) return;
    const md = MODES[q.get('m')] ? q.get('m') : 'walk', secs = Math.max(0, +q.get('s') || 0), m = length(pts);
    const box = $('rt-shared');
    box.hidden = false;
    box.innerHTML = `<strong>${MODES[md]}</strong> someone shared: ${(m / 1000).toFixed(2)} km${secs ? ' in ' + clock(secs) + ' · ' + pace(m, secs, md) + (md === 'cycle' ? ' km/h' : ' min/km') : ''}. <button type="button" class="rt-btn" id="rt-shared-gpx">GPX</button>`;
    $('rt-shared-gpx').onclick = () => gpx({ mode: md, start: Date.now(), pts });
    follow = false; draw(pts, true);
  }

  /* ── wiring ── */
  document.querySelectorAll('.rt-modes button').forEach((b) => b.addEventListener('click', () => {
    mode = b.dataset.mode;
    document.querySelectorAll('.rt-modes button').forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
    show();
  }));
  $('rt-go').addEventListener('click', () => rec ? finish() : start());
  $('rt-pause').addEventListener('click', pause);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && rec) keepAwake(); });

  initMap();
  // A recording survives a reload or the browser being killed: pick it up where it stopped.
  const live = load(LIVE, null);
  if (live && Array.isArray(live.pts)){
    rec = live; mode = rec.mode;
    document.querySelectorAll('.rt-modes button').forEach((x) => x.setAttribute('aria-pressed', x.dataset.mode === mode ? 'true' : 'false'));
    draw(rec.pts, true); startWatch();
  } else shared();
  controls(); show(); list();
})();
