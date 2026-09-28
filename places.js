/* Parishkar outside Purulia — an experiment.
 *
 * West Bengal places, other than Purulia, that have an open, detailed ward map.
 * The report map works inside their wards, and the name on the page follows the
 * place: "Parishkar Kolkata" while the map is on Kolkata, "Parishkar Purulia"
 * everywhere else. Purulia's own pages (promises, circle, schools, wards…) stay
 * Purulia-only.
 *
 * A place is added only when its ward outlines come from a cited open source.
 * Checked September 2026: only Kolkata qualifies. OpenStreetMap has no ward
 * boundaries for any other West Bengal town, and DataMeet has none either.
 * The server has the same wards (kasa_private.areas, kind 'place_ward';
 * tools/build-places.py builds both).
 */
window.KASA_PLACES = [
  {
    slug: 'kolkata',
    name: 'Kolkata',
    body: 'Kolkata Municipal Corporation',
    // KMC's own complaint form on kmcgov.in, checked September 2026.
    complaintUrl: 'https://www.kmcgov.in/KMCPortal/ComplaintFormAction.do',
    wardsGeojson: 'places/kolkata_wards.geojson',
    // 141 of KMC's 144 wards: 142–144 (Joka, added in 2015) are not in the open map.
    wardsMapped: 141,
    wardsTotal: 144,
    bbox: { min_lat: 22.450, max_lat: 22.633, min_lng: 88.242, max_lng: 88.459 },
    center: [88.3639, 22.5726],
    source: 'https://github.com/datameet/Municipal_Spatial_Data/tree/master/Kolkata',
    sourceName: 'DataMeet',
    licence: 'CC BY-SA 2.5 IN'
  }
];

window.KasaPlaces = (() => {
  const PLACES = window.KASA_PLACES;
  const geo = {};        // slug -> FeatureCollection once loaded
  const loading = {};    // slug -> Promise
  let current = null;    // slug of the place the page is named after, or null (Purulia)
  let home = null;       // Purulia's page title and wordmark text
  const listeners = [];

  const bySlug = slug => PLACES.find(p => p.slug === slug) || null;
  const inBox = (p, lat, lng) => lat >= p.bbox.min_lat && lat <= p.bbox.max_lat && lng >= p.bbox.min_lng && lng <= p.bbox.max_lng;
  const boxAt = (lat, lng) => PLACES.find(p => inBox(p, lat, lng)) || null;

  function ring(pt, r){
    let inside = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++){
      const [xi, yi] = r[i], [xj, yj] = r[j];
      if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }
  function inGeom(pt, g){
    const polys = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
    return polys.some(p => ring(pt, p[0]) && !p.slice(1).some(h => ring(pt, h)));
  }

  function load(slug){
    const p = bySlug(slug);
    if (!p) return Promise.resolve(null);
    if (geo[slug]) return Promise.resolve(geo[slug]);
    return loading[slug] || (loading[slug] = fetch(p.wardsGeojson)
      .then(r => r.ok ? r.json() : null)
      .then(j => { if (j) { geo[slug] = j; listeners.forEach(f => f('geo', slug)); } return j; })
      .catch(() => null));
  }

  /* Where a point is: { kind: 'place', place, name, body, ward }, { kind: 'place_unmapped', … }
     inside the place's box but in no mapped ward, 'unknown' while its wards load, or null. */
  function at(lat, lng){
    const p = boxAt(lat, lng);
    if (!p) return null;
    const g = geo[p.slug];
    if (!g){ load(p.slug); return { kind: 'unknown' }; }
    const f = g.features.find(f => inGeom([lng, lat], f.geometry));
    return f ? { kind: 'place', place: p.slug, name: p.name, body: p.body, ward: Number(f.properties.ward) }
             : { kind: 'place_unmapped', place: p.slug, name: p.name };
  }

  /* One visit per device per place per day. `send` is set by kasa.js (a Supabase RPC). */
  let send = null;
  function countVisit(slug){
    if (!send) return;
    const key = 'kasa_visit_' + slug, today = new Date().toISOString().slice(0, 10);
    try { if (localStorage.getItem(key) === today) return; localStorage.setItem(key, today); } catch (e) {}
    send(slug);
  }

  /* Name the page after the place (null = Purulia). */
  function brand(slug){
    const p = slug ? bySlug(slug) : null;
    slug = p ? p.slug : null;
    if (!home) home = { title: document.title, second: document.querySelector('.k-wordmark-second')?.textContent || 'Purulia' };
    countVisit(slug || 'purulia');
    if (slug === current) return;
    current = slug;
    const name = p ? p.name : home.second;
    document.querySelectorAll('.k-wordmark-second').forEach(el => { el.textContent = name; });
    document.querySelectorAll('.k-wordmark, .k-nav-logo').forEach(el => {
      if (el.hasAttribute('aria-label')) el.setAttribute('aria-label', 'Parishkar ' + name);
    });
    document.title = p ? home.title.replace(home.second, p.name) : home.title;
    document.documentElement.dataset.place = slug || 'purulia';
    listeners.forEach(f => f('brand', slug));
  }

  /* The map moved: follow the place in view. Zoomed far out, the page stays Purulia. */
  function onView(lat, lng, zoom){
    const p = zoom >= 10 ? boxAt(lat, lng) : null;
    if (p) load(p.slug);
    brand(p ? p.slug : null);
  }

  return {
    list: PLACES, bySlug, at, load, brand, onView, boxAt,
    get current(){ return current; },
    get geo(){ return geo; },
    on: f => listeners.push(f),
    setSender: f => { send = f; },
    // ?place=kolkata opens the map on that place.
    fromUrl(){
      try { return bySlug(new URLSearchParams(location.search).get('place')); } catch (e) { return null; }
    }
  };
})();
