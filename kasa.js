/* ══════════════════════════════════════════════════════════
   PURULIA KASA — Phase 1
   MapLibre + Supabase. Anonymous reporting. Public map.
   ══════════════════════════════════════════════════════════ */

/* ── CONFIG — REPLACE THESE ── */
const SUPABASE_URL = 'https://YOUR-PROJECT.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR-ANON-KEY';
const MUNICIPALITY_PHONE = '919046003666';
const MAP_CENTER = [86.3654, 23.3320];   /* [lng, lat] for MapLibre */
const MAP_ZOOM = 13;
const KASA_PAGE_URL = 'https://mahatoanupam002-lang.github.io/purulia/kasa.html';

/* ── Supabase client ── */
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ── State ── */
let mainMap, miniMap, miniMarker;
let reports = [];
let wards = {};   /* { ward_no: { name, party } } */
let draft = { photoBlob: null, photoFile: null, lat: null, lng: null, ward: null };

/* ══════════════════════════════════════════════════════════
   INIT
   ══════════════════════════════════════════════════════════ */
async function init(){
  await loadWards();
  initMainMap();
  await loadReports();
  populateWardDropdown();
  updateStats();
  renderLeaderboard();
  wireUI();
}

/* ── Load wards from Supabase ── */
async function loadWards(){
  const { data, error } = await sb.from('wards').select('*').order('ward_no');
  if (error){ console.error('Wards load failed', error); return; }
  (data || []).forEach(w => { wards[w.ward_no] = w; });
}

/* ── Load reports from Supabase ── */
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
   MAIN MAP (MapLibre + OpenFreeMap dark tiles)
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
    mainMap.addSource('reports', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });

    /* Halo layer (soft glow under pins) */
    mainMap.addLayer({
      id: 'reports-halo',
      type: 'circle',
      source: 'reports',
      paint: {
        'circle-radius': 14,
        'circle-color': ['case', ['==', ['get','status'], 'resolved'], '#6DB88A', '#E8524A'],
        'circle-opacity': 0.18
      }
    });

    /* Core pin dot */
    mainMap.addLayer({
      id: 'reports-core',
      type: 'circle',
      source: 'reports',
      paint: {
        'circle-radius': 6,
        'circle-color': ['case', ['==', ['get','status'], 'resolved'], '#6DB88A', '#E8524A'],
        'circle-stroke-color': 'rgba(255,255,255,.3)',
        'circle-stroke-width': 1
      }
    });

    /* Click on a pin → open popup */
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

function renderMarkers(){
  if (!mainMap || !mainMap.getSource('reports')) return;
  const features = reports
    .filter(r => r.lat && r.lng)
    .map(r => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
      properties: {
        id: r.id,
        status: r.status,
        ward_no: r.ward_no,
        description: r.description || '',
        photo_url: r.photo_url || '',
        reporter_name: r.reporter_name || '',
        created_at: r.created_at,
        resolved_photo_url: r.resolved_photo_url || ''
      }
    }));
  mainMap.getSource('reports').setData({ type: 'FeatureCollection', features });
}

/* ── Popup for a report ── */
function openReportPopup(props, coords){
  const w = wards[props.ward_no] || { councillor_name: '—', party: '—' };
  const date = props.created_at ? new Date(props.created_at).toLocaleDateString('en-IN', {day:'numeric', month:'short', year:'numeric'}) : '';
  const photo = props.photo_url ? `<img class="k-popup-img" src="${esc(props.photo_url)}" alt="">` : '';
  const statusLabel = props.status === 'resolved'
    ? '<span style="color:#6DB88A">Resolved</span>'
    : '<span style="color:#E8524A">Open</span>';
  const resolveBtn = props.status === 'resolved'
    ? '<span class="k-popup-btn k-resolved">✓ Resolved</span>'
    : `<button class="k-popup-btn k-btn-resolve" data-resolve="${esc(props.id)}">Mark as Resolved</button>`;

  const html = `
    <div class="k-popup">
      ${photo}
      <div class="k-popup-body">
        <div class="k-popup-title">Ward ${esc(props.ward_no || '—')} · ${esc(w.councillor_name)} · ${esc(w.party)}</div>
        <div class="k-popup-desc">${esc(props.description) || 'Garbage reported'}</div>
        <div class="k-popup-meta">${date} · ${statusLabel}<br>${props.reporter_name ? '— ' + esc(props.reporter_name) : 'Reported anonymously'}</div>
        ${resolveBtn}
        <a class="k-popup-btn" href="https://www.google.com/maps?q=${props.lat || coords[1]},${props.lng || coords[0]}" target="_blank" rel="noopener">Open in Google Maps</a>
      </div>
    </div>`;

  new maplibregl.Popup({ closeButton: true, maxWidth: '280px' })
    .setLngLat(coords)
    .setHTML(html)
    .addTo(mainMap);
}

/* ── Resolve flow (delegated) ── */
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-resolve]');
  if (!btn) return;
  const id = btn.getAttribute('data-resolve');
  await openResolveModal(id);
});

/* ══════════════════════════════════════════════════════════
   STATS
   ══════════════════════════════════════════════════════════ */
function updateStats(){
  const total = reports.length;
  const resolved = reports.filter(r => r.status === 'resolved').length;
  const wardsActive = new Set(reports.map(r => r.ward_no).filter(Boolean)).size;
  const rate = total ? Math.round((resolved / total) * 100) : 0;

  document.getElementById('k-stat-total').textContent = total;
  document.getElementById('k-stat-resolved').textContent = resolved;
  document.getElementById('k-stat-wards').textContent = wardsActive;
  document.getElementById('k-stat-rate').textContent = rate + '%';
}

/* ══════════════════════════════════════════════════════════
   LEADERBOARD
   ══════════════════════════════════════════════════════════ */
function renderLeaderboard(){
  const list = document.getElementById('k-lb-list');
  if (!reports.length){
    list.innerHTML = '<div class="k-lb-empty">No reports yet — be the first</div>';
    return;
  }
  const counts = {};
  const resolvedCounts = {};
  reports.forEach(r => {
    if (!r.ward_no) return;
    counts[r.ward_no] = (counts[r.ward_no] || 0) + 1;
    if (r.status === 'resolved') resolvedCounts[r.ward_no] = (resolvedCounts[r.ward_no] || 0) + 1;
  });
  const rows = Object.entries(counts)
    .map(([ward, count]) => {
      const w = wards[ward] || { councillor_name: '—', party: '—' };
      const res = resolvedCounts[ward] || 0;
      const rate = Math.round((res / count) * 100);
      return { ward: parseInt(ward), count, councillor: w.councillor_name, party: w.party, rate };
    })
    .sort((a, b) => b.count - a.count);

  if (!rows.length){
    list.innerHTML = '<div class="k-lb-empty">No ward data yet</div>';
    return;
  }
  const max = rows[0].count;
  list.innerHTML = rows.map((r, i) => `
    <div class="k-lb-row">
      <div class="k-lb-rank">${String(i+1).padStart(2,'0')}</div>
      <div>
        <div class="k-lb-name">Ward ${r.ward}</div>
        <div class="k-lb-councillor">${esc(r.councillor)} · ${esc(r.party)}</div>
        <div class="k-lb-bar"><div class="k-lb-bar-fill" style="width:${(r.count/max*100).toFixed(1)}%"></div></div>
      </div>
      <div class="k-lb-count">${r.count}</div>
      <div class="k-lb-rate">${r.rate}%</div>
    </div>
  `).join('');
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
  miniMap.on('click', (e) => setLocation(e.lngLat.lat, e.lngLat.lng));
}

function setLocation(lat, lng){
  draft.lat = lat;
  draft.lng = lng;
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
  /* Open modal */
  document.getElementById('k-hero-cta').addEventListener('click', openModal);
  document.getElementById('k-map-report-btn').addEventListener('click', openModal);
  document.getElementById('k-nav-report').addEventListener('click', (e) => { e.preventDefault(); openModal(); });

  /* Close */
  document.getElementById('k-modal-close').addEventListener('click', closeModal);
  document.getElementById('k-modal-backdrop').addEventListener('click', closeModal);

  /* Photo */
  document.getElementById('k-photo').addEventListener('change', handlePhoto);

  /* Step navigation */
  document.getElementById('k-next-1').addEventListener('click', () => goToStep(2));
  document.getElementById('k-next-2').addEventListener('click', () => goToStep(3));

  /* GPS */
  document.getElementById('k-gps-btn').addEventListener('click', detectGPS);

  /* Ward select */
  document.getElementById('k-ward').addEventListener('change', (e) => {
    draft.ward = e.target.value ? parseInt(e.target.value) : null;
  });

  /* Submit */
  document.getElementById('k-submit').addEventListener('click', submitReport);

  /* Done */
  document.getElementById('k-done-close').addEventListener('click', () => {
    closeModal();
    resetDraft();
  });
}

/* ── Photo handling + client-side downscale ── */
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
        draft.photoFile = new File([blob], `kasa-${Date.now()}.jpg`, { type: 'image/jpeg' });
        document.getElementById('k-photo-preview').innerHTML = `<img src="${canvas.toDataURL('image/jpeg', 0.75)}" alt="">`;
        document.getElementById('k-next-1').disabled = false;
      }, 'image/jpeg', 0.75);
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

/* ── GPS ── */
function detectGPS(){
  const btn = document.getElementById('k-gps-btn');
  if (!navigator.geolocation){
    showToast('GPS not available — tap the map instead');
    return;
  }
  btn.textContent = '⟳ Locating…';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      btn.textContent = '✓ Location captured';
      setLocation(pos.coords.latitude, pos.coords.longitude);
    },
    (err) => {
      btn.textContent = '⊕ Use my location';
      showToast(err.code === 1 ? 'Permission denied — tap the map' : 'GPS failed — tap the map');
    },
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

  /* 1. Upload photo to Supabase Storage */
  const filename = `reports/${Date.now()}-${Math.random().toString(36).slice(2,8)}.jpg`;
  const { error: upErr } = await sb.storage
    .from('kasa-photos')
    .upload(filename, draft.photoBlob, { contentType: 'image/jpeg', upsert: false });
  if (upErr){
    console.error(upErr);
    showToast('Photo upload failed — try again');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit Report →';
    return;
  }
  const { data: urlData } = sb.storage.from('kasa-photos').getPublicUrl(filename);
  const photoUrl = urlData.publicUrl;

  /* 2. Insert report */
  submitBtn.textContent = 'Filing report…';
  const desc = document.getElementById('k-desc').value.trim();
  const name = document.getElementById('k-name').value.trim();

  const { data: inserted, error: insErr } = await sb.from('reports').insert({
    lat: draft.lat,
    lng: draft.lng,
    ward_no: draft.ward,
    description: desc || null,
    reporter_name: name || null,
    photo_url: photoUrl,
    status: 'open'
  }).select().single();

  if (insErr){
    console.error(insErr);
    showToast('Report failed — try again');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit Report →';
    return;
  }

  /* 3. Update in-memory state */
  reports.unshift(inserted);
  renderMarkers();
  updateStats();
  renderLeaderboard();

  /* 4. Build WhatsApp escalation link */
  const w = wards[draft.ward] || { councillor_name: '—' };
  const msg = `Garbage report — Purulia Kasa\n`
    + `Ward: ${draft.ward} (${w.councillor_name})\n`
    + `Location: ${draft.lat.toFixed(5)}°N, ${draft.lng.toFixed(5)}°E\n`
    + `Issue: ${desc || '(no description)'}\n`
    + `Map: https://www.google.com/maps?q=${draft.lat},${draft.lng}\n`
    + `Report: ${KASA_PAGE_URL}`;
  document.getElementById('k-wa-escalate').href = `https://wa.me/${MUNICIPALITY_PHONE}?text=${encodeURIComponent(msg)}`;

  /* 5. Show done step */
  goToStep('done');
  showToast('Report filed — thank you');
}

/* ══════════════════════════════════════════════════════════
   RESOLVE FLOW
   ══════════════════════════════════════════════════════════ */
async function openResolveModal(reportId){
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
  const { error: upErr } = await sb.storage
    .from('kasa-photos')
    .upload(filename, blob, { contentType: 'image/jpeg' });
  if (upErr){ console.error(upErr); showToast('Upload failed'); return; }

  const { data: urlData } = sb.storage.from('kasa-photos').getPublicUrl(filename);

  const { error: rpcErr } = await sb.rpc('mark_resolved', {
    p_report_id: reportId,
    p_resolved_photo_url: urlData.publicUrl,
    p_resolved_by: null
  });
  if (rpcErr){ console.error(rpcErr); showToast('Could not mark resolved'); return; }

  /* Update local state */
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
   UTILITIES
   ══════════════════════════════════════════════════════════ */
function resetDraft(){
  draft = { photoBlob: null, photoFile: null, lat: null, lng: null, ward: null };
  document.getElementById('k-photo').value = '';
  document.getElementById('k-photo-preview').innerHTML = '';
  document.getElementById('k-coords').textContent = 'No location set yet';
  document.getElementById('k-desc').value = '';
  document.getElementById('k-name').value = '';
  document.getElementById('k-ward').value = '';
  document.getElementById('k-next-1').disabled = true;
  document.getElementById('k-next-2').disabled = true;
  document.getElementById('k-submit').disabled = false;
  document.getElementById('k-submit').textContent = 'Submit Report →';
  document.getElementById('k-gps-btn').textContent = '⊕ Use my location';
  if (miniMarker){ miniMarker.remove(); miniMarker = null; }
}

function showToast(msg){
  const t = document.getElementById('k-toast');
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

/* ── Go ── */
init();
