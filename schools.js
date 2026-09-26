/* Schools page for Parishkar Purulia: every listed school and residents' latest checks, worst first. */
(async function(){
  const cfg = window.KASA_CONFIG || {};
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const CITY = window.KASA_CITY || {};
  const DISTRICT = CITY.name || 'Purulia';
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const QS = [
    ['water_ok', 'Drinking water'], ['toilets_ok', 'Toilets'], ['boundary_ok', 'Boundary wall'],
    ['electricity_ok', 'Electricity'], ['mdm_ok', 'Mid-day meal kitchen']
  ];
  const PROBLEM = { water_ok: 'no drinking water', toilets_ok: 'no usable toilets', boundary_ok: 'no boundary wall',
                    electricity_ok: 'no working electricity', mdm_ok: 'no mid-day meal kitchen or utensils' };
  const COND = { good: 'Building good', needs_repair: 'Building needs repair', unsafe: 'Building unsafe' };
  const VIDYANJALI = 'https://vidyanjali.education.gov.in/';
  const checkUrl = code => `kasa.html?school=${encodeURIComponent(code)}`;
  const fmt = d => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

  // The API returns at most 1,000 rows per request, so fetch the list in pages.
  const all = [];
  for (let from = 0; ; from += 1000){
    const { data, error } = await sb.rpc('kasa_school_coverage').range(from, from + 999);
    if (error){ set('sc-updated', 'Could not load the schools. Please try again later.'); return; }
    all.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  const checked = all.filter(s => s.audits > 0);
  set('sc-updated', 'Updated ' + new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }));
  set('sc-t-listed', all.length.toLocaleString('en-IN'));
  set('sc-t-checked', checked.length.toLocaleString('en-IN'));
  set('sc-t-pct', all.length ? `${(100 * checked.length / all.length).toFixed(1)}% of listed schools` : '');
  set('sc-t-water', checked.filter(s => s.water_ok === false).length);
  set('sc-t-toilets', checked.filter(s => s.toilets_ok === false).length);

  const blocks = [...new Set(all.map(s => s.block_name).filter(Boolean))].sort();
  const sel = document.getElementById('sc-block');
  sel.innerHTML += blocks.map(b => `<option value="${esc(b)}">${esc(b)}</option>`).join('');

  const problems = s => [
    ...QS.filter(([k]) => s[k] === false).map(([k]) => PROBLEM[k]),
    ...(s.building_condition && s.building_condition !== 'good' ? [COND[s.building_condition].toLowerCase()] : [])
  ];

  function fy(d){ const y = d.getFullYear(), m = d.getMonth(); const s = m >= 3 ? y : y - 1; return `${s}-${String(s + 1).slice(2)}`; }
  function rtiText(s){
    const now = new Date(), cur = fy(now), prev = fy(new Date(now.getFullYear() - 1, now.getMonth(), 1));
    const found = problems(s);
    return [
      'To',
      'The Public Information Officer,',
      `Office of the District Project Officer, Paschim Banga Samagra Shiksha Mission, ${DISTRICT}`,
      '',
      'Subject: Application under Section 6(1) of the Right to Information Act, 2005',
      '',
      `School: ${s.name}`,
      `UDISE code: ${s.udise_code}`,
      `Block: ${s.block_name || '—'}${s.panchayat ? ', Gram Panchayat: ' + s.panchayat : ''}${s.village ? ', Village: ' + s.village : ''}`,
      '',
      found.length
        ? `On ${fmt(s.last_audit_at)}, a resident's check of this school found: ${found.join('; ')}. (Public record: ${location.origin}${location.pathname}?school=${s.udise_code})`
        : '',
      '',
      'Please provide the following information:',
      `1. The amount sanctioned and released for this school (UDISE ${s.udise_code}) for civil works, repairs, drinking water, toilets, electrification and the mid-day meal kitchen in ${prev} and ${cur}, with the dates of release.`,
      '2. Copies of the estimates, work orders, and completion or utilisation certificates for each such work.',
      '3. If no such work was sanctioned, whether a proposal for this school is pending, and the date it was submitted.',
      '4. The name and designation of the officer responsible for monitoring infrastructure at this school.',
      '',
      'I am a citizen of India. The fee of ₹10 is enclosed / paid online. If the information is held by another public authority, please transfer this application under Section 6(3).',
      '',
      'Name:',
      'Address:',
      'Date:'
    ].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');
  }

  function answers(s){
    const tags = QS.filter(([k]) => s[k] != null).map(([k, label]) =>
      `<span class="${s[k] ? 'sc-ok' : 'sc-bad'}">${s[k] ? '✓' : '✗'} ${esc(label)}</span>`);
    if (s.building_condition) tags.push(`<span class="${s.building_condition === 'good' ? 'sc-ok' : 'sc-bad'}">${esc(COND[s.building_condition])}</span>`);
    return tags.join('');
  }

  function row(s){
    const where = [s.village, s.panchayat, s.block_name].filter(Boolean).join(', ');
    const weak = s.score != null && s.score_of && s.score / s.score_of < 0.7;
    return `<div class="sc-row" id="s-${esc(s.udise_code)}">
      ${s.photo_url ? `<a href="${esc(s.photo_url)}" target="_blank" rel="noopener"><img src="${esc(s.photo_url)}" alt="" loading="lazy"></a>` : '<div class="sc-noimg" aria-hidden="true">🏫</div>'}
      <div>
        <div class="sc-name">${esc(s.name)}${s.score != null ? `<span class="sc-score">${s.score}/${s.score_of}</span>` : ''}</div>
        <div class="sc-where">${esc(where)} · UDISE ${esc(s.udise_code)}${s.audits ? ` · checked ${s.audits}× · latest ${esc(fmt(s.last_audit_at))}` : ''}</div>
        ${s.audits ? `<div class="sc-ans">${answers(s)}</div>` : ''}
        <div class="sc-acts">
          <a href="${checkUrl(s.udise_code)}">${s.audits ? 'Check again' : 'Check this school'}</a>
          ${s.audits && problems(s).length ? `<button type="button" data-rti="${esc(s.udise_code)}">Draft an RTI</button>` : ''}
          ${weak ? `<a href="${VIDYANJALI}" target="_blank" rel="noopener">Help this school on Vidyanjali ↗</a>` : ''}
          <a href="kasa.html?fix=${encodeURIComponent(s.udise_code)}">${s.lat != null ? 'Pin in the wrong place? Fix it' : 'Put it on the map'}</a>
        </div>
        <div class="sc-rti" hidden></div>
      </div>
    </div>`;
  }

  function render(){
    const block = sel.value, q = document.getElementById('sc-find').value.trim().toLowerCase();
    const match = s => (!block || s.block_name === block)
      && (!q || `${s.name} ${s.village || ''} ${s.panchayat || ''} ${s.udise_code}`.toLowerCase().includes(q));
    const worst = checked.filter(match).sort((a, b) => (a.score / a.score_of) - (b.score / b.score_of) || a.name.localeCompare(b.name));
    // Until a school is checked there is nothing to rank: the section only keeps its filters.
    document.querySelector('#sc-list h2').textContent = checked.length ? 'Checked schools, worst first' : 'Find a school';
    document.querySelector('#sc-list .an-card-sub').hidden = !checked.length;
    document.getElementById('sc-checked').hidden = !checked.length;
    document.getElementById('sc-checked').innerHTML = worst.length ? worst.map(row).join('')
      : `<div class="an-empty">${checked.length ? 'No checked school matches.' : 'No school has been checked yet. Be the first: stand at a school and tap “Check a school”.'}</div>`;
    // One dropdown of every unchecked school matching the filters above, not a long scrolling
    // list — choose one, then Check or Fix pin for just that school.
    const todo = all.filter(s => !s.audits && match(s));
    document.getElementById('sc-unchecked').innerHTML = todo.length
      ? `<p class="sc-unchecked-count">${todo.length.toLocaleString('en-IN')} school${todo.length === 1 ? '' : 's'} not checked yet.</p>
         <div class="sc-unchecked-pick">
           <select id="sc-unchecked-sel" aria-label="Choose an unchecked school">
             <option value="">Choose a school…</option>
             ${todo.map(s => `<option value="${esc(s.udise_code)}">${esc(s.name)} — ${esc([s.village, s.block_name].filter(Boolean).join(', ')) || 'no village on record'}</option>`).join('')}
           </select>
           <button type="button" class="sc-unchecked-go" id="sc-unchecked-go" disabled>Check</button>
           <a class="sc-unchecked-fix" id="sc-unchecked-fix" hidden>Put on map</a>
         </div>`
      : '<div class="an-empty">Every school here has been checked.</div>';
    const uSel = document.getElementById('sc-unchecked-sel');
    const uGo = document.getElementById('sc-unchecked-go');
    const uFix = document.getElementById('sc-unchecked-fix');
    if (uSel) uSel.addEventListener('change', () => {
      const s = todo.find(x => x.udise_code === uSel.value);
      uGo.disabled = !s;
      if (s){
        uFix.hidden = false;
        uFix.href = `kasa.html?fix=${encodeURIComponent(s.udise_code)}`;
        uFix.textContent = s.lat != null || s.seen_lat != null ? 'Fix pin' : 'Put on map';
      } else uFix.hidden = true;
    });
    if (uGo) uGo.addEventListener('click', () => { if (uSel.value) location.href = checkUrl(uSel.value); });
  }

  // "Schools near me": the block you stand in and the schools placed nearby, nearest first.
  set('sc-near-text', `${all.length.toLocaleString('en-IN')} schools in Purulia, ${checked.length.toLocaleString('en-IN')} checked so far. Stand at one, answer six questions and take one photo: about two minutes.`);
  document.getElementById('sc-near-btn').addEventListener('click', () => {
    const btn = document.getElementById('sc-near-btn'), out = document.getElementById('sc-near-list');
    if (!navigator.geolocation){ set('sc-near-text', 'This phone cannot share its location. Choose your block below instead.'); return; }
    btn.disabled = true; btn.textContent = 'Finding you…';
    navigator.geolocation.getCurrentPosition(async p => {
      const { data } = await sb.rpc('kasa_nearby_schools', { p_lat: p.coords.latitude, p_lng: p.coords.longitude });
      btn.hidden = true;
      const blk = data?.block;
      const near = (data?.near || []).map(n => ({ ...n, audits: all.find(s => s.udise_code === n.udise_code)?.audits || 0 }));
      const inBlock = blk ? all.filter(s => s.block_name === blk && !s.audits).slice(0, near.length ? 0 : 5) : [];
      const rows = [...near.map(n => ({ s: n, note: `${n.distance_m < 1000 ? n.distance_m + ' m' : (n.distance_m / 1000).toFixed(1) + ' km'} away${n.audits ? ' · checked' : ''}` })),
                    ...inBlock.map(s => ({ s, note: s.village || '' }))];
      const inTown = data?.area === 'town';
      set('sc-near-text', blk ? `You are in ${blk} block: ${all.filter(s => s.block_name === blk).length} schools, ${all.filter(s => s.block_name === blk && s.audits).length} checked.`
        : inTown ? 'You are in Purulia town. Few town schools are on the list yet; pick one below or check the one you are standing at.'
        : 'You seem to be outside Purulia district. Choose a block below to see its schools.');
      out.innerHTML = rows.map(({ s, note }) => `<li><span><strong>${esc(s.name)}</strong> <small>${esc(note)}</small></span>
        <span class="sc-todo-acts"><a href="${checkUrl(s.udise_code)}">Check</a></span></li>`).join('');
      if (blk && sel.querySelector(`option[value="${CSS.escape(blk)}"]`)){ sel.value = blk; render(); }
    }, () => { btn.disabled = false; btn.textContent = '📍 Find schools near me'; set('sc-near-text', 'Location is off. Choose your block below to see its schools.'); },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  });

  const byBlock = {};
  for (const s of all){
    const b = byBlock[s.block_name || '—'] ||= { n: 0, checked: 0, water: 0, toilets: 0 };
    b.n++;
    if (s.audits){ b.checked++; if (s.water_ok === false) b.water++; if (s.toilets_ok === false) b.toilets++; }
  }
  document.getElementById('sc-blocks').innerHTML = `<table class="an-table"><thead><tr><th>Block</th><th class="n">Schools</th><th class="n">Checked</th><th class="n">No water</th><th class="n">No toilets</th></tr></thead><tbody>${
    Object.entries(byBlock).sort().map(([b, v]) => `<tr><td>${esc(b)}</td><td class="n">${v.n}</td><td class="n">${v.checked}</td><td class="n">${v.water}</td><td class="n">${v.toilets}</td></tr>`).join('')
  }</tbody></table>`;

  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-rti]');
    if (!b) return;
    const s = all.find(x => x.udise_code === b.dataset.rti);
    const box = b.closest('.sc-row').querySelector('.sc-rti');
    if (!box.hidden){ box.hidden = true; return; }
    const text = rtiText(s);
    box.textContent = text;
    box.hidden = false;
    try { await navigator.clipboard.writeText(text); b.textContent = 'Draft an RTI (copied)'; } catch (err) { /* shown below to copy by hand */ }
  });
  sel.addEventListener('change', render);
  document.getElementById('sc-find').addEventListener('input', render);

  const want = new URLSearchParams(location.search).get('school');
  if (want){
    const s = all.find(x => x.udise_code === want);
    if (s){ if (s.block_name) sel.value = s.block_name; document.getElementById('sc-find').value = want; }
  }
  render();
  drawMap();

  /* Map: blocks shaded by the share of schools checked; pins for schools with a known location. */
  function drawMap(){
    if (!window.maplibregl){ document.getElementById('sc-map').hidden = true; return; }
    const key = b => String(b || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/II/g, '2').replace(/I/g, '1');
    const stat = {};
    for (const s of all){ const k = key(s.block_name); (stat[k] ||= { n: 0, c: 0, name: s.block_name }).n++; if (s.audits) stat[k].c++; }
    const colour = s => !s.audits ? '#8a8272' : s.score / s.score_of >= 0.8 ? '#5fae6b' : s.score / s.score_of >= 0.5 ? '#d4882a' : '#d9594c';
    const pins = {
      type: 'FeatureCollection',
      features: all.filter(s => s.lat != null && s.lng != null).map(s => ({
        type: 'Feature', geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
        properties: { code: s.udise_code, colour: colour(s) }
      }))
    };
    const placed = pins.features.length;
    if (!placed) document.getElementById('sc-map-sub').textContent += ` No school has a known location yet — each check places its school here.`;
    const map = new maplibregl.Map({
      container: 'sc-map', style: 'https://tiles.openfreemap.org/styles/dark',
      center: [86.35, 23.25], zoom: 8.6, attributionControl: { compact: true }
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    map.on('load', async () => {
      try {
        const geo = await (await fetch(CITY.blocksGeojson || 'purulia_blocks.geojson')).json();
        for (const f of geo.features){
          const st = stat[key(f.properties.block)] || { n: 0, c: 0 };
          f.properties.share = st.n ? st.c / st.n : 0;
          f.properties.label = `${f.properties.block}: ${st.c} of ${st.n} checked`;
          f.properties.listName = st.name || '';
        }
        map.addSource('blocks', { type: 'geojson', data: geo });
        map.addLayer({ id: 'block-fill', type: 'fill', source: 'blocks', paint: {
          'fill-color': '#d4882a', 'fill-opacity': ['interpolate', ['linear'], ['get', 'share'], 0, 0.06, 0.25, 0.3, 1, 0.6] } });
        map.addLayer({ id: 'block-line', type: 'line', source: 'blocks', paint: { 'line-color': '#d4882a', 'line-opacity': 0.55, 'line-width': 1 } });
        map.addLayer({ id: 'block-name', type: 'symbol', source: 'blocks', layout: {
          'text-field': ['get', 'block'], 'text-size': 11, 'text-font': ['Noto Sans Regular'] },
          paint: { 'text-color': '#f0e6d0', 'text-halo-color': '#0a0805', 'text-halo-width': 1.2 } });
        map.on('click', 'block-fill', e => {
          if (map.queryRenderedFeatures(e.point, { layers: ['school-pins'] }).length) return;
          const f = e.features[0];
          new maplibregl.Popup({ closeButton: false }).setLngLat(e.lngLat)
            .setHTML(`<strong>${esc(f.properties.label)}</strong><br><a href="#sc-list" data-block="${esc(f.properties.listName)}">List its schools ↓</a>`).addTo(map);
        });
      } catch (err) { console.warn('block outlines unavailable', err); }
      map.addSource('schools', { type: 'geojson', data: pins });
      map.addLayer({ id: 'school-pins', type: 'circle', source: 'schools', paint: {
        'circle-color': ['get', 'colour'], 'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 3.5, 13, 7],
        'circle-stroke-color': '#0a0805', 'circle-stroke-width': 1 } });
      map.on('click', 'school-pins', e => {
        const s = all.find(x => x.udise_code === e.features[0].properties.code);
        if (!s) return;
        new maplibregl.Popup({ closeButton: false }).setLngLat(e.lngLat).setHTML(
          `<strong>${esc(s.name)}</strong><br>${esc([s.village, s.block_name].filter(Boolean).join(', '))}<br>` +
          (s.audits ? `Score ${s.score}/${s.score_of} · checked ${esc(fmt(s.last_audit_at))}` : 'Not checked yet') +
          (s.located === 'checks' ? '<br><small>Location from residents’ checks</small>' : '') +
          `<br><a href="${checkUrl(s.udise_code)}">${s.audits ? 'Check again' : 'Check this school'}</a>` +
          ` · <a href="kasa.html?fix=${encodeURIComponent(s.udise_code)}">Wrong place? Fix it</a>`).addTo(map);
      });
      for (const l of ['school-pins', 'block-fill']){
        map.on('mouseenter', l, () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', l, () => { map.getCanvas().style.cursor = ''; });
      }
      if (placed){
        const b = new maplibregl.LngLatBounds();
        pins.features.forEach(f => b.extend(f.geometry.coordinates));
        if (placed > 1) map.fitBounds(b, { padding: 50, maxZoom: 12 });
      }
    });
    document.getElementById('sc-map').addEventListener('click', e => {
      const a = e.target.closest('[data-block]');
      if (!a) return;
      sel.value = a.dataset.block;
      render();
    });
  }
})();
