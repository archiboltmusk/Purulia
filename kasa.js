/* ══════════════════════════════════════════════════════════
   PURULIA KASA — Stage 1 Final
   MapLibre + Supabase + Ward auto-detection
   ══════════════════════════════════════════════════════════ */

/* ── CONFIG — REPLACE THESE TWO ── */
const SUPABASE_URL = 'https://https://jrravmlodmbmmzmhofxi.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpycmF2bWxvZG1ibW16bWhvZnhpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyMjMzNzksImV4cCI6MjEwNTc5OTM3OX0.dQKsZtiOsQLO8TIQnIuIaOxVDL_Q4K47VI__PqvQGqo';

/* ── Constants ── */
const MUNICIPALITY_PHONE = '919046003666';
const MAP_CENTER = [86.3654, 23.3320];
const MAP_ZOOM = 13;
const KASA_PAGE_URL = 'https://mahatoanupam002-lang.github.io/purulia/kasa.html';

/* ── Supabase client ── */
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ── State ── */
let mainMap, miniMap, miniMarker;
let reports = [];
let wards = {};
let wardGeo = null;
let draft = { photoBlob: null, lat: null, lng: null, ward: null, severity: 'minor' };
let activeFilters = { severity: '', status: '' };
let userUpvotes = new Set();

/* ── Rep data ── */
const REPS = {
  mla: {
    name: 'Sudip Kumar Mukherjee',
    role: 'MLA · Purulia (No. 242)',
    party: 'BJP',
    initials: 'SKM',
    scope: 'constituency'
  },
  mp: {
    name: 'Jyotirmay Singh Mahato',
    role: 'MP · Purulia (Lok Sabha)',
    party: 'BJP',
    initials: 'JSM',
    scope: 'constituency'
  },
  chairman: {
    name: 'Nabendu Mahali',
    role: 'Chairman · Purulia Municipality',
    party: 'AITC',
    initials: 'NM',
    scope: 'municipality'
  }
};

/* ══════════════════════════════════════════════════════════
   INIT
   ══════════════════════════════════════════════════════════ */
async function init(){
  loadUpvotes();
  await loadWards();
  await loadWardGeo();
  initMainMap();
  await loadReports();
  populateWardDropdown();
  updateStats();
  renderLeaderboard();
  renderChain();
  wireUI();
  checkIntro();
}

function checkIntro(){
  if (!localStorage.getItem('kasa_intro_seen')){
    setTimeout(() => {
      document.getElementById('k-intro').classList.add('open');
    }, 400);
  }
}

function loadUpvotes(){
  try { userUpvotes = new Set(JSON.parse(localStorage.getItem('kasa_upvotes') || '[]')); } catch(e) {}
}
function saveUpvotes(){
  try { localStorage.setItem('kasa_upvotes', JSON.stringify([...userUpvotes])); } catch(e) {}
}

/* ══════════════════════════════════════════════════════════
   WARDS (from Supabase) + WARD GEOMETRY (from GeoJSON)
   ══════════════════════════════════════════════════════════ */
async function loadWards(){
  const { data, error } = await sb.from('wards').select('*').order('ward_no');
  if (error){ console.error('Wards load failed', error); return; }
  (data || []).forEach(w => { wards[w.ward_no] = w; });
}

async function loadWardGeo(){
  try {
    const res = await fetch('purulia_wards.geojson');
    if (!res.ok) throw new Error('not found');
    wardGeo = await res.json();
    console.info('Kasa: ward boundaries loaded', wardGeo.features.length, 'polygons');
  } catch(e){
    console.info('Kasa: no ward GeoJSON — manual ward selection only');
  }
}

/* Point-in-polygon (ray casting) */
function pointInRing(pt, ring){
  let x = pt[0], y = pt[1], inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++){
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

function pointInPolygon(pt, polygon){
  if (polygon.type === 'Polygon') return pointInRing(pt, polygon.coordinates[0]);
  if (polygon.type === 'MultiPolygon'){
    return polygon.coordinates.some(rings => pointInRing(pt, rings[0]));
  }
  return false;
}

function detectWard(lat, lng){
  if (!wardGeo || !wardGeo.features) return null;
  for (const f of wardGeo.features){
    if (pointInPolygon([lng, lat], f.geometry)){
      const props = f.properties || {};
      const n = props.ward || props.WARD || props.ward_no || props.Ward_No;
      if (n) return parseInt(String(n).replace(/\D/g, ''), 10);
    }
  }
  return null;
}

/* ══════════════════════════════════════════════════════════
   LOAD REPORTS
   ══════════════════════════════════════════════════════════ */
async function loadReports(){
  const { data, error } = await sb
    .from('reports')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500);
  if (error){ console.error('Reports load failed', error); return; }
  reports = data || [];
  renderMarkers();
}

/* ══════════════════════════════════════════════════════════
   MAIN MAP
   ══════════════════════════════════════════════════════════ */
function initMainMap(){
  mainMap = new maplibregl.Map({
    container: 'k-map',
    style: 'https://tiles.openfreemap.org/styles/dark',
    center: MAP_CENTER,
    zoom: MAP_ZOOM,
    attributionControl: { compact: true }
  });
  mainMap.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

  mainMap.on('load', () => {
    /* Ward boundary outlines (visible layer) */
    if (wardGeo) {
      mainMap.addSource('wards', { type: 'geojson', data: wardGeo });

      mainMap.addLayer({
        id: 'wards-fill',
        type: 'fill',
        source: 'wards',
        paint: {
          'fill-color': '#d4882a',
          'fill-opacity': 0.04
        }
      });

      mainMap.addLayer({
        id: 'wards-line',
        type: 'line',
        source: 'wards',
        paint: {
          'line-color': 'rgba(212,136,42,.4)',
          'line-width': 1
        }
      });
    }

    /* Reports source */
    mainMap.addSource('reports', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });

    mainMap.addLayer({
      id: 'reports-halo',
      type: 'circle',
      source: 'reports',
      paint: {
        'circle-radius': 14,
        'circle-color': severityColor(),
        'circle-opacity': 0.18
      }
    });

    mainMap.addLayer({
      id: 'reports-core',
      type: 'circle',
      source: 'reports',
      paint: {
        'circle-radius': 6,
        'circle-color': severityColor(),
        'circle-stroke-color': 'rgba(255,255,255,.3)',
        'circle-stroke-width': 1
      }
    });

    mainMap.on('click', 'reports-core', (e) => {
      const props = e.features[0].properties;
      const coords = e.features[0].geometry.coordinates.slice();
      openReportPopup(props, coords);
    });
    mainMap.on('mouseenter', 'reports-core', () => { mainMap.getCanvas().style.cursor = 'pointer'; });
    mainMap.on('mouseleave', 'reports-core', () => { mainMap.getCanvas().style.cursor = ''; });

    renderMarkers();
  });
}

function severityColor(){
  return [
    'case',
    ['==', ['get','status'], 'resolved'], '#6DB88A',
    ['==', ['get','severity'], 'critical'], '#E8524A',
    ['==', ['get','severity'], 'severe'], '#E88A4A',
    '#D4882A'
  ];
}

function filteredReports(){
  return reports.filter(r => {
    if (activeFilters.severity && r.severity !== activeFilters.severity) return false;
    if (activeFilters.status && r.status !== activeFilters.status) return false;
    return true;
  });
}

function renderMarkers(){
  if (!mainMap || !mainMap.getSource('reports')) return;
  const features = filteredReports()
    .filter(r => r.lat && r.lng)
    .map(r => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
      properties: {
        id: r.id,
        status: r.status,
        severity: r.severity || 'minor',
        ward_no: r.ward_no,
        description: r.description || '',
        photo_url: r.photo_url || '',
        reporter_name: r.reporter_name || '',
        created_at: r.created_at,
        resolved_photo_url: r.resolved_photo_url || '',
        upvotes: r.upvotes || 0,
        flags: r.flags || 0,
        lat: r.lat,
        lng: r.lng
      }
    }));
  mainMap.getSource('reports').setData({ type: 'FeatureCollection', features });
}

/* ══════════════════════════════════════════════════════════
   POPUP
   ══════════════════════════════════════════════════════════ */
function openReportPopup(props, coords){
  const w = wards[props.ward_no] || { councillor_name: '—', party: '—' };
  const date = props.created_at ? new Date(props.created_at).toLocaleDateString('en-IN', {day:'numeric', month:'short', year:'numeric'}) : '';
  const daysOpen = props.created_at ? Math.floor((Date.now() - new Date(props.created_at).getTime()) / 86400000) : 0;

  const photo = props.photo_url ? `<img class="k-popup-img" src="${esc(props.photo_url)}" alt="">` : '';
  const statusLabel = props.status === 'resolved'
    ? '<span style="color:#6DB88A">Resolved</span>'
    : `<span style="color:#E8524A">${daysOpen} days open</span>`;

  let sevClass = 'k-popup-sev-minor';
  if (props.status === 'resolved') sevClass = 'k-popup-sev-resolved';
  else if (props.severity === 'critical') sevClass = 'k-popup-sev-critical';
  else if (props.severity === 'severe') sevClass = 'k-popup-sev-severe';

  const hasUpvoted = userUpvotes.has(props.id);

  let actionsHtml = '';
  if (props.status === 'resolved'){
    actionsHtml = `<span class="k-popup-btn" style="border-color:#6DB88A;color:#6DB88A;cursor:default;">✓ Resolved</span>`;
  } else {
    actionsHtml = `
      <button class="k-popup-btn k-btn-verify" data-verify="${esc(props.id)}">Verify Cleanup</button>
      <button class="k-popup-btn k-btn-flag" data-flag="${esc(props.id)}">Flag</button>`;
  }

  const html = `
    <div class="k-popup">
      ${photo}
      <div class="k-popup-body">
        <div class="k-popup-severity ${sevClass}">${props.status === 'resolved' ? 'Resolved' : (props.severity || 'Minor')}</div>
        <div class="k-popup-title">Ward ${esc(props.ward_no || '—')} · ${esc(w.councillor_name)} · ${esc(w.party)}</div>
        <div class="k-popup-desc">${esc(props.description) || 'Garbage reported'}</div>
        <div class="k-popup-meta">${date} · ${statusLabel}<br>${props.reporter_name ? '— ' + esc(props.reporter_name) : 'Reported anonymously'}</div>
        <button class="k-popup-upvote ${hasUpvoted ? 'upvoted' : ''}" data-upvote="${esc(props.id)}">
          <span>👍</span> ${hasUpvoted ? 'You saw this' : 'I saw this too'} · ${props.upvotes || 0}
        </button>
        <div class="k-popup-actions">
          ${actionsHtml}
        </div>
        <a class="k-popup-btn" style="margin-top:.5rem;" href="https://www.google.com/maps?q=${props.lat || coords[1]},${props.lng || coords[0]}" target="_blank" rel="noopener">Get directions</a>
      </div>
    </div>`;

  new maplibregl.Popup({ closeButton: true, maxWidth: '320px', offset: 12 })
    .setLngLat(coords)
    .setHTML(html)
    .addTo(mainMap);
}

/* ══════════════════════════════════════════════════════════
   STATS + PILL
   ══════════════════════════════════════════════════════════ */
function updateStats(){
  const total = reports.length;
  const resolved = reports.filter(r => r.status === 'resolved').length;
  const active = total - resolved;
  const wardsActive = new Set(reports.map(r => r.ward_no).filter(Boolean)).size;
  const rate = total ? Math.round((resolved / total) * 100) : 0;

  const elTotal = document.getElementById('k-stat-total');
  const elResolved = document.getElementById('k-stat-resolved');
  const elWards = document.getElementById('k-stat-wards');
  const elRate = document.getElementById('k-stat-rate');
  if (elTotal) elTotal.textContent = total;
  if (elResolved) elResolved.textContent = resolved;
  if (elWards) elWards.textContent = wardsActive;
  if (elRate) elRate.textContent = rate + '%';

  const pillActive = document.getElementById('k-pill-active');
  const pillTotal = document.getElementById('k-pill-total');
  if (pillActive) pillActive.textContent = active;
  if (pillTotal) pillTotal.textContent = total;
}

/* ══════════════════════════════════════════════════════════
   LEADERBOARD (open first)
   ══════════════════════════════════════════════════════════ */
function renderLeaderboard(){
  const list = document.getElementById('k-lb-list');
  if (!list) return;
  if (!reports.length){
    list.innerHTML = '<div class="k-lb-empty">No reports yet — be the first</div>';
    return;
  }

  const stats = {};
  reports.forEach(r => {
    if (!r.ward_no) return;
    if (!stats[r.ward_no]) stats[r.ward_no] = { open: 0, resolved: 0, total: 0 };
    stats[r.ward_no].total++;
    if (r.status === 'resolved') stats[r.ward_no].resolved++;
    else stats[r.ward_no].open++;
  });

  const rows = Object.entries(stats)
    .map(([ward, s]) => {
      const w = wards[ward] || { councillor_name: '—', party: '—' };
      return { ward: parseInt(ward), open: s.open, resolved: s.resolved, total: s.total, councillor: w.councillor_name, party: w.party };
    })
    .filter(r => r.open > 0)
    .sort((a, b) => b.open - a.open);

  if (!rows.length){
    list.innerHTML = '<div class="k-lb-empty">All reports resolved — nothing pending</div>';
    return;
  }
  const max = rows[0].open;
  list.innerHTML = rows.map((r, i) => `
    <div class="k-lb-row">
      <div class="k-lb-rank">${String(i+1).padStart(2,'0')}</div>
      <div>
        <div class="k-lb-name">Ward ${r.ward}</div>
        <div class="k-lb-councillor">${esc(r.councillor)} · ${esc(r.party)}</div>
        <div class="k-lb-bar"><div class="k-lb-bar-fill" style="width:${(r.open/max*100).toFixed(1)}%"></div></div>
      </div>
      <div class="k-lb-count">${r.open}</div>
      <div class="k-lb-rate">${r.resolved} done</div>
    </div>
  `).join('');
}

/* ══════════════════════════════════════════════════════════
   ACCOUNTABILITY CHAIN — Purulia Municipality hierarchy
   ══════════════════════════════════════════════════════════ */
function renderChain(){
  const chain = document.getElementById('k-chain');
  if (!chain) return;
  const nodes = [
    { icon: '🏛', name: 'The Council / Board of Councillors', role: 'Elected body · 23 ward councillors · Sets policy & budgets' },
    { icon: '👤', name: 'Chairman', role: 'Nabendu Mahali · Political head & chief executive authority' },
    { icon: '📋', name: 'Executive Officer (EO)', role: 'WB Civil Service appointee · Implements board resolutions, manages funds & departments' },
    { icon: '🧹', name: 'Sanitation Inspector (SI)', role: 'Supervises waste collection, drainage, water distribution across all 23 wards' },
    { icon: '👷', name: 'Sanitation Supervisors / Ward Jamadars', role: 'Sub-inspectors · Assist the SI with field coordination' },
    { icon: '🧑‍🔧', name: 'Sanitation & Conservancy Staff', role: 'Garbage collection, road sweeping, drain cleaning, spraying' },
    { icon: '📝', name: 'Clerical Staff', role: 'Grievance tracking, attendance, inventory' }
  ];

  chain.innerHTML = nodes.map((n, i) => {
    const isLast = i === nodes.length - 1;
    const arrow = !isLast ? '<div class="k-chain-arrow">↓</div>' : '';
    return `
      <div class="k-chain-node">
        <div class="k-chain-icon">${n.icon}</div>
        <div class="k-chain-text">
          <div class="k-chain-name">${esc(n.name)}</div>
          <div class="k-chain-role">${esc(n.role)}</div>
        </div>
      </div>${arrow}`;
  }).join('');
}

/* ══════════════════════════════════════════════════════════
   REP PROFILES
   ══════════════════════════════════════════════════════════ */
function openRepProfile(key){
  const rep = REPS[key];
  if (!rep) return;

  const total = reports.length;
  const resolved = reports.filter(r => r.status === 'resolved').length;
  const active = total - resolved;

  const stats = {};
  reports.forEach(r => {
    if (!r.ward_no || r.status === 'resolved') return;
    if (!stats[r.ward_no]) stats[r.ward_no] = 0;
    stats[r.ward_no]++;
  });
  const worst = Object.entries(stats)
    .map(([ward, count]) => ({ ward: parseInt(ward), count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const worstHtml = worst.length
    ? worst.map((w, i) => {
        const wd = wards[w.ward] || {};
        return `<div class="k-rep-worst-item">
          <span>${i+1}. Ward ${w.ward} · ${esc(wd.councillor_name || '—')} <em style="color:rgba(240,230,208,.35);font-style:normal;">(${esc(wd.party || '—')})</em></span>
          <span class="k-rep-worst-count">${w.count}</span>
        </div>`;
      }).join('')
    : '<div style="padding:1rem 0;color:rgba(240,230,208,.4);font-size:.72rem;">No open reports in this area.</div>';

  const scopeLabel = rep.scope === 'municipality'
    ? 'All 23 wards of Purulia town'
    : 'Purulia constituency';

  document.getElementById('k-rep-content').innerHTML = `
    <div class="k-rep-header">
      <div class="k-rep-avatar">${esc(rep.initials)}</div>
      <div>
        <div class="k-rep-name">${esc(rep.name)}</div>
        <div class="k-rep-role">${esc(rep.role)} · ${esc(rep.party)}</div>
        <div class="k-rep-role" style="margin-top:.3rem;font-size:.6rem;color:rgba(240,230,208,.35);">Covers: ${esc(scopeLabel)}</div>
      </div>
    </div>
    <div class="k-rep-stats">
      <div class="k-rep-stat"><div class="k-rep-stat-n">${active}</div><div class="k-rep-stat-l">Active</div></div>
      <div class="k-rep-stat"><div class="k-rep-stat-n">${total}</div><div class="k-rep-stat-l">Reports</div></div>
      <div class="k-rep-stat"><div class="k-rep-stat-n">${resolved}</div><div class="k-rep-stat-l">Resolved</div></div>
    </div>
    <div class="k-rep-worst-title">Worst wards (open reports)</div>
    ${worstHtml}
  `;
  document.getElementById('k-rep-modal').classList.add('open');
}

/* ══════════════════════════════════════════════════════════
   WARD DROPDOWN
   ══════════════════════════════════════════════════════════ */
function populateWardDropdown(){
  const sel = document.getElementById('k-ward');
  if (!sel) return;
  Object.values(wards).sort((a,b) => a.ward_no - b.ward_no).forEach(w => {
    const opt = document.createElement('option');
    opt.value = w.ward_no;
    opt.textContent = `Ward ${w.ward_no} — ${w.councillor_name} (${w.party})`;
    sel.appendChild(opt);
  });
}

/* ══════════════════════════════════════════════════════════
   MODAL FLOW
   ══════════════════════════════════════════════════════════ */
function openModal(){
  document.getElementById('k-modal').classList.add('open');
  document.getElementById('k-modal').setAttribute('aria-hidden','false');
  goToStep(1);
}
function closeModal(){
  document.getElementById('k-modal').classList.remove('open');
  document.getElementById('k-modal').setAttribute('aria-hidden','true');
}
function goToStep(n){
  [1,2,3,'done'].forEach(s => {
    const el = document.getElementById('k-step-' + s);
    if (el) el.hidden = (String(s) !== String(n));
  });
  if (n === 2 && !miniMap) initMiniMap();
  if (miniMap) setTimeout(() => miniMap.resize(), 50);
}

function initMiniMap(){
  miniMap = new maplibregl.Map({
    container: 'k-mini-map',
    style: 'https://tiles.openfreemap.org/styles/dark',
    center: MAP_CENTER,
    zoom: 13,
    attributionControl: false
  });

  /* Show ward outlines in mini-map too */
  miniMap.on('load', () => {
    if (wardGeo){
      miniMap.addSource('wards-mini', { type: 'geojson', data: wardGeo });
      miniMap.addLayer({
        id: 'wards-mini-line',
        type: 'line',
        source: 'wards-mini',
        paint: { 'line-color': 'rgba(212,136,42,.5)', 'line-width': 1 }
      });
    }
  });

  miniMap.on('click', (e) => setLocation(e.lngLat.lat, e.lngLat.lng));
}

function setLocation(lat, lng){
  draft.lat = lat;
  draft.lng = lng;

  /* Auto-detect ward from coordinates */
  const autoWard = detectWard(lat, lng);
  if (autoWard && wards[autoWard]){
    draft.ward = autoWard;
    const sel = document.getElementById('k-ward');
    if (sel) sel.value = String(autoWard);
    showToast(`Ward ${autoWard} detected — ${wards[autoWard].councillor_name}`);
  }

  document.getElementById('k-coords').textContent = `${lat.toFixed(5)}°N, ${lng.toFixed(5)}°E`;
  if (miniMap){
    if (miniMarker) miniMarker.remove();
    miniMarker = new maplibregl.Marker({ color: '#D4882A' })
      .setLngLat([lng, lat])
      .addTo(miniMap);
    miniMap.flyTo({ center: [lng, lat], zoom: 15 });
  }
  document.getElementById('k-next-2').disabled = false;
}

/* ══════════════════════════════════════════════════════════
   UI WIRING
   ══════════════════════════════════════════════════════════ */
function wireUI(){
  /* Intro */
  document.getElementById('k-intro-continue').addEventListener('click', () => {
    document.getElementById('k-intro').classList.remove('open');
    localStorage.setItem('kasa_intro_seen', '1');
  });

  /* Open modal */
  document.getElementById('k-hero-cta').addEventListener('click', openModal);
  document.getElementById('k-map-report-btn').addEventListener('click', openModal);
  document.getElementById('k-nav-report').addEventListener('click', (e) => { e.preventDefault(); openModal(); });

  /* Close */
  document.getElementById('k-modal-close').addEventListener('click', closeModal);
  document.getElementById('k-modal-backdrop').addEventListener('click', closeModal);

  /* Photo */
  document.getElementById('k-photo').addEventListener('change', handlePhoto);

  /* Steps */
  document.getElementById('k-next-1').addEventListener('click', () => goToStep(2));
  document.getElementById('k-next-2').addEventListener('click', () => goToStep(3));

  /* GPS */
  document.getElementById('k-gps-btn').addEventListener('click', detectGPS);

  /* Ward + severity */
  document.getElementById('k-ward').addEventListener('change', (e) => {
    draft.ward = e.target.value ? parseInt(e.target.value) : null;
  });
  document.getElementById('k-severity').addEventListener('change', (e) => {
    draft.severity = e.target.value;
  });

  /* Submit */
  document.getElementById('k-submit').addEventListener('click', submitReport);

  /* Done */
  document.getElementById('k-done-close').addEventListener('click', () => {
    closeModal();
    resetDraft();
  });

  /* Filters */
  document.getElementById('k-filter-severity').addEventListener('change', (e) => {
    activeFilters.severity = e.target.value;
    renderMarkers();
  });
  document.getElementById('k-filter-status').addEventListener('change', (e) => {
    activeFilters.status = e.target.value;
    renderMarkers();
  });

  /* QR */
  document.getElementById('k-qr-btn').addEventListener('click', () => {
    document.getElementById('k-qr-modal').classList.add('open');
    renderQR();
  });
  document.getElementById('k-qr-close').addEventListener('click', () => {
    document.getElementById('k-qr-modal').classList.remove('open');
  });
  document.getElementById('k-qr-backdrop').addEventListener('click', () => {
    document.getElementById('k-qr-modal').classList.remove('open');
  });

  /* Rep profiles */
  document.querySelectorAll('[data-profile]').forEach(btn => {
    btn.addEventListener('click', () => openRepProfile(btn.dataset.profile));
  });
  document.getElementById('k-rep-close').addEventListener('click', () => {
    document.getElementById('k-rep-modal').classList.remove('open');
  });
  document.getElementById('k-rep-backdrop').addEventListener('click', () => {
    document.getElementById('k-rep-modal').classList.remove('open');
  });

  /* Delegated: popup actions */
  document.addEventListener('click', (e) => {
    const upBtn = e.target.closest('[data-upvote]');
    if (upBtn){ handleUpvote(upBtn.dataset.upvote, upBtn); return; }

    const verifyBtn = e.target.closest('[data-verify]');
    if (verifyBtn){ handleVerify(verifyBtn.dataset.verify); return; }

    const flagBtn = e.target.closest('[data-flag]');
    if (flagBtn){ handleFlag(flagBtn.dataset.flag); return; }
  });
}

/* ══════════════════════════════════════════════════════════
   PHOTO HANDLING
   ══════════════════════════════════════════════════════════ */
function handlePhoto(e){
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = () => {
      const MAX = 1200;
      let w = img.width, h = img.height;
      if (w > h && w > MAX){ h = h * MAX / w; w = MAX; }
      else if (h > MAX){ w = w * MAX / h; h = MAX; }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      canvas.toBlob((blob) => {
        draft.photoBlob = blob;
        document.getElementById('k-photo-preview').innerHTML = `<img src="${canvas.toDataURL('image/jpeg', 0.75)}" alt="">`;
        document.getElementById('k-next-1').disabled = false;
      }, 'image/jpeg', 0.75);
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

/* ══════════════════════════════════════════════════════════
   GPS
   ══════════════════════════════════════════════════════════ */
function detectGPS(){
  const btn = document.getElementById('k-gps-btn');
  if (!navigator.geolocation){ showToast('GPS not available — tap the map instead'); return; }
  btn.textContent = '⟳ Locating…';
  navigator.geolocation.getCurrentPosition(
    (pos) => { btn.textContent = '✓ Location captured'; setLocation(pos.coords.latitude, pos.coords.longitude); },
    (err) => { btn.textContent = '⊕ Use my location'; showToast(err.code === 1 ? 'Permission denied — tap the map' : 'GPS failed — tap the map'); },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

/* ══════════════════════════════════════════════════════════
   SUBMIT
   ══════════════════════════════════════════════════════════ */
async function submitReport(){
  if (!draft.photoBlob){ showToast('Please add a photo'); return; }
  if (draft.lat === null || draft.lng === null){ showToast('Please set a location'); return; }
  if (!draft.ward){ showToast('Please select a ward'); return; }

  const submitBtn = document.getElementById('k-submit');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Uploading photo…';

  const filename = `reports/${Date.now()}-${Math.random().toString(36).slice(2,8)}.jpg`;
  const { error: upErr } = await sb.storage
    .from('kasa-photos')
    .upload(filename, draft.photoBlob, { contentType: 'image/jpeg', upsert: false });
  if (upErr){ console.error(upErr); showToast('Photo upload failed — try again'); submitBtn.disabled = false; submitBtn.textContent = 'Submit Report →'; return; }
  const { data: urlData } = sb.storage.from('kasa-photos').getPublicUrl(filename);
  const photoUrl = urlData.publicUrl;

  submitBtn.textContent = 'Filing report…';
  const desc = document.getElementById('k-desc').value.trim();
  const name = document.getElementById('k-name').value.trim();

  const { data: inserted, error: insErr } = await sb.from('reports').insert({
    lat: draft.lat,
    lng: draft.lng,
    ward_no: draft.ward,
    severity: draft.severity,
    description: desc || null,
    reporter_name: name || null,
    photo_url: photoUrl,
    status: 'open',
    upvotes: 0,
    flags: 0
  }).select().single();

  if (insErr){ console.error(insErr); showToast('Report failed — try again'); submitBtn.disabled = false; submitBtn.textContent = 'Submit Report →'; return; }

  reports.unshift(inserted);
  renderMarkers();
  updateStats();
  renderLeaderboard();

  const w = wards[draft.ward] || { councillor_name: '—' };
  const msg = `Garbage report — Purulia Kasa\nWard: ${draft.ward} (${w.councillor_name})\nLocation: ${draft.lat.toFixed(5)}°N, ${draft.lng.toFixed(5)}°E\nSeverity: ${draft.severity}\nIssue: ${desc || '(no description)'}\nMap: https://www.google.com/maps?q=${draft.lat},${draft.lng}`;
  document.getElementById('k-wa-escalate').href = `https://wa.me/${MUNICIPALITY_PHONE}?text=${encodeURIComponent(msg)}`;

  goToStep('done');
  showToast('Report filed — thank you');
}

/* ══════════════════════════════════════════════════════════
   UPVOTE
   ══════════════════════════════════════════════════════════ */
async function handleUpvote(reportId, btn){
  if (userUpvotes.has(reportId)){ showToast('You already upvoted this'); return; }
  const r = reports.find(x => x.id === reportId);
  if (!r) return;
  r.upvotes = (r.upvotes || 0) + 1;
  userUpvotes.add(reportId);
  saveUpvotes();
  btn.classList.add('upvoted');
  btn.innerHTML = `<span>👍</span> You saw this · ${r.upvotes}`;
  await sb.rpc('upvote_report', { p_report_id: reportId });
  showToast('Thanks — your upvote is counted');
}

/* ══════════════════════════════════════════════════════════
   FLAG
   ══════════════════════════════════════════════════════════ */
async function handleFlag(reportId){
  const r = reports.find(x => x.id === reportId);
  if (!r) return;
  r.flags = (r.flags || 0) + 1;
  await sb.rpc('flag_report', { p_report_id: reportId, p_reason: null });
  showToast('Flagged — thank you');
}

/* ══════════════════════════════════════════════════════════
   VERIFY CLEANUP
   ══════════════════════════════════════════════════════════ */
function handleVerify(reportId){
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = async () => {
        const MAX = 1200;
        let w = img.width, h = img.height;
        if (w > h && w > MAX){ h = h * MAX / w; w = MAX; }
        else if (h > MAX){ w = w * MAX / h; h = MAX; }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        canvas.toBlob(async (blob) => {
          await commitResolve(reportId, blob);
        }, 'image/jpeg', 0.75);
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  };
  input.click();
}

async function commitResolve(reportId, blob){
  showToast('Uploading proof…');
  const filename = `resolved/${Date.now()}-${Math.random().toString(36).slice(2,8)}.jpg`;
  const { error: upErr } = await sb.storage.from('kasa-photos').upload(filename, blob, { contentType: 'image/jpeg' });
  if (upErr){ console.error(upErr); showToast('Upload failed'); return; }
  const { data: urlData } = sb.storage.from('kasa-photos').getPublicUrl(filename);

  const { error: rpcErr } = await sb.rpc('mark_resolved', {
    p_report_id: reportId,
    p_resolved_photo_url: urlData.publicUrl,
    p_resolved_by: null
  });
  if (rpcErr){ console.error(rpcErr); showToast('Could not mark resolved'); return; }

  const r = reports.find(x => x.id === reportId);
  if (r){
    r.status = 'resolved';
    r.resolved_at = new Date().toISOString();
    r.resolved_photo_url = urlData.publicUrl;
  }
  renderMarkers();
  updateStats();
  renderLeaderboard();
  showToast('Marked as resolved ✓');
}

/* ══════════════════════════════════════════════════════════
   QR CODE
   ══════════════════════════════════════════════════════════ */
function renderQR(){
  const wrap = document.getElementById('k-qr-wrap');
  const urlEl = document.getElementById('k-qr-url');
  if (!wrap || !urlEl) return;
  wrap.innerHTML = '';
  urlEl.textContent = KASA_PAGE_URL;

  if (window.QRCode){
    const canvas = document.createElement('canvas');
    wrap.appendChild(canvas);
    window.QRCode.toCanvas(canvas, KASA_PAGE_URL, { width: 220, margin: 1, color: { dark: '#0a0805', light: '#f0e6d0' } }, (err) => {
      if (err) console.error(err);
    });
  }
}

/* ══════════════════════════════════════════════════════════
   UTILITIES
   ══════════════════════════════════════════════════════════ */
function resetDraft(){
  draft = { photoBlob: null, lat: null, lng: null, ward: null, severity: 'minor' };
  document.getElementById('k-photo').value = '';
  document.getElementById('k-photo-preview').innerHTML = '';
  document.getElementById('k-coords').textContent = 'No location set yet';
  document.getElementById('k-desc').value = '';
  document.getElementById('k-name').value = '';
  document.getElementById('k-ward').value = '';
  document.getElementById('k-severity').value = 'minor';
  document.getElementById('k-next-1').disabled = true;
  document.getElementById('k-next-2').disabled = true;
  document.getElementById('k-submit').disabled = false;
  document.getElementById('k-submit').textContent = 'Submit Report →';
  document.getElementById('k-gps-btn').textContent = '⊕ Use my location';
  if (miniMarker){ miniMarker.remove(); miniMarker = null; }
}

function showToast(msg){
  const t = document.getElementById('k-toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => t.classList.remove('show'), 3000);
}

function esc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

/* ── GO ── */
init();
