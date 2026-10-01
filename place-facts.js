/* place-facts.js: the district a visitor is looking at, and its sourced facts.
 *
 * Data: places/wb_district_facts.json, built by tools/build-wb-district-facts.py
 * (Wikidata/Census 2011, Wikipedia, NFHS-5, Jal Jeevan Mission, NITI Aayog) and
 * refreshed monthly by .github/workflows/refresh-place-data.yml.
 * The place follows ?d=<slug>, else the place last opened on the map
 * (localStorage 'parishkar_place', shared with places.js), else Purulia.
 */
window.PlaceFacts = (() => {
  const SAVED = 'parishkar_place';
  const URL_ = 'places/wb_district_facts.json';
  let data = null, loading = null, townList = null, savedTown = null;

  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const n = v => Number(v).toLocaleString('en-IN');

  function load() {
    return loading || (loading = fetch(URL_).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(d => {
        data = d;
        // A town chosen on the map (its slug) counts as the district it is in.
        let k = null;
        try { k = localStorage.getItem(SAVED); } catch (e) {}
        if (!k || k === 'purulia' || k === 'kolkata' || k === 'bengal' || k.startsWith('district:')) return d;
        return towns().then(t => { const x = t.find(p => p.slug === k); savedTown = x ? x.district : null; return d; });
      }));
  }

  // Every West Bengal municipality outside Kolkata and Purulia (places/wb_towns.geojson):
  // slug, name, body, district, wards and a [lng, lat] point inside or at it.
  function towns() {
    return townList || (townList = fetch('places/wb_towns.geojson').then(r => r.ok ? r.json() : { features: [] })
      .then(g => g.features.map(f => {
        const c = [], walk = a => typeof a[0] === 'number' ? c.push(a) : a.forEach(walk);
        walk(f.geometry.coordinates);
        return { ...f.properties, at: c.length ? [c.reduce((s, p) => s + p[0], 0) / c.length, c.reduce((s, p) => s + p[1], 0) / c.length] : null };
      })).catch(() => []));
  }

  // The district's municipal bodies, for RTI letters: [{ name, body, at }], by name.
  function bodies(slug) {
    if (slug === 'kolkata') return Promise.resolve([{ name: 'Kolkata', body: 'Kolkata Municipal Corporation', at: [88.3639, 22.5726] }]);
    return towns().then(t => t.filter(p => p.district === slug).sort((a, b) => a.name.localeCompare(b.name)));
  }

  // Which reports (kasa_public_reports rows, by their `place`) belong to a district: Purulia's
  // carry no place, Kolkata's 'kolkata', others 'district:<slug>' or one of the district's towns.
  function reportFilter(slug) {
    if (slug === 'purulia') return Promise.resolve(r => !r.place);
    if (slug === 'kolkata') return Promise.resolve(r => r.place === 'kolkata');
    return towns().then(t => {
      const mine = new Set(t.filter(p => p.district === slug).map(p => p.slug));
      return r => r.place === 'district:' + slug || mine.has(r.place);
    });
  }

  // Map-place key ('purulia', 'kolkata', 'district:bankura', a town slug) -> district slug.
  function fromKey(key) {
    if (!key || key === 'purulia') return 'purulia';
    if (key.startsWith('district:')) return key.slice(9);
    return key;
  }

  function current() {
    let s = null;
    try { s = new URLSearchParams(location.search).get('d'); } catch (e) {}
    if (!s) { try { s = savedTown || fromKey(localStorage.getItem(SAVED)); } catch (e) {} }
    s = (s || 'purulia').toLowerCase();
    if (data && !data.districts[s]) s = 'purulia';
    return s;
  }

  function choose(slug) {
    try { localStorage.setItem(SAVED, slug === 'purulia' || slug === 'kolkata' ? slug : 'district:' + slug); } catch (e) {}
    try {
      const u = new URL(location.href);
      u.searchParams.set('d', slug);
      history.replaceState(null, '', u);
    } catch (e) {}
  }

  // Rank a district on one NFHS indicator. 1 = worst of the West Bengal districts.
  function rank(key, nfhsName) {
    const ind = data.nfhs.indicators[key];
    const vals = Object.entries(data.nfhs.districts).map(([d, v]) => [d, v[key] && v[key][0]]).filter(x => x[1] != null);
    vals.sort((a, b) => ind.higher_is_better ? a[1] - b[1] : b[1] - a[1]);
    const sorted = vals.map(x => x[1]).sort((a, b) => a - b), m = sorted.length;
    const median = m % 2 ? sorted[(m - 1) / 2] : Math.round((sorted[m / 2 - 1] + sorted[m / 2]) * 50) / 100;
    return { pos: vals.findIndex(x => x[0] === nfhsName) + 1, of: m, median };
  }

  function rankText(r) {
    if (!r.pos) return '';
    if (r.pos === 1) return `worst of the ${r.of} West Bengal districts`;
    if (r.pos === r.of) return `best of the ${r.of} West Bengal districts`;
    const ord = k => k + (k % 10 === 1 && k !== 11 ? 'st' : k % 10 === 2 && k !== 12 ? 'nd' : k % 10 === 3 && k !== 13 ? 'rd' : 'th');
    return r.pos <= r.of / 2 ? `${ord(r.pos)} worst of the ${r.of} West Bengal districts`
      : `${ord(r.of - r.pos + 1)} best of the ${r.of} West Bengal districts`;
  }

  // <select> of every district; onChange(slug) after it is saved.
  function picker(el, slug, onChange) {
    const ds = Object.entries(data.districts).sort((a, b) => a[1].name.localeCompare(b[1].name));
    el.innerHTML = ds.map(([s, d]) => `<option value="${esc(s)}"${s === slug ? ' selected' : ''}>${esc(d.name)}</option>`).join('');
    el.onchange = () => { choose(el.value); onChange(el.value); };
  }

  return { load, current, choose, rank, rankText, picker, towns, bodies, reportFilter, esc, n, get data() { return data; } };
})();
