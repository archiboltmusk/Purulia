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
    ['electricity_ok', 'Electricity'], ['mdm_ok', 'Mid-day meal kitchen'],
    ['girls_toilet_ok', "Girls' toilet"], ['meal_today_ok', 'Meal cooked today']
  ];
  const PROBLEM = { water_ok: 'no drinking water', toilets_ok: 'no usable toilets', boundary_ok: 'no boundary wall',
                    electricity_ok: 'no working electricity', mdm_ok: 'no mid-day meal kitchen or utensils',
                    girls_toilet_ok: "no usable separate girls' toilet", meal_today_ok: 'no mid-day meal cooked that day' };
  // Official UDISE+ facility keys (schools.official) beside the resident answer that checks the same thing.
  const OFFICIAL = [['drinking_water', 'drinking water', 'water_ok'], ['girls_toilet', "girls' toilet", 'girls_toilet_ok'],
                    ['boys_toilet', "boys' toilet", null], ['electricity', 'electricity', 'electricity_ok'],
                    ['boundary_wall', 'boundary wall', 'boundary_ok'], ['handwash', 'hand-wash', null],
                    ['library', 'library', null], ['playground', 'playground', null], ['ramp', 'ramp', null]];
  // State and national figures from the UDISE+ 2024-25 report (tools/udise-benchmarks.py).
  const bench = await fetch('schools-benchmarks.json').then(r => r.ok ? r.json() : null).catch(() => null);
  const bm = key => bench?.indicators.find(i => i.key === key);
  const pct = v => v == null ? '—' : `${v}%`;
  const COND = { good: 'Building good', needs_repair: 'Building needs repair', unsafe: 'Building unsafe' };
  const VIDYANJALI = 'https://vidyanjali.education.gov.in/';
  const checkUrl = code => `kasa.html?school=${encodeURIComponent(code)}`;
  const cardUrl = code => `kasa.html?card=${encodeURIComponent(code)}`;
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
  const official = all.filter(s => s.official);
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
    if (s.teachers_seen != null) tags.push(`<span>${s.teachers_seen} teacher${s.teachers_seen === 1 ? '' : 's'} seen teaching</span>`);
    return tags.join('');
  }

  // What the school's own UDISE+ return says, and where a resident found otherwise.
  function officialLine(s){
    const o = s.official;
    if (!o) return '';
    const nums = [
      o.enrolment != null ? `${o.enrolment} pupils` : '',
      o.teachers != null ? `${o.teachers} teacher${o.teachers === 1 ? '' : 's'}` : '',
      o.enrolment != null && o.teachers ? `${Math.round(o.enrolment / o.teachers)} pupils per teacher` : '',
      o.classrooms != null ? `${o.classrooms} classrooms` : ''
    ].filter(Boolean);
    const has = OFFICIAL.filter(([k]) => typeof o[k] === 'boolean').map(([k, label]) => `${o[k] ? '✓' : '✗'} ${label}`);
    const gaps = OFFICIAL.filter(([k, , r]) => r && o[k] === true && s[r] === false).map(([, label]) => label);
    if (o.teachers != null && s.teachers_seen != null && s.teachers_seen < o.teachers) gaps.push(`teachers (${s.teachers_seen} of ${o.teachers} seen)`);
    const src = o.source === 'report_card' && /^https:\/\//.test(o.source_url || '')
      ? ` <a href="${esc(o.source_url)}" target="_blank" rel="noopener">from the report card a resident shared, checked by a moderator ↗</a>` : '';
    return `<div class="sc-off">Official record (UDISE+${s.official_year ? ' ' + esc(s.official_year) : ''}): ${esc([...nums, ...has].join(' · '))}${src}</div>` +
      (gaps.length ? `<div class="sc-gap">Records say yes, the latest check found no: ${esc(gaps.join(', '))}</div>` : '');
  }

  // For each thing found missing, how common it is across West Bengal's schools.
  function stateLine(s){
    const miss = [['water_ok', 'water'], ['girls_toilet_ok', 'girls_toilet'], ['electricity_ok', 'electricity']]
      .filter(([k, b]) => s[k] === false && bm(b));
    if (!miss.length) return '';
    return `<div class="sc-bench">Across West Bengal, ${esc(miss.map(([, b]) => `${bm(b).west_bengal}% of schools report ${bm(b).label.toLowerCase()}`).join(', '))} (UDISE+ ${esc(bench.source.year)}).</div>`;
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
        ${officialLine(s)}${s.audits ? stateLine(s) : ''}
        <div class="sc-acts">
          <a href="${checkUrl(s.udise_code)}">${s.audits ? 'Check again' : 'Check this school'}</a>
          ${s.audits && problems(s).length ? `<button type="button" data-rti="${esc(s.udise_code)}">Draft an RTI</button>` : ''}
          <a href="${cardUrl(s.udise_code)}">${s.official ? 'Newer report card? Share it' : 'Share its report card'}</a>
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
    const ranked = [...checked].sort((a, b) => (b.score / b.score_of) - (a.score / a.score_of));
    document.getElementById('sc-bestworst').innerHTML = ranked.length > 1
      ? `Best checked: <a href="#s-${esc(ranked[0].udise_code)}">${esc(ranked[0].name)}</a> (${ranked[0].score}/${ranked[0].score_of}) · Worst: <a href="#s-${esc(ranked.at(-1).udise_code)}">${esc(ranked.at(-1).name)}</a> (${ranked.at(-1).score}/${ranked.at(-1).score_of})`
      : '';
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
           <a class="sc-unchecked-fix" id="sc-unchecked-card" hidden>Share report card</a>
           <a class="sc-unchecked-fix" id="sc-unchecked-fix" hidden>Put on map</a>
         </div>`
      : '<div class="an-empty">Every school here has been checked.</div>';
    const uSel = document.getElementById('sc-unchecked-sel');
    const uGo = document.getElementById('sc-unchecked-go');
    const uFix = document.getElementById('sc-unchecked-fix');
    const uCard = document.getElementById('sc-unchecked-card');
    if (uSel) uSel.addEventListener('change', () => {
      const s = todo.find(x => x.udise_code === uSel.value);
      uGo.disabled = !s;
      if (uCard){ uCard.hidden = !s; if (s) uCard.href = cardUrl(s.udise_code); }
      if (s){
        uFix.hidden = false;
        uFix.href = `kasa.html?fix=${encodeURIComponent(s.udise_code)}`;
        uFix.textContent = s.lat != null || s.seen_lat != null ? 'Fix pin' : 'Put on map';
      } else uFix.hidden = true;
    });
    if (uGo) uGo.addEventListener('click', () => { if (uSel.value) location.href = checkUrl(uSel.value); });
  }

  // "Schools near me": the block you stand in and the schools placed nearby, nearest first.
  set('sc-near-text', `${all.length.toLocaleString('en-IN')} schools in Purulia, ${checked.length.toLocaleString('en-IN')} checked so far. Stand at one, answer a few questions and take one photo: about two minutes.`);
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
  drawCompare();
  drawMap();

  /* How Purulia compares: residents' checks and official records here, beside West Bengal, India and the best and worst state. */
  function drawCompare(){
    const box = document.getElementById('sc-compare');
    if (!bench){ box.innerHTML = '<div class="an-empty">The state and national figures could not be loaded.</div>'; return; }
    const RES = { water: 'water_ok', girls_toilet: 'girls_toilet_ok', electricity: 'electricity_ok' };
    const OFF = { water: 'drinking_water', girls_toilet: 'girls_toilet', boys_toilet: 'boys_toilet', electricity: 'electricity',
                  handwash: 'handwash', library: 'library', playground: 'playground', ramp: 'ramp' };
    const share = (list, get) => {
      const vals = list.map(get).filter(v => typeof v === 'boolean');
      return vals.length ? `${(100 * vals.filter(Boolean).length / vals.length).toFixed(1)}% <small>of ${vals.length}</small>` : '—';
    };
    const ptr = (() => {
      const w = official.filter(s => s.official.enrolment != null && s.official.teachers);
      if (!w.length) return '—';
      const e = w.reduce((a, s) => a + s.official.enrolment, 0), t = w.reduce((a, s) => a + s.official.teachers, 0);
      return `${Math.round(e / t)} <small>all classes, ${w.length} school${w.length === 1 ? '' : 's'}</small>`;
    })();
    const rows = bench.indicators.map(i => {
      const low = i.better === 'low', f = v => low ? String(v) : pct(v);
      const res = RES[i.key] ? share(checked, s => s[RES[i.key]]) : '<small>not checked</small>';
      const off = OFF[i.key] ? share(official, s => s.official[OFF[i.key]]) : i.key === 'ptr_primary' ? ptr : '—';
      return `<tr><td>${esc(i.label)}</td><td class="n">${res}</td><td class="n">${off}</td>
        <td class="n"><strong>${f(i.west_bengal)}</strong> <small>#${i.west_bengal_rank} of ${i.of}</small></td><td class="n">${f(i.india)}</td>
        <td>${esc(i.best.name)} <small>${f(i.best.value)}</small></td><td>${esc(i.worst.name)} <small>${f(i.worst.value)}</small></td></tr>`;
    }).join('');
    box.innerHTML = `<div class="an-table-wrap"><table class="an-table sc-cmp"><thead><tr><th>Indicator</th>
      <th class="n">Purulia: residents found</th><th class="n">Purulia: official</th><th class="n">West Bengal</th><th class="n">India</th>
      <th>Best state/UT</th><th>Worst state/UT</th></tr></thead><tbody>${rows}</tbody></table></div>
      <details class="an-details"><summary>Where these numbers come from</summary>
        <p>West Bengal, India and the best and worst of ${bench.indicators[0].of} states and union territories: <a href="${esc(bench.source.url)}" target="_blank" rel="noopener">${esc(bench.source.title)}</a>, ${esc(bench.source.publisher)}. ${esc(bench.source.note)} Each row is read from the report: ${esc(bench.indicators.map(i => `${i.label}: ${i.cite}, p. ${i.page}`).join('; '))}. Pupils per teacher: lower is better.</p>
        <p>Purulia, residents found: the latest check of each school that answered that question. Purulia, official: the schools' own UDISE+ returns, where loaded${official.length ? ` (${official.length.toLocaleString('en-IN')} schools)` : ' (not loaded yet)'}. A resident's check is what one person saw on one day; UDISE+ is what schools report about themselves. A gap between the two is worth asking about, not proof.</p>
      </details>`;
  }

  /* Map: blocks shaded by the share of schools checked; pins for schools with a known location. */
  function drawMap(){
    if (!window.maplibregl){ document.getElementById('sc-map').hidden = true; return; }
    const key = b => String(b || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/II/g, '2').replace(/I/g, '1');
    const stat = {};
    for (const s of all){ const k = key(s.block_name); (stat[k] ||= { n: 0, c: 0, name: s.block_name }).n++; if (s.audits) stat[k].c++; }
    const colour = s => !s.audits ? '#8a8272' : s.score / s.score_of >= 0.8 ? '#5fae6b' : s.score / s.score_of >= 0.5 ? '#d4882a' : '#d9594c';
    const placedSchools = all.filter(s => s.lat != null && s.lng != null);
    const placed = placedSchools.length;
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
          const f = e.features[0];
          new maplibregl.Popup({ closeButton: false }).setLngLat(e.lngLat)
            .setHTML(`<strong>${esc(f.properties.label)}</strong><br><a href="#sc-list" data-block="${esc(f.properties.listName)}">List its schools ↓</a>`).addTo(map);
        });
        map.on('mouseenter', 'block-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', 'block-fill', () => { map.getCanvas().style.cursor = ''; });
      } catch (err) { console.warn('block outlines unavailable', err); }
      // A 🏫 icon, not a plain dot — the colour ring around it still carries the check status.
      const bounds = new maplibregl.LngLatBounds();
      placedSchools.forEach(s => {
        const el = document.createElement('div');
        el.style.cssText = `width:24px;height:24px;border-radius:50%;background:${colour(s)};border:1px solid #0a0805;` +
          'display:flex;align-items:center;justify-content:center;font-size:13px;cursor:pointer;';
        el.textContent = '🏫';
        new maplibregl.Marker({ element: el })
          .setLngLat([s.lng, s.lat])
          .setPopup(new maplibregl.Popup({ closeButton: false }).setHTML(
            `<strong>${esc(s.name)}</strong><br>${esc([s.village, s.block_name].filter(Boolean).join(', '))}<br>` +
            (s.audits ? `Score ${s.score}/${s.score_of} · checked ${esc(fmt(s.last_audit_at))}` : 'Not checked yet') +
            (s.located === 'checks' ? '<br><small>Location from residents’ checks</small>' : '') +
            `<br><a href="${checkUrl(s.udise_code)}">${s.audits ? 'Check again' : 'Check this school'}</a>` +
            ` · <a href="kasa.html?fix=${encodeURIComponent(s.udise_code)}">Wrong place? Fix it</a>`))
          .addTo(map);
        bounds.extend([s.lng, s.lat]);
      });
      if (placed > 1) map.fitBounds(bounds, { padding: 50, maxZoom: 12 });
    });
    document.getElementById('sc-map').addEventListener('click', e => {
      const a = e.target.closest('[data-block]');
      if (!a) return;
      sel.value = a.dataset.block;
      render();
    });
  }
})();
