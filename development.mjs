import { Map, Popup, NavigationControl } from './vendor/maplibre-gl-6.14.0/maplibre-gl.mjs';

const byId = id => document.getElementById(id);
const mapForm = byId('map-controls');
const recordsForm = byId('records-controls');
const api = location.hostname === 'archiboltmusk.github.io'
  ? 'https://purulia.mahatoanupam002.workers.dev/api/hisaab'
  : '/api/hisaab';
const india = [68, 6, 98, 37];
const purulia = [85.65, 22.7, 87.2, 23.95];
const emptyMap = { type: 'FeatureCollection', features: [] };
const number = new Intl.NumberFormat('en-IN');
let map, popup, mapRequest, recordsRequest, selectionRequest, timer;

function node(tag, value) {
  const element = document.createElement(tag);
  if (value !== undefined) element.textContent = value;
  return element;
}

async function readFeed(feed, filters = {}, signal) {
  const params = new URLSearchParams({ feed });
  for (const [key, value] of Object.entries(filters)) {
    if (value !== '') params.set(key, value);
  }
  const response = await fetch(`${api}?${params}`, { signal });
  if (!response.ok) throw new Error('Hisaab returned an error');
  return response.json();
}

function link(url, label) {
  try {
    if (new URL(url).protocol !== 'https:') return node('span', label);
    const anchor = node('a', label);
    anchor.href = url;
    return anchor;
  } catch {
    return node('span', label);
  }
}

function showData(value, title = 'Source fields') {
  if (value === null) return node('span', 'Unknown');
  if (typeof value === 'string') return value.startsWith('https://') ? link(value, value) : node('span', value || '—');
  if (typeof value !== 'object') return node('span', String(value));
  const details = node('details');
  details.append(node('summary', Array.isArray(value) ? `${title} (${number.format(value.length)})` : title));
  details.addEventListener('toggle', () => {
    if (!details.open || details.children.length > 1) return;
    const list = node('dl');
    for (const [key, item] of Object.entries(value)) {
      const label = key.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ');
      const name = item?.title ?? item?.name ?? (Array.isArray(value) ? String(Number(key) + 1) : label);
      const content = node('dd');
      content.append(showData(item, String(name)));
      list.append(node('dt', Array.isArray(value) ? String(Number(key) + 1) : label), content);
    }
    details.append(list);
  });
  return details;
}

function button(label, action) {
  const control = node('button', label);
  control.type = 'button';
  control.addEventListener('click', action);
  return control;
}

function resetSelection() {
  selectionRequest?.abort();
  popup?.remove();
  byId('map-detail').replaceChildren();
  byId('map-records').replaceChildren();
}

function updateCategory() {
  byId('category-label').hidden = mapForm.elements.layer.value !== 'assets';
}

function mapFilters(bounds) {
  const form = new FormData(mapForm);
  const assets = form.get('layer') === 'assets';
  const filters = { q: form.get('q').trim() };
  if (bounds) filters.bbox = bounds.map(n => n.toFixed(6)).join(',');
  if (assets) filters.kind = form.get('kind');
  return { assets, filters };
}

function mapBounds() {
  if (!map) return purulia;
  const bounds = map.getBounds();
  return [
    Math.max(60, bounds.getWest()), Math.max(0, bounds.getSouth()),
    Math.min(105, bounds.getEast()), Math.min(43, bounds.getNorth()),
  ];
}

async function refreshMap() {
  const source = map?.getSource('hisaab');
  if (!source) return;
  resetSelection();
  mapRequest?.abort();
  const request = new AbortController();
  mapRequest = request;
  const { assets, filters } = mapFilters(mapBounds());
  source.setData(emptyMap);
  byId('map-status').textContent = 'Loading map records…';
  try {
    const data = await readFeed(assets ? 'map/assets' : 'map/works', filters, request.signal);
    if (request.signal.aborted) return;
    source.setData(data);
    const total = number.format(data.total);
    const scope = assets ? `historical records · ${data.edition || 'archived geography'}` : 'reviewed mapped works';
    byId('map-status').textContent = `${total} ${scope} in view.${data.truncated ? ' Zoom in to see omitted map groups.' : ''}`;
  } catch {
    if (!request.signal.aborted) byId('map-status').textContent = 'Map data is temporarily unavailable from Hisaab.';
  }
}

async function recordDetail(assets, id, title) {
  selectionRequest?.abort();
  const request = new AbortController();
  selectionRequest = request;
  const panel = byId('map-detail');
  panel.replaceChildren(node('h3', title), node('p', 'Loading source record…'));
  const route = `${assets ? 'assets' : 'works'}/${encodeURIComponent(id).replace('%3A', ':')}`;
  try {
    const data = await readFeed(route, {}, request.signal);
    if (request.signal.aborted) return;
    const fields = showData(data.asset ?? data.work ?? data);
    fields.open = true;
    panel.replaceChildren(node('h3', title), fields, link(`https://adiram.me/api/v1/${route}`, 'Open Hisaab source record'));
  } catch {
    if (!request.signal.aborted) panel.replaceChildren(node('p', 'This source record is temporarily unavailable.'));
  }
}

async function listMapRecords(bounds, offset = 0) {
  const panel = byId('map-records');
  panel.closest('details').open = true;
  selectionRequest?.abort();
  const request = new AbortController();
  selectionRequest = request;
  const { assets, filters } = mapFilters(bounds);
  panel.replaceChildren(node('p', 'Loading records in this area…'));
  try {
    const data = await readFeed(assets ? 'map/assets' : 'map/works', { ...filters, mode: 'members', offset }, request.signal);
    if (request.signal.aborted) return;
    const rows = assets ? data.assets : data.works;
    const list = node('ul');
    for (const row of rows) {
      const item = node('li');
      item.append(button(row.title, () => recordDetail(assets, row.id, row.title)));
      list.append(item);
    }
    panel.replaceChildren(node('p', rows.length ? `Showing ${offset + 1}–${offset + rows.length} of ${number.format(data.total)}` : 'No published records in this area.'), list);
    if (offset > 0) panel.append(button('Previous', () => listMapRecords(bounds, offset - 25)));
    if (offset + rows.length < data.total && rows.length) {
      panel.append(button('Next', () => listMapRecords(bounds, offset + rows.length)));
    }
  } catch {
    if (!request.signal.aborted) panel.replaceChildren(node('p', 'The map record list is temporarily unavailable.'));
  }
}

function showPoint(event) {
  const feature = map.queryRenderedFeatures(event.point, { layers: ['hisaab-markers'] })[0];
  if (!feature) return;
  const props = feature.properties;
  const coordinates = feature.geometry.coordinates;
  const assets = mapForm.elements.layer.value === 'assets';
  const content = node('div');
  if (props.cluster) {
    let bounds = props.bounds;
    try { if (typeof bounds === 'string') bounds = JSON.parse(bounds); } catch { bounds = null; }
    content.append(node('strong', `${number.format(props.count)} ${assets ? 'historical records' : 'reviewed works'}`));
    if (!bounds && props.west != null && props.east != null) bounds = [props.west, props.south, props.east, props.north];
    if (Array.isArray(bounds) && bounds.length === 4 && bounds.every(Number.isFinite)) {
      const [west, south, east, north] = bounds;
      const padded = [west - .000002, south - .000002, east + .000002, north + .000002];
      content.append(node('br'), button('Browse these records', () => listMapRecords(padded)));
    } else {
      content.append(node('br'), button('Zoom in', () => map.easeTo({ center: coordinates, zoom: map.getZoom() + 2 })));
    }
  } else {
    content.append(node('strong', props.title), node('br'), button('Source and evidence', () => recordDetail(assets, props.id, props.title)));
  }
  popup?.remove();
  popup = new Popup().setLngLat(coordinates).setDOMContent(content).addTo(map);
}

function initMap() {
  const style = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'positron';
  map = new Map({
    container: 'development-map',
    style: `https://tiles.openfreemap.org/styles/${style}`,
    bounds: purulia,
    fitBoundsOptions: { padding: 25 },
    maxBounds: [[60, 0], [105, 43]],
    renderWorldCopies: false,
  });
  map.addControl(new NavigationControl());
  map.once('load', () => {
    map.addSource('hisaab', { type: 'geojson', data: emptyMap });
    map.addLayer({
      id: 'hisaab-markers', type: 'circle', source: 'hisaab',
      paint: {
        'circle-color': '#126677', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5,
        'circle-radius': ['case', ['==', ['get', 'cluster'], true], 13, 6],
      },
    });
    map.addLayer({
      id: 'hisaab-count', type: 'symbol', source: 'hisaab',
      filter: ['==', ['get', 'cluster'], true],
      layout: { 'text-field': ['to-string', ['get', 'count']], 'text-size': 10, 'text-allow-overlap': true },
      paint: { 'text-color': '#fff' },
    });
    map.on('click', showPoint);
    map.on('mouseenter', 'hisaab-markers', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'hisaab-markers', () => { map.getCanvas().style.cursor = ''; });
    map.on('moveend', () => {
      clearTimeout(timer);
      timer = setTimeout(refreshMap, 300);
    });
    refreshMap();
  });
}

function updateRecordFilters() {
  const feed = recordsForm.elements.feed.value;
  for (const label of recordsForm.querySelectorAll('[data-filter]')) {
    label.hidden = !label.dataset.filter.split(' ').includes(feed);
    label.querySelector('input, select').disabled = label.hidden;
  }
}

async function loadRecords(offset = 0) {
  recordsRequest?.abort();
  const request = new AbortController();
  recordsRequest = request;
  const { feed, ...filters } = Object.fromEntries(new FormData(recordsForm));
  const status = byId('records-status');
  const container = byId('records');
  if (feed === 'works') Object.assign(filters, { limit: 25, offset });
  if (feed === 'funding') filters.offset = offset;
  status.textContent = 'Loading records…';
  container.replaceChildren();
  try {
    const response = await readFeed(feed, filters, request.signal);
    if (request.signal.aborted) return;
    status.textContent = (response.works?.length === 0 || response.areas?.length === 0)
      ? 'No published records match this query.' : 'Source data retrieved from Hisaab.';
    const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== ''));
    const details = showData(response);
    details.open = true;
    container.append(link(`https://adiram.me/api/v1/${feed}?${params}`, 'Open source response'), details);
    if (feed === 'works' && response.works?.length && offset + response.works.length < response.total) {
      container.append(button('Next works', () => loadRecords(offset + 25)));
    }
    if (feed === 'works' && offset) container.append(button('Previous works', () => loadRecords(offset - 25)));
  } catch {
    if (!request.signal.aborted) status.textContent = 'This public feed is unavailable or the selected filters are invalid.';
  }
}

mapForm.addEventListener('submit', event => { event.preventDefault(); refreshMap(); });
mapForm.elements.layer.addEventListener('change', () => { updateCategory(); refreshMap(); });
byId('india').addEventListener('click', () => map?.fitBounds(india, { padding: 24 }));
byId('purulia').addEventListener('click', () => map?.fitBounds(purulia, { padding: 24 }));
byId('map-list').addEventListener('click', () => listMapRecords(mapBounds()));
recordsForm.elements.feed.addEventListener('change', () => {
  updateRecordFilters();
  recordsRequest?.abort();
  byId('records').replaceChildren();
  byId('records-status').textContent = '';
});
recordsForm.addEventListener('submit', event => { event.preventDefault(); loadRecords(); });
updateCategory();
updateRecordFilters();
try {
  initMap();
} catch {
  byId('map-status').textContent = 'The map could not start on this device. Use the record list to browse Purulia.';
}
loadRecords();
