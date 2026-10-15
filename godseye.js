/* God's-eye view: every West Bengal district on one screen. Sourced figures from
   places/wb_district_facts.json (people, tap water, leaders), live readings from
   places/godseye.json (refreshed by .github/workflows/godseye-refresh.yml; the page never
   calls a third-party API), and open reports from kasa_public_reports (by place).
   A tile with no reading shows a dash, never an estimate. */
(async function(){
  const PF = window.PlaceFacts;
  const $ = id => document.getElementById(id);
  const esc = PF.esc, num = v => v == null ? '–' : Number(v).toLocaleString('en-IN');
  const ago = iso => {
    if (!iso) return '';
    const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    return m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago';
  };
  const aqiWord = v => v == null ? '' : v <= 50 ? 'good' : v <= 100 ? 'moderate' : v <= 150 ? 'unhealthy for sensitive groups' : v <= 200 ? 'unhealthy' : v <= 300 ? 'very unhealthy' : 'hazardous';

  await PF.load().catch(() => null);
  if (!PF.data){ $('ge-hero').innerHTML = '<p class="an-empty">Could not load the district figures. Please try again later.</p>'; return; }
  const DS = PF.data.districts;
  const live = await fetch('places/godseye.json').then(r => r.ok ? r.json() : null).catch(() => null);
  const L = live ? live.districts : {};
  let slug = PF.current();
  if (!DS[slug]) slug = 'purulia';

  // Open reports per district: one query, sorted into districts by the same rule as the map.
  let counts = {};
  try {
    const cfg = window.KASA_CONFIG || {};
    const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    const [a, b] = await Promise.all([
      sb.from('kasa_public_reports').select('id,place,is_duplicate').neq('status', 'resolved').limit(3000),
      sb.from('kasa_public_place_reports').select('id,place,is_duplicate').neq('status', 'resolved').limit(3000)
    ]);
    const rows = [...(a.data || []), ...(b.data || [])].filter(r => !r.is_duplicate);
    const filters = {};
    await Promise.all(Object.keys(DS).map(async s => { filters[s] = await PF.reportFilter(s); }));
    const seen = new Set();
    rows.forEach(r => {
      if (seen.has(r.id)) return;
      seen.add(r.id);
      for (const s of Object.keys(DS)) if (filters[s](r)) { counts[s] = (counts[s] || 0) + 1; break; }
    });
  } catch (e) { counts = null; }
  const openOf = s => counts ? num(counts[s] || 0) : '–';

  function reading(s){
    const d = L[s] || {};
    const w = d.weather || {}, a = d.air || {};
    return {
      temp: w.temp_c == null ? '–' : Math.round(w.temp_c) + '°C',
      aqi: a.us_aqi == null ? '–' : a.us_aqi,
      fires: d.fires_7d == null ? '–' : d.fires_7d,
      aqiWord: aqiWord(a.us_aqi)
    };
  }

  // Selected district: everything about it on one card.
  const D = DS[slug], R = reading(slug), Lr = L[slug] || {};
  const reps = await PF.reps(slug).catch(() => []);
  const repLine = reps.length ? reps.map(x => `${esc(x.role === 'mp' ? 'MP' : 'MLA')} ${esc(x.name)}${x.seat ? ' <span class="ge-muted">(' + esc(x.seat) + ')</span>' : ''}`).join(' · ') : 'Not on record yet';
  const jjm = D.jjm ? `${D.jjm.pct}% of homes with tap water (rank ${D.jjm.rank_wb} of ${D.jjm.of_wb} in WB; Jal Jeevan Mission)` : '';
  $('ge-name').textContent = D.name;
  $('ge-hero').innerHTML = `
    <div class="ge-live">
      <div class="ge-tile"><span class="ge-k">Temperature</span><span class="ge-v">${esc(R.temp)}</span><span class="ge-s">${esc(Lr.weather && Lr.weather.humidity_pct != null ? 'humidity ' + Lr.weather.humidity_pct + '%' : '')}</span></div>
      <div class="ge-tile"><span class="ge-k">Air, US AQI</span><span class="ge-v">${esc(R.aqi)}</span><span class="ge-s">${esc(R.aqiWord)}${Lr.air && Lr.air.pm2_5 != null ? ' · PM2.5 ' + Lr.air.pm2_5 : ''}</span></div>
      <div class="ge-tile"><span class="ge-k">Fire hotspots, 7 days</span><span class="ge-v">${esc(R.fires)}</span><span class="ge-s">${Lr.high_confidence_7d != null ? Lr.high_confidence_7d + ' high confidence' : 'satellite, NASA FIRMS'}</span></div>
      <div class="ge-tile"><span class="ge-k">Open reports</span><span class="ge-v">${esc(openOf(slug))}</span><span class="ge-s"><a href="kasa.html">see on the map</a></span></div>
    </div>
    <dl class="ge-facts">
      <dt>People (Census 2011)</dt><dd>${num(D.census2011 && D.census2011.population)}</dd>
      <dt>Area</dt><dd>${num(D.area_km2)} km²</dd>
      <dt>Tap water</dt><dd>${esc(jjm || 'Not on record yet')}</dd>
      <dt>Who answers</dt><dd>${repLine}</dd>
    </dl>
    <p class="an-card-sub ge-src">Weather and air: Open-Meteo${Lr.weather ? ', read ' + esc(ago(Lr.weather.at)) : ''} · Fires: NASA FIRMS · Figures: <a href="data.html?d=${esc(slug)}">${esc(D.name)} data page</a>, <a href="compare.html?c=${esc(slug)}">compare</a>, <a href="calendar.html">calendar</a></p>`;

  // Every district: one tile each, click to look at it.
  const order = Object.keys(DS).sort((x, y) => DS[x].name.localeCompare(DS[y].name));
  $('ge-grid').innerHTML = order.map(s => {
    const r = reading(s);
    return `<a class="ge-cell${s === slug ? ' on' : ''}" href="godseye.html?d=${esc(s)}">
      <span class="ge-cell-name">${esc(DS[s].name)}</span>
      <span class="ge-cell-row"><span>${esc(r.temp)}</span><span>AQI ${esc(r.aqi)}</span><span>${esc(r.fires)} fires</span><span>${esc(openOf(s))} open</span></span>
    </a>`;
  }).join('');

  const st = live ? live.status || {} : {};
  const label = { ok: 'live', failed: 'last good reading kept', 'no key': 'not on yet (key not set)' };
  $('ge-sources').innerHTML = live ? live.sources.map(x =>
    `<li><a href="${esc(x.url)}">${esc(x.name)}</a> — ${esc(x.licence)}. ${esc(x.terms)}. <span class="ge-muted">${esc(label[st[x.key_required ? 'nasa-firms' : 'open-meteo']] || '')}</span></li>`
  ).join('') + `<li class="ge-muted">Readings refreshed ${esc(ago(live.generated))}. Refresh runs every 12 hours.</li>` : '<li class="ge-muted">Live readings not on yet.</li>';

  PF.picker($('ge-pick'), slug, () => location.reload());
})();
