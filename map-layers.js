/* Layers on the report map (kasa.html): the noticeboard's demands that have a pin, the tax and
 * spending figures from money.html (states, then West Bengal seats), and the schools list dots from
 * schools.html (coloured by the latest residents' check). Reports stay the default.
 * Chosen in the filter bar (#k-layer-select) or by kasa.html?layer=reports|demands|schools|money-<key>.
 * Sources: places/money.json + places/in_states.geojson + places/wb_mplads.json (money-metrics.js
 * holds the definitions); places/wb_assembly.geojson (loaded on first use of the seat layer);
 * kasa_demands (public RPC, same as noticeboard.html); kasa_school_coverage(district) for schools.
 * Nothing here is sent or stored.
 */
(() => {
  const CFG = window.KASA_CONFIG || {};
  const MM = window.MoneyMetrics;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const slug = s => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const cr = v => v == null ? '—' : '₹' + Math.round(v).toLocaleString('en-IN') + ' cr';
  const pct = v => v == null ? '—' : (Math.round(v * 10) / 10).toLocaleString('en-IN') + '%';
  const NONE = 'rgba(128,120,104,0.28)';
  const REPORT_LAYERS = ['clusters', 'cluster-count', 'report-halo', 'report-points'];
  const MONEY_KEYS = ['selfPaid', 'unspent', 'ucs', 'mplads', 'seats'];

  let map = null, current = 'reports', fetched = {}, money = null, mp = null, seats = null, demands = null, note = null, schoolDistrict = () => 'purulia', schools = {};

  const get = (key, url) => fetched[key] ||= fetch(url).then(r => { if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); });

  function setVisible(id, on) {
    if (map && map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  }

  function showReports(on) { REPORT_LAYERS.forEach(id => setVisible(id, on)); }

  // Schools for one district, 1,000 rows a request (same RPC and paging as schools.html).
  async function loadSchools(district) {
    if (schools[district]) return schools[district];
    const all = [];
    for (let from = 0; ; from += 1000) {
      const res = await fetch(`${CFG.SUPABASE_URL}/rest/v1/rpc/kasa_school_coverage`, { method: 'POST',
        headers: { apikey: CFG.SUPABASE_ANON_KEY, Authorization: `Bearer ${CFG.SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json',
          'Range-Unit': 'items', Range: `${from}-${from + 999}` }, body: JSON.stringify({ p_district: district }) });
      if (!res.ok) throw new Error('schools ' + res.status);
      const rows = await res.json();
      all.push(...rows);
      if (rows.length < 1000) break;
    }
    return (schools[district] = all);
  }

  async function paintSchools() {
    const district = schoolDistrict();
    const all = await loadSchools(district);
    const colour = s => !s.audits ? '#8a8272' : s.score / s.score_of >= 0.8 ? '#5fae6b' : s.score / s.score_of >= 0.5 ? '#DD3333' : '#d9594c';
    const placed = all.filter(s => s.lat != null && s.lng != null);
    map.getSource('schools').setData({ type: 'FeatureCollection', features: placed.map(s => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
      properties: { code: s.udise_code, name: s.name, place: [s.village, s.block_name].filter(Boolean).join(', '),
        colour: colour(s), checked: s.audits ? 1 : 0, score: s.score, of: s.score_of } })) });
    note && (note.textContent = `${placed.length.toLocaleString('en-IN')} schools with a known location in this district. Coloured by the latest residents' check; grey = not checked yet.`);
  }

  // Shade states (or seats) by the chosen money figure. Same colours and rules as money.html used.
  async function paintMoney(key) {
    const k = key.slice('money-'.length);
    const [d, g, m] = await Promise.all([get('money', 'places/money.json'), get('states', 'places/in_states.geojson'), get('mp', 'places/wb_mplads.json')]);
    money = d; mp = m;
    if (k === 'seats') {
      if (!seats) seats = await get('seats', 'places/wb_assembly.geojson');
      const vals = Object.keys(mp.pc).map(pc => MM.seatPct(mp, pc));
      seats.features.forEach(f => { f.properties.c = MM.color(MM.seatPct(mp, String(f.properties.pc)), vals) || NONE; });
      map.getSource('money-seats').setData(seats);
      note && (note.textContent = MM.LAYERS.seats.note);
      return;
    }
    const states = g.features.map(f => f.properties.state);
    const vals = states.map(s => MM.metric(d, s, k));
    g.features.forEach(f => {
      const v = MM.metric(d, f.properties.state, k);
      f.properties.c = MM.color(v, vals) || NONE;
      f.properties.v = v == null ? 'not on file' : (MM.LAYERS[k].unit === 'cr' ? cr(v) : pct(v));
      f.properties.slug = slug(f.properties.state);
    });
    map.getSource('money-states').setData(g);
    note && (note.textContent = MM.LAYERS[k].note);
  }

  async function paintDemands() {
    if (!demands) {
      const res = await fetch(`${CFG.SUPABASE_URL}/rest/v1/rpc/kasa_demands`, { method: 'POST',
        headers: { apikey: CFG.SUPABASE_ANON_KEY, Authorization: `Bearer ${CFG.SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' }, body: '{}' });
      demands = res.ok ? await res.json() : [];
    }
    const pins = demands.filter(d => d.lat != null && d.lng != null);
    map.getSource('demands').setData({ type: 'FeatureCollection', features: pins.map(d => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: [d.lng, d.lat] },
      properties: { id: d.id, title: d.title, leader: d.leader_name, supports: d.supports || 0 } })) });
    note && (note.textContent = pins.length ? 'Demands to leaders that have a pin. Tap one to read it on the noticeboard.' : 'No demand has a pin yet.');
  }

  function choose(key) {
    if (!map) return;
    const k = MONEY_KEYS.includes(key.replace(/^money-/, '')) && key.startsWith('money-') ? key : key === 'demands' || key === 'schools' ? key : 'reports';
    current = k;
    const sel = document.getElementById('k-layer-select');
    if (sel && sel.value !== k) sel.value = k;
    if (note) note.hidden = k === 'reports';
    showReports(k === 'reports');
    setVisible('demand-points', k === 'demands');
    if (k === 'demands') paintDemands().catch(() => {});
    setVisible('school-dots', k === 'schools');
    if (k === 'schools') paintSchools().catch(() => {});
    if (k.startsWith('money-')) {
      paintMoney(k).catch(() => {});
      setVisible('money-states-fill', k !== 'money-seats'); setVisible('money-states-line', k !== 'money-seats');
      setVisible('money-seats-fill', k === 'money-seats');
    } else {
      ['money-states-fill', 'money-states-line', 'money-seats-fill'].forEach(id => setVisible(id, false));
    }
  }

  // Called once from kasa.js, after the base map loads and before the report layers are added.
  function mount(m, opts = {}) {
    map = m;
    if (opts.district) schoolDistrict = opts.district;
    map.addSource('schools', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'school-dots', type: 'circle', source: 'schools', layout: { visibility: 'none' }, paint: {
      'circle-color': ['get', 'colour'], 'circle-stroke-color': '#0a0805', 'circle-stroke-width': 1,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, ['+', 2.5, ['*', 2, ['get', 'checked']]], 13, ['+', 6, ['*', 2, ['get', 'checked']]]] } });
    map.addSource('demands', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'demand-points', type: 'circle', source: 'demands', layout: { visibility: 'none' }, paint: {
      'circle-radius': ['+', 6, ['min', 8, ['sqrt', ['get', 'supports']]]], 'circle-color': '#d4882a', 'circle-stroke-color': '#0a0805', 'circle-stroke-width': 1.5 } });
    map.addSource('money-states', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'money-states-fill', type: 'fill', source: 'money-states', layout: { visibility: 'none' }, paint: { 'fill-color': ['get', 'c'], 'fill-opacity': 0.85 } });
    map.addLayer({ id: 'money-states-line', type: 'line', source: 'money-states', layout: { visibility: 'none' }, paint: { 'line-color': '#0a0805', 'line-width': 0.6 } });
    map.addSource('money-seats', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'money-seats-fill', type: 'fill', source: 'money-seats', layout: { visibility: 'none' }, paint: { 'fill-color': ['get', 'c'], 'fill-opacity': 0.85, 'fill-outline-color': '#0a0805' } });

    const el = document.getElementById('k-map');
    note = document.createElement('p');
    note.id = 'k-layer-note'; note.hidden = true;
    note.style.cssText = 'position:absolute;left:12px;bottom:12px;max-width:min(360px,70vw);margin:0;padding:6px 10px;border-radius:6px;font-size:12px;line-height:1.4;background:rgba(10,8,5,.85);color:#f0e6d0;z-index:5;';
    el.appendChild(note);

    map.on('click', 'demand-points', e => {
      const p = e.features[0].properties;
      new maplibregl.Popup({ offset: 12 }).setLngLat(e.lngLat).setHTML(`<strong>${esc(p.title)}</strong><br>To: ${esc(p.leader)}<br>${esc(p.supports)} supported<br><a href="noticeboard.html#d-${esc(p.id)}">Read it on the noticeboard →</a>`).addTo(map);
    });
    map.on('click', 'money-states-fill', e => {
      const p = e.features[0].properties;
      new maplibregl.Popup({ offset: 12 }).setLngLat(e.lngLat).setHTML(`<strong>${esc(p.state)}</strong><br>${esc(MM.LAYERS[current.slice(6)].label)}: ${esc(p.v)}<br><a href="money.html?s=${esc(p.slug)}">Open this state on Tax and spending →</a>`).addTo(map);
    });
    map.on('click', 'money-seats-fill', e => {
      const pc = String(e.features[0].properties.pc), r = mp.pc[pc];
      new maplibregl.Popup({ offset: 12 }).setLngLat(e.lngLat).setHTML(`<strong>Seat ${esc(pc)}</strong><br>` + (r ? `Spent ${cr(r.spent / 1e7)} of ${cr(r.allocated / 1e7)} (${pct(MM.seatPct(mp, pc))})` : 'Not on file (seat vacant or no MPLADS figures)') +
        `<br><a href="kasa.html?rep=pc:${esc(pc)}">MP's page</a>`).addTo(map);
    });
    map.on('click', 'school-dots', e => {
      const p = e.features[0].properties;
      const code = encodeURIComponent(p.code);
      new maplibregl.Popup({ offset: 8 }).setLngLat(e.lngLat).setHTML(`<strong>${esc(p.name)}</strong><br>${esc(p.place)}<br>` +
        (p.checked ? `Score ${esc(p.score)}/${esc(p.of)}` : 'Not checked yet') +
        `<br><a href="kasa.html?school=${code}">${p.checked ? 'Check again' : 'Check this school'}</a> · <a href="kasa.html?fix=${code}">Wrong place? Fix it</a>`).addTo(map);
    });
    ['demand-points', 'school-dots', 'money-states-fill', 'money-seats-fill'].forEach(id => {
      map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; });
    });

    const sel = document.getElementById('k-layer-select');
    if (sel) sel.addEventListener('change', e => choose(e.target.value));
    const want = new URLSearchParams(location.search).get('layer') || '';
    if (want && want !== 'reports') {
      map.once('idle', () => choose(want));
    }
  }

  window.KasaLayers = { mount, choose };
})();
