/* ══════════════════════════════════════════════════════════
   PURULIA KASA — Main app
   Reads config from config.js (loaded before this file)
   ══════════════════════════════════════════════════════════ */

/* ── CONFIG ── */
window.KASA_CONFIG = window.KASA_CONFIG || {};
const SUPABASE_URL = window.KASA_CONFIG.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = window.KASA_CONFIG.SUPABASE_ANON_KEY || '';

const MUNICIPALITY_PHONE = '919046003666';
const MAP_CENTER = [86.3654, 23.3320];
const MAP_ZOOM = 13;
const KASA_PAGE_URL = 'https://archiboltmusk.github.io/Purulia/kasa.html';
const DEFAULT_SLA_DAYS = 7;
const DUPLICATE_RADIUS_M = 20;
const DUPLICATE_HOURS = 6;
const ESCALATION_THRESHOLD = 10;
const MLA_TWITTER_HANDLE = 'SudipKMukherjee';

/* ── Guard: if config missing, show message and stop ── */
if (!SUPABASE_URL || !SUPABASE_ANON_KEY){
  document.addEventListener('DOMContentLoaded', () => {
    const ld = document.getElementById('k-loader');
    if (ld) ld.innerHTML = '<div style="color:#e8524a;font-family:monospace;padding:2rem;text-align:center;max-width:400px;">Configuration error.<br><br>Please check that <code>config.js</code> exists and contains valid Supabase credentials.</div>';
  });
  throw new Error('Supabase config missing');
}

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ── State ── */
let mainMap = null;
let miniMap = null;
let miniMarker = null;
let reports = [];
let wards = {};
let wardGeo = null;
let draft = { photoBlob: null, lat: null, lng: null, ward: null, severity: 'minor' };
let activeFilters = { severity: '', status: '', ward: null };
let userUpvotes = new Set();
let currentLang = 'en';
let reporterHash = null;

/* ── Reps ── */
const REPS = {
  mla: { name:'Sudip Kumar Mukherjee', role:'MLA · Purulia (No. 242)', party:'BJP', initials:'SKM' },
  mp: { name:'Jyotirmay Singh Mahato', role:'MP · Purulia (Lok Sabha)', party:'BJP', initials:'JSM' },
  chairman: { name:'Nabendu Mahali', role:'Chairman · Purulia Municipality', party:'AITC', initials:'NM' }
};

/* ══════════════════════════════════════════════════════════
   i18n
   ══════════════════════════════════════════════════════════ */
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
    intro_stats:'২৩ ওয়ার্ড', intro_cta:'ম্যাপে যান →',
    hero_l1:'আবর্জনা দেখছেন?', hero_l2:'৩০ সেকেন্ডে রিপোর্ট করুন।',
    hero_sub:'পুরুলিয়া শহরের জন্য পাবলিক ম্যাপ।', hero_cta:'রিপোর্ট করুন',
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
    intro_stats:'23 वार्ड', intro_cta:'मैप पर जाएं →',
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
   INIT
   ══════════════════════════════════════════════════════════ */
async function init(){
  try {
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
    }, 600);
  } catch(e){
    console.error('Kasa init failed:', e);
    const ld = document.getElementById('k-loader');
    if (ld) ld.innerHTML = '<div style="color:#e8524a;font-family:monospace;padding:2rem;text-align:center;max-width:400px;">Error: ' + e.message + '</div>';
  }
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
  try {
    const { data, error } = await sb.from('wards').select('*').order('ward_no');
    if (error){ console.error('Wards load failed', error); return; }
    (data || []).forEach(w => { wards[w.ward_no] = w; });
  } catch(e){ console.warn('Wards fetch failed', e); }
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
  try {
    const { data, error } = await sb.from('reports').select('*').order('created_at', { ascending: false }).limit(500);
    if (error){ console.error('Reports load failed', error); return; }
    reports = data || [];
    renderMarkers();
  } catch(e){ console.warn('Reports fetch failed', e); }
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
        lat: r.lat, lng: r.lng, resolution_status: r.resolution_status || 'none'
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
    const statusText = r.status === 'resolved' ? 'Resolved' : `${days}d open`;
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
  const slaStatus = props.status === 'resolved' ? 'resolved' : slaRemaining === 0 ? 'overdue' : slaRemaining <= 2 ? 'warning' : 'ontrack';
  const slaColors = { resolved:'#6DB88A', overdue:'#E8524A', warning:'#E88A4A', ontrack:'#D4882A' };
  const slaLabels = {
    resolved: `Resolved in ${daysOpen}d`,
    overdue: `SLA overdue by ${daysOpen - sla}d`,
    warning: `${slaRemaining}d left to SLA`,
    ontrack: `${slaRemaining}d left to SLA`
  };

  const photo = props.photo_url ? `<img class="k-popup-img" src="${esc(props.photo_url)}" alt="">` : '';
  let sevClass = 'k-popup-sev-minor';
  if (props.status === 'resolved') sevClass = 'k-popup-sev-resolved';
  else if (props.severity === 'critical') sevClass = 'k-popup-sev-critical';
  else if (props.severity === 'severe') sevClass = 'k-popup-sev-severe';

  const hasUpvoted = userUpvotes.has(props.id);

  let actionsHtml = '';
  if (props.status === 'resolved'){
    actionsHtml = `<span class="k-popup-btn" style="border-color:#6DB88A;color:#6DB88A;cursor:default;">✓ Verified & Resolved</span>`;
  } else if (props.resolution_status === 'pending'){
    actionsHtml = `<span class="k-popup-btn" style="border-color:#E88A4A;color:#E88A4A;cursor:default;">⏳ Awaiting verification</span>`;
  } else {
    actionsHtml = `<button class="k-popup-btn k-btn-verify" data-verify="${esc(props.id)}">Submit Cleanup Proof</button>
      <button class="k-popup-btn k-btn-flag" data-flag="${esc(props.id)}">Flag</button>`;
  }

  const html = `
    <div class="k-popup">
      ${photo}
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
  }).join('');
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
    if (window._lastReport) openTweetComposer(window._lastReport, wards[window._lastReport.ward_no]);
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
  });
}

function setupOfflineDetection(){
  const update = () => {
    const el = document.getElementById('k-offline');
    if (el) el.hidden = navigator.onLine;
  };
  window.addEventListener('online', update);
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
  submitBtn.textContent = 'Uploading…';

  const desc = document.getElementById('k-desc').value.trim();
  const name = document.getElementById('k-name').value.trim();

  const report = {
    id: 'R' + Date.now(),
    lat: draft.lat, lng: draft.lng, ward_no: draft.ward,
    severity: draft.severity, description: desc || null,
    reporter_name: name || null, reporter_hash: reporterHash,
    created_at: new Date().toISOString(),
    photoBlob: draft.photoBlob
  };

  try {
    await syncReportToServer(report);
    await loadReports();
    updateStats();
    renderLeaderboard();
    renderTicker();

    const w = wards[report.ward_no] || { councillor_name:'—' };
    const msg = `Garbage report — Purulia Kasa\nWard: ${report.ward_no} (${w.councillor_name})\nLocation: ${report.lat.toFixed(5)},${report.lng.toFixed(5)}\nSeverity: ${report.severity}\n${report.description || ''}`;
    document.getElementById('k-wa-escalate').href = `https://wa.me/${MUNICIPALITY_PHONE}?text=${encodeURIComponent(msg)}`;

    const tweetBtn = document.getElementById('k-tweet-btn');
    if (tweetBtn){ tweetBtn.style.display = 'block'; window._lastReport = report; }

    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit Report →';
    goToStep('done');
    showToast('Report filed');
  } catch(e){
    console.error(e);
    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit Report →';
    showToast('Could not submit: ' + (e.message || 'unknown error'));
  }
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
    upvotes: 0, flags: 0, sla_days: DEFAULT_SLA_DAYS
  });
  if (insErr) throw insErr;
}

function openTweetComposer(report, ward){
  const councillor = ward?.councillor_name || 'Ward Councillor';
  const text = `🗑️ New garbage report in Ward ${report.ward_no}, Purulia\nCouncillor: ${councillor}\nSeverity: ${report.severity}\nReported via @PuruliaKasa`;
  window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&via=${MLA_TWITTER_HANDLE}`, '_blank');
}

async function handleUpvote(reportId, btn){
  if (userUpvotes.has(reportId)){ showToast('Already upvoted'); return; }
  const r = reports.find(x => x.id === reportId);
  if (!r) return;
  r.upvotes = (r.upvotes || 0) + 1;
  userUpvotes.add(reportId);
  saveUpvotes();
  btn.classList.add('upvoted');
  btn.innerHTML = `<span>👍</span> You saw this · ${r.upvotes}`;
  try { await sb.rpc('upvote_report', { p_report_id: reportId, p_reporter_hash: reporterHash }); } catch(e){}
  showToast('Upvote counted');
}

async function handleFlag(reportId){
  const r = reports.find(x => x.id === reportId);
  if (!r) return;
  try { await sb.rpc('flag_report', { p_report_id: reportId, p_reporter_hash: reporterHash, p_reason: null }); } catch(e){}
  showToast('Flagged — thank you');
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
        canvas.toBlob(async (blob) => {
          try {
            const filename = `resolutions/${reportId}-${Date.now()}.jpg`;
            const { error: upErr } = await sb.storage.from('kasa-photos').upload(filename, blob, { contentType:'image/jpeg' });
            if (upErr){ showToast('Upload failed'); return; }
            const { data: urlData } = sb.storage.from('kasa-photos').getPublicUrl(filename);
            await sb.rpc('submit_resolution', { p_report_id: reportId, p_resolved_photo_url: urlData.publicUrl, p_submitted_by: reporterHash });
            await loadReports();
            updateStats();
            showToast('Submitted for verification');
          } catch(e){ showToast('Failed'); }
        }, 'image/jpeg', 0.75);
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  };
  input.click();
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
