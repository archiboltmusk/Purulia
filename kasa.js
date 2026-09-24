/* ══════════════════════════════════════════════════════════
   PURULIA KASA — Main app
   Reads Supabase config from config.js (generated at build time)
   ══════════════════════════════════════════════════════════ */

/* ── CONFIG — read from config.js ── */
window.KASA_CONFIG = window.KASA_CONFIG || {};
const SUPABASE_URL = window.KASA_CONFIG.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = window.KASA_CONFIG.SUPABASE_ANON_KEY || '';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY){
  console.error('Kasa: Supabase credentials missing. Check config.js is loaded before kasa.js.');
}

const MUNICIPALITY_PHONE = '919046003666';
const MUNICIPALITY_EMAIL = 'puruliamunicipality@gmail.com';
const MAP_CENTER = [86.3654, 23.3320];
const MAP_ZOOM = 13;
const KASA_PAGE_URL = 'https://archiboltmusk.github.io/Purulia/kasa.html';
const DEFAULT_SLA_DAYS = 7;
const DUPLICATE_RADIUS_M = 20;
const DUPLICATE_HOURS = 6;
const ESCALATION_THRESHOLD = 10;
const MLA_TWITTER_HANDLE = 'SudipKMukherjee';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let mainMap, miniMap, miniMarker;
let reports = [];
let wards = {};
let wardGeo = null;
let draft = { photoBlob: null, lat: null, lng: null, ward: null, severity: 'minor' };
let activeFilters = { severity: '', status: '', ward: null };
let userUpvotes = new Set();
let currentLang = 'en';
let reporterHash = null;

const REPS = {
  mla: { name:'Sudip Kumar Mukherjee', role:'MLA · Purulia (No. 242)', party:'BJP', initials:'SKM', scope:'constituency' },
  mp: { name:'Jyotirmay Singh Mahato', role:'MP · Purulia (Lok Sabha)', party:'BJP', initials:'JSM', scope:'constituency' },
  chairman: { name:'Nabendu Mahali', role:'Chairman · Purulia Municipality', party:'AITC', initials:'NM', scope:'municipality' }
};

const I18N = {
  en: {
    nav_home:'Home', nav_blueprint:'Blueprint', nav_map:'Map', nav_kasa:'Kasa', nav_report:'Report →',
    intro_title:'Purulia has a garbage problem.', intro_sub:'Report it. Photograph it. Track who is responsible.',
    intro_meta:'Every dump is mapped to the responsible ward, councillor, MLA, and MP.',
    intro_stats:'23 wards · 1 Chairman · 1 MLA · 1 MP · All of Purulia', intro_cta:'Continue to Map →',
    hero_l1:'See garbage?', hero_l2:'Report it in 30 seconds.',
    hero_sub:'A public map for Purulia town. Every report is visible. Every ward is ranked.',
    hero_cta:'Report Now', pill_active:'Active', pill_reports:'Reports',
    filter_all_sev:'All Severity', filter_all_status:'All Status',
    sev_minor:'Minor', sev_severe:'Severe', sev_critical:'Critical',
    status_open:'Open', status_resolved:'Resolved', map_report:'Report',
    stat_reports:'Reports', stat_resolved:'Resolved', stat_wards:'Wards active', stat_rate:'Resolution %',
    lb_title:'Ward accountability', lb_sub:'Ranked by open reports.', lb_loading:'Loading…',
    chain_title:"Who's responsible", chain_sub:'The chain of accountability for garbage in Purulia.',
    auth_title:'Elected representatives', auth_mla:'MLA · Purulia', auth_mp:'MP · Purulia', auth_chairman:'Chairman · Municipality',
    auth_chairman_meta:'AITC · Board reinstated by Calcutta HC, 2026', auth_view:'View →',
    footer_left:'Purulia Kasa · A civic tool for Purulia town',
    qr_btn:'Scan QR to Report', qr_title:'Share Purulia Kasa', qr_sub:'Point a phone camera at this QR code.',
    step1_title:'Take a photo', step1_sub:'Point at the garbage.', step1_photo:'Tap to take or choose a photo',
    step2_title:'Pin the location', step2_sub:"We'll capture GPS.", step2_gps:'⊕ Use my location',
    step2_no_loc:'No location set yet', step2_ward:'Ward', step2_sev:'Severity',
    sev_minor_long:'Minor — small pile', sev_severe_long:'Severe — large dump', sev_critical_long:'Critical — blocking road',
    step3_title:"What's the problem?", step3_sub:'Optional.', step3_name:'Your name (optional)', step3_submit:'Submit Report →',
    step3_privacy:'🔒 Photo, location and ward are public.',
    done_title:'Report filed', done_sub:"It's now on the public map.",
    done_wa:'Notify Municipality on WhatsApp →', done_close:'Done', continue:'Continue →'
  },
  bn: {
    nav_home:'হোম', nav_blueprint:'ব্লুপ্রিন্ট', nav_map:'ম্যাপ', nav_kasa:'কাসা', nav_report:'রিপোর্ট →',
    intro_title:'পুরুলিয়ায় আবর্জনার সমস্যা আছে।', intro_sub:'রিপোর্ট করুন। ছবি তুলুন।',
    intro_meta:'প্রতিটি আবর্জনা সংশ্লিষ্ট ওয়ার্ডের সাথে ম্যাপ করা হয়েছে।',
    intro_stats:'২৩ ওয়ার্ড · ১ চেয়ারম্যান · ১ বিধায়ক · ১ সাংসদ', intro_cta:'ম্যাপে যান →',
    hero_l1:'আবর্জনা দেখছেন?', hero_l2:'৩০ সেকেন্ডে রিপোর্ট করুন।',
    hero_sub:'পুরুলিয়া শহরের জন্য একটি পাবলিক ম্যাপ।', hero_cta:'রিপোর্ট করুন',
    pill_active:'সক্রিয়', pill_reports:'রিপোর্ট',
    filter_all_sev:'সব তীব্রতা', filter_all_status:'সব অবস্থা',
    sev_minor:'সামান্য', sev_severe:'গুরুতর', sev_critical:'সংকটপূর্ণ',
    status_open:'খোলা', status_resolved:'সমাধান', map_report:'রিপোর্ট',
    stat_reports:'রিপোর্ট', stat_resolved:'সমাধান', stat_wards:'সক্রিয় ওয়ার্ড', stat_rate:'সমাধানের হার',
    lb_title:'ওয়ার্ড জবাবদিহিতা', lb_sub:'খোলা রিপোর্ট অনুযায়ী।', lb_loading:'লোড হচ্ছে…',
    chain_title:'কে দায়ী', chain_sub:'জবাবদিহিতার চেইন।',
    auth_title:'নির্বাচিত প্রতিনিধি', auth_mla:'বিধায়ক', auth_mp:'সাংসদ', auth_chairman:'চেয়ারম্যান',
    auth_chairman_meta:'AITC · হাইকোর্ট পুনর্বহাল করেছে', auth_view:'দেখুন →',
    footer_left:'পুরুলিয়া কাসা', qr_btn:'QR স্ক্যান করুন', qr_title:'শেয়ার করুন', qr_sub:'ফোন ক্যামেরা QR দিকে ধরুন।',
    step1_title:'ছবি তুলুন', step1_sub:'আবর্জনার দিকে তাক করুন।', step1_photo:'ছবি তুলতে ট্যাপ করুন',
    step2_title:'লোকেশন পিন করুন', step2_sub:'GPS নেওয়া হবে।', step2_gps:'⊕ আমার লোকেশন',
    step2_no_loc:'লোকেশন সেট করা হয়নি', step2_ward:'ওয়ার্ড', step2_sev:'তীব্রতা',
    sev_minor_long:'সামান্য', sev_severe_long:'গুরুতর', sev_critical_long:'সংকটপূর্ণ',
    step3_title:'সমস্যা কী?', step3_sub:'ঐচ্ছিক।', step3_name:'আপনার নাম', step3_submit:'জমা দিন →',
    step3_privacy:'🔒 ছবি পাবলিক।', done_title:'রিপোর্ট জমা হয়েছে', done_sub:'এখন ম্যাপে দৃশ্যমান।',
    done_wa:'হোয়াটসঅ্যাপে জানান →', done_close:'সম্পন্ন', continue:'চালিয়ে যান →'
  },
  hi: {
    nav_home:'होम', nav_blueprint:'ब्लूप्रिंट', nav_map:'मैप', nav_kasa:'कासा', nav_report:'रिपोर्ट →',
    intro_title:'पुरुलिया में कचरे की समस्या है।', intro_sub:'रिपोर्ट करें। फोटो लें।',
    intro_meta:'हर कचरा संबंधित वार्ड से जुड़ा है।',
    intro_stats:'23 वार्ड · 1 अध्यक्ष · 1 विधायक · 1 सांसद', intro_cta:'मैप पर जाएं →',
    hero_l1:'कचरा दिखा?', hero_l2:'30 सेकंड में रिपोर्ट करें।',
    hero_sub:'पुरुलिया के लिए सार्वजनिक मैप।', hero_cta:'रिपोर्ट करें',
    pill_active:'सक्रिय', pill_reports:'रिपोर्ट',
    filter_all_sev:'सभी गंभीरता', filter_all_status:'सभी स्थिति',
    sev_minor:'मामूली', sev_severe:'गंभीर', sev_critical:'संकटपूर्ण',
    status_open:'खुला', status_resolved:'हल', map_report:'रिपोर्ट',
    stat_reports:'रिपोर्ट', stat_resolved:'हल', stat_wards:'सक्रिय वार्ड', stat_rate:'समाधान %',
    lb_title:'वार्ड जवाबदेही', lb_sub:'खुले रिपोर्ट के अनुसार।', lb_loading:'लोड हो रहा है…',
    chain_title:'कौन जिम्मेदार', chain_sub:'जवाबदेही श्रृंखला।',
    auth_title:'निर्वाचित प्रतिनिधि', auth_mla:'विधायक', auth_mp:'सांसद', auth_chairman:'अध्यक्ष',
    auth_chairman_meta:'AITC · बहाल', auth_view:'देखें →',
    footer_left:'पुरुलिया कासा', qr_btn:'QR स्कैन करें', qr_title:'शेयर करें', qr_sub:'फोन कैमरा QR पर रखें।',
    step1_title:'फोटो लें', step1_sub:'कचरे की ओर।', step1_photo:'टैप करें',
    step2_title:'स्थान पिन करें', step2_sub:'GPS लिया जाएगा।', step2_gps:'⊕ मेरा स्थान',
    step2_no_loc:'स्थान सेट नहीं', step2_ward:'वार्ड', step2_sev:'गंभीरता',
    sev_minor_long:'मामूली', sev_severe_long:'गंभीर', sev_critical_long:'संकटपूर्ण',
    step3_title:'समस्या?', step3_sub:'वैकल्पिक।', step3_name:'नाम', step3_submit:'जमा करें →',
    step3_privacy:'🔒 फोटो सार्वजनिक।', done_title:'रिपोर्ट दर्ज', done_sub:'मैप पर दिख रही है।',
    done_wa:'व्हाट्सएप →', done_close:'हो गया', continue:'जारी रखें →'
  }
};

/* ══════════════════════════════════════════════════════════
   MODERATION
   ══════════════════════════════════════════════════════════ */
async function moderatePhoto(blob){
  const result = { approved: false, reason: null, labels: {} };
  if (blob.size < 10000){ result.reason = 'Image too small'; return result; }
  if (blob.size > 8 * 1024 * 1024){ result.reason = 'Image too large'; return result; }
  if (window.KASA_CONFIG.VISION_API_KEY){
    try {
      const base64 = await blobToBase64(blob);
      const res = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${window.KASA_CONFIG.VISION_API_KEY}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests: [{ image: { content: base64.split(',')[1] }, features: [{ type: 'SAFE_SEARCH_DETECTION' }] }] })
      });
      if (res.ok){
        const data = await res.json();
        const safe = data.responses?.[0]?.safeSearchAnnotation || {};
        result.labels.vision = safe;
        if (safe.adult === 'LIKELY' || safe.adult === 'VERY_LIKELY'){ result.reason = 'Adult content'; return result; }
        if (safe.violence === 'LIKELY' || safe.violence === 'VERY_LIKELY'){ result.reason = 'Violent content'; return result; }
      }
    } catch(e){ console.warn('Vision failed', e); }
  }
  result.approved = true;
  return result;
}

function blobToBase64(blob){
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.readAsDataURL(blob);
  });
}

/* ══════════════════════════════════════════════════════════
   INIT
   ══════════════════════════════════════════════════════════ */
async function init(){
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY){
    showToast('Configuration missing — please contact admin');
    return;
  }
  reporterHash = await getReporterHash();
  loadUpvotes();
  loadLang();
  applyLang();
  await loadWards();
  await loadWardGeo();
  initMainMap();
  await loadReports();
  populateWardDropdown();
  updateStats();
  renderLeaderboard();
  renderChain();
  renderTicker();
  wireUI();
  checkIntro();
  setupOfflineDetection();
  syncOfflineQueue();

  setTimeout(() => {
    const ld = document.getElementById('k-loader');
    if (ld){ ld.classList.add('hidden'); setTimeout(() => ld.remove(), 500); }
  }, 800);
}

async function getReporterHash(){
  let hash = localStorage.getItem('kasa_reporter_hash');
  if (hash) return hash;
  const seed = [navigator.userAgent, screen.width+'x'+screen.height, Intl.DateTimeFormat().resolvedOptions().timeZone, navigator.language, Math.random().toString(36).slice(2)].join('|');
  const buf = new TextEncoder().encode(seed);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  hash = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2,'0')).join('').slice(0, 16);
  localStorage.setItem('kasa_reporter_hash', hash);
  return hash;
}

function loadLang(){
  currentLang = localStorage.getItem('kasa_lang') || 'en';
  document.documentElement.lang = currentLang;
}
function applyLang(){
  const s = I18N[currentLang] || I18N.en;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const k = el.dataset.i18n;
    if (s[k]) el.textContent = s[k];
  });
  document.querySelectorAll('.k-lang-btn').forEach(b => b.classList.toggle('k-lang-active', b.dataset.lang === currentLang));
}
function setLang(lang){
  if (!I18N[lang]) return;
  currentLang = lang;
  localStorage.setItem('kasa_lang', lang);
  document.documentElement.lang = lang;
  applyLang();
  renderChain();
  renderLeaderboard();
  renderTicker();
}

function checkIntro(){
  const force = new URLSearchParams(window.location.search).get('intro') === '1';
  if (!force && localStorage.getItem('kasa_intro_seen')) return;
  const show = () => { const el = document.getElementById('k-intro'); if (el) el.classList.add('open'); };
  if (document.readyState === 'complete') setTimeout(show, 600);
  else window.addEventListener('load', () => setTimeout(show, 600));
}

function loadUpvotes(){ try { userUpvotes = new Set(JSON.parse(localStorage.getItem('kasa_upvotes')||'[]')); } catch(e){} }
function saveUpvotes(){ try { localStorage.setItem('kasa_upvotes', JSON.stringify([...userUpvotes])); } catch(e){} }

/* ══════════════════════════════════════════════════════════
   WARDS
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
    console.info('Kasa: ward boundaries loaded', wardGeo.features.length);
  } catch(e){ console.info('Kasa: no ward GeoJSON'); }
}

function pointInRing(pt, ring){
  let x = pt[0], y = pt[1], inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++){
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function pointInPolygon(pt, polygon){
  if (polygon.type === 'Polygon') return pointInRing(pt, polygon.coordinates[0]);
  if (polygon.type === 'MultiPolygon') return polygon.coordinates.some(r => pointInRing(pt, r[0]));
  return false;
}
function detectWard(lat, lng){
  if (!wardGeo || !wardGeo.features) return null;
  for (const f of wardGeo.features){
    if (pointInPolygon([lng, lat], f.geometry)){
      const p = f.properties || {};
      const n = p.ward || p.WARD || p.ward_no;
      if (n) return parseInt(String(n).replace(/\D/g, ''), 10);
    }
  }
  return null;
}

/* ══════════════════════════════════════════════════════════
   REPORTS
   ══════════════════════════════════════════════════════════ */
async function loadReports(){
  const pending = await getPendingReports();
  const { data, error } = await sb.from('reports').select('*').order('created_at', { ascending: false }).limit(500);
  if (error) console.error('Reports load failed', error);
  reports = [...(data || [])];
  for (const p of pending){
    reports.unshift({
      id: p.id, lat: p.lat, lng: p.lng, ward_no: p.ward_no,
      severity: p.severity, description: p.description,
      reporter_name: p.reporter_name,
      photo_url: URL.createObjectURL(p.photoBlob),
      status: 'open', created_at: p.created_at, sync_status: 'pending'
    });
  }
  renderMarkers();
}

async function getPendingReports(){
  try { return await idbKeyval.get('pending_reports') || []; }
  catch(e){ return []; }
}
async function queuePendingReport(report){
  const pending = await getPendingReports();
  pending.push(report);
  await idbKeyval.set('pending_reports', pending);
}
async function removePendingReport(id){
  const pending = await getPendingReports();
  await idbKeyval.set('pending_reports', pending.filter(p => p.id !== id));
}
async function syncOfflineQueue(){
  if (!navigator.onLine) return;
  const pending = await getPendingReports();
  if (!pending.length) return;
  showToast(`Syncing ${pending.length} offline report(s)…`);
  for (const p of pending){
    try { await syncReportToServer(p); await removePendingReport(p.id); }
    catch(e){ console.warn('Sync failed', p.id, e); }
  }
  await loadReports();
  updateStats();
  renderLeaderboard();
  renderTicker();
}

/* ══════════════════════════════════════════════════════════
   MAP
   ══════════════════════════════════════════════════════════ */
function initMainMap(){
  mainMap = new maplibregl.Map({
    container: 'k-map',
    style: 'https://tiles.openfreemap.org/styles/dark',
    center: MAP_CENTER, zoom: MAP_ZOOM,
    attributionControl: { compact: true }
  });
  mainMap.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

  mainMap.on('load', () => {
    if (wardGeo){
      mainMap.addSource('wards', { type: 'geojson', data: wardGeo });
      mainMap.addLayer({ id:'wards-fill', type:'fill', source:'wards', paint:{ 'fill-color':'#d4882a','fill-opacity':0.04 }});
      mainMap.addLayer({ id:'wards-line', type:'line', source:'wards', paint:{ 'line-color':'rgba(212,136,42,.4)','line-width':1 }});
      mainMap.on('click', 'wards-fill', (e) => {
        const ward = e.features[0].properties.ward;
        if (!ward) return;
        activeFilters.ward = parseInt(ward);
        const inp = document.getElementById('k-search-ward');
        if (inp) inp.value = ward;
        renderMarkers();
        showToast(`Filtering Ward ${ward}`);
      });
      mainMap.on('mouseenter', 'wards-fill', () => { mainMap.getCanvas().style.cursor = 'pointer'; });
      mainMap.on('mouseleave', 'wards-fill', () => { mainMap.getCanvas().style.cursor = ''; });
    }

    mainMap.addSource('reports', { type:'geojson', data:{ type:'FeatureCollection', features:[] }});
    mainMap.addLayer({
      id:'reports-halo', type:'circle', source:'reports',
      paint:{ 'circle-radius':14, 'circle-color': severityColor(), 'circle-opacity':0.18 }
    });
    mainMap.addLayer({
      id:'reports-core', type:'circle', source:'reports',
      paint:{
        'circle-radius':6,
        'circle-color': severityColor(),
        'circle-stroke-color': ['case', ['==', ['get','sync_status'], 'pending'], '#E88A4A', 'rgba(255,255,255,.3)'],
        'circle-stroke-width': ['case', ['==', ['get','sync_status'], 'pending'], 2, 1]
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
    if (r.moderation_status && r.moderation_status !== 'approved') return false;
    if (activeFilters.severity && r.severity !== activeFilters.severity) return false;
    if (activeFilters.status && r.status !== activeFilters.status) return false;
    if (activeFilters.ward && r.ward_no !== activeFilters.ward) return false;
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
        id: r.id, status: r.status, severity: r.severity || 'minor',
        ward_no: r.ward_no, description: r.description || '',
        photo_url: r.photo_url || '', reporter_name: r.reporter_name || '',
        created_at: r.created_at, resolved_photo_url: r.resolved_photo_url || '',
        upvotes: r.upvotes || 0, flags: r.flags || 0,
        lat: r.lat, lng: r.lng, sync_status: r.sync_status || 'synced',
        resolution_status: r.resolution_status || 'none'
      }
    }));
  mainMap.getSource('reports').setData({ type: 'FeatureCollection', features });
  renderTicker();
}

function renderTicker(){
  const track = document.getElementById('k-ticker-track');
  if (!track) return;
  if (!reports.length){
    track.innerHTML = '<span class="k-ticker-item">No reports yet — be the first</span>';
    return;
  }
  const recent = reports.slice(0, 10);
  const items = recent.map(r => {
    const color = r.status === 'resolved' ? '#6DB88A' :
      r.severity === 'critical' ? '#E8524A' :
      r.severity === 'severe' ? '#E88A4A' : '#D4882A';
    const days = Math.floor((Date.now() - new Date(r.created_at).getTime()) / 86400000);
    const w = wards[r.ward_no] || {};
    const statusText = r.sync_status === 'pending' ? 'Pending sync' :
      r.status === 'resolved' ? 'Resolved' : `${days}d open`;
    return `<span class="k-ticker-item">
      <i class="k-ticker-dot" style="background:${color}"></i>
      Ward ${r.ward_no || '?'} · ${esc(w.councillor_name || 'Unknown')} · ${statusText}
    </span>`;
  }).join('');
  track.innerHTML = items + items;
}

function openReportPopup(props, coords){
  const w = wards[props.ward_no] || { councillor_name:'—', party:'—' };
  const date = props.created_at ? new Date(props.created_at).toLocaleDateString() : '';
  const daysOpen = props.created_at ? Math.floor((Date.now() - new Date(props.created_at).getTime()) / 86400000) : 0;
  const sla = DEFAULT_SLA_DAYS;
  const slaRemaining = Math.max(0, sla - daysOpen);
  const slaStatus = props.status === 'resolved' ? 'resolved'
    : slaRemaining === 0 ? 'overdue'
    : slaRemaining <= 2 ? 'warning' : 'ontrack';
  const slaColors = { resolved:'#6DB88A', overdue:'#E8524A', warning:'#E88A4A', ontrack:'#D4882A' };
  const slaLabels = {
    resolved: `Resolved in ${daysOpen}d`,
    overdue: `SLA overdue by ${daysOpen - sla}d`,
    warning: `${slaRemaining}d left to SLA`,
    ontrack: `${slaRemaining}d left to SLA`
  };

  const photo = props.photo_url ? `<img class="k-popup-img" src="${esc(props.photo_url)}" alt="">` : '';
  const pendingBadge = props.sync_status === 'pending'
    ? '<div style="background:rgba(232,138,74,.15);border-bottom:1px solid #E88A4A;color:#E88A4A;font-size:11px;padding:.4rem .6rem;text-align:center;letter-spacing:.14em;text-transform:uppercase;font-family:var(--mono);">Pending sync</div>'
    : '';

  let sevClass = 'k-popup-sev-minor';
  if (props.status === 'resolved') sevClass = 'k-popup-sev-resolved';
  else if (props.severity === 'critical') sevClass = 'k-popup-sev-critical';
  else if (props.severity === 'severe') sevClass = 'k-popup-sev-severe';

  const hasUpvoted = userUpvotes.has(props.id);
  const isPending = props.sync_status === 'pending';

  let actionsHtml = '';
  if (props.status === 'resolved'){
    actionsHtml = `<span class="k-popup-btn" style="border-color:#6DB88A;color:#6DB88A;cursor:default;">✓ Verified & Resolved</span>`;
  } else if (props.resolution_status === 'pending'){
    actionsHtml = `<span class="k-popup-btn" style="border-color:#E88A4A;color:#E88A4A;cursor:default;">⏳ Awaiting verification</span>`;
  } else if (props.resolution_status === 'rejected'){
    actionsHtml = `<button class="k-popup-btn k-btn-verify" data-verify="${esc(props.id)}">Resubmit proof</button>
      <button class="k-popup-btn k-btn-flag" data-flag="${esc(props.id)}">Flag</button>`;
  } else if (isPending){
    actionsHtml = `<span class="k-popup-btn" style="border-color:#E88A4A;color:#E88A4A;cursor:default;">Awaiting upload</span>`;
  } else {
    actionsHtml = `<button class="k-popup-btn k-btn-verify" data-verify="${esc(props.id)}">Submit Cleanup Proof</button>
      <button class="k-popup-btn k-btn-flag" data-flag="${esc(props.id)}">Flag</button>`;
  }

  const shareUrl = `${KASA_PAGE_URL}?report=${props.id}`;
  const shareMsg = `Garbage in Ward ${props.ward_no} — Purulia Kasa`;

  const html = `
    <div class="k-popup">
      ${photo}
      ${pendingBadge}
      <div class="k-popup-body">
        <div class="k-popup-severity ${sevClass}">${props.status === 'resolved' ? 'Resolved' : (props.severity || 'Minor')}</div>
        <div class="k-popup-title">Ward ${esc(props.ward_no || '—')} · ${esc(w.councillor_name)} · ${esc(w.party)}</div>
        <div class="k-popup-desc">${esc(props.description) || 'Garbage reported'}</div>
        <div class="k-popup-meta">${date} · ${esc(slaLabels[slaStatus])}<br>${props.reporter_name ? '— ' + esc(props.reporter_name) : 'Anonymous'}</div>
        <div style="background:rgba(${slaStatus === 'overdue' ? '232,82,74' : slaStatus === 'warning' ? '232,138,74' : '212,136,42'},.08);border-left:2px solid ${slaColors[slaStatus]};padding:.55rem .75rem;font-size:11px;color:${slaColors[slaStatus]};margin-bottom:.7rem;font-family:var(--mono);">SLA: ${slaLabels[slaStatus]}</div>
        <button class="k-popup-upvote ${hasUpvoted ? 'upvoted' : ''}" data-upvote="${esc(props.id)}">
          <span>👍</span> ${hasUpvoted ? 'You saw this' : 'I saw this too'} · ${props.upvotes || 0}
        </button>
        <div class="k-popup-actions">${actionsHtml}</div>
        <button class="k-popup-btn" style="margin-top:.5rem;" data-share-url="${esc(shareUrl)}" data-share-msg="${esc(shareMsg)}">Share report</button>
        <a class="k-popup-btn" style="margin-top:.5rem;" href="https://www.google.com/maps?q=${props.lat || coords[1]},${props.lng || coords[0]}" target="_blank" rel="noopener">Get directions</a>
      </div>
    </div>`;

  new maplibregl.Popup({ closeButton: true, maxWidth: '320px', offset: 12 })
    .setLngLat(coords).setHTML(html).addTo(mainMap);
}

function updateStats(){
  const total = reports.length;
  const resolved = reports.filter(r => r.status === 'resolved').length;
  const active = total - resolved;
  const wardsActive = new Set(reports.map(r => r.ward_no).filter(Boolean)).size;
  const rate = total ? Math.round((resolved / total) * 100) : 0;
  const ids = ['k-stat-total','k-stat-resolved','k-stat-wards','k-stat-rate','k-pill-active','k-pill-total'];
  const vals = [total, resolved, wardsActive, rate + '%', active, total];
  ids.forEach((id, i) => { const el = document.getElementById(id); if (el) el.textContent = vals[i]; });
}

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
    if (!stats[r.ward_no]) stats[r.ward_no] = { open:0, resolved:0, overdue:0 };
    if (r.status === 'resolved') stats[r.ward_no].resolved++;
    else {
      stats[r.ward_no].open++;
      const days = Math.floor((Date.now() - new Date(r.created_at).getTime()) / 86400000);
      if (days > DEFAULT_SLA_DAYS) stats[r.ward_no].overdue++;
    }
  });
  const rows = Object.entries(stats).map(([ward, s]) => {
    const w = wards[ward] || { councillor_name:'—', party:'—' };
    return { ward: parseInt(ward), ...s, councillor: w.councillor_name, party: w.party };
  }).filter(r => r.open > 0).sort((a,b) => b.open - a.open);
  if (!rows.length){
    list.innerHTML = '<div class="k-lb-empty">All reports resolved</div>';
    return;
  }
  const max = rows[0].open;
  list.innerHTML = rows.map((r, i) => `
    <div class="k-lb-row">
      <div class="k-lb-rank">${String(i+1).padStart(2,'0')}</div>
      <div>
        <div class="k-lb-name">Ward ${r.ward}${r.overdue ? ' <span style="color:#E8524A;font-size:.78rem;font-family:var(--mono);">⚠ ' + r.overdue + ' overdue</span>' : ''}</div>
        <div class="k-lb-councillor">${esc(r.councillor)} · ${esc(r.party)}</div>
        <div class="k-lb-bar"><div class="k-lb-bar-fill" style="width:${(r.open/max*100).toFixed(1)}%"></div></div>
      </div>
      <div class="k-lb-count">${r.open}</div>
      <div class="k-lb-rate">${r.resolved} done</div>
    </div>
  `).join('');
}

function renderChain(){
  const chain = document.getElementById('k-chain');
  if (!chain) return;
  const nodes = [
    { icon:'🏛', name:'The Council', role:'23 elected ward councillors · Sets policy & budgets' },
    { icon:'👤', name:'Chairman', role:'Nabendu Mahali · Political head' },
    { icon:'📋', name:'Executive Officer (EO)', role:'WB Civil Service · Administrative head' },
    { icon:'🧹', name:'Sanitation Inspector (SI)', role:'Supervises waste, drainage, water' },
    { icon:'👷', name:'Sanitation Supervisors', role:'Ward Jamadars · Field coordination' },
    { icon:'🧑‍🔧', name:'Sanitation Staff', role:'Collection, sweeping, drain cleaning' }
  ];
  chain.innerHTML = nodes.map((n, i) => {
    const isLast = i === nodes.length - 1;
    const arrow = !isLast ? '<div class="k-chain-arrow">↓</div>' : '';
    return `<div class="k-chain-node">
      <div class="k-chain-icon">${n.icon}</div>
      <div class="k-chain-text">
        <div class="k-chain-name">${esc(n.name)}</div>
        <div class="k-chain-role">${esc(n.role)}</div>
      </div>
    </div>${arrow}`;
  }).join('') + `
    <div class="k-chain-note">
      <div class="k-chain-note-label">Also involved</div>
      <div class="k-chain-note-text">Clerical Staff — grievance tracking, attendance, inventory. Report to the Executive Officer, not the sanitation chain.</div>
    </div>`;
}

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
  const worst = Object.entries(stats).map(([w,c]) => ({ ward: parseInt(w), count: c })).sort((a,b) => b.count - a.count).slice(0, 5);
  const worstHtml = worst.length
    ? worst.map((w, i) => {
        const wd = wards[w.ward] || {};
        return `<div class="k-rep-worst-item">
          <span>${i+1}. Ward ${w.ward} · ${esc(wd.councillor_name || '—')}</span>
          <span class="k-rep-worst-count">${w.count}</span>
        </div>`;
      }).join('')
    : '<div style="padding:1rem 0;color:rgba(240,230,208,.4);font-size:.85rem;">No open reports.</div>';
  document.getElementById('k-rep-content').innerHTML = `
    <div class="k-rep-header">
      <div class="k-rep-avatar">${esc(rep.initials)}</div>
      <div>
        <div class="k-rep-name">${esc(rep.name)}</div>
        <div class="k-rep-role">${esc(rep.role)} · ${esc(rep.party)}</div>
      </div>
    </div>
    <div class="k-rep-stats">
      <div class="k-rep-stat"><div class="k-rep-stat-n">${active}</div><div class="k-rep-stat-l">Active</div></div>
      <div class="k-rep-stat"><div class="k-rep-stat-n">${total}</div><div class="k-rep-stat-l">Reports</div></div>
      <div class="k-rep-stat"><div class="k-rep-stat-n">${resolved}</div><div class="k-rep-stat-l">Resolved</div></div>
    </div>
    <div class="k-rep-worst-title">Worst wards</div>
    ${worstHtml}
  `;
  document.getElementById('k-rep-modal').classList.add('open');
}

function populateWardDropdown(){
  const sel = document.getElementById('k-ward');
  if (!sel) return;
  Object.values(wards).sort((a,b) => a.ward_no - b.ward_no).forEach(w => {
    const opt = document.createElement('option');
    opt.value = w.ward_no;
    opt.textContent = `Ward ${w.ward_no} — ${w.councillor_name}`;
    sel.appendChild(opt);
  });
}

function openModal(){ document.getElementById('k-modal').classList.add('open'); goToStep(1); }
function closeModal(){ document.getElementById('k-modal').classList.remove('open'); }
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
    center: MAP_CENTER, zoom: 13, attributionControl: false
  });
  miniMap.on('load', () => {
    if (wardGeo){
      miniMap.addSource('wards-mini', { type:'geojson', data:wardGeo });
      miniMap.addLayer({ id:'wards-mini-line', type:'line', source:'wards-mini', paint:{ 'line-color':'rgba(212,136,42,.5)','line-width':1 }});
    }
  });
  miniMap.on('click', (e) => setLocation(e.lngLat.lat, e.lngLat.lng));
}

function setLocation(lat, lng){
  draft.lat = lat;
  draft.lng = lng;
  const autoWard = detectWard(lat, lng);
  if (autoWard && wards[autoWard]){
    draft.ward = autoWard;
    const sel = document.getElementById('k-ward');
    if (sel) sel.value = String(autoWard);
    showToast(`Ward ${autoWard} detected`);
  }
  document.getElementById('k-coords').textContent = `${lat.toFixed(5)}°N, ${lng.toFixed(5)}°E`;
  if (miniMap){
    if (miniMarker) miniMarker.remove();
    miniMarker = new maplibregl.Marker({ color:'#D4882A' }).setLngLat([lng, lat]).addTo(miniMap);
    miniMap.flyTo({ center: [lng, lat], zoom: 15 });
  }
  document.getElementById('k-next-2').disabled = false;
}

function wireUI(){
  document.getElementById('k-intro-continue').addEventListener('click', () => {
    document.getElementById('k-intro').classList.remove('open');
    localStorage.setItem('kasa_intro_seen', '1');
  });
  document.getElementById('k-hero-cta').addEventListener('click', openModal);
  document.getElementById('k-map-report-btn').addEventListener('click', openModal);
  document.getElementById('k-nav-report').addEventListener('click', (e) => { e.preventDefault(); openModal(); });
  document.getElementById('k-modal-close').addEventListener('click', closeModal);
  document.getElementById('k-modal-backdrop').addEventListener('click', closeModal);
  document.getElementById('k-photo').addEventListener('change', handlePhoto);
  document.getElementById('k-next-1').addEventListener('click', () => goToStep(2));
  document.getElementById('k-next-2').addEventListener('click', () => goToStep(3));
  document.getElementById('k-gps-btn').addEventListener('click', detectGPS);
  document.getElementById('k-ward').addEventListener('change', (e) => {
    draft.ward = e.target.value ? parseInt(e.target.value) : null;
  });
  document.getElementById('k-severity').addEventListener('change', (e) => { draft.severity = e.target.value; });
  document.getElementById('k-submit').addEventListener('click', submitReport);
  document.getElementById('k-done-close').addEventListener('click', () => { closeModal(); resetDraft(); });
  document.getElementById('k-tweet-btn').addEventListener('click', () => {
    if (window._lastReport){
      const w = wards[window._lastReport.ward_no];
      openTweetComposer(window._lastReport, w);
    }
  });
  document.getElementById('k-filter-severity').addEventListener('change', (e) => { activeFilters.severity = e.target.value; renderMarkers(); });
  document.getElementById('k-filter-status').addEventListener('change', (e) => { activeFilters.status = e.target.value; renderMarkers(); });
  document.getElementById('k-search-ward').addEventListener('input', (e) => {
    const n = parseInt(e.target.value);
    activeFilters.ward = n || null;
    renderMarkers();
  });
  document.querySelectorAll('.k-lang-btn').forEach(btn => btn.addEventListener('click', () => setLang(btn.dataset.lang)));
  document.getElementById('k-qr-btn').addEventListener('click', () => {
    document.getElementById('k-qr-modal').classList.add('open');
    renderQR();
  });
  document.getElementById('k-qr-close').addEventListener('click', () => document.getElementById('k-qr-modal').classList.remove('open'));
  document.getElementById('k-qr-backdrop').addEventListener('click', () => document.getElementById('k-qr-modal').classList.remove('open'));
  document.querySelectorAll('[data-profile]').forEach(btn => btn.addEventListener('click', () => openRepProfile(btn.dataset.profile)));
  document.getElementById('k-rep-close').addEventListener('click', () => document.getElementById('k-rep-modal').classList.remove('open'));
  document.getElementById('k-rep-backdrop').addEventListener('click', () => document.getElementById('k-rep-modal').classList.remove('open'));

  document.addEventListener('click', (e) => {
    const upBtn = e.target.closest('[data-upvote]');
    if (upBtn){ handleUpvote(upBtn.dataset.upvote, upBtn); return; }
    const verifyBtn = e.target.closest('[data-verify]');
    if (verifyBtn){ handleVerify(verifyBtn.dataset.verify); return; }
    const flagBtn = e.target.closest('[data-flag]');
    if (flagBtn){ handleFlag(flagBtn.dataset.flag); return; }
    const shareBtn = e.target.closest('[data-share-url]');
    if (shareBtn){ handleShare(shareBtn.dataset.shareUrl, shareBtn.dataset.shareMsg); return; }
  });
}

function setupOfflineDetection(){
  const update = () => {
    const el = document.getElementById('k-offline');
    if (el) el.hidden = navigator.onLine;
  };
  window.addEventListener('online', () => { update(); syncOfflineQueue(); });
  window.addEventListener('offline', update);
  update();
}

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

function detectGPS(){
  const btn = document.getElementById('k-gps-btn');
  if (!navigator.geolocation){ showToast('GPS not available'); return; }
  btn.textContent = '⟳ Locating…';
  navigator.geolocation.getCurrentPosition(
    (pos) => { btn.textContent = '✓ Location captured'; setLocation(pos.coords.latitude, pos.coords.longitude); },
    (err) => { btn.textContent = '⊕ Use my location'; showToast(err.code === 1 ? 'Permission denied' : 'GPS failed'); },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

async function submitReport(){
  if (!draft.photoBlob){ showToast('Please add a photo'); return; }
  if (draft.lat === null || draft.lng === null){ showToast('Please set a location'); return; }
  if (!draft.ward){ showToast('Please select a ward'); return; }

  const submitBtn = document.getElementById('k-submit');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Checking photo…';

  let moderation;
  try { moderation = await moderatePhoto(draft.photoBlob); }
  catch(e){ moderation = { approved: true, reason: null, labels: {} }; }

  if (!moderation.approved){
    showToast(`Photo rejected: ${moderation.reason}`);
    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit Report →';
    return;
  }

  submitBtn.textContent = 'Checking for duplicates…';

  let parentId = null;
  if (navigator.onLine){
    try {
      const { data: nearby } = await sb.rpc('find_nearby_report', {
        p_lat: draft.lat, p_lng: draft.lng,
        p_radius_meters: DUPLICATE_RADIUS_M, p_hours: DUPLICATE_HOURS
      });
      if (nearby) parentId = nearby;
    } catch(e){}
  }

  const desc = document.getElementById('k-desc').value.trim();
  const name = document.getElementById('k-name').value.trim();

  const report = {
    id: 'R' + Date.now(),
    lat: draft.lat, lng: draft.lng, ward_no: draft.ward,
    severity: draft.severity, description: desc || null,
    reporter_name: name || null, reporter_hash: reporterHash,
    created_at: new Date().toISOString(),
    parent_report_id: parentId, is_duplicate: !!parentId,
    photoBlob: draft.photoBlob,
    moderation_status: moderation.approved ? 'approved' : 'pending',
    moderation_labels: moderation.labels || {}
  };

  if (navigator.onLine){
    try {
      await syncReportToServer(report);
      submitBtn.textContent = 'Submit Report →';
      submitBtn.disabled = false;
      await afterSubmit(report, parentId);
      const tweetBtn = document.getElementById('k-tweet-btn');
      if (tweetBtn){ tweetBtn.style.display = 'block'; window._lastReport = report; }
      return;
    } catch(e){ console.warn('Online submit failed, queuing', e); }
  }

  await queuePendingReport(report);
  submitBtn.textContent = 'Submit Report →';
  submitBtn.disabled = false;
  await afterSubmit(report, parentId, true);
}

async function syncReportToServer(report){
  const filename = `reports/${report.id}.jpg`;
  const { error: upErr } = await sb.storage.from('kasa-photos').upload(filename, report.photoBlob, { contentType:'image/jpeg', upsert:true });
  if (upErr) throw upErr;
  const { data: urlData } = sb.storage.from('kasa-photos').getPublicUrl(filename);

  const { error: insErr } = await sb.from('reports').insert({
    lat: report.lat, lng: report.lng, ward_no: report.ward_no,
    severity: report.severity, description: report.description,
    reporter_name: report.reporter_name, reporter_hash: report.reporter_hash,
    photo_url: urlData.publicUrl, status: 'open',
    upvotes: 0, flags: 0, sla_days: DEFAULT_SLA_DAYS,
    parent_report_id: report.parent_report_id || null,
    is_duplicate: report.is_duplicate || false,
    sync_status: 'synced',
    moderation_status: report.moderation_status || 'pending',
    moderation_labels: report.moderation_labels || {}
  });
  if (insErr) throw insErr;
}

async function afterSubmit(report, parentId, isPending){
  await loadReports();
  updateStats();
  renderLeaderboard();
  renderTicker();

  const w = wards[report.ward_no] || { councillor_name:'—' };
  const msg = `Garbage report — Purulia Kasa\nWard: ${report.ward_no} (${w.councillor_name})\nLocation: ${report.lat.toFixed(5)},${report.lng.toFixed(5)}\nSeverity: ${report.severity}\n${report.description || ''}\nMap: https://www.google.com/maps?q=${report.lat},${report.lng}`;
  document.getElementById('k-wa-escalate').href = `https://wa.me/${MUNICIPALITY_PHONE}?text=${encodeURIComponent(msg)}`;

  const doneTitle = document.getElementById('k-done-title');
  const doneSub = document.getElementById('k-done-sub');
  if (isPending){
    if (doneTitle) doneTitle.textContent = 'Saved offline';
    if (doneSub) doneSub.textContent = 'Will upload automatically when you are back online.';
  } else if (parentId){
    if (doneTitle) doneTitle.textContent = 'Report added';
    if (doneSub) doneSub.textContent = 'Similar nearby report found — linked to it.';
  }

  goToStep('done');
  showToast(isPending ? 'Saved offline' : 'Report filed');
}

function openTweetComposer(report, ward){
  const councillor = ward?.councillor_name || 'Ward Councillor';
  const text = [
    `🗑️ New garbage report in Ward ${report.ward_no}, Purulia`,
    `Councillor: ${councillor}`,
    `Severity: ${report.severity}`,
    report.description ? `"${report.description.slice(0, 80)}"` : '',
    `Reported via @PuruliaKasa`
  ].filter(Boolean).join('\n');
  window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&via=${MLA_TWITTER_HANDLE}`, '_blank');
}

async function handleUpvote(reportId, btn){
  if (userUpvotes.has(reportId)){ showToast('Already upvoted'); return; }
  const r = reports.find(x => x.id === reportId);
  if (!r) return;
  btn.disabled = true;
  const { data: wasInserted } = await sb.rpc('upvote_report', {
    p_report_id: reportId, p_reporter_hash: reporterHash
  });
  if (wasInserted){
    r.upvotes = (r.upvotes || 0) + 1;
    userUpvotes.add(reportId);
    saveUpvotes();
    btn.classList.add('upvoted');
    btn.innerHTML = `<span>👍</span> You saw this · ${r.upvotes}`;
    showToast('Upvote counted');
  } else {
    userUpvotes.add(reportId);
    saveUpvotes();
    showToast('You already upvoted this');
  }
  btn.disabled = false;
}

async function handleFlag(reportId){
  const r = reports.find(x => x.id === reportId);
  if (!r) return;
  const { data: wasInserted } = await sb.rpc('flag_report', {
    p_report_id: reportId, p_reporter_hash: reporterHash, p_reason: null
  });
  if (wasInserted){
    r.flags = (r.flags || 0) + 1;
    showToast('Flagged — thank you');
  } else {
    showToast('You already flagged this');
  }
}

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
        canvas.toBlob(async (blob) => { await commitResolve(reportId, blob); }, 'image/jpeg', 0.75);
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  };
  input.click();
}

async function commitResolve(reportId, blob){
  showToast('Uploading proof for review…');
  const filename = `resolutions/${reportId}-${Date.now()}.jpg`;
  const { error: upErr } = await sb.storage.from('kasa-photos').upload(filename, blob, { contentType:'image/jpeg' });
  if (upErr){ showToast('Upload failed'); return; }
  const { data: urlData } = sb.storage.from('kasa-photos').getPublicUrl(filename);
  const { error: rpcErr } = await sb.rpc('submit_resolution', {
    p_report_id: reportId,
    p_resolved_photo_url: urlData.publicUrl,
    p_submitted_by: reporterHash
  });
  if (rpcErr){
    showToast(rpcErr.message.includes('attempts') ? 'Max retries reached' : 'Could not submit');
    return;
  }
  await loadReports();
  updateStats();
  renderLeaderboard();
  renderTicker();
  showToast('Submitted for verification');
}

function handleShare(url, msg){
  if (navigator.share){ navigator.share({ title:'Purulia Kasa', text: msg, url }).catch(() => {}); return; }
  navigator.clipboard.writeText(url).then(() => showToast('Link copied'));
}

function renderQR(){
  const wrap = document.getElementById('k-qr-wrap');
  const urlEl = document.getElementById('k-qr-url');
  if (!wrap || !urlEl) return;
  wrap.innerHTML = '';
  urlEl.textContent = KASA_PAGE_URL;
  if (window.QRCode){
    const canvas = document.createElement('canvas');
    wrap.appendChild(canvas);
    window.QRCode.toCanvas(canvas, KASA_PAGE_URL, { width:220, margin:1, color:{ dark:'#0a0805', light:'#f0e6d0' }});
  }
}

function resetDraft(){
  draft = { photoBlob:null, lat:null, lng:null, ward:null, severity:'minor' };
  ['k-photo','k-desc','k-name','k-ward'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const pp = document.getElementById('k-photo-preview'); if (pp) pp.innerHTML = '';
  const co = document.getElementById('k-coords'); if (co) co.textContent = 'No location set yet';
  const n1 = document.getElementById('k-next-1'); if (n1) n1.disabled = true;
  const n2 = document.getElementById('k-next-2'); if (n2) n2.disabled = true;
  const sb1 = document.getElementById('k-submit'); if (sb1){ sb1.disabled = false; sb1.textContent = 'Submit Report →'; }
  const gb = document.getElementById('k-gps-btn'); if (gb) gb.textContent = '⊕ Use my location';
  const sv = document.getElementById('k-severity'); if (sv) sv.value = 'minor';
  const tw = document.getElementById('k-tweet-btn'); if (tw) tw.style.display = 'none';
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

init();
const REPS = {
  mla: { name:'Sudip Kumar Mukherjee', role:'MLA · Purulia (No. 242)', party:'BJP', initials:'SKM', scope:'constituency' },
  mp: { name:'Jyotirmay Singh Mahato', role:'MP · Purulia (Lok Sabha)', party:'BJP', initials:'JSM', scope:'constituency' },
  chairman: { name:'Nabendu Mahali', role:'Chairman · Purulia Municipality', party:'AITC', initials:'NM', scope:'municipality' }
};

const I18N = {
  en: {
    nav_home:'Home', nav_blueprint:'Blueprint', nav_map:'Map', nav_kasa:'Kasa', nav_report:'Report →',
    intro_title:'Purulia has a garbage problem.',
    intro_sub:'Report it. Photograph it. Track who is responsible.',
    intro_meta:'Every dump is mapped to the responsible ward, councillor, MLA, and MP.',
    intro_stats:'23 wards · 1 Chairman · 1 MLA · 1 MP · All of Purulia',
    intro_cta:'Continue to Map →',
    hero_l1:'See garbage?', hero_l2:'Report it in 30 seconds.',
    hero_sub:'A public map for Purulia town. Every report is visible. Every ward is ranked.',
    hero_cta:'Report Now',
    pill_active:'Active', pill_reports:'Reports',
    filter_all_sev:'All Severity', filter_all_status:'All Status',
    sev_minor:'Minor', sev_severe:'Severe', sev_critical:'Critical',
    status_open:'Open', status_resolved:'Resolved',
    map_report:'Report',
    stat_reports:'Reports', stat_resolved:'Resolved', stat_wards:'Wards active', stat_rate:'Resolution %',
    lb_title:'Ward accountability', lb_sub:'Ranked by open reports.', lb_loading:'Loading…',
    chain_title:"Who's responsible", chain_sub:'The chain of accountability for garbage in Purulia.',
    auth_title:'Elected representatives', auth_mla:'MLA · Purulia', auth_mp:'MP · Purulia', auth_chairman:'Chairman · Municipality',
    auth_chairman_meta:'AITC · Board reinstated by Calcutta HC, 2026', auth_view:'View →',
    footer_left:'Purulia Kasa · A civic tool for Purulia town',
    qr_btn:'Scan QR to Report', qr_title:'Share Purulia Kasa', qr_sub:'Point a phone camera at this QR code.',
    step1_title:'Take a photo', step1_sub:'Point at the garbage.', step1_photo:'Tap to take or choose a photo',
    step2_title:'Pin the location', step2_sub:"We'll capture GPS.", step2_gps:'⊕ Use my location',
    step2_no_loc:'No location set yet', step2_ward:'Ward', step2_sev:'Severity',
    sev_minor_long:'Minor — small pile', sev_severe_long:'Severe — large dump', sev_critical_long:'Critical — blocking road',
    step3_title:"What's the problem?", step3_sub:'Optional.', step3_name:'Your name (optional)', step3_submit:'Submit Report →',
    step3_privacy:'🔒 Photo, location and ward are public.',
    done_title:'Report filed', done_sub:"It's now on the public map.",
    done_wa:'Notify Municipality on WhatsApp →', done_close:'Done',
    continue:'Continue →'
  },
  bn: {
    nav_home:'হোম', nav_blueprint:'ব্লুপ্রিন্ট', nav_map:'ম্যাপ', nav_kasa:'কাসা', nav_report:'রিপোর্ট →',
    intro_title:'পুরুলিয়ায় আবর্জনার সমস্যা আছে।',
    intro_sub:'রিপোর্ট করুন। ছবি তুলুন।',
    intro_meta:'প্রতিটি আবর্জনা সংশ্লিষ্ট ওয়ার্ড, কাউন্সিলর, বিধায়ক এবং সাংসদের সাথে ম্যাপ করা হয়েছে।',
    intro_stats:'২৩ ওয়ার্ড · ১ চেয়ারম্যান · ১ বিধায়ক · ১ সাংসদ',
    intro_cta:'ম্যাপে যান →',
    hero_l1:'আবর্জনা দেখছেন?', hero_l2:'৩০ সেকেন্ডে রিপোর্ট করুন।',
    hero_sub:'পুরুলিয়া শহরের জন্য একটি পাবলিক ম্যাপ।',
    hero_cta:'রিপোর্ট করুন',
    pill_active:'সক্রিয়', pill_reports:'রিপোর্ট',
    filter_all_sev:'সব তীব্রতা', filter_all_status:'সব অবস্থা',
    sev_minor:'সামান্য', sev_severe:'গুরুতর', sev_critical:'সংকটপূর্ণ',
    status_open:'খোলা', status_resolved:'সমাধান',
    map_report:'রিপোর্ট',
    stat_reports:'রিপোর্ট', stat_resolved:'সমাধান', stat_wards:'সক্রিয় ওয়ার্ড', stat_rate:'সমাধানের হার',
    lb_title:'ওয়ার্ড জবাবদিহিতা', lb_sub:'খোলা রিপোর্ট অনুযায়ী।', lb_loading:'লোড হচ্ছে…',
    chain_title:'কে দায়ী', chain_sub:'জবাবদিহিতার চেইন।',
    auth_title:'নির্বাচিত প্রতিনিধি', auth_mla:'বিধায়ক · পুরুলিয়া', auth_mp:'সাংসদ · পুরুলিয়া', auth_chairman:'চেয়ারম্যান · পুরসভা',
    auth_chairman_meta:'AITC · হাইকোর্ট পুনর্বহাল করেছে', auth_view:'দেখুন →',
    footer_left:'পুরুলিয়া কাসা',
    qr_btn:'QR স্ক্যান করুন', qr_title:'শেয়ার করুন', qr_sub:'ফোন ক্যামেরা QR দিকে ধরুন।',
    step1_title:'ছবি তুলুন', step1_sub:'আবর্জনার দিকে তাক করুন।', step1_photo:'ছবি তুলতে ট্যাপ করুন',
    step2_title:'লোকেশন পিন করুন', step2_sub:'GPS নেওয়া হবে।', step2_gps:'⊕ আমার লোকেশন',
    step2_no_loc:'লোকেশন সেট করা হয়নি', step2_ward:'ওয়ার্ড', step2_sev:'তীব্রতা',
    sev_minor_long:'সামান্য', sev_severe_long:'গুরুতর', sev_critical_long:'সংকটপূর্ণ',
    step3_title:'সমস্যা কী?', step3_sub:'ঐচ্ছিক।', step3_name:'আপনার নাম (ঐচ্ছিক)', step3_submit:'জমা দিন →',
    step3_privacy:'🔒 ছবি পাবলিক।',
    done_title:'রিপোর্ট জমা হয়েছে', done_sub:'এখন ম্যাপে দৃশ্যমান।',
    done_wa:'হোয়াটসঅ্যাপে জানান →', done_close:'সম্পন্ন',
    continue:'চালিয়ে যান →'
  },
  hi: {
    nav_home:'होम', nav_blueprint:'ब्लूप्रिंट', nav_map:'मैप', nav_kasa:'कासा', nav_report:'रिपोर्ट →',
    intro_title:'पुरुलिया में कचरे की समस्या है।',
    intro_sub:'रिपोर्ट करें। फोटो लें।',
    intro_meta:'हर कचरा संबंधित वार्ड, पार्षद से जुड़ा है।',
    intro_stats:'23 वार्ड · 1 अध्यक्ष · 1 विधायक · 1 सांसद',
    intro_cta:'मैप पर जाएं →',
    hero_l1:'कचरा दिखा?', hero_l2:'30 सेकंड में रिपोर्ट करें।',
    hero_sub:'पुरुलिया के लिए सार्वजनिक मैप।',
    hero_cta:'रिपोर्ट करें',
    pill_active:'सक्रिय', pill_reports:'रिपोर्ट',
    filter_all_sev:'सभी गंभीरता', filter_all_status:'सभी स्थिति',
    sev_minor:'मामूली', sev_severe:'गंभीर', sev_critical:'संकटपूर्ण',
    status_open:'खुला', status_resolved:'हल',
    map_report:'रिपोर्ट',
    stat_reports:'रिपोर्ट', stat_resolved:'हल', stat_wards:'सक्रिय वार्ड', stat_rate:'समाधान %',
    lb_title:'वार्ड जवाबदेही', lb_sub:'खुले रिपोर्ट के अनुसार।', lb_loading:'लोड हो रहा है…',
    chain_title:'कौन जिम्मेदार', chain_sub:'जवाबदेही श्रृंखला।',
    auth_title:'निर्वाचित प्रतिनिधि', auth_mla:'विधायक', auth_mp:'सांसद', auth_chairman:'अध्यक्ष',
    auth_chairman_meta:'AITC · बहाल', auth_view:'देखें →',
    footer_left:'पुरुलिया कासा',
    qr_btn:'QR स्कैन करें', qr_title:'शेयर करें', qr_sub:'फोन कैमरा QR पर रखें।',
    step1_title:'फोटो लें', step1_sub:'कचरे की ओर।', step1_photo:'टैप करें',
    step2_title:'स्थान पिन करें', step2_sub:'GPS लिया जाएगा।', step2_gps:'⊕ मेरा स्थान',
    step2_no_loc:'स्थान सेट नहीं', step2_ward:'वार्ड', step2_sev:'गंभीरता',
    sev_minor_long:'मामूली', sev_severe_long:'गंभीर', sev_critical_long:'संकटपूर्ण',
    step3_title:'समस्या?', step3_sub:'वैकल्पिक।', step3_name:'नाम', step3_submit:'जमा करें →',
    step3_privacy:'🔒 फोटो सार्वजनिक।',
    done_title:'रिपोर्ट दर्ज', done_sub:'मैप पर दिख रही है।',
    done_wa:'व्हाट्सएप →', done_close:'हो गया',
    continue:'जारी रखें →'
  }
};

/* ══════════════════════════════════════════════════════════
   MODERATION
   ══════════════════════════════════════════════════════════ */
async function moderatePhoto(blob){
  const result = { approved: false, reason: null, labels: {} };
  if (blob.size < 10000){ result.reason = 'Image too small'; return result; }
  if (blob.size > 8 * 1024 * 1024){ result.reason = 'Image too large'; return result; }
  if (window.KASA_CONFIG.VISION_API_KEY){
    try {
      const base64 = await blobToBase64(blob);
      const res = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${window.KASA_CONFIG.VISION_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{ image: { content: base64.split(',')[1] }, features: [{ type: 'SAFE_SEARCH_DETECTION' }] }]
        })
      });
      if (res.ok){
        const data = await res.json();
        const safe = data.responses?.[0]?.safeSearchAnnotation || {};
        result.labels.vision = safe;
        if (safe.adult === 'LIKELY' || safe.adult === 'VERY_LIKELY'){ result.reason = 'Adult content'; return result; }
        if (safe.violence === 'LIKELY' || safe.violence === 'VERY_LIKELY'){ result.reason = 'Violent content'; return result; }
      }
    } catch(e){ console.warn('Vision failed', e); }
  }
  result.approved = true;
  return result;
}

function blobToBase64(blob){
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.readAsDataURL(blob);
  });
}

/* ══════════════════════════════════════════════════════════
   INIT
   ══════════════════════════════════════════════════════════ */
async function init(){
  reporterHash = await getReporterHash();
  loadUpvotes();
  loadLang();
  applyLang();
  await loadWards();
  await loadWardGeo();
  initMainMap();
  await loadReports();
  populateWardDropdown();
  updateStats();
  renderLeaderboard();
  renderChain();
  renderTicker();
  wireUI();
  checkIntro();
  setupOfflineDetection();
  syncOfflineQueue();

  setTimeout(() => {
    const ld = document.getElementById('k-loader');
    if (ld){ ld.classList.add('hidden'); setTimeout(() => ld.remove(), 500); }
  }, 800);
}

async function getReporterHash(){
  let hash = localStorage.getItem('kasa_reporter_hash');
  if (hash) return hash;
  const seed = [navigator.userAgent, screen.width+'x'+screen.height, Intl.DateTimeFormat().resolvedOptions().timeZone, navigator.language, Math.random().toString(36).slice(2)].join('|');
  const buf = new TextEncoder().encode(seed);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  hash = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2,'0')).join('').slice(0, 16);
  localStorage.setItem('kasa_reporter_hash', hash);
  return hash;
}

function loadLang(){
  currentLang = localStorage.getItem('kasa_lang') || 'en';
  document.documentElement.lang = currentLang;
}
function applyLang(){
  const s = I18N[currentLang] || I18N.en;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const k = el.dataset.i18n;
    if (s[k]) el.textContent = s[k];
  });
  document.querySelectorAll('.k-lang-btn').forEach(b => b.classList.toggle('k-lang-active', b.dataset.lang === currentLang));
}
function setLang(lang){
  if (!I18N[lang]) return;
  currentLang = lang;
  localStorage.setItem('kasa_lang', lang);
  document.documentElement.lang = lang;
  applyLang();
  renderChain();
  renderLeaderboard();
  renderTicker();
}

function checkIntro(){
  const force = new URLSearchParams(window.location.search).get('intro') === '1';
  if (!force && localStorage.getItem('kasa_intro_seen')) return;
  const show = () => { const el = document.getElementById('k-intro'); if (el) el.classList.add('open'); };
  if (document.readyState === 'complete') setTimeout(show, 600);
  else window.addEventListener('load', () => setTimeout(show, 600));
}

function loadUpvotes(){ try { userUpvotes = new Set(JSON.parse(localStorage.getItem('kasa_upvotes')||'[]')); } catch(e){} }
function saveUpvotes(){ try { localStorage.setItem('kasa_upvotes', JSON.stringify([...userUpvotes])); } catch(e){} }

/* ══════════════════════════════════════════════════════════
   WARDS
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
    console.info('Kasa: ward boundaries loaded', wardGeo.features.length);
  } catch(e){ console.info('Kasa: no ward GeoJSON'); }
}

function pointInRing(pt, ring){
  let x = pt[0], y = pt[1], inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++){
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function pointInPolygon(pt, polygon){
  if (polygon.type === 'Polygon') return pointInRing(pt, polygon.coordinates[0]);
  if (polygon.type === 'MultiPolygon') return polygon.coordinates.some(r => pointInRing(pt, r[0]));
  return false;
}
function detectWard(lat, lng){
  if (!wardGeo || !wardGeo.features) return null;
  for (const f of wardGeo.features){
    if (pointInPolygon([lng, lat], f.geometry)){
      const p = f.properties || {};
      const n = p.ward || p.WARD || p.ward_no;
      if (n) return parseInt(String(n).replace(/\D/g, ''), 10);
    }
  }
  return null;
}

/* ══════════════════════════════════════════════════════════
   REPORTS
   ══════════════════════════════════════════════════════════ */
async function loadReports(){
  const pending = await getPendingReports();
  const { data, error } = await sb.from('reports').select('*').order('created_at', { ascending: false }).limit(500);
  if (error) console.error('Reports load failed', error);
  reports = [...(data || [])];
  for (const p of pending){
    reports.unshift({
      id: p.id, lat: p.lat, lng: p.lng, ward_no: p.ward_no,
      severity: p.severity, description: p.description,
      reporter_name: p.reporter_name,
      photo_url: URL.createObjectURL(p.photoBlob),
      status: 'open', created_at: p.created_at, sync_status: 'pending'
    });
  }
  renderMarkers();
}

async function getPendingReports(){
  try { return await idbKeyval.get('pending_reports') || []; }
  catch(e){ return []; }
}
async function queuePendingReport(report){
  const pending = await getPendingReports();
  pending.push(report);
  await idbKeyval.set('pending_reports', pending);
}
async function removePendingReport(id){
  const pending = await getPendingReports();
  await idbKeyval.set('pending_reports', pending.filter(p => p.id !== id));
}
async function syncOfflineQueue(){
  if (!navigator.onLine) return;
  const pending = await getPendingReports();
  if (!pending.length) return;
  showToast(`Syncing ${pending.length} offline report(s)…`);
  for (const p of pending){
    try { await syncReportToServer(p); await removePendingReport(p.id); }
    catch(e){ console.warn('Sync failed', p.id, e); }
  }
  await loadReports();
  updateStats();
  renderLeaderboard();
  renderTicker();
}

/* ══════════════════════════════════════════════════════════
   MAP
   ══════════════════════════════════════════════════════════ */
function initMainMap(){
  mainMap = new maplibregl.Map({
    container: 'k-map',
    style: 'https://tiles.openfreemap.org/styles/dark',
    center: MAP_CENTER, zoom: MAP_ZOOM,
    attributionControl: { compact: true }
  });
  mainMap.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

  mainMap.on('load', () => {
    if (wardGeo){
      mainMap.addSource('wards', { type: 'geojson', data: wardGeo });
      mainMap.addLayer({ id:'wards-fill', type:'fill', source:'wards', paint:{ 'fill-color':'#d4882a','fill-opacity':0.04 }});
      mainMap.addLayer({ id:'wards-line', type:'line', source:'wards', paint:{ 'line-color':'rgba(212,136,42,.4)','line-width':1 }});
      mainMap.on('click', 'wards-fill', (e) => {
        const ward = e.features[0].properties.ward;
        if (!ward) return;
        activeFilters.ward = parseInt(ward);
        const inp = document.getElementById('k-search-ward');
        if (inp) inp.value = ward;
        renderMarkers();
        showToast(`Filtering Ward ${ward}`);
      });
      mainMap.on('mouseenter', 'wards-fill', () => { mainMap.getCanvas().style.cursor = 'pointer'; });
      mainMap.on('mouseleave', 'wards-fill', () => { mainMap.getCanvas().style.cursor = ''; });
    }

    mainMap.addSource('reports', { type:'geojson', data:{ type:'FeatureCollection', features:[] }});
    mainMap.addLayer({
      id:'reports-halo', type:'circle', source:'reports',
      paint:{ 'circle-radius':14, 'circle-color': severityColor(), 'circle-opacity':0.18 }
    });
    mainMap.addLayer({
      id:'reports-core', type:'circle', source:'reports',
      paint:{
        'circle-radius':6,
        'circle-color': severityColor(),
        'circle-stroke-color': ['case', ['==', ['get','sync_status'], 'pending'], '#E88A4A', 'rgba(255,255,255,.3)'],
        'circle-stroke-width': ['case', ['==', ['get','sync_status'], 'pending'], 2, 1]
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
    if (r.moderation_status && r.moderation_status !== 'approved') return false;
    if (activeFilters.severity && r.severity !== activeFilters.severity) return false;
    if (activeFilters.status && r.status !== activeFilters.status) return false;
    if (activeFilters.ward && r.ward_no !== activeFilters.ward) return false;
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
        id: r.id, status: r.status, severity: r.severity || 'minor',
        ward_no: r.ward_no, description: r.description || '',
        photo_url: r.photo_url || '', reporter_name: r.reporter_name || '',
        created_at: r.created_at, resolved_photo_url: r.resolved_photo_url || '',
        upvotes: r.upvotes || 0, flags: r.flags || 0,
        lat: r.lat, lng: r.lng, sync_status: r.sync_status || 'synced',
        resolution_status: r.resolution_status || 'none'
      }
    }));
  mainMap.getSource('reports').setData({ type: 'FeatureCollection', features });
  renderTicker();
}

/* ══════════════════════════════════════════════════════════
   TICKER
   ══════════════════════════════════════════════════════════ */
function renderTicker(){
  const track = document.getElementById('k-ticker-track');
  if (!track) return;
  if (!reports.length){
    track.innerHTML = '<span class="k-ticker-item">No reports yet — be the first</span>';
    return;
  }
  const recent = reports.slice(0, 10);
  const items = recent.map(r => {
    const color = r.status === 'resolved' ? '#6DB88A' :
      r.severity === 'critical' ? '#E8524A' :
      r.severity === 'severe' ? '#E88A4A' : '#D4882A';
    const days = Math.floor((Date.now() - new Date(r.created_at).getTime()) / 86400000);
    const w = wards[r.ward_no] || {};
    const statusText = r.sync_status === 'pending' ? 'Pending sync' :
      r.status === 'resolved' ? 'Resolved' : `${days}d open`;
    return `<span class="k-ticker-item">
      <i class="k-ticker-dot" style="background:${color}"></i>
      Ward ${r.ward_no || '?'} · ${esc(w.councillor_name || 'Unknown')} · ${statusText}
    </span>`;
  }).join('');
  track.innerHTML = items + items;
}

/* ══════════════════════════════════════════════════════════
   POPUP
   ══════════════════════════════════════════════════════════ */
function openReportPopup(props, coords){
  const w = wards[props.ward_no] || { councillor_name:'—', party:'—' };
  const date = props.created_at ? new Date(props.created_at).toLocaleDateString() : '';
  const daysOpen = props.created_at ? Math.floor((Date.now() - new Date(props.created_at).getTime()) / 86400000) : 0;
  const sla = DEFAULT_SLA_DAYS;
  const slaRemaining = Math.max(0, sla - daysOpen);
  const slaStatus = props.status === 'resolved' ? 'resolved'
    : slaRemaining === 0 ? 'overdue'
    : slaRemaining <= 2 ? 'warning' : 'ontrack';
  const slaColors = { resolved:'#6DB88A', overdue:'#E8524A', warning:'#E88A4A', ontrack:'#D4882A' };
  const slaLabels = {
    resolved: `Resolved in ${daysOpen}d`,
    overdue: `SLA overdue by ${daysOpen - sla}d`,
    warning: `${slaRemaining}d left to SLA`,
    ontrack: `${slaRemaining}d left to SLA`
  };

  const photo = props.photo_url ? `<img class="k-popup-img" src="${esc(props.photo_url)}" alt="">` : '';
  const pendingBadge = props.sync_status === 'pending'
    ? '<div style="background:rgba(232,138,74,.15);border-bottom:1px solid #E88A4A;color:#E88A4A;font-size:11px;padding:.4rem .6rem;text-align:center;letter-spacing:.14em;text-transform:uppercase;font-family:var(--mono);">Pending sync</div>'
    : '';

  let sevClass = 'k-popup-sev-minor';
  if (props.status === 'resolved') sevClass = 'k-popup-sev-resolved';
  else if (props.severity === 'critical') sevClass = 'k-popup-sev-critical';
  else if (props.severity === 'severe') sevClass = 'k-popup-sev-severe';

  const hasUpvoted = userUpvotes.has(props.id);
  const isPending = props.sync_status === 'pending';

  let actionsHtml = '';
  if (props.status === 'resolved'){
    actionsHtml = `<span class="k-popup-btn" style="border-color:#6DB88A;color:#6DB88A;cursor:default;">✓ Verified & Resolved</span>`;
  } else if (props.resolution_status === 'pending'){
    actionsHtml = `<span class="k-popup-btn" style="border-color:#E88A4A;color:#E88A4A;cursor:default;">⏳ Awaiting verification</span>`;
  } else if (props.resolution_status === 'rejected'){
    actionsHtml = `<button class="k-popup-btn k-btn-verify" data-verify="${esc(props.id)}">Resubmit proof</button>
      <button class="k-popup-btn k-btn-flag" data-flag="${esc(props.id)}">Flag</button>`;
  } else if (isPending){
    actionsHtml = `<span class="k-popup-btn" style="border-color:#E88A4A;color:#E88A4A;cursor:default;">Awaiting upload</span>`;
  } else {
    actionsHtml = `<button class="k-popup-btn k-btn-verify" data-verify="${esc(props.id)}">Submit Cleanup Proof</button>
      <button class="k-popup-btn k-btn-flag" data-flag="${esc(props.id)}">Flag</button>`;
  }

  const shareUrl = `${KASA_PAGE_URL}?report=${props.id}`;
  const shareMsg = `Garbage in Ward ${props.ward_no} — Purulia Kasa`;

  const html = `
    <div class="k-popup">
      ${photo}
      ${pendingBadge}
      <div class="k-popup-body">
        <div class="k-popup-severity ${sevClass}">${props.status === 'resolved' ? 'Resolved' : (props.severity || 'Minor')}</div>
        <div class="k-popup-title">Ward ${esc(props.ward_no || '—')} · ${esc(w.councillor_name)} · ${esc(w.party)}</div>
        <div class="k-popup-desc">${esc(props.description) || 'Garbage reported'}</div>
        <div class="k-popup-meta">${date} · ${esc(slaLabels[slaStatus])}<br>${props.reporter_name ? '— ' + esc(props.reporter_name) : 'Anonymous'}</div>
        <div style="background:rgba(${slaStatus === 'overdue' ? '232,82,74' : slaStatus === 'warning' ? '232,138,74' : '212,136,42'},.08);border-left:2px solid ${slaColors[slaStatus]};padding:.55rem .75rem;font-size:11px;color:${slaColors[slaStatus]};margin-bottom:.7rem;font-family:var(--mono);">SLA: ${slaLabels[slaStatus]}</div>
        <button class="k-popup-upvote ${hasUpvoted ? 'upvoted' : ''}" data-upvote="${esc(props.id)}">
          <span>👍</span> ${hasUpvoted ? 'You saw this' : 'I saw this too'} · ${props.upvotes || 0}
        </button>
        <div class="k-popup-actions">${actionsHtml}</div>
        <button class="k-popup-btn" style="margin-top:.5rem;" data-share-url="${esc(shareUrl)}" data-share-msg="${esc(shareMsg)}">Share report</button>
        <a class="k-popup-btn" style="margin-top:.5rem;" href="https://www.google.com/maps?q=${props.lat || coords[1]},${props.lng || coords[0]}" target="_blank" rel="noopener">Get directions</a>
      </div>
    </div>`;

  new maplibregl.Popup({ closeButton: true, maxWidth: '320px', offset: 12 })
    .setLngLat(coords).setHTML(html).addTo(mainMap);
}

/* ══════════════════════════════════════════════════════════
   STATS + LEADERBOARD + CHAIN
   ══════════════════════════════════════════════════════════ */
function updateStats(){
  const total = reports.length;
  const resolved = reports.filter(r => r.status === 'resolved').length;
  const active = total - resolved;
  const wardsActive = new Set(reports.map(r => r.ward_no).filter(Boolean)).size;
  const rate = total ? Math.round((resolved / total) * 100) : 0;
  document.getElementById('k-stat-total').textContent = total;
  document.getElementById('k-stat-resolved').textContent = resolved;
  document.getElementById('k-stat-wards').textContent = wardsActive;
  document.getElementById('k-stat-rate').textContent = rate + '%';
  document.getElementById('k-pill-active').textContent = active;
  document.getElementById('k-pill-total').textContent = total;
}

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
    if (!stats[r.ward_no]) stats[r.ward_no] = { open:0, resolved:0, overdue:0 };
    if (r.status === 'resolved') stats[r.ward_no].resolved++;
    else {
      stats[r.ward_no].open++;
      const days = Math.floor((Date.now() - new Date(r.created_at).getTime()) / 86400000);
      if (days > DEFAULT_SLA_DAYS) stats[r.ward_no].overdue++;
    }
  });
  const rows = Object.entries(stats).map(([ward, s]) => {
    const w = wards[ward] || { councillor_name:'—', party:'—' };
    return { ward: parseInt(ward), ...s, councillor: w.councillor_name, party: w.party };
  }).filter(r => r.open > 0).sort((a,b) => b.open - a.open);
  if (!rows.length){
    list.innerHTML = '<div class="k-lb-empty">All reports resolved</div>';
    return;
  }
  const max = rows[0].open;
  list.innerHTML = rows.map((r, i) => `
    <div class="k-lb-row">
      <div class="k-lb-rank">${String(i+1).padStart(2,'0')}</div>
      <div>
        <div class="k-lb-name">Ward ${r.ward}${r.overdue ? ' <span style="color:#E8524A;font-size:.78rem;font-family:var(--mono);">⚠ ' + r.overdue + ' overdue</span>' : ''}</div>
        <div class="k-lb-councillor">${esc(r.councillor)} · ${esc(r.party)}</div>
        <div class="k-lb-bar"><div class="k-lb-bar-fill" style="width:${(r.open/max*100).toFixed(1)}%"></div></div>
      </div>
      <div class="k-lb-count">${r.open}</div>
      <div class="k-lb-rate">${r.resolved} done</div>
    </div>
  `).join('');
}

function renderChain(){
  const chain = document.getElementById('k-chain');
  if (!chain) return;
  const nodes = [
    { icon:'🏛', name:'The Council', role:'23 elected ward councillors · Sets policy & budgets' },
    { icon:'👤', name:'Chairman', role:'Nabendu Mahali · Political head' },
    { icon:'📋', name:'Executive Officer (EO)', role:'WB Civil Service · Administrative head' },
    { icon:'🧹', name:'Sanitation Inspector (SI)', role:'Supervises waste, drainage, water' },
    { icon:'👷', name:'Sanitation Supervisors', role:'Ward Jamadars · Field coordination' },
    { icon:'🧑‍🔧', name:'Sanitation Staff', role:'Collection, sweeping, drain cleaning' }
  ];
  chain.innerHTML = nodes.map((n, i) => {
    const isLast = i === nodes.length - 1;
    const arrow = !isLast ? '<div class="k-chain-arrow">↓</div>' : '';
    return `<div class="k-chain-node">
      <div class="k-chain-icon">${n.icon}</div>
      <div class="k-chain-text">
        <div class="k-chain-name">${esc(n.name)}</div>
        <div class="k-chain-role">${esc(n.role)}</div>
      </div>
    </div>${arrow}`;
  }).join('') + `
    <div class="k-chain-note">
      <div class="k-chain-note-label">Also involved</div>
      <div class="k-chain-note-text">Clerical Staff — grievance tracking, attendance, inventory. Report to the Executive Officer, not the sanitation chain.</div>
    </div>`;
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
  const worst = Object.entries(stats).map(([w,c]) => ({ ward: parseInt(w), count: c })).sort((a,b) => b.count - a.count).slice(0, 5);
  const worstHtml = worst.length
    ? worst.map((w, i) => {
        const wd = wards[w.ward] || {};
        return `<div class="k-rep-worst-item">
          <span>${i+1}. Ward ${w.ward} · ${esc(wd.councillor_name || '—')}</span>
          <span class="k-rep-worst-count">${w.count}</span>
        </div>`;
      }).join('')
    : '<div style="padding:1rem 0;color:rgba(240,230,208,.4);font-size:.85rem;">No open reports.</div>';
  document.getElementById('k-rep-content').innerHTML = `
    <div class="k-rep-header">
      <div class="k-rep-avatar">${esc(rep.initials)}</div>
      <div>
        <div class="k-rep-name">${esc(rep.name)}</div>
        <div class="k-rep-role">${esc(rep.role)} · ${esc(rep.party)}</div>
      </div>
    </div>
    <div class="k-rep-stats">
      <div class="k-rep-stat"><div class="k-rep-stat-n">${active}</div><div class="k-rep-stat-l">Active</div></div>
      <div class="k-rep-stat"><div class="k-rep-stat-n">${total}</div><div class="k-rep-stat-l">Reports</div></div>
      <div class="k-rep-stat"><div class="k-rep-stat-n">${resolved}</div><div class="k-rep-stat-l">Resolved</div></div>
    </div>
    <div class="k-rep-worst-title">Worst wards</div>
    ${worstHtml}
  `;
  document.getElementById('k-rep-modal').classList.add('open');
}

function populateWardDropdown(){
  const sel = document.getElementById('k-ward');
  if (!sel) return;
  Object.values(wards).sort((a,b) => a.ward_no - b.ward_no).forEach(w => {
    const opt = document.createElement('option');
    opt.value = w.ward_no;
    opt.textContent = `Ward ${w.ward_no} — ${w.councillor_name}`;
    sel.appendChild(opt);
  });
}

/* ══════════════════════════════════════════════════════════
   MODAL FLOW
   ══════════════════════════════════════════════════════════ */
function openModal(){ document.getElementById('k-modal').classList.add('open'); goToStep(1); }
function closeModal(){ document.getElementById('k-modal').classList.remove('open'); }
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
    center: MAP_CENTER, zoom: 13, attributionControl: false
  });
  miniMap.on('load', () => {
    if (wardGeo){
      miniMap.addSource('wards-mini', { type:'geojson', data:wardGeo });
      miniMap.addLayer({ id:'wards-mini-line', type:'line', source:'wards-mini', paint:{ 'line-color':'rgba(212,136,42,.5)','line-width':1 }});
    }
  });
  miniMap.on('click', (e) => setLocation(e.lngLat.lat, e.lngLat.lng));
}

function setLocation(lat, lng){
  draft.lat = lat;
  draft.lng = lng;
  const autoWard = detectWard(lat, lng);
  if (autoWard && wards[autoWard]){
    draft.ward = autoWard;
    const sel = document.getElementById('k-ward');
    if (sel) sel.value = String(autoWard);
    showToast(`Ward ${autoWard} detected`);
  }
  document.getElementById('k-coords').textContent = `${lat.toFixed(5)}°N, ${lng.toFixed(5)}°E`;
  if (miniMap){
    if (miniMarker) miniMarker.remove();
    miniMarker = new maplibregl.Marker({ color:'#D4882A' }).setLngLat([lng, lat]).addTo(miniMap);
    miniMap.flyTo({ center: [lng, lat], zoom: 15 });
  }
  document.getElementById('k-next-2').disabled = false;
}

/* ══════════════════════════════════════════════════════════
   UI WIRING
   ══════════════════════════════════════════════════════════ */
function wireUI(){
  document.getElementById('k-intro-continue').addEventListener('click', () => {
    document.getElementById('k-intro').classList.remove('open');
    localStorage.setItem('kasa_intro_seen', '1');
  });
  document.getElementById('k-hero-cta').addEventListener('click', openModal);
  document.getElementById('k-map-report-btn').addEventListener('click', openModal);
  document.getElementById('k-nav-report').addEventListener('click', (e) => { e.preventDefault(); openModal(); });
  document.getElementById('k-modal-close').addEventListener('click', closeModal);
  document.getElementById('k-modal-backdrop').addEventListener('click', closeModal);
  document.getElementById('k-photo').addEventListener('change', handlePhoto);
  document.getElementById('k-next-1').addEventListener('click', () => goToStep(2));
  document.getElementById('k-next-2').addEventListener('click', () => goToStep(3));
  document.getElementById('k-gps-btn').addEventListener('click', detectGPS);
  document.getElementById('k-ward').addEventListener('change', (e) => {
    draft.ward = e.target.value ? parseInt(e.target.value) : null;
  });
  document.getElementById('k-severity').addEventListener('change', (e) => { draft.severity = e.target.value; });
  document.getElementById('k-submit').addEventListener('click', submitReport);
  document.getElementById('k-done-close').addEventListener('click', () => { closeModal(); resetDraft(); });
  document.getElementById('k-tweet-btn').addEventListener('click', () => {
    if (window._lastReport){
      const w = wards[window._lastReport.ward_no];
      openTweetComposer(window._lastReport, w);
    }
  });
  document.getElementById('k-filter-severity').addEventListener('change', (e) => { activeFilters.severity = e.target.value; renderMarkers(); });
  document.getElementById('k-filter-status').addEventListener('change', (e) => { activeFilters.status = e.target.value; renderMarkers(); });
  document.getElementById('k-search-ward').addEventListener('input', (e) => {
    const n = parseInt(e.target.value);
    activeFilters.ward = n || null;
    renderMarkers();
  });
  document.querySelectorAll('.k-lang-btn').forEach(btn => btn.addEventListener('click', () => setLang(btn.dataset.lang)));
  document.getElementById('k-qr-btn').addEventListener('click', () => {
    document.getElementById('k-qr-modal').classList.add('open');
    renderQR();
  });
  document.getElementById('k-qr-close').addEventListener('click', () => document.getElementById('k-qr-modal').classList.remove('open'));
  document.getElementById('k-qr-backdrop').addEventListener('click', () => document.getElementById('k-qr-modal').classList.remove('open'));
  document.querySelectorAll('[data-profile]').forEach(btn => btn.addEventListener('click', () => openRepProfile(btn.dataset.profile)));
  document.getElementById('k-rep-close').addEventListener('click', () => document.getElementById('k-rep-modal').classList.remove('open'));
  document.getElementById('k-rep-backdrop').addEventListener('click', () => document.getElementById('k-rep-modal').classList.remove('open'));

  document.addEventListener('click', (e) => {
    const upBtn = e.target.closest('[data-upvote]');
    if (upBtn){ handleUpvote(upBtn.dataset.upvote, upBtn); return; }
    const verifyBtn = e.target.closest('[data-verify]');
    if (verifyBtn){ handleVerify(verifyBtn.dataset.verify); return; }
    const flagBtn = e.target.closest('[data-flag]');
    if (flagBtn){ handleFlag(flagBtn.dataset.flag); return; }
    const shareBtn = e.target.closest('[data-share-url]');
    if (shareBtn){ handleShare(shareBtn.dataset.shareUrl, shareBtn.dataset.shareMsg); return; }
  });
}

function setupOfflineDetection(){
  const update = () => {
    const el = document.getElementById('k-offline');
    if (el) el.hidden = navigator.onLine;
  };
  window.addEventListener('online', () => { update(); syncOfflineQueue(); });
  window.addEventListener('offline', update);
  update();
}

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

function detectGPS(){
  const btn = document.getElementById('k-gps-btn');
  if (!navigator.geolocation){ showToast('GPS not available'); return; }
  btn.textContent = '⟳ Locating…';
  navigator.geolocation.getCurrentPosition(
    (pos) => { btn.textContent = '✓ Location captured'; setLocation(pos.coords.latitude, pos.coords.longitude); },
    (err) => { btn.textContent = '⊕ Use my location'; showToast(err.code === 1 ? 'Permission denied' : 'GPS failed'); },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

async function submitReport(){
  if (!draft.photoBlob){ showToast('Please add a photo'); return; }
  if (draft.lat === null || draft.lng === null){ showToast('Please set a location'); return; }
  if (!draft.ward){ showToast('Please select a ward'); return; }

  const submitBtn = document.getElementById('k-submit');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Checking photo…';

  let moderation;
  try { moderation = await moderatePhoto(draft.photoBlob); }
  catch(e){ moderation = { approved: true, reason: null, labels: {} }; }

  if (!moderation.approved){
    showToast(`Photo rejected: ${moderation.reason}`);
    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit Report →';
    return;
  }

  submitBtn.textContent = 'Checking for duplicates…';

  let parentId = null;
  if (navigator.onLine){
    try {
      const { data: nearby } = await sb.rpc('find_nearby_report', {
        p_lat: draft.lat, p_lng: draft.lng,
        p_radius_meters: DUPLICATE_RADIUS_M, p_hours: DUPLICATE_HOURS
      });
      if (nearby) parentId = nearby;
    } catch(e){}
  }

  const desc = document.getElementById('k-desc').value.trim();
  const name = document.getElementById('k-name').value.trim();

  const report = {
    id: 'R' + Date.now(),
    lat: draft.lat, lng: draft.lng, ward_no: draft.ward,
    severity: draft.severity, description: desc || null,
    reporter_name: name || null, reporter_hash: reporterHash,
    created_at: new Date().toISOString(),
    parent_report_id: parentId, is_duplicate: !!parentId,
    photoBlob: draft.photoBlob,
    moderation_status: moderation.approved ? 'approved' : 'pending',
    moderation_labels: moderation.labels || {}
  };

  if (navigator.onLine){
    try {
      await syncReportToServer(report);
      submitBtn.textContent = 'Submit Report →';
      submitBtn.disabled = false;
      await afterSubmit(report, parentId);
      const tweetBtn = document.getElementById('k-tweet-btn');
      if (tweetBtn){ tweetBtn.style.display = 'block'; window._lastReport = report; }
      return;
    } catch(e){ console.warn('Online submit failed, queuing', e); }
  }

  await queuePendingReport(report);
  submitBtn.textContent = 'Submit Report →';
  submitBtn.disabled = false;
  await afterSubmit(report, parentId, true);
}

async function syncReportToServer(report){
  const filename = `reports/${report.id}.jpg`;
  const { error: upErr } = await sb.storage.from('kasa-photos').upload(filename, report.photoBlob, { contentType:'image/jpeg', upsert:true });
  if (upErr) throw upErr;
  const { data: urlData } = sb.storage.from('kasa-photos').getPublicUrl(filename);

  const { error: insErr } = await sb.from('reports').insert({
    lat: report.lat, lng: report.lng, ward_no: report.ward_no,
    severity: report.severity, description: report.description,
    reporter_name: report.reporter_name, reporter_hash: report.reporter_hash,
    photo_url: urlData.publicUrl, status: 'open',
    upvotes: 0, flags: 0, sla_days: DEFAULT_SLA_DAYS,
    parent_report_id: report.parent_report_id || null,
    is_duplicate: report.is_duplicate || false,
    sync_status: 'synced',
    moderation_status: report.moderation_status || 'pending',
    moderation_labels: report.moderation_labels || {}
  });
  if (insErr) throw insErr;
}

async function afterSubmit(report, parentId, isPending){
  await loadReports();
  updateStats();
  renderLeaderboard();
  renderTicker();

  const w = wards[report.ward_no] || { councillor_name:'—' };
  const msg = `Garbage report — Purulia Kasa\nWard: ${report.ward_no} (${w.councillor_name})\nLocation: ${report.lat.toFixed(5)},${report.lng.toFixed(5)}\nSeverity: ${report.severity}\n${report.description || ''}\nMap: https://www.google.com/maps?q=${report.lat},${report.lng}`;
  document.getElementById('k-wa-escalate').href = `https://wa.me/${MUNICIPALITY_PHONE}?text=${encodeURIComponent(msg)}`;

  const doneTitle = document.getElementById('k-done-title');
  const doneSub = document.getElementById('k-done-sub');
  if (isPending){
    if (doneTitle) doneTitle.textContent = 'Saved offline';
    if (doneSub) doneSub.textContent = 'Will upload automatically when you are back online.';
  } else if (parentId){
    if (doneTitle) doneTitle.textContent = 'Report added';
    if (doneSub) doneSub.textContent = 'Similar nearby report found — linked to it.';
  }

  goToStep('done');
  showToast(isPending ? 'Saved offline' : 'Report filed');
}

/* ══════════════════════════════════════════════════════════
   AUTO-TWEET
   ══════════════════════════════════════════════════════════ */
function openTweetComposer(report, ward){
  const councillor = ward?.councillor_name || 'Ward Councillor';
  const text = [
    `🗑️ New garbage report in Ward ${report.ward_no}, Purulia`,
    `Councillor: ${councillor}`,
    `Severity: ${report.severity}`,
    report.description ? `"${report.description.slice(0, 80)}"` : '',
    `Reported via @PuruliaKasa`
  ].filter(Boolean).join('\n');
  const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&via=${MLA_TWITTER_HANDLE}`;
  window.open(url, '_blank');
}

/* ══════════════════════════════════════════════════════════
   UPVOTE / FLAG / VERIFY / SHARE
   ══════════════════════════════════════════════════════════ */
async function handleUpvote(reportId, btn){
  if (userUpvotes.has(reportId)){ showToast('Already upvoted'); return; }
  const r = reports.find(x => x.id === reportId);
  if (!r) return;
  btn.disabled = true;
  const { data: wasInserted } = await sb.rpc('upvote_report', {
    p_report_id: reportId, p_reporter_hash: reporterHash
  });
  if (wasInserted){
    r.upvotes = (r.upvotes || 0) + 1;
    userUpvotes.add(reportId);
    saveUpvotes();
    btn.classList.add('upvoted');
    btn.innerHTML = `<span>👍</span> You saw this · ${r.upvotes}`;
    showToast('Upvote counted');
  } else {
    userUpvotes.add(reportId);
    saveUpvotes();
    showToast('You already upvoted this');
  }
  btn.disabled = false;
}

async function handleFlag(reportId){
  const r = reports.find(x => x.id === reportId);
  if (!r) return;
  const { data: wasInserted } = await sb.rpc('flag_report', {
    p_report_id: reportId, p_reporter_hash: reporterHash, p_reason: null
  });
  if (wasInserted){
    r.flags = (r.flags || 0) + 1;
    showToast('Flagged — thank you');
  } else {
    showToast('You already flagged this');
  }
}

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
        canvas.toBlob(async (blob) => { await commitResolve(reportId, blob); }, 'image/jpeg', 0.75);
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  };
  input.click();
}

async function commitResolve(reportId, blob){
  showToast('Uploading proof for review…');
  const filename = `resolutions/${reportId}-${Date.now()}.jpg`;
  const { error: upErr } = await sb.storage.from('kasa-photos').upload(filename, blob, { contentType:'image/jpeg' });
  if (upErr){ showToast('Upload failed'); return; }
  const { data: urlData } = sb.storage.from('kasa-photos').getPublicUrl(filename);
  const { error: rpcErr } = await sb.rpc('submit_resolution', {
    p_report_id: reportId,
    p_resolved_photo_url: urlData.publicUrl,
    p_submitted_by: reporterHash
  });
  if (rpcErr){
    showToast(rpcErr.message.includes('attempts') ? 'Max retries reached' : 'Could not submit');
    return;
  }
  await loadReports();
  updateStats();
  renderLeaderboard();
  renderTicker();
  showToast('Submitted for verification');
}

function handleShare(url, msg){
  if (navigator.share){ navigator.share({ title:'Purulia Kasa', text: msg, url }).catch(() => {}); return; }
  navigator.clipboard.writeText(url).then(() => showToast('Link copied'));
}

function renderQR(){
  const wrap = document.getElementById('k-qr-wrap');
  const urlEl = document.getElementById('k-qr-url');
  if (!wrap || !urlEl) return;
  wrap.innerHTML = '';
  urlEl.textContent = KASA_PAGE_URL;
  if (window.QRCode){
    const canvas = document.createElement('canvas');
    wrap.appendChild(canvas);
    window.QRCode.toCanvas(canvas, KASA_PAGE_URL, { width:220, margin:1, color:{ dark:'#0a0805', light:'#f0e6d0' }});
  }
}

function resetDraft(){
  draft = { photoBlob:null, lat:null, lng:null, ward:null, severity:'minor' };
  ['k-photo','k-desc','k-name','k-ward'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const pp = document.getElementById('k-photo-preview'); if (pp) pp.innerHTML = '';
  const co = document.getElementById('k-coords'); if (co) co.textContent = 'No location set yet';
  const n1 = document.getElementById('k-next-1'); if (n1) n1.disabled = true;
  const n2 = document.getElementById('k-next-2'); if (n2) n2.disabled = true;
  const sb1 = document.getElementById('k-submit'); if (sb1){ sb1.disabled = false; sb1.textContent = 'Submit Report →'; }
  const gb = document.getElementById('k-gps-btn'); if (gb) gb.textContent = '⊕ Use my location';
  const sv = document.getElementById('k-severity'); if (sv) sv.value = 'minor';
  const tw = document.getElementById('k-tweet-btn'); if (tw) tw.style.display = 'none';
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

/* ── Reps ── */
const REPS = {
  mla: { name:'Sudip Kumar Mukherjee', role:'MLA · Purulia (No. 242)', party:'BJP', initials:'SKM', scope:'constituency' },
  mp: { name:'Jyotirmay Singh Mahato', role:'MP · Purulia (Lok Sabha)', party:'BJP', initials:'JSM', scope:'constituency' },
  chairman: { name:'Nabendu Mahali', role:'Chairman · Purulia Municipality', party:'AITC', initials:'NM', scope:'municipality' }
};

/* ══════════════════════════════════════════════════════════
   i18n
   ══════════════════════════════════════════════════════════ */
const I18N = {
  en: {
    nav_home:'Home', nav_blueprint:'Blueprint', nav_map:'Map', nav_kasa:'Kasa', nav_report:'Report →',
    intro_title:'Purulia has a garbage problem.',
    intro_sub:'Report it. Photograph it. Track who is responsible.',
    intro_meta:'Every dump is mapped to the responsible ward, councillor, MLA, and MP. When enough citizens report, it becomes impossible to ignore.',
    intro_stats:'23 wards · 1 Chairman · 1 MLA · 1 MP · All of Purulia',
    intro_cta:'Continue to Map →',
    hero_l1:'See garbage?', hero_l2:'Report it in 30 seconds.',
    hero_sub:'A public map for Purulia town. Every report is visible. Every ward is ranked. Your councillor is notified.',
    hero_cta:'Report Now',
    pill_active:'Active', pill_reports:'Reports',
    filter_all_sev:'All Severity', filter_all_status:'All Status',
    sev_minor:'Minor', sev_severe:'Severe', sev_critical:'Critical',
    status_open:'Open', status_resolved:'Resolved',
    map_report:'Report',
    stat_reports:'Reports', stat_resolved:'Resolved', stat_wards:'Wards active', stat_rate:'Resolution %',
    lb_title:'Ward accountability', lb_sub:'Ranked by open reports. The higher the bar, the more attention needed.', lb_loading:'Loading…',
    chain_title:"Who's responsible", chain_sub:'The chain of accountability for garbage in Purulia.',
    auth_title:'Elected representatives', auth_mla:'MLA · Purulia', auth_mp:'MP · Purulia', auth_chairman:'Chairman · Municipality',
    auth_chairman_meta:'AITC · Board reinstated by Calcutta HC, 2026', auth_view:'View →',
    footer_left:'Purulia Kasa · A civic tool for Purulia town',
    qr_btn:'Scan QR to Report', qr_title:'Share Purulia Kasa', qr_sub:'Point a phone camera at this QR code to open the report page.',
    step1_title:'Take a photo', step1_sub:'Point at the garbage. Tap to capture.', step1_photo:'Tap to take or choose a photo',
    step2_title:'Pin the location', step2_sub:"We'll capture GPS. If it fails, tap the map below.", step2_gps:'⊕ Use my location',
    step2_no_loc:'No location set yet', step2_ward:'Ward', step2_sev:'Severity',
    sev_minor_long:'Minor — small pile, not blocking', sev_severe_long:'Severe — large dump, health risk', sev_critical_long:'Critical — blocking road, dangerous',
    step3_title:"What's the problem?", step3_sub:'Optional. One sentence is enough.', step3_name:'Your name (optional)', step3_submit:'Submit Report →',
    step3_privacy:'🔒 Photo, location and ward are public. Your name is never shown unless you add it.',
    done_title:'Report filed', done_sub:"It's now on the public map. The Municipality has been notified.",
    done_wa:'Notify Municipality on WhatsApp →', done_close:'Done',
    continue:'Continue →'
  },
  bn: {
    nav_home:'হোম', nav_blueprint:'ব্লুপ্রিন্ট', nav_map:'ম্যাপ', nav_kasa:'কাসা', nav_report:'রিপোর্ট →',
    intro_title:'পুরুলিয়ায় আবর্জনার সমস্যা আছে।',
    intro_sub:'রিপোর্ট করুন। ছবি তুলুন। কে দায়ী তা দেখুন।',
    intro_meta:'প্রতিটি আবর্জনা সংশ্লিষ্ট ওয়ার্ড, কাউন্সিলর, বিধায়ক এবং সাংসদের সাথে ম্যাপ করা হয়েছে।',
    intro_stats:'২৩ ওয়ার্ড · ১ চেয়ারম্যান · ১ বিধায়ক · ১ সাংসদ',
    intro_cta:'ম্যাপে যান →',
    hero_l1:'আবর্জনা দেখছেন?', hero_l2:'৩০ সেকেন্ডে রিপোর্ট করুন।',
    hero_sub:'পুরুলিয়া শহরের জন্য একটি পাবলিক ম্যাপ।',
    hero_cta:'রিপোর্ট করুন',
    pill_active:'সক্রিয়', pill_reports:'রিপোর্ট',
    filter_all_sev:'সব তীব্রতা', filter_all_status:'সব অবস্থা',
    sev_minor:'সামান্য', sev_severe:'গুরুতর', sev_critical:'সংকটপূর্ণ',
    status_open:'খোলা', status_resolved:'সমাধান',
    map_report:'রিপোর্ট',
    stat_reports:'রিপোর্ট', stat_resolved:'সমাধান', stat_wards:'সক্রিয় ওয়ার্ড', stat_rate:'সমাধানের হার',
    lb_title:'ওয়ার্ড জবাবদিহিতা', lb_sub:'খোলা রিপোর্ট অনুযায়ী র‍্যাংক করা।', lb_loading:'লোড হচ্ছে…',
    chain_title:'কে দায়ী', chain_sub:'পুরুলিয়ায় আবর্জনার জন্য জবাবদিহিতার চেইন।',
    auth_title:'নির্বাচিত প্রতিনিধি', auth_mla:'বিধায়ক · পুরুলিয়া', auth_mp:'সাংসদ · পুরুলিয়া', auth_chairman:'চেয়ারম্যান · পুরসভা',
    auth_chairman_meta:'AITC · কলকাতা হাইকোর্ট পুনর্বহাল করেছে', auth_view:'দেখুন →',
    footer_left:'পুরুলিয়া কাসা · পুরুলিয়ার জন্য একটি নাগরিক টুল',
    qr_btn:'QR স্ক্যান করুন', qr_title:'পুরুলিয়া কাসা শেয়ার করুন', qr_sub:'ফোন ক্যামেরা QR দিকে ধরুন।',
    step1_title:'ছবি তুলুন', step1_sub:'আবর্জনার দিকে তাক করুন।', step1_photo:'ছবি তুলতে ট্যাপ করুন',
    step2_title:'লোকেশন পিন করুন', step2_sub:'GPS নেওয়া হবে।', step2_gps:'⊕ আমার লোকেশন',
    step2_no_loc:'লোকেশন সেট করা হয়নি', step2_ward:'ওয়ার্ড', step2_sev:'তীব্রতা',
    sev_minor_long:'সামান্য — ছোট স্তূপ', sev_severe_long:'গুরুতর — বড় ডাম্প', sev_critical_long:'সংকটপূর্ণ — রাস্তা ব্লক',
    step3_title:'সমস্যা কী?', step3_sub:'ঐচ্ছিক।', step3_name:'আপনার নাম (ঐচ্ছিক)', step3_submit:'রিপোর্ট জমা দিন →',
    step3_privacy:'🔒 ছবি, লোকেশন এবং ওয়ার্ড পাবলিক।',
    done_title:'রিপোর্ট জমা হয়েছে', done_sub:'এখন ম্যাপে দৃশ্যমান।',
    done_wa:'হোয়াটসঅ্যাপে পুরসভাকে জানান →', done_close:'সম্পন্ন',
    continue:'চালিয়ে যান →'
  },
  hi: {
    nav_home:'होम', nav_blueprint:'ब्लूप्रिंट', nav_map:'मैप', nav_kasa:'कासा', nav_report:'रिपोर्ट →',
    intro_title:'पुरुलिया में कचरे की समस्या है।',
    intro_sub:'रिपोर्ट करें। फोटो लें। जवाबदेही ट्रैक करें।',
    intro_meta:'हर कचरा संबंधित वार्ड, पार्षद, विधायक और सांसद से जुड़ा है।',
    intro_stats:'23 वार्ड · 1 अध्यक्ष · 1 विधायक · 1 सांसद',
    intro_cta:'मैप पर जाएं →',
    hero_l1:'कचरा दिखा?', hero_l2:'30 सेकंड में रिपोर्ट करें।',
    hero_sub:'पुरुलिया शहर के लिए एक सार्वजनिक मैप।',
    hero_cta:'रिपोर्ट करें',
    pill_active:'सक्रिय', pill_reports:'रिपोर्ट',
    filter_all_sev:'सभी गंभीरता', filter_all_status:'सभी स्थिति',
    sev_minor:'मामूली', sev_severe:'गंभीर', sev_critical:'संकटपूर्ण',
    status_open:'खुला', status_resolved:'हल',
    map_report:'रिपोर्ट',
    stat_reports:'रिपोर्ट', stat_resolved:'हल', stat_wards:'सक्रिय वार्ड', stat_rate:'समाधान %',
    lb_title:'वार्ड जवाबदेही', lb_sub:'खुले रिपोर्ट के अनुसार रैंक।', lb_loading:'लोड हो रहा है…',
    chain_title:'कौन जिम्मेदार', chain_sub:'पुरुलिया में कचरे के लिए जवाबदेही श्रृंखला।',
    auth_title:'निर्वाचित प्रतिनिधि', auth_mla:'विधायक · पुरुलिया', auth_mp:'सांसद · पुरुलिया', auth_chairman:'अध्यक्ष · नगरपालिका',
    auth_chairman_meta:'AITC · कलकत्ता HC ने बहाल किया', auth_view:'देखें →',
    footer_left:'पुरुलिया कासा · पुरुलिया के लिए नागरिक उपकरण',
    qr_btn:'QR स्कैन करें', qr_title:'पुरुलिया कासा शेयर करें', qr_sub:'फोन कैमरा QR पर रखें।',
    step1_title:'फोटो लें', step1_sub:'कचरे की ओर इशारा करें।', step1_photo:'फोटो के लिए टैप करें',
    step2_title:'स्थान पिन करें', step2_sub:'GPS लिया जाएगा।', step2_gps:'⊕ मेरा स्थान',
    step2_no_loc:'स्थान सेट नहीं', step2_ward:'वार्ड', step2_sev:'गंभीरता',
    sev_minor_long:'मामूली — छोटा ढेर', sev_severe_long:'गंभीर — बड़ा डंप', sev_critical_long:'संकटपूर्ण — सड़क बंद',
    step3_title:'समस्या क्या है?', step3_sub:'वैकल्पिक।', step3_name:'आपका नाम (वैकल्पिक)', step3_submit:'रिपोर्ट जमा करें →',
    step3_privacy:'🔒 फोटो, स्थान और वार्ड सार्वजनिक।',
    done_title:'रिपोर्ट दर्ज', done_sub:'अब मैप पर दिख रही है।',
    done_wa:'व्हाट्सएप पर नगरपालिका को सूचित करें →', done_close:'हो गया',
    continue:'जारी रखें →'
  }
};

/* ══════════════════════════════════════════════════════════
   MODERATION
   ══════════════════════════════════════════════════════════ */
const VISION_ENDPOINT = () => `https://vision.googleapis.com/v1/images:annotate?key=${window.KASA_CONFIG.VISION_API_KEY}`;

async function moderatePhoto(blob){
  const result = { approved: false, reason: null, labels: {} };

  /* Basic size check */
  if (blob.size < 10000){
    result.reason = 'Image too small';
    return result;
  }
  if (blob.size > 8 * 1024 * 1024){
    result.reason = 'Image too large';
    return result;
  }

  /* Google Vision SafeSearch (optional) */
  if (window.KASA_CONFIG.VISION_API_KEY){
    try {
      const base64 = await blobToBase64(blob);
      const res = await fetch(VISION_ENDPOINT(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{
            image: { content: base64.split(',')[1] },
            features: [{ type: 'SAFE_SEARCH_DETECTION' }]
          }]
        })
      });
      if (res.ok){
        const data = await res.json();
        const safe = data.responses?.[0]?.safeSearchAnnotation || {};
        result.labels.vision = safe;

        if (safe.adult === 'LIKELY' || safe.adult === 'VERY_LIKELY'){
          result.reason = 'Image flagged as adult content';
          return result;
        }
        if (safe.violence === 'LIKELY' || safe.violence === 'VERY_LIKELY'){
          result.reason = 'Image flagged as violent content';
          return result;
        }
      }
    } catch(e){
      console.warn('Vision check failed, proceeding', e);
    }
  }

  result.approved = true;
  return result;
}

function blobToBase64(blob){
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

/* ══════════════════════════════════════════════════════════
   INIT
   ══════════════════════════════════════════════════════════ */
async function init(){
  reporterHash = await getReporterHash();
  loadUpvotes();
  loadLang();
  applyLang();
  await loadWards();
  await loadWardGeo();
  initMainMap();
  await loadReports();
  populateWardDropdown();
  updateStats();
  renderLeaderboard();
  renderChain();
  renderTicker();
  wireUI();
  checkIntro();
  setupOfflineDetection();
  syncOfflineQueue();

  setTimeout(() => {
    const ld = document.getElementById('k-loader');
    if (ld){ ld.classList.add('hidden'); setTimeout(() => ld.remove(), 500); }
  }, 800);

  /* Weekly digest prompt after everything settles */
  setTimeout(() => { checkWeeklyDigest(); }, 8000);
}

/* ── Reporter fingerprint ── */
async function getReporterHash(){
  let hash = localStorage.getItem('kasa_reporter_hash');
  if (hash) return hash;
  const seed = [
    navigator.userAgent,
    screen.width + 'x' + screen.height,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    navigator.language,
    Math.random().toString(36).slice(2)
  ].join('|');
  const buf = new TextEncoder().encode(seed);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  hash = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2,'0')).join('').slice(0, 16);
  localStorage.setItem('kasa_reporter_hash', hash);
  return hash;
}

/* ── Language ── */
function loadLang(){
  currentLang = localStorage.getItem('kasa_lang') || 'en';
  document.documentElement.lang = currentLang;
}
function applyLang(){
  const s = I18N[currentLang] || I18N.en;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const k = el.dataset.i18n;
    if (s[k]) el.textContent = s[k];
  });
  document.querySelectorAll('.k-lang-btn').forEach(b => {
    b.classList.toggle('k-lang-active', b.dataset.lang === currentLang);
  });
}
function setLang(lang){
  if (!I18N[lang]) return;
  currentLang = lang;
  localStorage.setItem('kasa_lang', lang);
  document.documentElement.lang = lang;
  applyLang();
  renderChain();
  renderLeaderboard();
  renderTicker();
}

/* ── Intro ── */
function checkIntro(){
  const force = new URLSearchParams(window.location.search).get('intro') === '1';
  if (!force && localStorage.getItem('kasa_intro_seen')) return;
  const show = () => { const el = document.getElementById('k-intro'); if (el) el.classList.add('open'); };
  if (document.readyState === 'complete') setTimeout(show, 600);
  else window.addEventListener('load', () => setTimeout(show, 600));
}

/* ── Upvotes ── */
function loadUpvotes(){ try { userUpvotes = new Set(JSON.parse(localStorage.getItem('kasa_upvotes')||'[]')); } catch(e){} }
function saveUpvotes(){ try { localStorage.setItem('kasa_upvotes', JSON.stringify([...userUpvotes])); } catch(e){} }

/* ══════════════════════════════════════════════════════════
   WARDS + GEO
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
    console.info('Kasa: ward boundaries loaded', wardGeo.features.length);
  } catch(e){ console.info('Kasa: no ward GeoJSON'); }
}

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
  if (polygon.type === 'MultiPolygon') return polygon.coordinates.some(r => pointInRing(pt, r[0]));
  return false;
}
function detectWard(lat, lng){
  if (!wardGeo || !wardGeo.features) return null;
  for (const f of wardGeo.features){
    if (pointInPolygon([lng, lat], f.geometry)){
      const p = f.properties || {};
      const n = p.ward || p.WARD || p.ward_no;
      if (n) return parseInt(String(n).replace(/\D/g, ''), 10);
    }
  }
  return null;
}

/* ══════════════════════════════════════════════════════════
   LOAD REPORTS
   ══════════════════════════════════════════════════════════ */
async function loadReports(){
  const pending = await getPendingReports();
  const { data, error } = await sb
    .from('reports')
    .select('*')
    .neq('moderation_status', 'rejected')
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) console.error('Reports load failed', error);
  reports = [...(data || [])];
  for (const p of pending){
    reports.unshift({
      id: p.id, lat: p.lat, lng: p.lng, ward_no: p.ward_no,
      severity: p.severity, description: p.description,
      reporter_name: p.reporter_name,
      photo_url: URL.createObjectURL(p.photoBlob),
      status: 'open', created_at: p.created_at,
      sync_status: 'pending'
    });
  }
  renderMarkers();
}

/* ══════════════════════════════════════════════════════════
   OFFLINE QUEUE
   ══════════════════════════════════════════════════════════ */
async function getPendingReports(){
  try { return await idbKeyval.get('pending_reports') || []; }
  catch(e){ return []; }
}
async function queuePendingReport(report){
  const pending = await getPendingReports();
  pending.push(report);
  await idbKeyval.set('pending_reports', pending);
}
async function removePendingReport(id){
  const pending = await getPendingReports();
  await idbKeyval.set('pending_reports', pending.filter(p => p.id !== id));
}
async function syncOfflineQueue(){
  if (!navigator.onLine) return;
  const pending = await getPendingReports();
  if (!pending.length) return;
  showToast(`Syncing ${pending.length} offline report(s)…`);
  for (const p of pending){
    try {
      await syncReportToServer(p);
      await removePendingReport(p.id);
    } catch(e){ console.warn('Sync failed', p.id, e); }
  }
  await loadReports();
  updateStats();
  renderLeaderboard();
  renderTicker();
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
    if (wardGeo){
      mainMap.addSource('wards', { type: 'geojson', data: wardGeo });
      mainMap.addLayer({ id:'wards-fill', type:'fill', source:'wards', paint:{ 'fill-color':'#d4882a','fill-opacity':0.04 }});
      mainMap.addLayer({ id:'wards-line', type:'line', source:'wards', paint:{ 'line-color':'rgba(212,136,42,.4)','line-width':1 }});

      mainMap.on('click', 'wards-fill', (e) => {
        const ward = e.features[0].properties.ward;
        if (!ward) return;
        activeFilters.ward = parseInt(ward);
        const inp = document.getElementById('k-search-ward');
        if (inp) inp.value = ward;
        renderMarkers();
        showToast(`Filtering Ward ${ward}`);
      });
      mainMap.on('mouseenter', 'wards-fill', () => { mainMap.getCanvas().style.cursor = 'pointer'; });
      mainMap.on('mouseleave', 'wards-fill', () => { mainMap.getCanvas().style.cursor = ''; });
    }

    mainMap.addSource('reports', { type:'geojson', data:{ type:'FeatureCollection', features:[] }});
    mainMap.addLayer({
      id: 'reports-halo', type: 'circle', source: 'reports',
      paint: { 'circle-radius':14, 'circle-color': severityColor(), 'circle-opacity':0.18 }
    });
    mainMap.addLayer({
      id: 'reports-core', type: 'circle', source: 'reports',
      paint: {
        'circle-radius':6,
        'circle-color': severityColor(),
        'circle-stroke-color': ['case', ['==', ['get','sync_status'], 'pending'], '#E88A4A', 'rgba(255,255,255,.3)'],
        'circle-stroke-width': ['case', ['==', ['get','sync_status'], 'pending'], 2, 1]
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
    if (r.moderation_status === 'rejected') return false;
    if (activeFilters.severity && r.severity !== activeFilters.severity) return false;
    if (activeFilters.status && r.status !== activeFilters.status) return false;
    if (activeFilters.ward && r.ward_no !== activeFilters.ward) return false;
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
        id: r.id, status: r.status, severity: r.severity || 'minor',
        ward_no: r.ward_no, description: r.description || '',
        photo_url: r.photo_url || '', reporter_name: r.reporter_name || '',
        created_at: r.created_at, resolved_photo_url: r.resolved_photo_url || '',
        upvotes: r.upvotes || 0, flags: r.flags || 0,
        lat: r.lat, lng: r.lng, sync_status: r.sync_status || 'synced'
      }
    }));
  mainMap.getSource('reports').setData({ type: 'FeatureCollection', features });
  renderTicker();
}

/* ══════════════════════════════════════════════════════════
   TICKER
   ══════════════════════════════════════════════════════════ */
function renderTicker(){
  const track = document.getElementById('k-ticker-track');
  if (!track) return;
  if (!reports.length){
    track.innerHTML = '<span class="k-ticker-item">No reports yet — be the first</span>';
    return;
  }
  const recent = reports.slice(0, 10);
  const items = recent.map(r => {
    const color = r.status === 'resolved' ? '#6DB88A' :
      r.severity === 'critical' ? '#E8524A' :
      r.severity === 'severe' ? '#E88A4A' : '#D4882A';
    const days = Math.floor((Date.now() - new Date(r.created_at).getTime()) / 86400000);
    const w = wards[r.ward_no] || {};
    const statusText = r.sync_status === 'pending' ? 'Pending sync' :
      r.status === 'resolved' ? 'Resolved' : `${days}d open`;
    return `<span class="k-ticker-item">
      <i class="k-ticker-dot" style="background:${color}"></i>
      Ward ${r.ward_no || '?'} · ${esc(w.councillor_name || 'Unknown')} · ${statusText}
    </span>`;
  }).join('');
  track.innerHTML = items + items;
}

/* ══════════════════════════════════════════════════════════
   POPUP
   ══════════════════════════════════════════════════════════ */
function openReportPopup(props, coords){
  const w = wards[props.ward_no] || { councillor_name:'—', party:'—' };
  const date = props.created_at ? new Date(props.created_at).toLocaleDateString() : '';
  const daysOpen = props.created_at ? Math.floor((Date.now() - new Date(props.created_at).getTime()) / 86400000) : 0;
  const sla = DEFAULT_SLA_DAYS;
  const slaRemaining = Math.max(0, sla - daysOpen);
  const slaStatus = props.status === 'resolved' ? 'resolved'
    : slaRemaining === 0 ? 'overdue'
    : slaRemaining <= 2 ? 'warning' : 'ontrack';
  const slaColors = { resolved:'#6DB88A', overdue:'#E8524A', warning:'#E88A4A', ontrack:'#D4882A' };
  const slaLabels = {
    resolved: `Resolved in ${daysOpen}d`,
    overdue: `SLA overdue by ${daysOpen - sla}d`,
    warning: `${slaRemaining}d left to SLA`,
    ontrack: `${slaRemaining}d left to SLA`
  };

  const photo = props.photo_url ? `<img class="k-popup-img" src="${esc(props.photo_url)}" alt="">` : '';
  const pendingBadge = props.sync_status === 'pending'
    ? '<div style="background:rgba(232,138,74,.15);border-bottom:1px solid #E88A4A;color:#E88A4A;font-size:11px;padding:.4rem .6rem;text-align:center;letter-spacing:.14em;text-transform:uppercase;font-family:var(--mono);">Pending sync</div>'
    : '';

  let sevClass = 'k-popup-sev-minor';
  if (props.status === 'resolved') sevClass = 'k-popup-sev-resolved';
  else if (props.severity === 'critical') sevClass = 'k-popup-sev-critical';
  else if (props.severity === 'severe') sevClass = 'k-popup-sev-severe';

  const hasUpvoted = userUpvotes.has(props.id);
  const isPending = props.sync_status === 'pending';

  let actionsHtml = '';
  if (props.status === 'resolved'){
    actionsHtml = `<span class="k-popup-btn" style="border-color:#6DB88A;color:#6DB88A;cursor:default;">✓ Resolved</span>`;
  } else if (isPending){
    actionsHtml = `<span class="k-popup-btn" style="border-color:#E88A4A;color:#E88A4A;cursor:default;">Awaiting upload</span>`;
  } else {
    actionsHtml = `
      <button class="k-popup-btn k-btn-verify" data-verify="${esc(props.id)}">Verify Cleanup</button>
      <button class="k-popup-btn k-btn-flag" data-flag="${esc(props.id)}">Flag</button>`;
  }

  const shareUrl = `${KASA_PAGE_URL}?report=${props.id}`;
  const shareMsg = `Garbage in Ward ${props.ward_no} — Purulia Kasa`;

  const html = `
    <div class="k-popup">
      ${photo}
      ${pendingBadge}
      <div class="k-popup-body">
        <div class="k-popup-severity ${sevClass}">${props.status === 'resolved' ? 'Resolved' : (props.severity || 'Minor')}</div>
        <div class="k-popup-title">Ward ${esc(props.ward_no || '—')} · ${esc(w.councillor_name)} · ${esc(w.party)}</div>
        <div class="k-popup-desc">${esc(props.description) || 'Garbage reported'}</div>
        <div class="k-popup-meta">${date} · ${esc(slaLabels[slaStatus])}<br>${props.reporter_name ? '— ' + esc(props.reporter_name) : 'Anonymous'}</div>
        <div style="background:rgba(${slaStatus === 'overdue' ? '232,82,74' : slaStatus === 'warning' ? '232,138,74' : '212,136,42'},.08);border-left:2px solid ${slaColors[slaStatus]};padding:.55rem .75rem;font-size:11px;color:${slaColors[slaStatus]};margin-bottom:.7rem;font-family:var(--mono);letter-spacing:.04em;">SLA: ${slaLabels[slaStatus]}</div>
        <button class="k-popup-upvote ${hasUpvoted ? 'upvoted' : ''}" data-upvote="${esc(props.id)}">
          <span>👍</span> ${hasUpvoted ? 'You saw this' : 'I saw this too'} · ${props.upvotes || 0}
        </button>
        <div class="k-popup-actions">${actionsHtml}</div>
        <button class="k-popup-btn" style="margin-top:.5rem;" data-share-url="${esc(shareUrl)}" data-share-msg="${esc(shareMsg)}">Share report</button>
        <a class="k-popup-btn" style="margin-top:.5rem;" href="https://www.google.com/maps?q=${props.lat || coords[1]},${props.lng || coords[0]}" target="_blank" rel="noopener">Get directions</a>
      </div>
    </div>`;

  new maplibregl.Popup({ closeButton: true, maxWidth: '320px', offset: 12 })
    .setLngLat(coords).setHTML(html).addTo(mainMap);
}

/* ══════════════════════════════════════════════════════════
   STATS + LEADERBOARD + CHAIN
   ══════════════════════════════════════════════════════════ */
function updateStats(){
  const total = reports.length;
  const resolved = reports.filter(r => r.status === 'resolved').length;
  const active = total - resolved;
  const wardsActive = new Set(reports.map(r => r.ward_no).filter(Boolean)).size;
  const rate = total ? Math.round((resolved / total) * 100) : 0;
  document.getElementById('k-stat-total').textContent = total;
  document.getElementById('k-stat-resolved').textContent = resolved;
  document.getElementById('k-stat-wards').textContent = wardsActive;
  document.getElementById('k-stat-rate').textContent = rate + '%';
  document.getElementById('k-pill-active').textContent = active;
  document.getElementById('k-pill-total').textContent = total;
}

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
    if (!stats[r.ward_no]) stats[r.ward_no] = { open:0, resolved:0, overdue:0 };
    if (r.status === 'resolved') stats[r.ward_no].resolved++;
    else {
      stats[r.ward_no].open++;
      const days = Math.floor((Date.now() - new Date(r.created_at).getTime()) / 86400000);
      if (days > DEFAULT_SLA_DAYS) stats[r.ward_no].overdue++;
    }
  });
  const rows = Object.entries(stats)
    .map(([ward, s]) => {
      const w = wards[ward] || { councillor_name:'—', party:'—' };
      return { ward: parseInt(ward), ...s, councillor: w.councillor_name, party: w.party };
    })
    .filter(r => r.open > 0)
    .sort((a,b) => b.open - a.open);
  if (!rows.length){
    list.innerHTML = '<div class="k-lb-empty">All reports resolved</div>';
    return;
  }
  const max = rows[0].open;
  list.innerHTML = rows.map((r, i) => `
    <div class="k-lb-row">
      <div class="k-lb-rank">${String(i+1).padStart(2,'0')}</div>
      <div>
        <div class="k-lb-name">Ward ${r.ward}${r.overdue ? ' <span style="color:#E8524A;font-size:.78rem;font-family:var(--mono);">⚠ ' + r.overdue + ' overdue</span>' : ''}</div>
        <div class="k-lb-councillor">${esc(r.councillor)} · ${esc(r.party)}</div>
        <div class="k-lb-bar"><div class="k-lb-bar-fill" style="width:${(r.open/max*100).toFixed(1)}%"></div></div>
      </div>
      <div class="k-lb-count">${r.open}</div>
      <div class="k-lb-rate">${r.resolved} done</div>
    </div>
  `).join('');
}

function renderChain(){
  const chain = document.getElementById('k-chain');
  if (!chain) return;
  const nodes = [
    { icon:'🏛', name:'The Council', role:'23 elected ward councillors · Sets policy & budgets' },
    { icon:'👤', name:'Chairman', role:'Nabendu Mahali · Political head' },
    { icon:'📋', name:'Executive Officer (EO)', role:'WB Civil Service · Administrative head' },
    { icon:'🧹', name:'Sanitation Inspector (SI)', role:'Supervises waste, drainage, water' },
    { icon:'👷', name:'Sanitation Supervisors', role:'Ward Jamadars · Field coordination' },
    { icon:'🧑‍🔧', name:'Sanitation Staff', role:'Collection, sweeping, drain cleaning' }
  ];
  chain.innerHTML = nodes.map((n, i) => {
    const isLast = i === nodes.length - 1;
    const arrow = !isLast ? '<div class="k-chain-arrow">↓</div>' : '';
    return `<div class="k-chain-node">
      <div class="k-chain-icon">${n.icon}</div>
      <div class="k-chain-text">
        <div class="k-chain-name">${esc(n.name)}</div>
        <div class="k-chain-role">${esc(n.role)}</div>
      </div>
    </div>${arrow}`;
  }).join('') + `
    <div class="k-chain-note">
      <div class="k-chain-note-label">Also involved</div>
      <div class="k-chain-note-text">Clerical Staff — grievance tracking, attendance, inventory. Report to the Executive Officer, not the sanitation chain.</div>
    </div>`;
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
  const worst = Object.entries(stats).map(([w,c]) => ({ ward: parseInt(w), count: c }))
    .sort((a,b) => b.count - a.count).slice(0, 5);
  const worstHtml = worst.length
    ? worst.map((w, i) => {
        const wd = wards[w.ward] || {};
        return `<div class="k-rep-worst-item">
          <span>${i+1}. Ward ${w.ward} · ${esc(wd.councillor_name || '—')}</span>
          <span class="k-rep-worst-count">${w.count}</span>
        </div>`;
      }).join('')
    : '<div style="padding:1rem 0;color:rgba(240,230,208,.4);font-size:.85rem;">No open reports.</div>';
  document.getElementById('k-rep-content').innerHTML = `
    <div class="k-rep-header">
      <div class="k-rep-avatar">${esc(rep.initials)}</div>
      <div>
        <div class="k-rep-name">${esc(rep.name)}</div>
        <div class="k-rep-role">${esc(rep.role)} · ${esc(rep.party)}</div>
      </div>
    </div>
    <div class="k-rep-stats">
      <div class="k-rep-stat"><div class="k-rep-stat-n">${active}</div><div class="k-rep-stat-l">Active</div></div>
      <div class="k-rep-stat"><div class="k-rep-stat-n">${total}</div><div class="k-rep-stat-l">Reports</div></div>
      <div class="k-rep-stat"><div class="k-rep-stat-n">${resolved}</div><div class="k-rep-stat-l">Resolved</div></div>
    </div>
    <div class="k-rep-worst-title">Worst wards</div>
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
    opt.textContent = `Ward ${w.ward_no} — ${w.councillor_name}`;
    sel.appendChild(opt);
  });
}

/* ══════════════════════════════════════════════════════════
   MODAL FLOW
   ══════════════════════════════════════════════════════════ */
function openModal(){
  document.getElementById('k-modal').classList.add('open');
  goToStep(1);
}
function closeModal(){
  document.getElementById('k-modal').classList.remove('open');
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
  miniMap.on('load', () => {
    if (wardGeo){
      miniMap.addSource('wards-mini', { type:'geojson', data:wardGeo });
      miniMap.addLayer({ id:'wards-mini-line', type:'line', source:'wards-mini', paint:{ 'line-color':'rgba(212,136,42,.5)','line-width':1 }});
    }
  });
  miniMap.on('click', (e) => setLocation(e.lngLat.lat, e.lngLat.lng));
}

function setLocation(lat, lng){
  draft.lat = lat;
  draft.lng = lng;
  const autoWard = detectWard(lat, lng);
  if (autoWard && wards[autoWard]){
    draft.ward = autoWard;
    const sel = document.getElementById('k-ward');
    if (sel) sel.value = String(autoWard);
    showToast(`Ward ${autoWard} detected`);
  }
  document.getElementById('k-coords').textContent = `${lat.toFixed(5)}°N, ${lng.toFixed(5)}°E`;
  if (miniMap){
    if (miniMarker) miniMarker.remove();
    miniMarker = new maplibregl.Marker({ color:'#D4882A' }).setLngLat([lng, lat]).addTo(miniMap);
    miniMap.flyTo({ center: [lng, lat], zoom: 15 });
  }
  document.getElementById('k-next-2').disabled = false;
}

/* ══════════════════════════════════════════════════════════
   UI WIRING
   ══════════════════════════════════════════════════════════ */
function wireUI(){
  document.getElementById('k-intro-continue').addEventListener('click', () => {
    document.getElementById('k-intro').classList.remove('open');
    localStorage.setItem('kasa_intro_seen', '1');
  });
  document.getElementById('k-hero-cta').addEventListener('click', openModal);
  document.getElementById('k-map-report-btn').addEventListener('click', openModal);
  document.getElementById('k-nav-report').addEventListener('click', (e) => { e.preventDefault(); openModal(); });
  document.getElementById('k-modal-close').addEventListener('click', closeModal);
  document.getElementById('k-modal-backdrop').addEventListener('click', closeModal);
  document.getElementById('k-photo').addEventListener('change', handlePhoto);
  document.getElementById('k-next-1').addEventListener('click', () => goToStep(2));
  document.getElementById('k-next-2').addEventListener('click', () => goToStep(3));
  document.getElementById('k-gps-btn').addEventListener('click', detectGPS);
  document.getElementById('k-ward').addEventListener('change', (e) => {
    draft.ward = e.target.value ? parseInt(e.target.value) : null;
  });
  document.getElementById('k-severity').addEventListener('change', (e) => { draft.severity = e.target.value; });
  document.getElementById('k-submit').addEventListener('click', submitReport);
  document.getElementById('k-done-close').addEventListener('click', () => { closeModal(); resetDraft(); });
  document.getElementById('k-tweet-btn').addEventListener('click', () => {
    if (window._lastReport){
      const w = wards[window._lastReport.ward_no];
      openTweetComposer(window._lastReport, w);
    }
  });
  document.getElementById('k-filter-severity').addEventListener('change', (e) => { activeFilters.severity = e.target.value; renderMarkers(); });
  document.getElementById('k-filter-status').addEventListener('change', (e) => { activeFilters.status = e.target.value; renderMarkers(); });
  document.getElementById('k-search-ward').addEventListener('input', (e) => {
    const n = parseInt(e.target.value);
    activeFilters.ward = n || null;
    renderMarkers();
  });
  document.querySelectorAll('.k-lang-btn').forEach(btn => {
    btn.addEventListener('click', () => setLang(btn.dataset.lang));
  });
  document.getElementById('k-qr-btn').addEventListener('click', () => {
    document.getElementById('k-qr-modal').classList.add('open');
    renderQR();
  });
  document.getElementById('k-qr-close').addEventListener('click', () => document.getElementById('k-qr-modal').classList.remove('open'));
  document.getElementById('k-qr-backdrop').addEventListener('click', () => document.getElementById('k-qr-modal').classList.remove('open'));
  document.querySelectorAll('[data-profile]').forEach(btn => {
    btn.addEventListener('click', () => openRepProfile(btn.dataset.profile));
  });
  document.getElementById('k-rep-close').addEventListener('click', () => document.getElementById('k-rep-modal').classList.remove('open'));
  document.getElementById('k-rep-backdrop').addEventListener('click', () => document.getElementById('k-rep-modal').classList.remove('open'));

  document.addEventListener('click', (e) => {
    const upBtn = e.target.closest('[data-upvote]');
    if (upBtn){ handleUpvote(upBtn.dataset.upvote, upBtn); return; }
    const verifyBtn = e.target.closest('[data-verify]');
    if (verifyBtn){ handleVerify(verifyBtn.dataset.verify); return; }
    const flagBtn = e.target.closest('[data-flag]');
    if (flagBtn){ handleFlag(flagBtn.dataset.flag); return; }
    const shareBtn = e.target.closest('[data-share-url]');
    if (shareBtn){ handleShare(shareBtn.dataset.shareUrl, shareBtn.dataset.shareMsg); return; }
  });
}

/* ══════════════════════════════════════════════════════════
   OFFLINE DETECTION
   ══════════════════════════════════════════════════════════ */
function setupOfflineDetection(){
  const update = () => {
    const el = document.getElementById('k-offline');
    if (!el) return;
    el.hidden = navigator.onLine;
  };
  window.addEventListener('online', () => { update(); syncOfflineQueue(); });
  window.addEventListener('offline', update);
  update();
}

/* ══════════════════════════════════════════════════════════
   PHOTO
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
  if (!navigator.geolocation){ showToast('GPS not available'); return; }
  btn.textContent = '⟳ Locating…';
  navigator.geolocation.getCurrentPosition(
    (pos) => { btn.textContent = '✓ Location captured'; setLocation(pos.coords.latitude, pos.coords.longitude); },
    (err) => { btn.textContent = '⊕ Use my location'; showToast(err.code === 1 ? 'Permission denied — tap the map' : 'GPS failed'); },
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
  submitBtn.textContent = 'Checking photo…';

  let moderation;
  try {
    moderation = await moderatePhoto(draft.photoBlob);
  } catch(e){
    console.warn('Moderation error', e);
    moderation = { approved: true, reason: null, labels: {} };
  }

  if (!moderation.approved){
    showToast(`Photo rejected: ${moderation.reason || 'does not meet guidelines'}`);
    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit Report →';
    return;
  }

  submitBtn.textContent = 'Checking for duplicates…';

  let parentId = null;
  if (navigator.onLine){
    try {
      const { data: nearby } = await sb.rpc('find_nearby_report', {
        p_lat: draft.lat, p_lng: draft.lng,
        p_radius_meters: DUPLICATE_RADIUS_M,
        p_hours: DUPLICATE_HOURS
      });
      if (nearby) parentId = nearby;
    } catch(e){ /* ignore */ }
  }

  const desc = document.getElementById('k-desc').value.trim();
  const name = document.getElementById('k-name').value.trim();

  const report = {
    id: 'R' + Date.now(),
    lat: draft.lat, lng: draft.lng, ward_no: draft.ward,
    severity: draft.severity, description: desc || null,
    reporter_name: name || null, reporter_hash: reporterHash,
    created_at: new Date().toISOString(),
    parent_report_id: parentId, is_duplicate: !!parentId,
    photoBlob: draft.photoBlob,
    moderation_status: moderation.approved ? 'approved' : 'pending',
    moderation_labels: moderation.labels || {}
  };

  if (navigator.onLine){
    try {
      await syncReportToServer(report);
      submitBtn.textContent = 'Submit Report →';
      submitBtn.disabled = false;
      await afterSubmit(report, parentId);

      /* Show tweet button on done step */
      const tweetBtn = document.getElementById('k-tweet-btn');
      if (tweetBtn){ tweetBtn.style.display = 'block'; window._lastReport = report; }

      await checkEscalation(report.ward_no);
      return;
    } catch(e){
      console.warn('Online submit failed, queuing offline', e);
    }
  }

  await queuePendingReport(report);
  submitBtn.textContent = 'Submit Report →';
  submitBtn.disabled = false;
  await afterSubmit(report, parentId, true);
}

async function syncReportToServer(report){
  const filename = `reports/${report.id}.jpg`;
  const { error: upErr } = await sb.storage
    .from('kasa-photos')
    .upload(filename, report.photoBlob, { contentType:'image/jpeg', upsert:true });
  if (upErr) throw upErr;
  const { data: urlData } = sb.storage.from('kasa-photos').getPublicUrl(filename);

  const { error: insErr } = await sb.from('reports').insert({
    lat: report.lat, lng: report.lng, ward_no: report.ward_no,
    severity: report.severity, description: report.description,
    reporter_name: report.reporter_name, reporter_hash: report.reporter_hash,
    photo_url: urlData.publicUrl, status: 'open',
    upvotes: 0, flags: 0, sla_days: DEFAULT_SLA_DAYS,
    parent_report_id: report.parent_report_id || null,
    is_duplicate: report.is_duplicate || false,
    sync_status: 'synced',
    moderation_status: report.moderation_status || 'pending',
    moderation_labels: report.moderation_labels || {}
  });
  if (insErr) throw insErr;
}

async function afterSubmit(report, parentId, isPending){
  await loadReports();
  updateStats();
  renderLeaderboard();
  renderTicker();

  const w = wards[report.ward_no] || { councillor_name:'—' };
  const msg = `Garbage report — Purulia Kasa\nWard: ${report.ward_no} (${w.councillor_name})\nLocation: ${report.lat.toFixed(5)},${report.lng.toFixed(5)}\nSeverity: ${report.severity}\n${report.description || ''}\nMap: https://www.google.com/maps?q=${report.lat},${report.lng}`;
  document.getElementById('k-wa-escalate').href = `https://wa.me/${MUNICIPALITY_PHONE}?text=${encodeURIComponent(msg)}`;

  const doneTitle = document.getElementById('k-done-title');
  const doneSub = document.getElementById('k-done-sub');
  if (isPending){
    if (doneTitle) doneTitle.textContent = 'Saved offline';
    if (doneSub) doneSub.textContent = 'Will upload automatically when you are back online.';
  } else if (parentId){
    if (doneTitle) doneTitle.textContent = 'Report added';
    if (doneSub) doneSub.textContent = 'Similar nearby report found — your report is linked to it.';
  }

  goToStep('done');
  showToast(isPending ? 'Saved offline' : 'Report filed');
}

/* ══════════════════════════════════════════════════════════
   AUTO-ESCALATION
   ══════════════════════════════════════════════════════════ */
function buildTweetText(report, ward){
  const councillor = ward?.councillor_name || 'Ward Councillor';
  return [
    `🗑️ New garbage report in Ward ${report.ward_no}, Purulia`,
    `Councillor: ${councillor}`,
    `Severity: ${report.severity}`,
    report.description ? `"${report.description.slice(0, 80)}"` : '',
    `Reported via @PuruliaKasa — puruliavision2040.vercel.app`
  ].filter(Boolean).join('\n');
}

function openTweetComposer(report, ward){
  const text = buildTweetText(report, ward);
  const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&via=${MLA_TWITTER_HANDLE}`;
  window.open(url, '_blank');
}

async function checkEscalation(wardNo){
  if (!sb) return;
  const { data, error } = await sb
    .from('reports')
    .select('id, auto_tweeted_at')
    .eq('ward_no', wardNo)
    .eq('status', 'open')
    .in('moderation_status', ['approved', 'pending'])
    .gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString());

  if (error || !data) return;
  const count = data.length;
  const alreadyTweeted = data.some(r => r.auto_tweeted_at);

  if (count >= ESCALATION_THRESHOLD && !alreadyTweeted){
    await sb
      .from('reports')
      .update({ auto_tweeted_at: new Date().toISOString() })
      .eq('ward_no', wardNo)
      .eq('status', 'open');

    const text = `🚨 Ward ${wardNo}, Purulia has ${count} open garbage reports this week.\n\nThe Municipality has not responded. Time to act.\n\n@${MLA_TWITTER_HANDLE} @PuruliaKasa`;
    setTimeout(() => {
      if (confirm(`Ward ${wardNo} crossed ${ESCALATION_THRESHOLD} open reports this week. Tweet the MLA?`)){
        window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, '_blank');
      }
    }, 2000);
  }
}

async function buildWeeklyDigest(){
  const { data: reports } = await sb
    .from('reports')
    .select('*')
    .eq('status', 'open')
    .in('moderation_status', ['approved', 'pending'])
    .order('created_at', { ascending: false });

  if (!reports || !reports.length) return null;
  const byWard = {};
  reports.forEach(r => {
    if (!byWard[r.ward_no]) byWard[r.ward_no] = [];
    byWard[r.ward_no].push(r);
  });
  const lines = [
    'PURULIA KASA — WEEKLY DIGEST',
    `Generated: ${new Date().toLocaleString('en-IN')}`,
    `Total open reports: ${reports.length}`,
    `Wards affected: ${Object.keys(byWard).length}`,
    '',
    '═══════════════════════════════════'
  ];
  Object.entries(byWard)
    .sort((a, b) => b[1].length - a[1].length)
    .forEach(([ward, items]) => {
      lines.push(`\nWard ${ward} — ${items.length} open report(s)`);
      items.slice(0, 5).forEach(r => {
        const days = Math.floor((Date.now() - new Date(r.created_at).getTime()) / 86400000);
        lines.push(`  • ${r.severity || 'minor'} · ${days}d ago · ${r.description || 'No description'}`);
        lines.push(`    Map: https://www.google.com/maps?q=${r.lat},${r.lng}`);
      });
      if (items.length > 5) lines.push(`  ... and ${items.length - 5} more`);
    });
  lines.push('\n═══════════════════════════════════');
  lines.push('\nPurulia Kasa — puruliavision2040.vercel.app');
  return lines.join('\n');
}

async function sendWeeklyDigest(){
  const digest = await buildWeeklyDigest();
  if (!digest) return;
  const mailto = `mailto:${MUNICIPALITY_EMAIL}?subject=${encodeURIComponent('Purulia Kasa — Weekly Digest')}&body=${encodeURIComponent(digest)}`;
  if (window.KASA_CONFIG.DIGEST_ENDPOINT){
    try {
      await fetch(window.KASA_CONFIG.DIGEST_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: MUNICIPALITY_EMAIL, subject: 'Purulia Kasa — Weekly Digest', body: digest })
      });
      showToast('Weekly digest sent');
      return;
    } catch(e){ console.warn('Digest endpoint failed', e); }
  }
  window.location.href = mailto;
}

async function checkWeeklyDigest(){
  const lastSent = localStorage.getItem('kasa_digest_sent');
  const now = Date.now();
  const weekMs = 7 * 86400000;
  if (!lastSent || (now - parseInt(lastSent)) > weekMs){
    const { count } = await sb
      .from('reports')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'open');
    if (count && count > 0){
      setTimeout(() => {
        if (confirm(`There are ${count} open reports this week. Send the weekly digest to Purulia Municipality?`)){
          sendWeeklyDigest();
          localStorage.setItem('kasa_digest_sent', String(now));
        }
      }, 5000);
    }
  }
}

/* ══════════════════════════════════════════════════════════
   UPVOTE / FLAG / VERIFY / SHARE
   ══════════════════════════════════════════════════════════ */
async function handleUpvote(reportId, btn){
  if (userUpvotes.has(reportId)){ showToast('Already upvoted'); return; }
  const r = reports.find(x => x.id === reportId);
  if (!r) return;
  r.upvotes = (r.upvotes || 0) + 1;
  userUpvotes.add(reportId);
  saveUpvotes();
  btn.classList.add('upvoted');
  btn.innerHTML = `<span>👍</span> You saw this · ${r.upvotes}`;
  await sb.rpc('upvote_report', { p_report_id: reportId });
  showToast('Upvote counted');
}

async function handleFlag(reportId){
  const r = reports.find(x => x.id === reportId);
  if (!r) return;
  r.flags = (r.flags || 0) + 1;
  await sb.rpc('flag_report', { p_report_id: reportId, p_reason: null });
  showToast('Flagged');
}

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
        canvas.toBlob(async (blob) => { await commitResolve(reportId, blob); }, 'image/jpeg', 0.75);
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  };
  input.click();
}

async function commitResolve(reportId, blob){
  showToast('Uploading proof…');
  const filename = `resolved/${reportId}-${Date.now()}.jpg`;
  const { error: upErr } = await sb.storage.from('kasa-photos').upload(filename, blob, { contentType:'image/jpeg' });
  if (upErr){ showToast('Upload failed'); return; }
  const { data: urlData } = sb.storage.from('kasa-photos').getPublicUrl(filename);
  const { error: rpcErr } = await sb.rpc('mark_resolved', {
    p_report_id: reportId,
    p_resolved_photo_url: urlData.publicUrl,
    p_resolved_by: reporterHash
  });
  if (rpcErr){ showToast('Could not mark resolved'); return; }
  await loadReports();
  updateStats();
  renderLeaderboard();
  renderTicker();
  showToast('Marked as resolved ✓');
}

function handleShare(url, msg){
  if (navigator.share){
    navigator.share({ title:'Purulia Kasa', text: msg, url }).catch(() => {});
    return;
  }
  navigator.clipboard.writeText(url).then(() => showToast('Link copied'));
}

/* ══════════════════════════════════════════════════════════
   QR
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
    window.QRCode.toCanvas(canvas, KASA_PAGE_URL, { width:220, margin:1, color:{ dark:'#0a0805', light:'#f0e6d0' }});
  }
}

/* ══════════════════════════════════════════════════════════
   UTILITIES
   ══════════════════════════════════════════════════════════ */
function resetDraft(){
  draft = { photoBlob:null, lat:null, lng:null, ward:null, severity:'minor' };
  ['k-photo','k-desc','k-name','k-ward'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const pp = document.getElementById('k-photo-preview'); if (pp) pp.innerHTML = '';
  const co = document.getElementById('k-coords'); if (co) co.textContent = 'No location set yet';
  const n1 = document.getElementById('k-next-1'); if (n1) n1.disabled = true;
  const n2 = document.getElementById('k-next-2'); if (n2) n2.disabled = true;
  const sb1 = document.getElementById('k-submit'); if (sb1){ sb1.disabled = false; sb1.textContent = 'Submit Report →'; }
  const gb = document.getElementById('k-gps-btn'); if (gb) gb.textContent = '⊕ Use my location';
  const sv = document.getElementById('k-severity'); if (sv) sv.value = 'minor';
  const tw = document.getElementById('k-tweet-btn'); if (tw) tw.style.display = 'none';
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
