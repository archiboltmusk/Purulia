/* data.html (Ground Truth): cards and charts for the chosen district, from
 * places/wb_district_facts.json via place-facts.js. Hand-written cards marked
 * data-only="<slug>" show only on that district. */
(() => {
  const PF = window.PlaceFacts, esc = PF.esc, n = PF.n;
  let charts = [], chartsWanted = false;

  const pct = v => v == null ? '—' : v + '%';
  const src = (label, url) => url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(label)}</a>` : esc(label);

  function card(label, val, cls, desc, source) {
    return `<div class="gt-card gt-auto"><div class="gt-card-label">${esc(label)}</div>` +
      `<div class="gt-card-val ${cls}">${val}</div><div class="gt-card-desc">${desc}</div>` +
      `<div class="gt-card-src">Source: ${source}</div></div>`;
  }
  function missing(label, what, fix) {
    return `<div class="gt-card gt-card-note gt-auto"><div class="gt-card-label">${esc(label)}</div>` +
      `<div class="gt-card-desc">${what} ${fix}</div></div>`;
  }

  function render(slug) {
    const D = PF.data, d = D.districts[slug], S = D.sources, N = D.nfhs;
    document.querySelectorAll('.gt-dname').forEach(e => { e.textContent = d.name; });
    document.title = `Ground Truth: ${d.name} — Parishkar Bengal`;
    document.querySelectorAll('#gtGrid [data-only]').forEach(e => { e.hidden = e.dataset.only !== slug; });
    document.querySelectorAll('#gtGrid .gt-auto').forEach(e => e.remove());

    const about = document.getElementById('gtAbout');
    if (d.about && d.about.text) {
      const rev = d.wikipedia && d.about.revid ? `${d.wikipedia.replace('/wiki/', '/w/index.php?title=')}&oldid=${d.about.revid}` : d.wikipedia;
      about.innerHTML = `${esc(d.about.text)} <a href="${esc(rev)}" target="_blank" rel="noopener">Wikipedia</a>`;
      about.hidden = false;
    } else about.hidden = true;
    const up = document.getElementById('gtUpdated');
    up.textContent = `Figures refreshed ${D.generated}.`; up.hidden = false;

    const nfhsName = d.nfhs_district, v = (N.districts[nfhsName] || {});
    const nfhsSrc = src(`NFHS-5 District Fact Sheet, ${nfhsName} (2019–21), IIPS / MoHFW`, S.nfhs && S.nfhs.url);
    const shared = d.nfhs_part_of
      ? ` NFHS-5 surveyed ${esc(d.name)} as part of ${esc(d.nfhs_part_of)} district, before it was split, so this is ${esc(d.nfhs_part_of)}'s figure.` : '';
    const worse = (k, x) => x != null && N.west_bengal[k] != null && (N.indicators[k].higher_is_better ? x < N.west_bengal[k] : x > N.west_bengal[k]);
    const change = k => {
      const [a, b] = v[k] || [];
      if (a == null || b == null) return '';
      return a === b ? ` Same as NFHS-4 (2015–16).` : ` ${a > b ? 'Up' : 'Down'} from ${b}% in NFHS-4 (2015–16).`;
    };
    const place = k => {
      const r = PF.rank(k, nfhsName);
      return r.pos ? ` The ${PF.rankText(r)} (median ${r.median}%). West Bengal: ${N.west_bengal[k]}%. India: ${N.india[k]}%.` : '';
    };
    const nf = (k, label, desc, extra) => {
      const x = v[k] && v[k][0];
      if (x == null) return '';
      return card(label, pct(x), worse(k, x) ? 'bad' : 'ok', desc + change(k) + place(k) + (extra || '') + shared, nfhsSrc);
    };
    const also = (k, text) => v[k] && v[k][0] != null ? ` ${text.replace('%', v[k][0] + '%')}` : '';

    const cards = [];
    if (!N.districts[nfhsName]) cards.push(missing('Health survey', `No NFHS-5 figures found for ${esc(d.name)}.`, 'If you know the fact sheet, <a href="grievance.html">tell us</a>.'));
    cards.push(nf('child_anaemia', 'Child Anaemia', 'Children aged 6–59 months who are anaemic.', also('women_anaemia', '% of women aged 15–49 are anaemic too.')));
    cards.push(nf('underweight', 'Underweight Children', 'Children under 5 who are underweight.', also('stunted', '% are stunted') + (v.wasted && v.wasted[0] != null ? ` and ${v.wasted[0]}% wasted.` : '')));
    cards.push(nf('women_literate', "Women's Literacy", 'Women aged 15–49 who can read and write.', also('women_10yrs', 'Only % of women have 10 or more years of schooling.')));
    cards.push(nf('sanitation', 'Improved Sanitation', 'People living in households that use an improved toilet. NFHS measures the type of toilet used, a different measure from the ODF declaration.'));
    cards.push(nf('clean_fuel', 'Clean Cooking Fuel', 'Households cooking with clean fuel such as LPG.'));
    cards.push(nf('child_marriage', 'Child Marriage', 'Women aged 20–24 who were married before 18.', also('inst_births', 'Births in a hospital or clinic: %.')));
    cards.push(nf('anc4', 'Antenatal Care', 'Mothers who had at least four antenatal check-ups.'));

    const j = d.jjm;
    if (j) cards.push(card('Tap Water at Home', j.pct + '%', j.pct < 100 ? 'bad' : 'good',
      `Rural homes with a tap connection under the Jal Jeevan Mission: ${n(j.tap)} of ${n(j.homes)}. Number ${j.rank_wb} of West Bengal's ${j.of_wb} districts on the dashboard, and ${n(j.rank_india)} of ${n(j.of_india)} districts in India.`,
      `${src('JJM dashboard, Ministry of Jal Shakti', S.jjm && S.jjm.url)}, read ${esc(S.jjm && S.jjm.read)}`));
    else if (slug !== 'kolkata') cards.push(missing('Tap Water at Home', `The Jal Jeevan Mission dashboard lists no figure for ${esc(d.name)}.`, ''));

    const c = d.census2011;
    const wd = d.wikidata ? src('Census of India 2011, via Wikidata', d.wikidata) : 'Census of India 2011';
    if (c && c.population) {
      const bits = [];
      if (d.area_km2) bits.push(`${n(d.area_km2)} km², about ${n(Math.round(c.population / d.area_km2))} people per km²`);
      if (c.male && c.female) bits.push(`${n(Math.round(c.female / c.male * 1000))} women for every 1,000 men`);
      if (c.urban != null) bits.push(`${(c.urban / c.population * 100).toFixed(1)}% in towns`);
      if (c.households) bits.push(`${n(c.households)} households`);
      cards.push(card('People (Census 2011)', n(c.population), 'ok',
        `${esc(d.name)} district${d.hq ? `, headquarters ${esc(d.hq)}` : ''}. ${bits.join('; ')}.`.replace('; .', '.'), wd));
    } else {
      const edit = d.wikidata ? `<a href="${esc(d.wikidata)}" target="_blank" rel="noopener">Add them on Wikidata</a> with a Census citation and this page picks them up at the next monthly refresh.` : '';
      cards.push(missing('People (Census 2011)', `Census 2011 counts for ${esc(d.name)} are not on Wikidata yet (the district was formed after 2011).`, edit));
    }

    cards.push(card('Aspirational District?', d.aspirational ? 'Yes' : 'No', d.aspirational ? 'bad' : 'ok',
      d.aspirational ? `${esc(d.name)} is one of NITI Aayog's 112 Aspirational Districts, picked for extra central attention on health, schooling, farming and basic services.`
        : `${esc(d.name)} is not in NITI Aayog's Aspirational Districts Programme. The West Bengal districts on the list of 112 are Birbhum, Dakshin Dinajpur, Maldah, Murshidabad, and Nadia.`,
      src('Aspirational Districts Programme, NITI Aayog', S.niti && S.niti.url)));

    document.getElementById('gtGrid').insertAdjacentHTML('afterbegin', cards.join(''));
    const note = document.getElementById('gtSmNote');
    note.hidden = slug === 'purulia';
    note.innerHTML = `These proposals were written for Purulia. None are written for ${esc(d.name)} yet: <a href="noticeboard.html">raise a demand</a> or <a href="grievance.html">send one</a>.`;
    drawCharts(slug);
  }

  function drawCharts(slug) {
    if (!chartsWanted || typeof Chart === 'undefined') return;
    charts.forEach(c => c.destroy()); charts = [];
    const D = PF.data, d = D.districts[slug], v = D.nfhs.districts[d.nfhs_district];
    if (!v) return;
    const med = k => PF.rank(k, d.nfhs_district).median;
    const x = k => v[k] ? v[k][0] : null, old = k => v[k] ? v[k][1] : null;
    const r = a => 'rgba(212,136,42,' + a + ')', rd = a => 'rgba(224,80,80,' + a + ')', gr = a => 'rgba(107,174,138,' + a + ')';
    const F = { family: 'DM Mono, monospace', size: 10 }, TC = 'rgba(240,230,208,0.4)', GC = 'rgba(212,136,42,0.07)';
    const legend = { labels: { color: 'rgba(240,230,208,.55)', font: F, boxWidth: 10, padding: 10 } };
    const tip = { callbacks: { label: c => (c.dataset.label ? c.dataset.label + ': ' : '') + c.raw + '%' } };
    const inv = y => y == null ? null : Math.round((100 - y) * 10) / 10;
    const name = d.name;

    charts.push(new Chart(document.getElementById('chartIncome'), {
      type: 'bar',
      data: {
        labels: ['Women literate', 'Improved sanitation', 'Children not anaemic', 'Children not underweight'],
        datasets: [
          { label: name, data: [x('women_literate'), x('sanitation'), inv(x('child_anaemia')), inv(x('underweight'))], backgroundColor: rd(.7), borderColor: '#E05050', borderWidth: 1 },
          { label: 'Median WB district', data: [med('women_literate'), med('sanitation'), inv(med('child_anaemia')), inv(med('underweight'))], backgroundColor: r(.6), borderColor: '#D4882A', borderWidth: 1 }
        ]
      },
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend, tooltip: tip },
        scales: { x: { grid: { color: GC }, min: 0, max: 100, ticks: { callback: t => t + '%', color: TC, font: F } }, y: { grid: { display: false }, ticks: { color: 'rgba(240,230,208,.65)', font: F } } } }
    }));

    const ks = ['sanitation', 'clean_fuel', 'inst_births', 'child_marriage', 'child_anaemia', 'underweight'];
    charts.push(new Chart(document.getElementById('chartIndicators'), {
      type: 'bar',
      data: {
        labels: ['Improved sanitation', 'Clean cooking fuel', 'Institutional births', 'Child marriage', 'Child anaemia', 'Child underweight'],
        datasets: [
          { label: 'NFHS-4 (2015–16)', data: ks.map(old), backgroundColor: r(.6), borderColor: '#D4882A', borderWidth: 1 },
          { label: 'NFHS-5 (2019–21)', data: ks.map(x), backgroundColor: gr(.6), borderColor: '#6BAE8A', borderWidth: 1 }
        ]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend, tooltip: tip },
        scales: { x: { grid: { color: GC }, ticks: { color: TC, font: { family: 'DM Mono, monospace', size: 9 }, maxRotation: 20 } }, y: { grid: { color: GC }, min: 0, max: 100, ticks: { callback: t => t + '%', color: TC, font: F } } } }
    }));

    const kids = [['Anaemic', 'child_anaemia'], ['Underweight', 'underweight'], ['Stunted', 'stunted'], ['Wasted', 'wasted']];
    charts.push(new Chart(document.getElementById('chartChildren'), {
      type: 'bar',
      data: {
        labels: kids.flatMap(([l]) => [`${l} (${name})`, `${l} (median district)`]),
        datasets: [{
          data: kids.flatMap(([, k]) => [x(k), med(k)]),
          backgroundColor: kids.flatMap(() => [rd(.7), r(.55)]),
          borderColor: kids.flatMap(() => ['#E05050', '#D4882A']), borderWidth: 1
        }]
      },
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => c.raw + '%' } } },
        scales: { x: { grid: { color: GC }, max: 100, ticks: { callback: t => t + '%', color: TC, font: F } }, y: { grid: { display: false }, ticks: { color: 'rgba(240,230,208,.55)', font: { family: 'DM Mono, monospace', size: 9 } } } } }
    }));
  }

  PF.load().then(() => {
    const slug = PF.current();
    PF.picker(document.getElementById('gtPick'), slug, render);
    render(slug);
    const el = document.getElementById('data-charts');
    const go = () => { chartsWanted = true; drawCharts(PF.current()); };
    if (el && 'IntersectionObserver' in window) {
      const obs = new IntersectionObserver(es => { if (es[0].isIntersecting) { go(); obs.disconnect(); } }, { threshold: 0.05 });
      obs.observe(el);
    } else go();
  }).catch(() => {
    const up = document.getElementById('gtUpdated');
    up.textContent = 'District figures could not load. Refresh the page to try again.'; up.hidden = false;
  });
})();
