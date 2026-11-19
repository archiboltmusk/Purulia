import { Map, NavigationControl, Popup } from './vendor/maplibre-gl-6.14.0/maplibre-gl.mjs';

const byId = (id) => document.getElementById(id);
const empty = { type: 'FeatureCollection', features: [] };
const layers = [
  { id: 'quake', color: '#f97373', name: 'USGS earthquakes', interval: 60_000 },
  { id: 'speed', color: '#3fda9a', name: 'Community internet speeds', interval: 300_000 },
  { id: 'weather', color: '#5ab5ff', name: 'Weather model · West Bengal', interval: 600_000 },
  { id: 'air', color: '#f9bf66', name: 'US AQI model · West Bengal', interval: 600_000 }
];
const formatTime = new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata'
});
const timeLabel = (value) => Number.isFinite(Date.parse(value)) ? formatTime.format(new Date(value)) + ' IST' : 'unknown';

async function read(url, options = {}) {
  const response = await fetch(url, { signal: AbortSignal.timeout(12_000), ...options });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  return response.json();
}

function rpc(name, query = '') {
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.KASA_CONFIG;
  return read(SUPABASE_URL + '/rest/v1/rpc/' + name + query, {
    headers: { apikey: SUPABASE_ANON_KEY }, cache: 'no-store'
  });
}

function point(coords, properties) {
  return { type: 'Feature', geometry: { type: 'Point', coordinates: coords }, properties };
}

function collection(points) {
  return { type: 'FeatureCollection', features: points.filter(({ geometry: { coordinates: [lng, lat] } }) =>
    Number.isFinite(lng) && Number.isFinite(lat) && lng >= 65 && lng <= 100 && lat >= 5 && lat <= 39) };
}

let modelPromise;
function getModel() {
  modelPromise ??= read('places/godseye.json', { cache: 'no-cache' }).finally(() => { modelPromise = undefined; });
  return modelPromise;
}

async function loadLayer(id) {
  if (id === 'quake') {
    const data = await rpc('india_earthquake_snapshot', '?p_days=' + byId('period').value);
    const age = Date.now() - Date.parse(data.last_success);
    const status = data.last_success ?
      ((age > 300_000 || data.error) ? 'Stale cache' : 'Source checked') + ' · ' + timeLabel(data.last_success) :
      'No successful source check yet';
    return { data, status };
  }
  if (id === 'speed') {
    const rows = await rpc('internet_speed_cells');
    const data = collection(rows.filter((row) => Number(row.samples) >= 5).map((row) =>
      point([Number(row.lng), Number(row.lat)], {
        label: row.download_mbps + ' Mbps download · ' + row.samples + ' contributors · ' + row.connection_type,
        note: 'Rolling 90-day aggregate'
      })));
    return { data, status: 'Rolling 90-day aggregates' };
  }
  const snapshot = await getModel();
  const metric = id === 'weather' ? 'temp_c' : 'us_aqi';
  const unit = id === 'weather' ? ' °C' : ' US AQI';
  const data = collection(Object.values(snapshot.districts).flatMap((district) => {
    const model = district[id];
    if (!Number.isFinite(model?.[metric]) || !district.at || !model.at) return [];
    return [point(district.at, {
      label: district.name + ' · ' + model[metric] + unit,
      observed: model.at + '+05:30',
      note: 'Open-Meteo model estimate'
    })];
  }));
  const newest = Math.max(...data.features.map((feature) => Date.parse(feature.properties.observed)));
  const status = Number.isFinite(newest)
    ? (Date.now() - newest > 43_200_000 || snapshot.status['open-meteo'] !== 'ok' ? 'Stale model output' : 'Latest model output') +
      ' · ' + timeLabel(new Date(newest).toISOString())
    : 'No model values available';
  return { data, status };
}

async function showRegistry() {
  const { sources } = await read('data/live-source-registry.json');
  for (const source of sources) {
    const row = document.createElement('p');
    const link = document.createElement('a');
    link.href = source.source_url ?? source.endpoint;
    link.textContent = source.category;
    row.append(link, ' · ' + source.status.replaceAll('_', ' '));
    const meta = document.createElement('small');
    meta.textContent = [source.coverage, source.license, source.refresh_target, source.constraint].filter(Boolean).join(' · ');
    row.append(meta);
    byId('registry').append(row);
  }
}

const map = new Map({
  container: 'map', style: 'https://tiles.openfreemap.org/styles/liberty',
  center: [80, 23], zoom: 4, renderWorldCopies: false
});
map.addControl(new NavigationControl());

async function setUpSearch() {
  const [{ states, attribution }, bengal] = await Promise.all([
    read('places/in/index.json'),
    read('places/wb_districts.geojson').catch(() => null)
  ]);
  const index = {};
  for (const state of Object.values(states)) {
    index[state.name] = state.bbox;
    for (const [district, bounds] of Object.entries(state.district_boxes ?? {})) {
      index[district + ', ' + state.name] = bounds;
    }
  }
  if (bengal) {
    const stateBounds = [180, 90, -180, -90];
    for (const feature of bengal.features) {
      const bounds = [180, 90, -180, -90];
      const { type, coordinates } = feature.geometry;
      for (const [lng, lat] of coordinates.flat(type === 'MultiPolygon' ? 2 : 1)) {
        bounds[0] = Math.min(bounds[0], lng);
        bounds[1] = Math.min(bounds[1], lat);
        bounds[2] = Math.max(bounds[2], lng);
        bounds[3] = Math.max(bounds[3], lat);
      }
      if (bounds[0] > bounds[2]) continue;
      index[feature.properties.district + ', West Bengal'] = bounds;
      stateBounds[0] = Math.min(stateBounds[0], bounds[0]);
      stateBounds[1] = Math.min(stateBounds[1], bounds[1]);
      stateBounds[2] = Math.max(stateBounds[2], bounds[2]);
      stateBounds[3] = Math.max(stateBounds[3], bounds[3]);
    }
    if (stateBounds[0] <= stateBounds[2]) index['West Bengal'] = stateBounds;
  }
  const options = Object.keys(index).sort().map((name) => new Option(name, name));
  byId('districts').replaceChildren(...options);
  const input = byId('district');
  input.disabled = false;
  input.addEventListener('change', () => {
    const search = input.value.trim().toLowerCase();
    if (!search) return;
    const names = Object.keys(index);
    const hits = names.filter((name) => name.split(',')[0].toLowerCase() === search);
    const match = names.find((name) => name.toLowerCase() === search) ?? (hits.length === 1 ? hits[0] : null);
    byId('district-status').textContent = match ? attribution : 'Choose a district or state from the search suggestions.';
    if (match) map.fitBounds(index[match], { padding: 42, maxZoom: 12 });
  });
}

const refreshers = [];
map.on('load', () => {
  for (const layer of layers) {
    const { id, color, name, interval } = layer;
    map.addSource(id, { type: 'geojson', data: empty });
    map.addLayer({
      id, type: 'circle', source: id,
      paint: { 'circle-radius': 6, 'circle-color': color, 'circle-stroke-color': '#15202b', 'circle-stroke-width': 1.25 }
    });
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = true;
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.backgroundColor = color;
    const status = document.createElement('small');
    status.textContent = 'Loading…';
    status.setAttribute('role', 'status');
    label.append(input, swatch, name, status);
    byId('layers').append(label);
    input.addEventListener('change', () => map.setLayoutProperty(id, 'visibility', input.checked ? 'visible' : 'none'));
    map.on('click', id, (event) => {
      const properties = event.features[0].properties;
      const text = [properties.label, Number.isFinite(properties.mag) && 'Magnitude ' + properties.mag,
        properties.observed && 'Source time ' + timeLabel(properties.observed), properties.note].filter(Boolean).join('\n');
      new Popup().setLngLat(event.lngLat).setText(text).addTo(map);
    });
    let sequence = 0;
    async function refresh() {
      const current = ++sequence;
      try {
        const result = await loadLayer(id);
        if (current !== sequence) return;
        map.getSource(id).setData(result.data);
        status.textContent = result.data.features.length + ' mapped · ' + result.status;
      } catch {
        if (current === sequence) status.textContent = 'Refresh failed · any displayed data may be stale';
      }
    }
    refreshers.push(refresh);
    if (id === 'quake') byId('period').addEventListener('change', refresh);
    refresh();
    setInterval(refresh, interval);
  }
});
byId('refresh').addEventListener('click', () => refreshers.forEach((refresh) => refresh()));
setUpSearch().catch(() => { byId('district-status').textContent = 'District search is unavailable.'; });
showRegistry().catch(() => { byId('registry').textContent = 'Source registry is unavailable.'; });
