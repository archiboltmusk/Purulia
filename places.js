/* Parishkar across West Bengal.
 *
 * The report map works anywhere in West Bengal. Inside a town whose ward map is
 * on Parishkar, a report goes to that town and ward; anywhere else it is filed
 * under its district. The name on the page follows the map: "Parishkar Kolkata"
 * on Kolkata, "Parishkar Bankura" on Bankura district, "Parishkar Purulia" on
 * Purulia and when zoomed out. Purulia's own pages (promises, circle, schools,
 * wards…) stay Purulia-only.
 *
 * Towns: Kolkata's wards ship with the site (DataMeet, CC BY-SA 2.5 IN). Others
 * are sent in by anyone on add-town.html and go live only after a moderator
 * approves them; kasa.js fetches that list (kasa_places) through setServer().
 * Districts: places/wb_districts.geojson, the Local Government Directory's
 * outlines (india-geodata, CC0), built by tools/build-districts.py. Purulia is
 * not in it: its own blocks and wards cover it.
 * The server decides with the same data (kasa_private.locate_any).
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

// The 23 West Bengal districts (including Purulia), as places/wb_districts.geojson names them.
window.KASA_DISTRICTS = {
  'alipurduar': 'Alipurduar', 'bankura': 'Bankura', 'birbhum': 'Birbhum', 'cooch-behar': 'Cooch Behar',
  'dakshin-dinajpur': 'Dakshin Dinajpur', 'darjeeling': 'Darjeeling', 'hooghly': 'Hooghly', 'howrah': 'Howrah',
  'jalpaiguri': 'Jalpaiguri', 'jhargram': 'Jhargram', 'kalimpong': 'Kalimpong', 'kolkata': 'Kolkata', 'malda': 'Malda',
  'murshidabad': 'Murshidabad', 'nadia': 'Nadia', 'north-24-parganas': 'North 24 Parganas',
  'paschim-bardhaman': 'Paschim Bardhaman', 'paschim-medinipur': 'Paschim Medinipur',
  'purba-bardhaman': 'Purba Bardhaman', 'purba-medinipur': 'Purba Medinipur',
  'purulia': 'Purulia',
  'south-24-parganas': 'South 24 Parganas', 'uttar-dinajpur': 'Uttar Dinajpur'
};

window.KasaPlaces = (() => {
  const PLACES = window.KASA_PLACES;
  const DISTRICTS = window.KASA_DISTRICTS;
  const WB = { min_lat: 21.5, max_lat: 27.25, min_lng: 85.8, max_lng: 89.9 };
  const PURULIA = { min_lat: 22.70, max_lat: 23.72, min_lng: 85.80, max_lng: 86.87 };
  const geo = {};        // slug -> FeatureCollection once loaded
  const loading = {};    // slug -> Promise
  let districts = null;  // FeatureCollection of district outlines once loaded
  let districtsLoading = null;
  let current = null;    // key of the place the page is named after ('kolkata', 'district:bankura'), or null (Purulia)
  let home = null;       // Purulia's page title and wordmark text
  let server = null;     // { places(), wards(slug) } from kasa.js
  let lastView = null;
  const listeners = [];
  const emit = (what, slug) => listeners.forEach(f => f(what, slug));

  const inBox = (b, lat, lng) => lat >= b.min_lat && lat <= b.max_lat && lng >= b.min_lng && lng <= b.max_lng;
  const boxAt = (lat, lng) => PLACES.find(p => p.bbox && inBox(p.bbox, lat, lng)) || null;
  const inWB = (lat, lng) => inBox(WB, lat, lng);

  /* A town, or a district as 'district:<slug>' (name without "district"; body unknown). */
  function bySlug(slug){
    if (typeof slug === 'string' && slug.startsWith('district:')){
      const name = DISTRICTS[slug.slice(9)];
      return name ? { slug, name, isDistrict: true, body: null } : null;
    }
    return PLACES.find(p => p.slug === slug) || null;
  }

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
    if (!p || p.isDistrict) return Promise.resolve(null);
    if (geo[slug]) return Promise.resolve(geo[slug]);
    const get = p.wardsGeojson ? fetch(p.wardsGeojson).then(r => r.ok ? r.json() : null)
              : server ? server.wards(slug) : Promise.resolve(null);
    return loading[slug] || (loading[slug] = get
      .then(j => { if (j?.features){ geo[slug] = j; emit('geo', slug); return j; } delete loading[slug]; return null; })
      .catch(() => { delete loading[slug]; return null; }));
  }

  function loadDistricts(){
    return districtsLoading || (districtsLoading = fetch('places/wb_districts.geojson')
      .then(r => r.ok ? r.json() : null)
      .then(j => { districts = j?.features ? j : { features: [] }; emit('districts'); return districts; })
      .catch(() => { districts = { features: [] }; return districts; }));
  }

  const districtAt = (lat, lng) => districts?.features.find(f => inGeom([lng, lat], f.geometry)) || null;

  /* Where a point is: { kind: 'place', place, name, body, ward } in a town's ward,
     { kind: 'place', place: 'district:<slug>', name, isDistrict: true } elsewhere in West Bengal,
     { kind: 'unknown' } while the maps load, or null outside West Bengal. */
  function at(lat, lng){
    for (const p of PLACES.filter(p => p.bbox && inBox(p.bbox, lat, lng))){
      const g = geo[p.slug];
      if (!g){ load(p.slug); return { kind: 'unknown' }; }
      const f = g.features.find(f => inGeom([lng, lat], f.geometry));
      if (f) return { kind: 'place', place: p.slug, name: p.name, body: p.body, ward: Number(f.properties.ward),
                      provisional: p.status === 'provisional' };
    }
    if (!inWB(lat, lng)) return null;
    if (!districts){ loadDistricts(); return { kind: 'unknown' }; }
    const d = districtAt(lat, lng);
    return d ? { kind: 'place', place: 'district:' + d.properties.slug, name: d.properties.district, isDistrict: true, body: null, ward: null }
             : null;
  }

  /* One visit per device per place per day. `send` is set by kasa.js (a Supabase RPC). */
  let send = null;
  function countVisit(key){
    if (!send) return;
    const k = 'kasa_visit_' + key, today = new Date().toISOString().slice(0, 10);
    try { if (localStorage.getItem(k) === today) return; localStorage.setItem(k, today); } catch (e) {}
    send(key);
  }

  /* Name the page after the place (null = Purulia). */
  function brand(key){
    const p = key ? bySlug(key) : null;
    key = p ? p.slug : null;
    if (!home) home = { title: document.title, second: document.querySelector('.k-wordmark-second')?.textContent || 'Purulia' };
    countVisit(key || 'purulia');
    if (key === current) return;
    current = key;
    const name = p ? p.name : home.second;
    document.querySelectorAll('.k-wordmark-second').forEach(el => { el.textContent = name; });
    document.querySelectorAll('.k-wordmark, .k-nav-logo').forEach(el => {
      if (el.hasAttribute('aria-label')) el.setAttribute('aria-label', 'Parishkar ' + name);
    });
    document.title = p ? home.title.replace(home.second, p.name) : home.title;
    document.documentElement.dataset.place = key || 'purulia';
    emit('brand', key);
  }

  /* The map moved: follow the town or district in view. Zoomed far out, or on Purulia, the page stays Purulia. */
  function onView(lat, lng, zoom){
    lastView = [lat, lng, zoom];
    const p = zoom >= 10 ? boxAt(lat, lng) : null;
    if (p){ load(p.slug); return brand(p.slug); }
    if (zoom < 8 || !inWB(lat, lng) || inBox(PURULIA, lat, lng)) return brand(null);
    if (!districts){ loadDistricts(); return brand(null); }
    const d = districtAt(lat, lng);
    brand(d ? 'district:' + d.properties.slug : null);
  }
  listeners.push(what => { if (what === 'districts' && lastView) onView(...lastView); });

  /* Towns approved since this file was written come from the server. */
  function setServer(s){
    server = s;
    return s.places().then(list => {
      for (const q of list || []){
        if (!q?.slug || !q.bbox || q.bbox.min_lat == null) continue;
        const p = bySlug(q.slug) || PLACES[PLACES.push({ slug: q.slug }) - 1];
        Object.assign(p, {
          name: q.name, body: q.body, complaintUrl: q.complaint_url || p.complaintUrl || null,
          wardsMapped: q.wards_mapped, wardsTotal: q.wards_total ?? p.wardsTotal ?? null,
          bbox: q.bbox, center: p.center || [(q.bbox.min_lng + q.bbox.max_lng) / 2, (q.bbox.min_lat + q.bbox.max_lat) / 2],
          source: p.source || q.source, sourceName: p.sourceName || q.source, licence: p.licence || q.licence,
          status: q.status, community: q.community, incharge: q.incharge, inchargeSource: q.incharge_source,
          district: q.district, updatedAt: q.updated_at
        });
        // A fixed border: drop the cached wards so the new ones load.
        if (!p.wardsGeojson && geo[q.slug] && p.loadedAt !== q.updated_at){ delete geo[q.slug]; delete loading[q.slug]; }
        p.loadedAt = q.updated_at;
      }
      emit('places');
      if (lastView) onView(...lastView);
    }).catch(() => {});
  }

  return {
    list: PLACES, districts: DISTRICTS, bySlug, at, load, brand, onView, boxAt, inWB,
    get current(){ return current; },
    get geo(){ return geo; },
    on: f => listeners.push(f),
    setSender: f => { send = f; },
    setServer,
    // ?place=kolkata or ?place=district:bankura opens the map there.
    fromUrl(){
      try { return bySlug(new URLSearchParams(location.search).get('place')); } catch (e) { return null; }
    }
  };
})();
