/* index.html: hero, ticker and "Numbers that demand action" for the chosen district,
 * from places/wb_district_facts.json (place-facts.js), places/wb/index.json (blocks,
 * gram panchayats) and places/wb_towns.geojson (municipalities, 2022 SEC ward counts).
 * Purulia keeps the hand-written page; any other district swaps in its own figures and
 * hides the Purulia-only sections (data-only="purulia"). */
(() => {
  const PF = window.PlaceFacts, esc = PF.esc, n = PF.n;
  const $ = s => document.querySelector(s);
  const getJSON = u => fetch(u).then(r => r.ok ? r.json() : null).catch(() => null);
  const lakh = v => v >= 1e7 ? (v / 1e7).toFixed(2) + 'Cr' : (v / 1e5).toFixed(1) + 'L';

  function render(slug, local, towns) {
    const D = PF.data, d = D.districts[slug], N = D.nfhs, S = D.sources;
    const isKol = slug === 'kolkata', where = isKol ? d.name : `${d.name} district`;
    document.querySelectorAll('[data-only]').forEach(e => { e.hidden = e.dataset.only !== slug; });
    document.querySelectorAll('.home-dname').forEach(e => { e.textContent = d.name; });

    // Hero.
    const l2 = $('#hero .l2'); l2.dataset.final = l2.textContent = `of ${d.name}.`;
    $('#hero .l3').textContent = 'Parishkar Bengal';
    document.querySelectorAll('.k-wordmark-second').forEach(e => { e.textContent = 'Bengal'; });
    const ft = $('.ft-brand > span:last-child'); if (ft) ft.textContent = `The public record of ${d.name}`;
    $('#hero .h-lead').innerHTML = `Every civic problem across ${esc(where)} — <strong>garbage, drains, roads, schools, health centres, water</strong> — on one public map.<br>${isKol ? 'Every ward.' : 'Every block. Every municipality. Every ward.'}<br><strong>Nothing is marked fixed until people on the spot confirm it.</strong>`;

    const L = local && local.districts && local.districts[slug];
    const T = (towns && towns.features || []).map(f => f.properties).filter(p => p.district === slug);
    const wards = T.reduce((a, p) => a + (p.wards || 0), 0);
    const bar = [];
    if (L) bar.push([L.blocks, 'Blocks'], [L.gps, 'Gram panchayats']);
    if (isKol) bar.push([1, 'Municipal corporation'], [144, 'Municipal wards']);
    else if (T.length) bar.push([T.length, T.length === 1 ? 'Municipality' : 'Municipalities'], [wards, 'Municipal wards']);
    if (d.census2011 && d.census2011.population) bar.push([lakh(d.census2011.population), 'People (Census 2011)']);
    $('#hero .h-bar').innerHTML = bar.map(([v, l]) => `<div class="hb"><div class="hb-n">${esc(v)}</div><div class="hb-l">${esc(l)}</div></div>`).join('') ||
      `<div class="hb"><div class="hb-l">No sourced counts yet for ${esc(d.name)}. <a href="grievance.html">Add a source</a></div></div>`;

    // The four NFHS-5 indicators where this district does worst among West Bengal's 20.
    const nfName = d.nfhs_district, v = N.districts[nfName] || {};
    const shared = d.nfhs_part_of ? ` Surveyed as part of ${esc(d.nfhs_part_of)} before the split.` : '';
    const worst = Object.keys(N.indicators).filter(k => v[k] && v[k][0] != null)
      .map(k => [k, PF.rank(k, nfName)]).sort((a, b) => a[1].pos - b[1].pos).slice(0, 4);
    const stat = (val, cls, label, note) => `<div class="crisis-stat"><div class="cs-val ${cls}">${val}</div>` +
      `<div class="cs-label">${esc(label)}</div><div class="cs-note">${note}</div></div>`;
    const cards = [], tick = [];
    worst.forEach(([k, r]) => {
      const ind = N.indicators[k], [a, b] = v[k], wb = N.west_bengal[k];
      const bad = ind.higher_is_better ? a < wb : a > wb;
      const chg = b == null ? '' : a === b ? ' Same as NFHS-4.' : ` ${a > b ? 'Up' : 'Down'} from ${b}% in NFHS-4.`;
      const rt = PF.rankText(r);
      cards.push(stat(`${a}%`, bad ? 'bad' : 'good', ind.label,
        `${chg} ${rt.charAt(0).toUpperCase() + rt.slice(1)}. West Bengal: ${wb}%.${shared} <a href="#src-nfhs5" class="src-link">Source</a>`));
      tick.push(`${ind.label}: ${a}% (${rt}) — NFHS-5`);
    });
    if (!worst.length) cards.push(stat('—', 'neutral', 'Health survey', `No NFHS-5 figures found for ${esc(d.name)}. <a href="grievance.html" class="src-link">Add a source</a>`));
    if (d.jjm && d.jjm.pct != null) {
      const j = d.jjm;
      cards.push(stat(`${j.pct}%`, j.rank_wb > j.of_wb / 2 ? 'bad' : 'good', 'Rural homes with a tap connection',
        `${n(j.tap)} of ${n(j.homes)} homes. Ranked ${j.rank_wb} of ${j.of_wb} West Bengal districts (1 = most homes connected). <a href="#src-jjm" class="src-link">Source</a>`));
      tick.push(`Rural homes with a tap: ${j.pct}% — Jal Jeevan Mission`);
    }
    cards.push(stat(d.aspirational ? 'Included' : 'Not included', 'neutral', 'NITI Aayog Aspirational Districts Programme',
      `${d.aspirational ? `${esc(d.name)} is one of the 112 districts` : `${esc(d.name)} is not on the list of 112 districts`}. West Bengal's five are Birbhum, Dakshin Dinajpur, Maldah, Murshidabad and Nadia. <a href="#src-lds" class="src-link">Source</a>`));
    tick.push(`${d.name} ${d.aspirational ? 'is' : 'is not'} among NITI Aayog's 112 Aspirational Districts`);
    $('#crisis .crisis-grid').innerHTML = cards.join('');
    $('#crisis .ss').innerHTML = `From NFHS-5 (2019–21), the government's own district health survey, unless noted: the indicators where ${esc(d.name)} ranks lowest among West Bengal's 20 surveyed districts. Every figure links to its source below. <a href="data.html?d=${esc(slug)}" class="src-link">All of ${esc(d.name)}'s figures</a>`;
    tick.push(`Parishkar Bengal · ${d.name} · West Bengal`);
    $('.ticker-t').innerHTML = tick.concat(tick).map(s => `<span class="ti">${esc(s)}</span>`).join('');

    // About, from Wikipedia, in place of Purulia's own case.
    const about = $('#homeAbout');
    if (about && d.about && d.about.text) {
      const rev = d.wikipedia && d.about.revid ? `${d.wikipedia.replace('/wiki/', '/w/index.php?title=')}&oldid=${d.about.revid}` : d.wikipedia;
      about.querySelector('p').innerHTML = `${esc(d.about.text)} <a href="${esc(rev)}" target="_blank" rel="noopener" class="src-link">Wikipedia</a>`;
      about.hidden = false;
    }

    // Sources.
    $('#src-nfhs5').innerHTML = `<strong>National Family Health Survey (NFHS-5), 2019–21</strong>, Government of India, Ministry of Health and Family Welfare. District fact sheet for ${esc(nfName)}. <a href="${esc(S.nfhs.url)}" target="_blank" rel="noopener">rchiips.org/nfhs</a>`;
    $('#src-census').innerHTML = d.census2011 && d.census2011.population
      ? `<strong>Census of India 2011</strong>, via <a href="${esc(d.wikidata)}" target="_blank" rel="noopener">Wikidata</a>: ${esc(d.name)} population ${n(d.census2011.population)}.`
      : `<strong>Census of India 2011</strong>: ${esc(d.name)} was created after 2011 and has no separate Census figure. <a href="${esc(d.wikidata)}" target="_blank" rel="noopener">Add it on Wikidata</a>`;
    const jjm = $('#src-jjm');
    if (jjm) { jjm.hidden = !d.jjm; jjm.querySelector('a').href = S.jjm.url; }
    const towns_ = $('#src-towns');
    if (towns_) towns_.hidden = !T.length && !L;
  }

  PF.load().then(() => {
    const slug = PF.current();
    const pick = $('#homePick');
    if (pick) { PF.picker(pick, slug, () => location.reload()); pick.closest('.gt-pick').hidden = false; }
    if (slug === 'purulia') return;
    return Promise.all([getJSON('places/wb/index.json'), getJSON('places/wb_towns.geojson')])
      .then(([local, towns]) => render(slug, local, towns));
  }).catch(() => {});
})();
