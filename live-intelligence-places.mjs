const stateAliases = {
  'Andaman and Nicobar Islands': 'Andaman & Nicobar Islands',
  'Dadra and Nagar Haveli and Daman and Diu': 'Daman & Diu and Dadra & Nagar Haveli',
  'Jammu and Kashmir': 'Jammu & Kashmir'
};
const number = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });

function addMetric(panel, label, value, provenance, href) {
  if (!Number.isFinite(value)) return;
  const row = document.createElement('p');
  const metric = document.createElement('strong');
  metric.textContent = label + ' · ' + number.format(value);
  const source = document.createElement('a');
  source.href = href;
  source.textContent = provenance;
  row.append(metric, document.createElement('br'), source);
  panel.append(row);
}

function addLink(panel, label, href) {
  const link = document.createElement('a');
  link.textContent = label;
  link.href = href;
  const row = document.createElement('p');
  row.append(link);
  panel.append(row);
}

export function placeProfile(panel, read) {
  const cache = new Map();
  function load(path) {
    if (!cache.has(path)) cache.set(path, read(path).catch(() => {
      cache.delete(path);
      return null;
    }));
    return cache.get(path);
  }
  let selection = 0;
  return async ({ state, label, slug }) => {
    const current = ++selection;
    const heading = document.createElement('h2');
    heading.textContent = label;
    panel.replaceChildren(heading);
    panel.hidden = false;
    const [facts, finance, education, openaq] = await Promise.all([
      slug ? load('places/wb_district_facts.json') : null,
      load('places/money.json'),
      load('schools-benchmarks.json'),
      slug ? load('places/air/openaq.json') : null
    ]);
    if (current !== selection) return;
    const district = facts?.districts[slug];
    if (district) {
      const jjm = facts.sources.jjm;
      const nfhs = facts.nfhs.districts[district.nfhs_district];
      const query = '?d=' + encodeURIComponent(slug);
      addMetric(panel, 'Homes with tap water (%)', district.jjm?.pct, 'Jal Jeevan Mission · read ' + jjm.read, jjm.url);
      addMetric(panel, 'Households with electricity (%)', nfhs?.electricity?.[0], 'NFHS-5 · 2019–21', facts.sources.nfhs.url);
      addMetric(panel, 'Institutional births (%)', nfhs?.inst_births?.[0], 'NFHS-5 · 2019–21', facts.sources.nfhs.url);
      addMetric(panel, 'Population', district.census2011?.population, 'Census of India · 2011', district.wikidata);
      const station = openaq?.districts?.find((row) => row.slug === slug);
      const reading = station?.pm25;
      if (Number.isFinite(reading?.value)) {
        const observed = Number.isFinite(Date.parse(reading.utc)) ? reading.utc : 'time unavailable';
        addMetric(panel, 'Nearest station PM₂.₅ (' + reading.unit + ')', reading.value,
          'OpenAQ · ' + observed, 'air.html' + query);
      }
      addLink(panel, 'District dashboard · weather, air and civic reports', 'godseye.html' + query);
      addLink(panel, 'District profile · officials and source records', 'data.html' + query);
      if (slug === 'purulia') {
        addLink(panel, 'Purulia school directory and checks', 'schools.html');
        addLink(panel, 'Purulia public works and evidence', 'works.html');
        addLink(panel, 'Purulia tourism and routes', 'tourism.html');
      }
    }
    const fiscal = finance?.rbi;
    addMetric(panel, state + ' capital expenditure (₹ crore)', fiscal?.states[state]?.capExp,
      'RBI Handbook · ' + fiscal?.year, fiscal?.page);
    const water = education?.indicators.find((indicator) => indicator.key === 'water');
    const schoolWater = water?.states[state] ?? water?.states[stateAliases[state]];
    addMetric(panel, state + ' schools with working drinking water (%)', schoolWater,
      'UDISE+ · ' + education?.source.year, education?.source.url);
    if (panel.childElementCount === 1) {
      const message = document.createElement('p');
      message.textContent = 'No linked figures available for this selection.';
      panel.append(message);
    }
  };
}
