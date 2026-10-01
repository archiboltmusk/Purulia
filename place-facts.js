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
  let data = null, loading = null;

  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const n = v => Number(v).toLocaleString('en-IN');

  function load() {
    return loading || (loading = fetch(URL_).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(d => (data = d)));
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
    if (!s) { try { s = fromKey(localStorage.getItem(SAVED)); } catch (e) {} }
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

  return { load, current, choose, rank, rankText, picker, esc, n, get data() { return data; } };
})();
