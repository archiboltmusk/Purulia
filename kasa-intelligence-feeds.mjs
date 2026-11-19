

export const layers = [
  { id: 'quake', color: '#f97373', name: 'USGS earthquakes', interval: 60_000 },
  { id: 'speed', color: '#3fda9a', name: 'Community internet speeds', interval: 300_000 },
  { id: 'weather', color: '#5ab5ff', name: 'Weather model · West Bengal', interval: 600_000 },
  { id: 'air', color: '#f9bf66', name: 'US AQI model · West Bengal', interval: 600_000 }
];
const formatTime = new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata'
});
const timeLabel = (value) => Number.isFinite(Date.parse(value)) ? formatTime.format(new Date(value)) + ' IST' : 'unknown';

export async function read(url, options = {}) {
  const response = await fetch(url, { signal: AbortSignal.timeout(12_000), ...options });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  return response.json();
}

export function rpc(name, query = '') {
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

export async function loadLayer(id, days = 1) {
  if (id === 'quake') {
    const data = await rpc('india_earthquake_snapshot', '?p_days=' + days);
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

