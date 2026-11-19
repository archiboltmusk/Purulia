import { layers, read, loadLayer } from './kasa-intelligence-feeds.mjs';
import { createFallback } from './live-intelligence-fallback.mjs';
import { measure } from './internet-speed-core.mjs';

const id = (name) => document.getElementById(name);
const empty = { type: 'FeatureCollection', features: [] };
const format = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });

function append(parent, tag, value) {
  const node = document.createElement(tag);
  node.textContent = value;
  parent.append(node);
  return node;
}

export function mountIntelligence({ map, district, closeDrawer, renderList }) {
  const panel = id('k-intelligence');
  const controls = id('k-intelligence-layers');
  const status = id('k-intelligence-status');
  const selector = id('k-layer-select');
  const history = id('k-intelligence-history');
  const detail = id('k-intelligence-detail');
  const sourceId = 'kasa-intelligence';
  let sequence = 0;
  let current = empty;
  let timer;
  let fallback;
  function activateFallback() {
    if (fallback) return;
    document.getElementById('k-splash')?.classList.add('k-splash-out');
    const container = id('k-map');
    if (!container) return;
    container.replaceChildren();
    container.classList.add('k-intelligence-fallback');
    fallback = createFallback(container, read('places/in_states.geojson'));
    append(container, 'p', 'Interactive report pins require WebGL2. Switch to List to browse civic reports.').className = 'k-intelligence-fallback-note';
    draw();
  }

  function draw() {
    const canvas = fallback ?? map();
    if (!canvas || (!fallback && !canvas.getLayer('clusters'))) return;
    if (!canvas.getSource(sourceId) && current.features.length === 0) return;
    if (!canvas.getSource(sourceId)) {
      canvas.addSource(sourceId, { type: 'geojson', data: current });
      canvas.addLayer({
        id: sourceId, type: 'circle', source: sourceId,
        paint: { 'circle-color': ['get', 'color'], 'circle-radius': 7, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 }
      }, 'clusters');
      canvas.on?.('click', sourceId, (event) => {
        if (event.defaultPrevented) return;
        event.preventDefault();
        const p = event.features[0].properties;
        new window.maplibregl.Popup().setLngLat(event.lngLat)
          .setText([p.label, Number.isFinite(p.mag) && 'Magnitude ' + p.mag, p.observed, p.note].filter(Boolean).join(' · '))
          .addTo(canvas);
      });
    }
    canvas.getSource(sourceId).setData(current);
  }

  const legend = id('k-feed-legend');
  const active = () => layers.find(layer => layer.id === selector.value);
  function list(query = '') {
    if (selector.value === 'reports') return false;
    const native = !active();
    const data = native ? window.KasaLayers?.datasets.get(selector.value) : current;
    const rows = (data?.features || []).map(({properties: p}) =>
      [p.label || p.name || p.title || p.state || (p.pc && 'Seat ' + p.pc), p.v, p.place, Number.isFinite(p.mag) && 'Magnitude ' + p.mag, p.observed, p.note].filter(Boolean).join(' · ')
    ).filter(text => text.toLowerCase().includes(query.toLowerCase()));
    const items = id('k-list-items');
    items.replaceChildren();
    rows.forEach(text => append(items, 'p', text));
    if (!rows.length) append(items, 'p', query ? 'No matching observations.' : native ? 'No mapped records available.' : status.textContent);
    id('k-list-count').textContent = rows.length + ' observations';
    return true;
  }
  async function refresh() {
    const ticket = ++sequence;
    clearTimeout(timer);
    const layer = layers.find(({ id: key }) => key === selector.value);
    legend.hidden = !layer;
    id('k-intelligence-refresh').disabled = !layer;
    id('k-sort').disabled = Boolean(layer);
    legend.textContent = layer?.name || '';
    history.hidden = layer?.id !== 'quake';
    draw();
    if (!layer) {
      current = empty;
      draw();
      status.textContent = 'Civic reports are visible on the map.';
      renderList();
      return;
    }
    status.textContent = 'Checking ' + layer.name + '…';
    renderList();
    try {
      const result = await loadLayer(layer.id, Number(history.value));
      if (ticket !== sequence) return;
      current = {
        ...result.data,
        features: result.data.features.map((feature) => ({
          ...feature, properties: { ...feature.properties, color: layer.color }
        }))
      };
      draw();
      status.textContent = current.features.length + ' mapped · ' + result.status;
    } catch {
      if (ticket === sequence) status.textContent = 'Source unavailable · any points still visible may be stale.';
    } finally {
      if (ticket === sequence) {
        legend.textContent = layer.name + ' · ' + current.features.length + ' mapped';
        legend.title = status.textContent;
        if (status.textContent.includes('Stale') || status.textContent.includes('unavailable')) legend.textContent += ' · stale or unavailable';
        if (!current.features.length && layer.id === 'speed') status.textContent += ' · A cell needs five contributors before publication.';
        renderList();
        timer = setTimeout(refresh, layer.interval);
      }
    }
  }

  selector.addEventListener('change', () => {
    const url = new URL(location.href);
    url.searchParams.set('layer', selector.value);
    window.history.replaceState(window.history.state, '', url);
    current = empty;
    refresh();
    if (matchMedia('(max-width: 760px)').matches && document.querySelector('.k-filters-open')) id('k-filter-toggle').click();
  });
  history.addEventListener('change', () => {
    const url = new URL(location.href);
    url.searchParams.set('days', history.value);
    window.history.replaceState(window.history.state, '', url);
    current = empty;
    refresh();
  });
  id('k-intelligence-refresh').addEventListener('click', refresh);

  function link(parent, label, href) {
    if (!href?.startsWith('https://')) return;
    const row = document.createElement('p');
    const anchor = append(row, 'a', label);
    anchor.href = href;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    parent.append(row);
  }

  const requests = new WeakMap();
  async function evidence(slug, target = detail) {
    const detail = target;
    const request = Symbol();
    requests.set(target, request);
    detail.replaceChildren();
    append(detail, 'p', 'Loading records…');
    const [facts, money, education, registry, air, affidavits, records] = await Promise.allSettled([
      read('places/wb_district_facts.json'), read('places/money.json'), read('schools-benchmarks.json'),
      read('data/live-source-registry.json'), read('places/air/openaq.json'),
      read('places/wb_affidavits.json'), read('places/wb_record.json')
    ]).then((results) => results.map((result) => result.value));
    if (request !== requests.get(target)) return;
    detail.replaceChildren();
    const area = facts?.districts?.[slug];
    const nfhs = facts?.nfhs?.districts?.[area?.nfhs_district];
    append(detail, 'h3', area?.name ?? 'Public records');
    const metric = (label, value, source) => {
      if (!Number.isFinite(value)) return;
      const row = append(detail, 'p', label + ' · ' + format.format(value) + ' · ' + source + ' ');
      const url = new URL(location.href);
      url.searchParams.set('intelligence', 'evidence');
      if (slug) url.searchParams.set('d', slug);
      url.searchParams.set('figure', label);
      const anchor = append(row, 'a', 'Permalink');
      anchor.href = url.href;
      anchor.setAttribute('aria-label', 'Permalink for ' + label);
      if (new URLSearchParams(location.search).get('figure') === label) {
        row.style.borderInlineStart = '3px solid currentColor';
        row.scrollIntoView({block:'nearest'});
      }
    };
    metric('Homes with tap water (%)', area?.jjm?.pct, 'Jal Jeevan Mission, checked ' + facts?.sources?.jjm?.read);
    metric('Households with electricity (%)', nfhs?.electricity?.[0], 'NFHS-5, 2019–21');
    metric('Institutional births (%)', nfhs?.inst_births?.[0], 'NFHS-5, 2019–21');
    metric('Population', area?.census2011?.population, '2011 Census');
    if (area && nfhs) link(detail, 'Open NFHS district fact sheets', facts.sources?.nfhs?.url);
    if (area?.jjm) link(detail, 'Open Jal Jeevan Mission source', facts.sources?.jjm?.url);
    const station = air?.districts?.find((row) => row.slug === slug);
    metric('Nearest station PM₂.₅ (' + station?.pm25?.unit + ')', station?.pm25?.value, 'OpenAQ, ' + station?.pm25?.utc);
    if (area) {
      metric('West Bengal capital expenditure (₹ crore)', money?.rbi?.states?.['West Bengal']?.capExp, 'RBI, ' + money?.rbi?.year);
      metric('West Bengal schools with working drinking water (%)', education?.indicators?.find((x) => x.key === 'water')?.west_bengal, 'UDISE+, ' + education?.source?.year);
    } else append(detail, 'p', 'District figures are available for covered West Bengal districts. Select a district on the map.');
    if (money?.missing?.length) {
      const gaps = append(detail, 'details', '');
      append(gaps, 'summary', 'Spending records missing from Parishkar (' + money.missing.length + ')');
      for (const gap of money.missing) {
        append(gaps, 'h4', gap.what);
        append(gaps, 'p', [gap.where, gap.why].join(' · '));
        const request = append(gaps, 'button', 'Draft request for this record');
        request.type = 'button';
        request.onclick = () => {
          if (!panel.open) panel.showModal();
          id('k-intelligence-detail').parentElement.open = true;
          draftFields[1].value = gap.what;
          draftFields[1].closest('details').open = true;
          updateDraft();
          draftFields[0].focus();
        };
      }
      link(gaps, 'Open Central Public Procurement Portal', 'https://eprocure.gov.in/cppp/');
    }
    if (affidavits || records) {
      const officials = append(detail, 'details', '');
      append(officials, 'summary', 'Representative records and disclosures');
      if (affidavits) append(officials, 'p', 'Sworn disclosure index checked ' + affidavits.checked);
      link(officials, 'Open West Bengal election disclosures', affidavits?.sources?.ac);
      if (records) append(officials, 'p', 'Parliament activity index checked ' + records.checked);
      link(officials, 'Open MP parliamentary activity', records?.sources?.prs);
    }
    if (registry?.sources?.length) {
      const sources = append(detail, 'details', '');
      append(sources, 'summary', 'Source coverage (' + registry.sources.length + ')');
      for (const source of registry.sources) {
        append(sources, 'p', [source.category, source.status.replaceAll('_', ' '), source.coverage, source.constraint].filter(Boolean).join(' · '));
      }
    }
    if (area?.website?.startsWith('http://')) link(detail, 'Open district authority website', area.website.replace('http:', 'https:'));
    else link(detail, 'Open district authority website', area?.website);
  }

  async function speedTest() {
    const button = id('k-intelligence-test');
    const output = id('k-intelligence-test-output');
    button.disabled = true;
    try {
      const result = await measure('mobile', { progress: (message) => { output.textContent = message; } });
      output.textContent = result.download_mbps + ' Mbps down · ' + result.upload_mbps + ' Mbps up · ' + result.latency_ms + ' ms. Private estimate.';
    } catch {
      output.textContent = 'Speed test could not finish. Try again with the page visible.';
    } finally {
      button.disabled = false;
    }
  }
  const draftFields = ['k-evidence-office', 'k-evidence-record', 'k-evidence-period'].map(id);
  function updateDraft() {
    const [office, record, period] = draftFields.map((field) => field.value.trim());
    id('k-evidence-draft').value = 'To the Public Information Officer, ' + (office || '[public office]') +
      '\n\nPlease provide a copy of ' + (record || '[specific record or project document]') +
      ' for ' + (period || '[date range]') +
      '. Please include the document reference and date, and tell me if any portion is unavailable.\n\n[Applicant name and contact details]';
  }
  draftFields.forEach((field) => field.addEventListener('input', updateDraft));
  updateDraft();

  id('k-intelligence-test').addEventListener('click', speedTest);

  const start = (event) => {
    const section = event?.target.closest('[data-intelligence]')?.dataset.intelligence ??
      new URLSearchParams(location.search).get('intelligence');
    closeDrawer();
    const selected = district();
    if (!panel.open) panel.showModal();
    if (section === 'evidence') detail.parentElement.open = true;
    if (section === 'speed') {
      selector.value = 'speed';
      selector.dispatchEvent(new Event('change'));
      controls.open = true;
    }
    evidence(selected);
  };
  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-intelligence]')) start(event);
  });
  panel.addEventListener('close', () => { draw(); });
  const params = new URLSearchParams(location.search);
  if ([...selector.options].some(option => option.value === params.get('layer'))) selector.value = params.get('layer');
  if (['1','7','30'].includes(params.get('days'))) history.value = params.get('days');
  window.KasaLayers?.choose(selector.value);
  document.addEventListener('kasa-layer-data', renderList);
  refresh();
  if (params.has('intelligence')) {
    if (params.get('intelligence') === 'evidence') detail.parentElement.open = true;
    start();
  }
  return { draw, list, active, activateFallback, evidence };
}
