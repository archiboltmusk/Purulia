/* God's-eye view: every West Bengal district on one screen. Sourced figures from
   places/wb_district_facts.json (people, tap water, leaders). Live tracks are the FEEDS
   list below: each one has its own source, refresh interval and on/off tick (kept on
   this device). Weather, AQI and fires: places/godseye.json. PM2.5: places/air/openaq.json.
   Open reports: kasa_public_reports. The page never calls a third-party API.
   A district with no value in a track shows "not on record yet", never an estimate.

   Add a track: push one object to FEEDS with id, label, source, url, every (ms), on,
   fmt (value -> text) and load(). load() returns { at, status, values } where values
   maps district slug -> number or string, or null when the source is unavailable. */
(async function(){
  const PF = window.PlaceFacts;
  const $ = id => document.getElementById(id);
  const esc = PF.esc, num = v => v == null ? '–' : Number(v).toLocaleString('en-IN');
  const MIN = 60000;
  const ago = iso => {
    if (!iso) return '';
    const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    return m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago';
  };
  const aqiWord = v => v == null ? '' : v <= 50 ? 'good' : v <= 100 ? 'moderate' : v <= 150 ? 'unhealthy for sensitive groups' : v <= 200 ? 'unhealthy' : v <= 300 ? 'very unhealthy' : 'hazardous';
  const NOT_ON_RECORD = 'not on record yet';
  const STATUS_WORD = { ok: 'live', failed: 'last good reading kept', 'no key': 'not on yet (key not set)' };

  await PF.load().catch(() => null);
  if (!PF.data){ $('ge-hero').innerHTML = '<p class="an-empty">Could not load the district figures. Please try again later.</p>'; return; }
  const DS = PF.data.districts;
  let slug = PF.current();
  if (!DS[slug]) slug = 'purulia';

  const getJSON = url => fetch(url, { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null);
  let liveData = null;
  const liveOf = async () => (liveData = await getJSON('places/godseye.json'));
  const pick = (districts, fn) => {
    const out = {};
    for (const s of Object.keys(districts || {})) { const v = fn(districts[s]); if (v != null) out[s] = v; }
    return out;
  };
  // Feed from places/godseye.json; status key is the source id in that file.
  const fromLive = (key, fn) => async () => {
    const d = await liveOf();
    if (!d) return null;
    return { at: d.generated, status: (d.status || {})[key] || 'ok', values: pick(d.districts, fn) };
  };

  let sb = null, filters = null;
  // Open reports per district: one query, sorted into districts by the same rule as the map.
  async function loadReports(){
    try {
      if (!sb) { const cfg = window.KASA_CONFIG || {}; sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY); }
      const [a, b] = await Promise.all([
        sb.from('kasa_public_reports').select('id,place,is_duplicate').neq('status', 'resolved').limit(3000),
        sb.from('kasa_public_place_reports').select('id,place,is_duplicate').neq('status', 'resolved').limit(3000)
      ]);
      if (a.error || b.error) return null;
      if (!filters) filters = Object.fromEntries(await Promise.all(Object.keys(DS).map(async s => [s, await PF.reportFilter(s)])));
      const rows = [...(a.data || []), ...(b.data || [])].filter(r => !r.is_duplicate);
      const counts = {}, seen = new Set();
      rows.forEach(r => {
        if (seen.has(r.id)) return;
        seen.add(r.id);
        for (const s of Object.keys(DS)) if (filters[s](r)) { counts[s] = (counts[s] || 0) + 1; break; }
      });
      return { at: new Date().toISOString(), status: 'ok', values: Object.fromEntries(Object.keys(DS).map(s => [s, counts[s] || 0])) };
    } catch (e) { return null; }
  }

  const FEEDS = [
    { id: 'temp', label: 'Temperature', source: 'Open-Meteo', url: 'https://open-meteo.com/', every: 10 * MIN, on: true,
      fmt: v => v + '°C', load: fromLive('open-meteo', d => d.weather && d.weather.temp_c != null ? Math.round(d.weather.temp_c) : null) },
    { id: 'aqi', label: 'US AQI', source: 'Open-Meteo', url: 'https://open-meteo.com/', every: 10 * MIN, on: true,
      fmt: v => 'AQI ' + v, load: fromLive('open-meteo', d => d.air && d.air.us_aqi != null ? d.air.us_aqi : null) },
    { id: 'pm25', label: 'PM2.5 at nearest station', source: 'OpenAQ', url: 'https://openaq.org/', every: 30 * MIN, on: true,
      fmt: v => 'PM2.5 ' + v,
      load: async () => {
        const d = await getJSON('places/air/openaq.json');
        if (!d) return null;
        return { at: d.generated, status: 'ok', values: Object.fromEntries((d.districts || []).filter(x => x.pm25 != null).map(x => [x.slug, x.pm25])) };
      } },
    { id: 'fires', label: 'Fire hotspots, 7 days', source: 'NASA FIRMS', url: 'https://firms.modaps.eosdis.nasa.gov/', every: 10 * MIN, on: true,
      fmt: v => v + ' fires', load: fromLive('nasa-firms', d => d.fires_7d != null ? d.fires_7d : null) },
    { id: 'reports', label: 'Open reports', source: 'Parishkar reports', url: 'kasa.html', every: 2 * MIN, on: true,
      fmt: v => v + ' open', load: loadReports },
  ];

  // Per-viewer track choice only (localStorage); empty or unavailable storage falls back to FEEDS defaults.
  const KEY = 'parishkar_godseye_tracks';
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY)); } catch (e) { saved = null; }
  const isOn = f => Array.isArray(saved) ? saved.includes(f.id) : f.on;
  const setOn = ids => { try { localStorage.setItem(KEY, JSON.stringify(ids)); } catch (e) {} };

  const state = {};
  const cellVal = (f, s) => {
    const st = state[f.id];
    if (!st) return 'loading…';
    return st.values && st.values[s] != null ? f.fmt(st.values[s]) : NOT_ON_RECORD;
  };
  async function refresh(f){
    const r = await f.load().catch(() => null);
    state[f.id] = r ? { at: r.at, status: r.status, values: r.values, loadedAt: Date.now() }
                    : { at: null, status: 'failed', values: {}, loadedAt: Date.now() };
    renderAll();
  }

  function renderHero(){
    const D = DS[slug], Lr = (liveData && liveData.districts && liveData.districts[slug]) || {};
    const v = id => state[id] && state[id].values ? state[id].values[slug] : undefined;
    const tile = (k, val, sub) => `<div class="ge-tile"><span class="ge-k">${k}</span><span class="ge-v">${val == null ? '–' : esc(val)}</span><span class="ge-s">${esc(sub)}</span></div>`;
    const reps = repsCache;
    const repLine = reps.length ? reps.map(x => `${esc(x.role === 'mp' ? 'MP' : 'MLA')} ${esc(x.name)}${x.seat ? ' <span class="ge-muted">(' + esc(x.seat) + ')</span>' : ''}`).join(' · ') : NOT_ON_RECORD;
    const jjm = D.jjm ? `${D.jjm.pct}% of homes with tap water (rank ${D.jjm.rank_wb} of ${D.jjm.of_wb} in WB; Jal Jeevan Mission)` : '';
    $('ge-name').textContent = D.name;
    $('ge-hero').innerHTML = `
    <div class="ge-live">
      ${tile('Temperature', v('temp') == null ? null : v('temp') + '°C', Lr.weather && Lr.weather.humidity_pct != null ? 'humidity ' + Lr.weather.humidity_pct + '%' : '')}
      ${tile('Air, US AQI', Lr.air && Lr.air.us_aqi, aqiWord(Lr.air && Lr.air.us_aqi) + (Lr.air && Lr.air.pm2_5 != null ? ' · PM2.5 ' + Lr.air.pm2_5 : ''))}
      ${tile('Fire hotspots, 7 days', Lr.fires_7d, Lr.high_confidence_7d != null ? Lr.high_confidence_7d + ' high confidence' : 'satellite, NASA FIRMS')}
      ${tile('Open reports', v('reports'), '')}
    </div>
    <dl class="ge-facts">
      <dt>People (Census 2011)</dt><dd>${num(D.census2011 && D.census2011.population)}</dd>
      <dt>Area</dt><dd>${num(D.area_km2)} km²</dd>
      <dt>Tap water</dt><dd>${esc(jjm || NOT_ON_RECORD)}</dd>
      <dt>Who answers</dt><dd>${repLine}</dd>
    </dl>
    <p class="an-card-sub ge-src">Weather and air: Open-Meteo${Lr.weather ? ', read ' + esc(ago(liveData.generated)) : ''} · Fires: NASA FIRMS · Figures: <a href="data.html?d=${esc(slug)}">${esc(D.name)} data page</a>, <a href="compare.html?c=${esc(slug)}">compare</a>, <a href="calendar.html">calendar</a></p>`;
    const mandi = Lr.mandi;
    if (mandi) {
      $('ge-hero').insertAdjacentHTML('beforeend', `<div class="ge-mandi"><span class="ge-k">Mandi prices, ${esc(mandi.markets)} markets, as of ${esc(mandi.as_of || '–')}</span><ul class="ge-sources">${mandi.commodities.map(c => `<li>${esc(c.name)}: Rs ${num(c.modal_price_rs)} (modal)</li>`).join('')}</ul></div>`);
    }
  }

  function renderGrid(){
    const on = FEEDS.filter(isOn);
    const order = Object.keys(DS).sort((x, y) => DS[x].name.localeCompare(DS[y].name));
    $('ge-grid').innerHTML = order.map(s => `<a class="ge-cell${s === slug ? ' on' : ''}" href="godseye.html?d=${esc(s)}">
      <span class="ge-cell-name">${esc(DS[s].name)}</span>
      <span class="ge-cell-row">${on.map(f => `<span>${esc(cellVal(f, s))}</span>`).join('') || '<span class="ge-muted">no track ticked</span>'}</span>
    </a>`).join('');
  }

  function renderFeeds(){
    $('ge-feeds').innerHTML = FEEDS.map(f => {
      const st = state[f.id];
      const word = !st ? 'loading…' : !st.at ? NOT_ON_RECORD : `${STATUS_WORD[st.status] || 'live'} · read ${ago(st.at)} · checked ${ago(st.loadedAt)}`;
      return `<li><label><input type="checkbox" data-feed="${esc(f.id)}"${isOn(f) ? ' checked' : ''}> <strong>${esc(f.label)}</strong></label>
        <span class="ge-muted"> · <a href="${esc(f.url)}">${esc(f.source)}</a> · every ${Math.round(f.every / MIN)} min · ${esc(word)}</span></li>`;
    }).join('');
  }

  function renderSources(){
    const live = liveData;
    if (!live) { $('ge-sources').innerHTML = '<li class="ge-muted">Live readings not on yet.</li>'; return; }
    const st = live.status || {};
    const label = { ok: 'live', failed: 'last good reading kept', 'no key': 'not on yet (key not set)' };
    const keyOf = x => x.id === 'nasa-firms' ? 'nasa-firms' : x.id === 'data-gov-in-mandi' ? 'data-gov-in-mandi' : 'open-meteo';
    $('ge-sources').innerHTML = live.sources.map(x =>
      `<li><a href="${esc(x.url)}">${esc(x.name)}</a> — ${esc(x.licence)}. ${esc(x.terms)}. <span class="ge-muted">${esc(label[st[keyOf(x)]] || '')}</span></li>`
    ).join('') + `<li class="ge-muted">Readings refreshed ${esc(ago(live.generated))}. Refresh runs every 12 hours.</li>`;
  }

  function renderAll(){ renderHero(); renderGrid(); renderFeeds(); renderSources(); }

  const repsCache = await PF.reps(slug).catch(() => []);
  renderAll();
  await Promise.all(FEEDS.map(refresh));

  FEEDS.forEach(f => setInterval(() => { if (!document.hidden) refresh(f); }, f.every));
  // A tab that was hidden past its interval refreshes on return.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    FEEDS.forEach(f => { if (!state[f.id] || Date.now() - state[f.id].loadedAt >= f.every) refresh(f); });
  });
  $('ge-feeds').addEventListener('change', () => {
    setOn([...$('ge-feeds').querySelectorAll('input[data-feed]:checked')].map(i => i.dataset.feed));
    renderHero(); renderGrid();  // not the panel: it would replace the box the viewer just ticked
  });

  PF.picker($('ge-pick'), slug, () => location.reload());
})();
