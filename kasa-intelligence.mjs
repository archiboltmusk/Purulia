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
    const [facts, money, education, registry, air, affidavits, records, projects] = await Promise.allSettled([
      read('places/wb_district_facts.json'), read('places/money.json'), read('schools-benchmarks.json'),
      read('data/live-source-registry.json'), read('places/air/openaq.json'),
      read('places/wb_affidavits.json'), read('places/wb_record.json'), read('places/wb_mplads.json')
    ]).then((results) => results.map((result) => result.value));
    if (request !== requests.get(target)) return;
    detail.replaceChildren();
    const area = facts?.districts?.[slug];
    const nfhs = facts?.nfhs?.districts?.[area?.nfhs_district];
    append(detail, 'h3', area?.name ?? 'Public records');
    if (['kolkata','purulia'].includes(slug)) {
      const compare = append(detail, 'details', '');
      append(compare, 'summary', 'Kolkata vs Purulia · facilities and representatives');
      compare.open = new URLSearchParams(location.search).get('intelligence') === 'compare';
      append(compare, 'p', 'District household survey estimates, NFHS-5 (2019–21). These measure access and use. Current staffing, travel time and service reliability require separate records.');
      const table = append(compare, 'table', '');
      const header = append(table, 'tr', '');
      for (const label of ['Indicator (%)','Kolkata','Purulia']) append(header, 'th', label).scope = 'col';
      for (const [key,label] of [['clean_fuel','Households using clean cooking fuel'],['sanitation','Population using improved sanitation'],['electricity','Population with electricity at home'],['inst_births','Institutional births'],['vaccinated','Children aged 12–23 months fully vaccinated']]) {
        const row = append(table, 'tr', '');
        append(row, 'th', label).scope = 'row';
        for (const name of ['Kolkata','Puruliya']) {
          const value = facts?.nfhs?.districts?.[name]?.[key]?.[0];
          append(row, 'td', Number.isFinite(value) ? value.toFixed(1) : 'Unavailable');
        }
      }
      link(compare, 'NFHS district fact sheets', facts?.sources?.nfhs?.url);
      append(compare, 'h4', 'Proposed public tasks');
      append(compare, 'p', 'Purulia MLA: request dated staffing and opening records for Chalyanpur and Sidhi PHCs. The district health page lists both as non-functional. Ask the district health office for the current position, the interim referral facility and the next review date. Verify against a dated roster and a site check.');
      link(compare, 'Purulia district health facility register', 'https://purulia.gov.in/health/');
      append(compare, 'p', 'Purulia elected local bodies: request ward and village sanitation repair lists, identify the executing office and publish inspection dates. Verify water availability and actual use after repair.');
      append(compare, 'p', 'Kolkata ward councillors: request aggregate missed vaccination sessions and catch-up schedules from municipal health officers. Verify sessions held and coverage by ward, keeping children’s identities private.');
      append(compare, 'p', 'Both districts: ask transport and employment offices for shift-compatible bus schedules and verified vacancies with pay. Check whether a worker can return home after the shift and actually received the stated wage.');
      append(compare, 'p', 'These are resident proposals. Acceptance, departmental action and completion each require a dated record.');
      append(compare, 'h4', 'What the public MP records show');
      for (const [seat,name] of [['35','Purulia'],['23','Kolkata Dakshin'],['24','Kolkata Uttar']]) {
        const mp = records?.pc?.[seat]?.prs, work = projects?.pc?.[seat];
        append(compare, 'h5', name + ' · Lok Sabha constituency');
        if (mp) {
          append(compare, 'p', [records.avg?.from,records.avg?.to].join(' to ') + ' · attendance ' + (mp.attendance == null ? 'unavailable' : mp.attendance + '%') + ' · questions ' + (mp.questions ?? 'unavailable') + ' · debates ' + (mp.debates ?? 'unavailable'));
          link(compare, 'Representative and activity record · PRS', mp.url);
        }
        if (work) {
          append(compare, 'p', 'MPLADS snapshot checked ' + projects.checked + ' · works recommended ' + (work.worksRecommended ?? 'unavailable') + ' · recorded completed ' + (work.worksCompleted ?? 'unavailable'));
          if (Number.isInteger(work.worksCompleted) && work.worksRecommended > 0) append(compare,'p',(100*work.worksCompleted/work.worksRecommended).toFixed(1)+'% recorded completions relative to recommendations. Physical progress for individual projects is unknown.');
          link(compare, 'Constituency works source', work.url);
        }
        if (!mp && !work) append(compare, 'p', 'No activity record available.');
      }
      append(compare, 'p', 'Constituencies and districts have different boundaries. Questions and debates document parliamentary participation. MPs recommend works; execution and verification involve implementing authorities. These records do not establish how a person spent unobserved time.');
    }
    if (area) {
      const tasks = append(detail, 'details', '');
      append(tasks, 'summary', area.name + ' · district strengths and ground worklist');
      tasks.open = new URLSearchParams(location.search).get('intelligence') === 'worklist';
      append(tasks, 'p', 'NFHS-5 (2019–21): largest favourable and adverse differences from West Bengal among the available survey indicators.');
      const gaps = Object.entries(facts.nfhs?.indicators || {}).flatMap(([key, field]) => {
        const local = nfhs?.[key]?.[0], state = facts.nfhs?.west_bengal?.[key];
        return Number.isFinite(local) && Number.isFinite(state) && !area.nfhs_part_of ?
          [{label:field.label, local, state, score:(local-state)*(field.higher_is_better ? 1 : -1)}] : [];
      }).sort((a,b) => b.score-a.score);
      for (const g of [...gaps.filter(g => g.score>0).slice(0,2), ...gaps.filter(g => g.score<0).slice(-2)]) {
        append(tasks,'p',(g.score>0 ? 'Relative strength · ' : 'Gap to investigate · ') + g.label + ': district ' + g.local + '%, state ' + g.state + '%.');
      }
      if (!gaps.length) append(tasks,'p','Comparable figures for this district boundary unavailable.');
      link(tasks,'Survey definitions and period',facts.sources.nfhs?.url);
      if (slug === 'purulia' || slug === 'kolkata') {
        const west = slug === 'purulia';
        append(tasks,'h4',west ? 'Manbazar · land, water and forest concerns' : 'Jadavpur · pedestrian access');
        append(tasks,'p',west ? 'The Telegraph reported a public gathering raising concerns about industrial projects. Check individual sites and project permissions before attributing harm.' : 'A public Reddit discussion describes uneven and broken pavement. Current conditions and the exact stretch need a fresh site check.');
        link(tasks,west ? 'Read the local reporting' : 'Read the community lead',west ? 'https://www.telegraphindia.com/west-bengal/tribal-groups-hold-mega-rally-in-purulia-against-industrial-projects-prnt/cid/2187585' : 'https://www.reddit.com/r/kolkata/comments/1ga5ykn/');
        for (const [role,action] of [
          ['MLA',west ? 'Request the project list, hearing minutes and a dated departmental response.' : 'Request the road owner’s inspection and repair schedule.'],
          ['MP',west ? 'Check whether a named project requires central clearance; request the public decision where applicable.' : 'Check whether the identified stretch received centrally recommended funds and match the work reference.'],
          ['Local body',west ? 'Convene affected villages and publish proposed remedies and review dates.' : 'Walk the crossing with residents and record accessible width and outstanding obstacles.'],
          ['Residents',west ? 'Identify the affected public asset and document its service before and after action.' : 'Revisit the same crossing after repairs with a volunteer who uses a wheelchair or pushchair.']
        ]) append(tasks,'p',role+' · '+action);
        append(tasks,'p','Proposed tasks. Acceptance and physical completion unknown.');
      } else append(tasks,'p','Independent local leads have not yet been curated here. Use Report a problem to record an observed service failure.');
      append(tasks,'p','To challenge a completion claim, match the project ID, public site, completion record and dated inspection. To establish low usefulness, compare intended service with observed use over multiple days. Record the implementing office’s response.');
    }
    const accountability = append(detail, 'details', '');
    append(accountability, 'summary', 'Public problems, responsible offices & action taken');
    const water = area?.jjm;
    if (Number.isInteger(water?.homes) && Number.isInteger(water.tap) && water.tap >= 0 && water.homes >= water.tap) {
      append(accountability, 'h4', area.name + ' · Rural drinking water');
      append(accountability, 'p', format.format(water.homes - water.tap) + ' of ' + format.format(water.homes) +
        ' rural households had no recorded tap connection in the JJM snapshot checked ' + facts.sources.jjm.read +
        '. Water quality and daily supply require separate checks.');
      link(accountability, 'District connection record · Jal Jeevan Mission', facts.sources.jjm.url);
      append(accountability, 'p', 'Follow up with the rural water scheme operator and district public health engineering office. Request the habitation-wise work order, commissioning date and supply log. Verify delivery at the affected habitation.');
    }
    const audits = append(accountability, 'details', '');
    append(audits, 'summary', 'State audit flags · outstanding grant certificates');
    append(audits, 'p', 'An outstanding utilisation certificate is a documentation gap at the audit date. Establishing misuse requires a separate finding. Ask the grant-making department for subsequent certificates and the auditor’s settlement record.');
    for (const [state, audit] of Object.entries(money?.audit || {})) {
      const flag = audit.figures?.find(f => f.k === 'ucs_pending');
      if (!flag || !Number.isFinite(flag.crore)) continue;
      append(audits, 'p', state + ' · ₹' + format.format(flag.crore) + ' crore · ' + (flag.asof || audit.year));
      link(audits, 'CAG · ' + flag.where, flag.url || audit.page);
    }
    const board = append(accountability, 'details', '');
    append(board, 'summary', 'Open resident reports by routing office · Parishkar coverage');
    append(board, 'p', 'Reported concerns. Routing is based on ward, block and asset tags. Confirm ownership with the office. The board covers participating places and shows up to 200 open reports per office.');
    const cases = append(board, 'div', '');
    async function query(name, args) {
      const config = window.KASA_CONFIG;
      return read(config.SUPABASE_URL + '/rest/v1/rpc/' + name, {method:'POST', cache:'no-store',
        headers:{apikey:config.SUPABASE_ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify(args)});
    }
    board.addEventListener('toggle', async () => {
      if (!board.open || cases.childElementCount) return;
      append(cases, 'p', 'Checking public reports…');
      try {
        const offices = await query('kasa_office_board', {});
        cases.replaceChildren();
        if (!offices.length) append(cases, 'p', 'No open reports returned.');
        for (const office of offices) {
          const section = append(cases, 'details', '');
          append(section, 'summary', office.title + ' · ' + office.open + ' open');
          append(section, 'p', office.overdue + ' past the tracker deadline. ' + (office.source || 'Office contact source unavailable.'));
          for (const report of office.reports || []) {
            const row = append(section, 'details', '');
            append(row, 'summary', report.category.replaceAll('_',' ') + ' · reported ' + report.created_at.slice(0,10) + ' · ' + report.days_open + ' days open');
            row.addEventListener('toggle', async () => {
              if (!row.open || row.childElementCount > 1) return;
              const evidence = append(row, 'p', 'Checking response records…');
              try {
                const records = await query('kasa_report_dockets', {p_report_id:String(report.id)});
                evidence.textContent = records.length ? 'Publicly logged correspondence' : 'No linked docket. Government action is unknown.';
                for (const record of records) append(row, 'p', [record.portal, record.filed_on || record.added, record.status?.replaceAll('_',' ')].filter(Boolean).join(' · '));
                if (records.length) append(row, 'p', 'A filing records correspondence. Verify repairs against a work order and a dated site check.');
              } catch { evidence.textContent = 'Response records unavailable.'; }
            });
          }
        }
      } catch { cases.replaceChildren(); append(cases, 'p', 'Office board unavailable.'); }
    });
    const guide = append(accountability, 'details', '');
    append(guide, 'summary', 'Which office to approach and how to check a fix');
    append(guide, 'p', 'Starting points across India. Confirm the operator and jurisdiction locally. These categories describe common services, without ranking national prevalence.');
    for (const [problem, owner, check] of [
      ['Unsafe school facilities','School head and district education office','Request the inspection and repair sanction. Check that the toilet, classroom or water point is usable.'],
      ['Missed waste collection or blocked drains','Municipal sanitation office or gram panchayat','Request the route and clearance schedule. Check the site after the next collection or rainfall.'],
      ['Damaged roads','Road-owning municipality, panchayat, PWD or highway authority','Identify the road owner and maintenance contract. Compare the repair with its specification.'],
      ['Power cuts or billing errors','Local electricity distribution company','Obtain a complaint number. Compare restoration times or the corrected bill with the complaint.'],
      ['Clinic staffing or medicine shortages','Facility head and district health administration','Request aggregate staffing or stock records. Check service availability on the next scheduled day.'],
      ['Ration entitlement shortfall','Fair-price shop and district food and supplies office','Compare the entitlement with the dated receipt. Verify the missing allocation was delivered.'],
      ['Delayed rural employment wages','Gram panchayat and block programme officer','Trace muster roll, payment order and settlement. Confirm receipt privately with the worker.'],
      ['Bus service gaps','Transport undertaking or contracted operator','Compare the published timetable with observed departures over several days.'],
      ['Housing or pension application delays','Implementing scheme office at block or urban local body','Request a dated decision and reason. Verify payment or delivery with the applicant’s consent.'],
      ['Air pollution','State Pollution Control Board or Pollution Control Committee','Identify the monitor and period. Ask for inspection findings and check subsequent measurements.']
    ]) {
      append(guide, 'h4', problem);
      append(guide, 'p', owner + '. ' + check);
    }
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

  const satellite = id('k-satellite');
  const earlier = id('sat-earlier'), later = id('sat-later');
  const utcDay = daysAgo => new Date(Date.now()-daysAgo*86400000).toISOString().slice(0,10);
  earlier.value = utcDay(31);
  later.value = utcDay(1);
  earlier.max = later.max = utcDay(0);
  let imageRequest = 0;
  async function compareImages() {
    const ticket = ++imageRequest;
    const box = id('sat-images'), notice = id('sat-location');
    box.replaceChildren();
    if (!earlier.value || !later.value || earlier.value >= later.value || later.value > utcDay(0)) {
      notice.textContent = 'Choose two different dates in chronological order through today (UTC).';
      return;
    }
    try {
      const canvas = map();
      const center = canvas?.getCenter();
      const coords = center ? [center.lng, center.lat] : (await read('places/godseye.json')).districts?.[district()]?.at;
      if (ticket !== imageRequest) return;
      if (!coords) { notice.textContent = 'Select a covered district or centre the interactive map on a site.'; return; }
      const [x,y] = coords.map(n => Math.round(n*10)/10);
      notice.textContent = 'Regional view centred at '+y+'°, '+x+'°. Both images cover the same 0.6° square. Dates identify requested daily composites; a blank image means coverage is unconfirmed.';
      for (const day of [earlier.value,later.value]) {
        const fig = append(box,'figure',''); fig.style.margin = '0';
        const caption = append(fig,'figcaption',day+' UTC · loading');
        const img = document.createElement('img');
        img.width = img.height = 512; img.style.cssText='width:100%;height:auto';
        img.alt = 'Terra MODIS true-colour imagery for '+day;
        img.referrerPolicy='no-referrer';
        img.onload = () => { caption.textContent = day+' UTC · NASA GIBS'; };
        img.onerror = () => { caption.textContent = day+' UTC · imagery unavailable'; img.hidden=true; };
        fig.append(img);
        const query = new URLSearchParams({SERVICE:'WMS',VERSION:'1.1.1',REQUEST:'GetMap',LAYERS:'MODIS_Terra_CorrectedReflectance_TrueColor',STYLES:'',SRS:'EPSG:4326',BBOX:[x-.3,y-.3,x+.3,y+.3].join(','),WIDTH:'512',HEIGHT:'512',FORMAT:'image/jpeg',TIME:day});
        img.src='https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?'+query;
      }
      id('sat-overlay').hidden = !canvas?.getLayer('clusters');
    } catch { if (ticket === imageRequest) notice.textContent = 'Satellite view unavailable. Try again.'; }
  }
  id('sat-load').onclick = compareImages;
  const overlay = id('sat-overlay');
  overlay.onclick = () => {
    const canvas = map(); if (!canvas) return;
    const key='nasa-modis-daily';
    if (canvas.getLayer(key)) {
      canvas.removeLayer(key); canvas.removeSource(key);
      overlay.textContent='Show later date on map';
    } else {
      if (!later.value || later.value > utcDay(0)) return;
      canvas.addSource(key,{type:'raster',tileSize:256,maxzoom:9,attribution:'NASA EOSDIS GIBS · Terra MODIS · '+later.value+' UTC',tiles:['https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/'+later.value+'/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg']});
      canvas.addLayer({id:key,type:'raster',source:key},canvas.getStyle().layers.find(layer=>layer.type==='symbol')?.id);
      overlay.textContent='Remove satellite overlay';
      panel.close();
    }
  };
  satellite.addEventListener('toggle',()=>{if(satellite.open) compareImages();});
  const start = (event) => {
    const section = event?.target.closest('[data-intelligence]')?.dataset.intelligence ??
      new URLSearchParams(location.search).get('intelligence');
    closeDrawer();
    const selected = district();
    if (!panel.open) panel.showModal();
    if (section === 'satellite') {
      if (satellite.open) compareImages(); else satellite.open = true;
      satellite.querySelector('summary').focus();
      return;
    }
    if (section === 'bribe') {
      const help = id('k-bribe-help');
      help.open = true;
      help.querySelector('summary').focus();
      return;
    }
    if (section === 'evidence' || section === 'compare' || section === 'worklist') detail.parentElement.open = true;
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
