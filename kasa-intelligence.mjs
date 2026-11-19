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

export function mountIntelligence({ map, district, closeDrawer }) {
  const panel = id('k-intelligence');
  const controls = id('k-intelligence-layers');
  const status = id('k-intelligence-status');
  const selector = id('k-intelligence-layer');
  const history = id('k-intelligence-history');
  const detail = id('k-intelligence-detail');
  const sourceId = 'kasa-intelligence';
  let sequence = 0;
  let current = empty;
  let timer;
  let fallback;
  setTimeout(() => {
    if (map()) return;
    document.getElementById('k-splash')?.classList.add('k-splash-out');
    const container = id('k-map');
    if (!container) return;
    container.replaceChildren();
    container.classList.add('k-intelligence-fallback');
    fallback = createFallback(container, read('places/in_states.geojson'));
    append(container, 'p', 'Interactive report pins require WebGL2. Switch to List to browse civic reports.').className = 'k-intelligence-fallback-note';
    draw();
  }, 3000);

  function draw() {
    const canvas = map() ?? fallback;
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
        const p = event.features[0].properties;
        new window.maplibregl.Popup().setLngLat(event.lngLat)
          .setText([p.label, Number.isFinite(p.mag) && 'Magnitude ' + p.mag, p.observed, p.note].filter(Boolean).join(' · '))
          .addTo(canvas);
      });
    } else canvas.getSource(sourceId).setData(current);
  }

  async function refresh() {
    const ticket = ++sequence;
    clearTimeout(timer);
    const layer = layers.find(({ id: key }) => key === selector.value);
    history.hidden = layer?.id !== 'quake';
    draw();
    if (!layer) {
      current = empty;
      draw();
      status.textContent = 'Civic reports are visible on the map.';
      return;
    }
    status.textContent = 'Checking ' + layer.name + '…';
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
      if (ticket === sequence) timer = setTimeout(refresh, layer.interval);
    }
  }

  selector.addEventListener('change', () => {
    current = empty;
    refresh();
  });
  history.addEventListener('change', refresh);
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

  let detailsRequest = 0;
  async function evidence(slug) {
    const request = ++detailsRequest;
    detail.replaceChildren();
    append(detail, 'p', 'Loading records…');
    const [facts, money, education, registry, air, affidavits, records] = await Promise.allSettled([
      read('places/wb_district_facts.json'), read('places/money.json'), read('schools-benchmarks.json'),
      read('data/live-source-registry.json'), read('places/air/openaq.json'),
      read('places/wb_affidavits.json'), read('places/wb_record.json')
    ]).then((results) => results.map((result) => result.value));
    if (request !== detailsRequest) return;
    detail.replaceChildren();
    const area = facts?.districts?.[slug];
    const nfhs = facts?.nfhs?.districts?.[area?.nfhs_district];
    append(detail, 'h3', area?.name ?? 'Public records');
    const metric = (label, value, source) => {
      if (Number.isFinite(value)) append(detail, 'p', label + ' · ' + format.format(value) + ' · ' + source);
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
      controls.open = true;
    }
    evidence(selected);
    refresh();
  };
  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-intelligence]')) start(event);
  });
  panel.addEventListener('close', () => { draw(); });
  const params = new URLSearchParams(location.search);
  if (params.has('intelligence')) {
    if (params.get('intelligence') === 'evidence') detail.parentElement.open = true;
    start();
  }
  return { draw };
}
