/* money.html: tax collected, money spent, and what the auditor flagged, by state, plus the MP
 * fund by seat. Data: places/money.json (tools/build-money.py: RBI Handbook, MPLADS via
 * Empowered Indian, CAG State Finances Audit Reports copied with page and quote).
 * Every figure links to its source; a state or seat with no figure shows "not on file".
 * The state follows ?s=<state slug>, else the place last opened on the map, else West Bengal.
 */
(() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const slug = s => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const cr = v => v == null ? '—' : '₹' + Math.round(v).toLocaleString('en-IN') + ' cr';
  const pct = v => v == null ? '—' : (Math.round(v * 10) / 10).toLocaleString('en-IN') + '%';
  const link = (u, t) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(t)}</a>`;

  // What the auditor's figures mean, in plain words. Order = order on the page.
  const FLAGS = {
    budget_unspent: ['Budget passed but not spent', 'Money the Assembly approved that was not used in the year. Unspent is not the same as wasted: it can mean work that never started.'],
    ucs_pending: ['Grants with no proof of use yet', 'Money already given out (to departments, bodies, panchayats) for which no utilisation certificate, the paper showing what it was spent on, had reached the auditor.'],
    excess_unregularised: ['Spent over budget, not yet approved', 'Spending beyond what the Assembly passed, from earlier years, still waiting for the Assembly to approve it (Article 205 of the Constitution).'],
    excess_year: ['Spent over budget this year', 'Spending beyond the amount passed for those grants in the year.'],
    supp_unneeded: ['Extra budget asked for, not needed', 'Supplementary money passed in the year when spending did not reach even the original amount.'],
    sna_unspent: ['Scheme money sitting in bank accounts', 'Central and state money for central schemes lying unspent in the scheme agencies’ bank accounts at year end.'],
    cess_kept: ['Cess collected, not passed on', 'Cess money collected for a set purpose but kept in the general account instead of the fund it belongs to.'],
    misclassified: ['Running costs shown as building costs', 'Day-to-day spending booked as capital (asset-building) spending, which makes capital spending look bigger.'],
    ac_bills: ['Advances drawn, bills not settled', 'Money drawn in advance on abstract contingent bills, with the detailed bill showing what it bought still not filed.'],
  };
  const LAYERS = {
    selfPaid: { label: 'Own taxes as % of spending', unit: '%', note: 'RBI, 2022-23 accounts: the state’s own tax revenue ÷ (revenue + capital expenditure).' },
    unspent: { label: 'Budget left unspent', unit: '%', note: 'CAG State Finances Audit Report: savings as a share of the budget provision.' },
    ucs: { label: 'Grants with no proof of use', unit: 'cr', note: 'CAG State Finances Audit Report: utilisation certificates not received, ₹ crore, as of the date in the report.' },
    mplads: { label: 'MP fund spent (Lok Sabha)', unit: '%', note: 'MPLADS, sitting Lok Sabha MPs: amount spent ÷ amount allocated so far this term.' },
    seats: { label: 'MP fund spent by seat (West Bengal)', unit: '%', note: 'MPLADS per Lok Sabha seat, drawn on its assembly segments: spent ÷ allocated so far.' },
  };

  let D, MP, LEAD, states = [], cur = null, layer = 'selfPaid', map = null, geo = null, seats = null;

  const fig = (s, k) => ((D.audit[s] || {}).figures || []).find(f => f.k === k);
  function metric(s, k) {
    const r = D.rbi.states[s], a = D.audit[s];
    if (k === 'selfPaid') return r && r.ownTax != null && r.revExp && r.capExp != null ? 100 * r.ownTax / (r.revExp + r.capExp) : null;
    if (k === 'unspent') { const f = fig(s, 'budget_unspent'); return f ? f.pct : null; }
    if (k === 'ucs') { const f = fig(s, 'ucs_pending'); return f ? f.crore : null; }
    if (k === 'mplads') { const m = (D.mplads.states[s] || {}).ls; return m && m.allocated ? 100 * m.spent / m.allocated : null; }
    return a ? null : null;
  }

  // Five steps of one hue: darker = more. For "own taxes" more is better, for the rest less is.
  const RAMP = ['#f3dcae', '#e8b665', '#DD3333', '#a35f12', '#6b3a05'];
  const BG = getComputedStyle(document.body).backgroundColor || '#0a0805';
  const DARK = (() => { const m = BG.match(/\d+/g); return m ? (+m[0] + +m[1] + +m[2]) < 384 : true; })();
  const NONE = DARK ? '#2a2620' : '#d9d4ca', EDGE = DARK ? '#0a0805' : '#ffffff', ON = DARK ? '#f0e6d0' : '#1a1410';
  function color(v, vals) {
    if (v == null) return NONE;
    const s = vals.filter(x => x != null).sort((a, b) => a - b);
    const i = s.length < 2 ? 4 : Math.min(4, Math.floor(5 * s.indexOf(v) / s.length));
    return RAMP[i];
  }

  function pickState() {
    const q = new URLSearchParams(location.search).get('s');
    const bySlug = Object.fromEntries(states.map(s => [slug(s), s]));
    if (q && bySlug[q]) return bySlug[q];
    try {
      const k = localStorage.getItem('parishkar_place') || '';
      const m = k.match(/^in:([^:]+)/);
      if (m && bySlug[m[1]]) return bySlug[m[1]];
    } catch (e) {}
    return 'West Bengal';
  }

  function tile(n, l, s) {
    return `<div class="an-tile"><div class="an-tile-n">${n}</div><div class="an-tile-l">${esc(l)}</div><div class="an-tile-s">${s}</div></div>`;
  }

  function renderState() {
    const s = cur, a = D.audit[s], r = D.rbi.states[s], m = (D.mplads.states[s] || {}).ls;
    $('mn-state-name').textContent = s;
    const own = a && fig(s, 'own_tax'), tot = a && fig(s, 'total_exp'), prov = fig(s, 'budget_provision'),
      spent = fig(s, 'budget_spent'), uns = fig(s, 'budget_unspent'), ucs = fig(s, 'ucs_pending'), be = fig(s, 'own_tax_be');
    const src = f => f ? link(f.url, (f.where || 'source')) : '';
    const rbiSrc = k => link(D.rbi.tables[k].url, 'RBI ' + D.rbi.tables[k].title.split(':')[0]);
    const t = [];
    if (own) t.push(tile(cr(own.crore), `Own taxes collected, ${a.year}`, (be ? `${pct(100 * own.crore / be.crore)} of the ${cr(be.crore)} the budget expected · ` : '') + src(own)));
    else if (r && r.ownTax != null) t.push(tile(cr(r.ownTax), `Own taxes collected, ${D.rbi.year}`, rbiSrc('ownTax')));
    if (own && tot) t.push(tile(pct(100 * own.crore / tot.crore), 'of spending paid by own taxes', `${cr(own.crore)} ÷ ${cr(tot.crore)} total spending · ${src(tot)}`));
    else if (metric(s, 'selfPaid') != null) t.push(tile(pct(metric(s, 'selfPaid')), `of spending paid by own taxes, ${D.rbi.year}`, `${cr(r.ownTax)} ÷ ${cr(r.revExp + r.capExp)} (revenue + capital) · ${rbiSrc('revExp')}, ${rbiSrc('capExp')}`));
    if (prov && spent) t.push(tile(pct(100 * spent.crore / prov.crore), `of the budget used, ${a.year}`, `${cr(spent.crore)} spent of ${cr(prov.crore)} passed · ${src(spent)}`));
    else t.push(tile('Not on file', 'Budget used', 'No budget-versus-spending figure copied for this state yet.'));
    if (uns) t.push(tile(cr(uns.crore), 'Budget not spent', `${pct(uns.pct)} of the budget · ${src(uns)}`));
    if (ucs) t.push(tile(cr(ucs.crore), 'Grants with no proof of use', `as of ${esc(ucs.asof || a.year)} · ${src(ucs)}`));
    if (m) t.push(tile(pct(100 * m.spent / m.allocated), 'MP fund spent', `${cr(m.spent / 1e7)} of ${cr(m.allocated / 1e7)} allocated, ${m.mps} Lok Sabha MPs · ${link(D.mplads.page, 'MPLADS')}`));
    $('mn-tiles').innerHTML = t.join('');

    // Where the money came from, when the audit report gives the split.
    const parts = [['own_tax', 'Own taxes'], ['union_share', 'Share of central taxes'], ['grants', 'Grants from the Centre'], ['non_tax', 'Fees and other own income'], ['borrowed', 'Borrowed (net)']]
      .map(([k, l]) => [fig(s, k), l]).filter(([f]) => f);
    const sum = parts.reduce((x, [f]) => x + f.crore, 0);
    $('mn-came').innerHTML = parts.length ? `<p class="an-card-sub">${esc(a.year)}, ₹ crore. Total ${cr(sum)} (the report's total receipts, which also count small loan recoveries).</p>` +
      parts.map(([f, l]) => `<div class="mn-bar"><span class="mn-bar-l">${esc(l)}</span><span class="mn-bar-t"><span style="width:${(100 * f.crore / sum).toFixed(1)}%"></span></span><span class="mn-bar-n">${cr(f.crore)} · ${pct(100 * f.crore / sum)}</span><span class="mn-bar-s">${src(f)}</span></div>`).join('')
      : `<p class="an-empty">Not on file for ${esc(s)}: the split of where the state's money came from is copied only from a CAG report so far.</p>`;

    // The auditor's own flags, each with its words.
    const flags = Object.keys(FLAGS).map(k => [k, fig(s, k)]).filter(([, f]) => f);
    $('mn-flags').innerHTML = a ? `<p class="an-card-sub">${link(a.page, a.report)}</p>` + (flags.length ? flags.map(([k, f]) => `
      <details class="mn-flag"><summary><span class="mn-flag-n">${cr(f.crore)}${f.pct != null ? ` <small>(${pct(f.pct)})</small>` : ''}</span><span class="mn-flag-l">${esc(FLAGS[k][0])}${f.asof ? ` <small>as of ${esc(f.asof)}</small>` : ''}</span></summary>
      <p>${esc(FLAGS[k][1])}</p><blockquote>${esc(f.quote)}</blockquote><p class="wk-small">${src(f)}</p></details>`).join('') : '')
      : `<p class="an-empty">No CAG figures copied for ${esc(s)} yet. Its State Finances Audit Report is listed on <a href="https://cag.gov.in/en/audit-report" target="_blank" rel="noopener">cag.gov.in</a>; send a figure and its page with "Suggest a correction" below.</p>`;
    try { history.replaceState(null, '', '?s=' + slug(s) + location.hash); } catch (e) {}
  }

  function renderTable() {
    const L = LAYERS[layer === 'seats' ? 'mplads' : layer];
    const rows = states.map(s => [s, metric(s, layer === 'seats' ? 'mplads' : layer)]).sort((a, b) => (b[1] ?? -1) - (a[1] ?? -1));
    $('mn-table').innerHTML = `<table class="an-table"><thead><tr><th>State</th><th>${esc(L.label)}</th></tr></thead><tbody>` +
      rows.map(([s, v]) => `<tr><td><a href="?s=${slug(s)}" data-s="${esc(s)}">${esc(s)}</a></td><td>${v == null ? '<span class="ad-over">not on file</span>' : (L.unit === 'cr' ? cr(v) : pct(v))}</td></tr>`).join('') + '</tbody></table>';
  }

  function seatPct(pc) { const r = MP.pc[pc]; return r && r.allocated ? 100 * r.spent / r.allocated : null; }

  function paint() {
    $('mn-layer-note').textContent = LAYERS[layer].note;
    if (!map || !map.getSource('st')) return;
    const isSeats = layer === 'seats';
    map.setLayoutProperty('st-fill', 'visibility', isSeats ? 'none' : 'visible');
    if (map.getLayer('seat-fill')) map.setLayoutProperty('seat-fill', 'visibility', isSeats ? 'visible' : 'none');
    if (isSeats && !seats) return;
    if (isSeats) {
      const vals = Object.keys(MP.pc).map(seatPct);
      seats.features.forEach(f => { f.properties.c = color(seatPct(String(f.properties.pc)), vals); });
      map.getSource('seats').setData(seats);
      map.fitBounds([[85.8, 21.5], [89.9, 27.3]], { padding: 20, duration: 0 });
    } else {
      const vals = states.map(s => metric(s, layer));
      geo.features.forEach(f => { f.properties.c = color(metric(f.properties.state, layer), vals); f.properties.on = f.properties.state === cur ? 1 : 0; });
      map.getSource('st').setData(geo);
      map.fitBounds([[68, 6.5], [97.5, 37.2]], { padding: 10, duration: 0 });
    }
    renderTable();
  }

  function popup(lngLat, html) {
    new maplibregl.Popup({ closeButton: true, maxWidth: '280px' }).setLngLat(lngLat).setHTML(html).addTo(map);
  }

  function initMap() {
    if (!window.maplibregl) { $('mn-map').innerHTML = '<p class="an-empty">The map did not load. The table below has the same figures.</p>'; return; }
    map = new maplibregl.Map({ container: 'mn-map', style: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': BG } }] },
      bounds: [[68, 6.5], [97.5, 37.2]], attributionControl: false, dragRotate: false });
    map.addControl(new maplibregl.AttributionControl({ customAttribution: 'Outlines: LGD (CC0), ECI segments' }));
    map.on('load', () => {
      map.addSource('st', { type: 'geojson', data: geo });
      map.addLayer({ id: 'st-fill', type: 'fill', source: 'st', paint: { 'fill-color': ['get', 'c'], 'fill-opacity': 0.92 } });
      map.addLayer({ id: 'st-line', type: 'line', source: 'st', paint: { 'line-color': ['case', ['==', ['get', 'on'], 1], ON, EDGE], 'line-width': ['case', ['==', ['get', 'on'], 1], 2, 0.6] } });
      map.addSource('seats', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'seat-fill', type: 'fill', source: 'seats', layout: { visibility: 'none' }, paint: { 'fill-color': ['get', 'c'], 'fill-opacity': 0.92, 'fill-outline-color': EDGE } });
      map.on('click', 'st-fill', e => {
        if (layer === 'seats') return;
        const s = e.features[0].properties.state, v = metric(s, layer), L = LAYERS[layer];
        popup(e.lngLat, `<b>${esc(s)}</b><br>${esc(L.label)}: ${v == null ? 'not on file' : (L.unit === 'cr' ? cr(v) : pct(v))}<br><a href="#" data-s="${esc(s)}">Open this state ↓</a>`);
      });
      map.on('click', 'seat-fill', e => {
        const pc = String(e.features[0].properties.pc), r = MP.pc[pc], l = (LEAD.pc || {})[pc] || {};
        popup(e.lngLat, `<b>${esc(l.name || 'Seat ' + pc)}</b>${l.person ? ` · ${esc(l.person)}` : ''}<br>` + (r ? `Spent ${cr(r.spent / 1e7)} of ${cr(r.allocated / 1e7)} (${pct(seatPct(pc))})<br>${r.worksCompleted} of ${r.worksRecommended} works completed<br>${link(r.url, 'MPLADS record')} · <a href="kasa.html?rep=pc:${esc(pc)}">MP's page</a>` : 'Not on file (seat vacant or no MPLADS figures)'));
      });
      ['st-fill', 'seat-fill'].forEach(id => { map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer'; }); map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; }); });
      paint();
    });
  }

  function choose(s) { if (!s || !D) return; cur = s; $('mn-pick').value = s; renderState(); paint(); }

  document.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('[data-s]');
    if (!a) return;
    e.preventDefault();
    choose(a.getAttribute('data-s'));
    $('mn-state').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  Promise.all(['places/money.json', 'places/in_states.geojson', 'places/wb_mplads.json', 'places/wb_leaders.json']
    .map(u => fetch(u).then(r => { if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); })))
    .then(([d, g, mp, lead]) => {
      D = d; geo = g; MP = mp; LEAD = lead;
      states = g.features.map(f => f.properties.state).sort();
      $('mn-updated').textContent = 'Figures checked ' + d.checked;
      $('mn-pick').innerHTML = states.map(s => `<option>${esc(s)}</option>`).join('');
      $('mn-pick').addEventListener('change', e => choose(e.target.value));
      $('mn-layer').innerHTML = Object.entries(LAYERS).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('');
      $('mn-layer').addEventListener('change', e => { layer = e.target.value; paint(); if (layer === 'seats' && !seats) loadSeats(); });
      $('mn-missing').innerHTML = d.missing.map(m => `<tr><td>${esc(m.what)}</td><td>${esc(m.where)}</td><td>${esc(m.why)}</td></tr>`).join('');
      $('mn-src').innerHTML = [
        link(d.rbi.page, d.rbi.title) + ` (${esc(d.rbi.year)}; ` + Object.values(d.rbi.tables).map(t => link(t.url, t.title.split(':')[0])).join(', ') + ')',
        link(d.mplads.page, d.mplads.title) + ` (checked ${esc(d.mplads.checked)}; West Bengal seats from ${link(mp.source, 'the same source')}, checked ${esc(mp.checked)})`,
        'CAG State Finances Audit Reports: ' + Object.entries(d.audit).map(([s, a]) => link(a.page, `${s} ${a.year}`)).join(', '),
      ].map(x => `<li>${x}</li>`).join('');
      choose(pickState());
      initMap();
    })
    .catch(err => { $('mn-updated').textContent = 'Could not load the figures (' + err.message + ').'; });

  function loadSeats() {
    fetch('places/wb_assembly.geojson').then(r => r.json()).then(g => { seats = g; paint(); });
  }
})();
