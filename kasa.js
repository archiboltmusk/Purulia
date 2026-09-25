/* ══════════════════════════════════════════════════════════
   PURULIA KASA — civic problem map
   Report garbage, drains, roads, streetlights, illegal activity.
   Nothing is marked fixed until people on the spot confirm it.

   The rules that make that true live on the server:
   supabase/migrations/20260924120000_kasa_v2_accountability.sql
   Until that migration is applied the page runs in "legacy" mode
   against the old tables.
   ══════════════════════════════════════════════════════════ */

/* ── CONFIG ── */
const CFG = window.KASA_CONFIG || {};
const SUPABASE_URL = CFG.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = CFG.SUPABASE_ANON_KEY || '';
const TURNSTILE_SITE_KEY = CFG.TURNSTILE_SITE_KEY || '';
const VAPID_PUBLIC_KEY = CFG.VAPID_PUBLIC_KEY || '';
const GRIEVANCE_EMAIL = CFG.GRIEVANCE_EMAIL || 'grievance@puruliakasa.in';
const MUNICIPALITY_PHONE = '919046003666';
const MUNICIPALITY_EMAIL = 'puruliamunicipality@gmail.com';
const MLA_TWITTER_HANDLE = 'SudipKMukherjee';
const MAP_CENTER = [86.3654, 23.3320];
const MAP_ZOOM = 13;
const MAP_STYLE = 'https://tiles.openfreemap.org/styles/dark';
const PAGE_URL = location.origin + location.pathname;
const PHOTO_MAX_PX = 1600;
// Exactly what the public view offers; never select('*') from it.
const PUBLIC_REPORT_COLUMNS = 'id,created_at,lat,lng,ward_no,category,severity,status,description,landmark,photo_url,upvotes,seen_on_site,flags,moderation_status,is_duplicate,parent_report_id,recurrence_count,rejected_claims,resolved_at,resolved_photo_url,resolution_method,sla_days,gps_verified,claim_id,claim_photo_url,claim_created_at,claim_verify_count,claim_dispute_count,claim_quorum_reached_at,claim_finalize_after,claim_distance_m,rating_count,onsite_rating_count,authenticity_avg,severity_avg,neighbour_status,reply_count,claim_needs_review';
const CACHE_KEY = 'kasa_reports_cache_v2';
const MAP_HIDE_RESOLVED_DAYS = 90;   // resolved reports leave the map (not the record) after this
const DEFAULT_RULES = {
  verify_quorum: 3, dispute_quorum: 2, challenge_hours: 12, claim_expiry_days: 14,
  claim_radius_m: 50, vote_radius_m: 100, max_gps_accuracy_m: 60,
  max_photo_age_minutes: 120, photo_gps_far_m: 500, require_live_capture: 0
};
const SEVERITIES = ['minor', 'severe', 'critical'];
const COLORS = { minor: '#d4882a', severe: '#e88a4a', critical: '#e8524a', claimed: '#8f7ae6', resolved: '#6db88a', pending: '#9a8f7c' };

/* Issue types. `chain` picks who is responsible; `review` means a moderator
   approves it before it is public (enforced on the server). */
const CATEGORIES = {
  garbage:              { icon: '🗑️', group: 'clean',   chain: 'sanitation',   fix: 'cleaned' },
  drain:                { icon: '🌊', group: 'clean',   chain: 'sanitation',   fix: 'cleared' },
  road:                 { icon: '🚧', group: 'infra',   chain: 'engineering',  fix: 'repaired' },
  streetlight:          { icon: '💡', group: 'infra',   chain: 'lighting',     fix: 'working' },
  water:                { icon: '🚰', group: 'infra',   chain: 'water',        fix: 'fixed' },
  missing:              { icon: '🕳️', group: 'infra',   chain: 'engineering',  fix: 'replaced' },
  encroachment:         { icon: '🚫', group: 'illegal', chain: 'enforcement',  fix: 'removed', review: true },
  illegal_construction: { icon: '🏗️', group: 'illegal', chain: 'enforcement',  fix: 'stopped', review: true },
  illegal_mining:       { icon: '⛏️', group: 'illegal', chain: 'mining',       fix: 'stopped', review: true },
  illegal_other:        { icon: '⚠️', group: 'illegal', chain: 'police',       fix: 'stopped', review: true },
  other:                { icon: '📍', group: 'infra',   chain: 'municipality', fix: 'fixed' }
};
const GROUPS = ['clean', 'infra', 'illegal'];

/* Who answers for each kind of problem, frontline first. Roles, not names:
   individual officers aren't publicly listed. */
const CHAINS = {
  sanitation:   { agency: 'agency_municipality', nodes: ['conservancy', 'si', 'eo', 'chairman'] },
  engineering:  { agency: 'agency_municipality', nodes: ['sae', 'ae', 'eo', 'chairman'], note: 'note_pwd' },
  lighting:     { agency: 'agency_municipality', nodes: ['sae_elec', 'ae', 'eo', 'chairman'], note: 'note_wbsedcl' },
  water:        { agency: 'agency_municipality', nodes: ['waterworks', 'ae', 'eo', 'chairman'], note: 'note_phe' },
  municipality: { agency: 'agency_municipality', nodes: ['eo', 'chairman'] },
  enforcement:  { agency: 'agency_municipality', nodes: ['building', 'eo', 'chairman', 'sdo'], note: 'note_police_help' },
  mining:       { agency: 'agency_district', nodes: ['bllro', 'dllro', 'dm'], note: 'note_police_help' },
  police:       { agency: 'agency_police', nodes: ['ps', 'sdpo', 'sp'], note: 'note_112' }
};
const ROLE_ABBR = {
  conservancy: 'CS', si: 'SI', eo: 'EO', chairman: 'CH', sae: 'SAE', ae: 'AE', sae_elec: 'SAE',
  waterworks: 'WW', building: 'BL', sdo: 'SDO', bllro: 'BL&LRO', dllro: 'DL&LRO', dm: 'DM', ps: 'PS', sdpo: 'SDPO', sp: 'SP'
};

// photo: a file in reps/ whose license allows reuse; photoCredit: the attribution it requires; photoPos: optional crop point.
const REPS = {
  mla: { name: 'Sudip Kumar Mukherjee', role: 'rep_mla_role', party: 'BJP', initials: 'SKM', photo: 'reps/mla-sudip-kumar-mukherjee.jpg', photoCredit: '' },
  mp: { name: 'Jyotirmay Singh Mahato', role: 'rep_mp_role', party: 'BJP', initials: 'JSM', photo: 'reps/mp-jyotirmay-singh-mahato.webp', photoCredit: '' },
  chairman: { name: 'Nabendu Mahali', role: 'rep_chair_role', party: 'AITC', initials: 'NM', meta: 'rep_chair_meta', photo: 'reps/chairman-nabendu-mahali.jpg', photoCredit: '', photoPos: '62% 38%' }
};

function repAvatar(rep, cls){
  return `<span class="${cls}"><span>${esc(rep.initials)}</span>${rep.photo ? `<img class="k-rep-photo" src="${esc(rep.photo)}" alt="" loading="lazy"${rep.photoPos ? ` style="object-position:${esc(rep.photoPos)}"` : ''}>` : ''}</span>`;
}
// A photo that fails to load leaves the initials showing.
document.addEventListener('error', e => { if (e.target.classList?.contains('k-rep-photo')) e.target.remove(); }, true);
const FLAG_REASONS = ['not_an_issue', 'wrong_category', 'wrong_location', 'duplicate', 'inappropriate', 'fake_or_old_photo', 'other'];

/* ── State ── */
const state = {
  listQuery: '',
  groupsByWard: {},
  fixConfirms: {},        // report id -> confirmations when it was verified fixed
  mode: null,              // 'v2' once the migration is live, else 'legacy'
  rules: { ...DEFAULT_RULES },
  reports: [],
  byId: new Map(),
  wards: {},
  wardGeo: null,
  filters: { category: '', status: '', severity: '', ward: null },
  view: 'map',
  sort: 'urgent',
  lang: 'en',
  sheetId: null,
  events: new Map(),
  seen: new Set(),
  ratings: {},
  replies: new Map(),
  selectedWard: null,
  chainTab: 'sanitation'
};
let sb = null;
let mainMap = null, miniMap = null, miniMarker = null;
let mapReady = null;
let draft = null;
let ev = null;
let reporterHash = null;

/* ══════════════════════════════════════════════════════════
   i18n  (strings live in kasa-i18n.js)
   ══════════════════════════════════════════════════════════ */
const I18N = window.KASA_I18N || { en: {} };

function t(key, vars){
  let s = (I18N[state.lang] && I18N[state.lang][key]) ?? I18N.en[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));
  return s;
}

function loadLang(){
  try { state.lang = localStorage.getItem('kasa_lang') || 'en'; } catch (e) { state.lang = 'en'; }
  if (!I18N[state.lang]) state.lang = 'en';
}

function applyLang(){
  document.documentElement.lang = state.lang;
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  document.querySelectorAll('.k-lang-btn').forEach(b => b.classList.toggle('k-lang-active', b.dataset.lang === state.lang));
}

function setLang(lang){
  state.lang = I18N[lang] ? lang : 'en';
  try { localStorage.setItem('kasa_lang', state.lang); } catch (e) {}
  applyLang();
  populateCategoryFilter();
  renderCategoryGrid();
  renderAll();
  renderChainSection();
  renderReps();
  renderTrust();
  if (state.sheetId) renderSheet();
}

/* ══════════════════════════════════════════════════════════
   BOOT
   ══════════════════════════════════════════════════════════ */
async function init(){
  loadLang();
  applyLang();
  try { state.seen = new Set(JSON.parse(localStorage.getItem('kasa_seen') || '[]')); } catch (e) {}
  try { state.ratings = JSON.parse(localStorage.getItem('kasa_ratings') || '{}'); } catch (e) {}

  if (!window.supabase || !SUPABASE_URL || !SUPABASE_ANON_KEY){
    console.error('Kasa: Supabase library or config.js missing');
    showToast(t('err_config'), 8000);
    return;
  }
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  });

  wireUI();
  populateCategoryFilter();
  renderCategoryGrid();
  renderChainSection();
  renderReps();
  setupOfflineDetection();

  const cached = readCache();
  if (cached){
    state.mode = cached.mode;
    setReports(cached.rows);
    renderAll();
  }

  mapReady = initMainMap();
  await Promise.all([loadReports(), loadWards(), loadWardGeo(), loadCommunities()]);
  renderAll();
  renderTrust();
  mapReady.then(() => { addWardLayers(); updateMap(); });
  openDeepLink();
  if (!location.hash && !location.search) mapReady.then(locateOnOpen);
  syncOfflineQueue();

  if (state.mode === 'v2'){
    sb.rpc('kasa_finalize_due').then(({ data }) => { if (data > 0) loadReports().then(renderAll); });
  }
  renderAlertsButtons();
  renderInstallButton();
  registerServiceWorker();
}

/* ══════════════════════════════════════════════════════════
   DATA
   ══════════════════════════════════════════════════════════ */
async function fetchRows(){
  // select('*'): the public view only has public columns, and a page cached
  // before a column was added (or removed) keeps working.
  const v2 = await sb.from('kasa_public_reports').select(PUBLIC_REPORT_COLUMNS).order('created_at', { ascending: false }).limit(1000);
  if (!v2.error){
    if (state.mode !== 'v2') loadRules();
    state.mode = 'v2';
    return v2.data || [];
  }
  const legacy = await sb.from('reports').select('*').order('created_at', { ascending: false }).limit(500);
  if (legacy.error) throw legacy.error;
  state.mode = 'legacy';
  return (legacy.data || []).filter(r => !['rejected', 'hidden', 'review'].includes(r.moderation_status));
}

async function loadRules(){
  const { data, error } = await sb.rpc('kasa_rules');
  if (error || !data) return;
  for (const k of Object.keys(DEFAULT_RULES)) if (data[k] != null) state.rules[k] = Number(data[k]);
  renderTrust();
}

async function loadReports(){
  try {
    const rows = await fetchRows();
    const pending = await getPendingReports();
    setReports([...pending.map(pendingToRow), ...rows]);
    writeCache(rows);
  } catch (e){
    console.error('Kasa: reports load failed', e);
    if (!state.reports.length) showToast(t('err_load'));
  }
}

function setReports(rows){
  state.reports = rows.map(normalize);
  state.byId = new Map(state.reports.map(r => [r.id, r]));
}

function normalize(r){
  let status = r.status === 'pending_verification' ? 'claimed' : r.status;
  if (!['open', 'claimed', 'resolved'].includes(status)) status = 'open';
  return {
    id: String(r.id),
    createdAt: r.created_at,
    lat: Number(r.lat), lng: Number(r.lng),
    ward: r.ward_no ? Number(r.ward_no) : null,
    category: CATEGORIES[r.category] ? r.category : 'garbage',
    severity: SEVERITIES.includes(r.severity) ? r.severity : 'minor',
    status,
    description: r.description || '',
    landmark: r.landmark || '',
    photo: safeUrl(r.photo_url),
    seen: Number(r.upvotes || 0),
    seenOnSite: Number(r.seen_on_site || 0),
    flags: Number(r.flags || 0),
    flagged: r.moderation_status === 'flagged',
    duplicate: !!r.is_duplicate,
    recurrence: Number(r.recurrence_count || 0),
    rejectedClaims: Number(r.rejected_claims || 0),
    resolvedAt: r.resolved_at || null,
    resolvedPhoto: safeUrl(r.resolved_photo_url),
    resolution: r.resolution_method || (status === 'resolved' && state.mode !== 'v2' ? 'legacy_unverified' : null),
    slaDays: Number(r.sla_days || 7),
    gps: !!r.gps_verified,
    claim: r.claim_id ? {
      id: r.claim_id, photo: safeUrl(r.claim_photo_url), createdAt: r.claim_created_at,
      verify: Number(r.claim_verify_count || 0), dispute: Number(r.claim_dispute_count || 0),
      quorumAt: r.claim_quorum_reached_at, finalAfter: r.claim_finalize_after, distance: r.claim_distance_m,
      held: !!r.claim_needs_review
    } : null,
    ratings: Number(r.rating_count || 0),
    onsiteRatings: Number(r.onsite_rating_count || 0),
    authAvg: r.authenticity_avg != null ? Number(r.authenticity_avg) : null,
    sevAvg: r.severity_avg != null ? Number(r.severity_avg) : null,
    neighbour: r.neighbour_status || null,
    replyCount: Number(r.reply_count || 0),
    pending: !!r._pending
  };
}

function readCache(){
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (c && Date.now() - c.at < 7 * 86400000 && Array.isArray(c.rows)) return c;
  } catch (e) {}
  return null;
}

function writeCache(rows){
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), mode: state.mode, rows })); } catch (e) {}
}

async function loadWards(){
  const { data, error } = await sb.from('wards').select('*').order('ward_no');
  if (error){ console.warn('Kasa: wards load failed', error); return; }
  state.wards = {};
  (data || []).forEach(w => { state.wards[w.ward_no] = w; });
  populateWardDropdown();
}

async function loadCommunities(){
  if (!sb) return;
  const { data, error } = await sb.from('kasa_public_communities').select('wards');
  if (error) return;
  state.groupsByWard = {};
  for (const g of data || []) for (const w of g.wards || []) state.groupsByWard[w] = (state.groupsByWard[w] || 0) + 1;
}

async function loadWardGeo(){
  try {
    const res = await fetch('purulia_wards.geojson');
    if (res.ok) state.wardGeo = await res.json();
  } catch (e) { console.info('Kasa: no ward boundaries'); }
}

function pointInRing(pt, ring){
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++){
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

function pointInPolygon(pt, geom){
  const polys = geom.type === 'MultiPolygon' ? geom.coordinates : [geom.coordinates];
  return polys.some(poly => pointInRing(pt, poly[0]) && !poly.slice(1).some(h => pointInRing(pt, h)));
}

function detectWard(lat, lng){
  const f = (state.wardGeo?.features || []).find(f => pointInPolygon([lng, lat], f.geometry));
  const n = f && (f.properties.ward ?? f.properties.ward_no ?? f.properties.WARD);
  return n ? parseInt(String(n).replace(/\D/g, ''), 10) : null;
}

/* ══════════════════════════════════════════════════════════
   API — v2 (server-enforced rules) with a legacy fallback
   ══════════════════════════════════════════════════════════ */
let turnstileLoading = null;
function loadTurnstile(){
  return turnstileLoading ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = resolve;
    s.onerror = () => { turnstileLoading = null; reject(new KasaError('err_captcha')); };
    document.head.appendChild(s);
  });
}

/* Cloudflare Turnstile. Usually invisible; shows a checkbox only when Cloudflare
   isn't sure. Supabase Auth verifies the token, so bots can't mint identities. */
async function getCaptchaToken(){
  if (!TURNSTILE_SITE_KEY) return null;
  await loadTurnstile();
  const box = document.getElementById('k-captcha');
  const slot = document.getElementById('k-captcha-widget');
  slot.innerHTML = '';
  return new Promise((resolve, reject) => {
    let id = null;
    const done = (fn, v) => {
      clearTimeout(timer);
      box.hidden = true;
      try { if (id != null) window.turnstile.remove(id); } catch (e) {}
      fn(v);
    };
    const timer = setTimeout(() => done(reject, new KasaError('err_captcha')), 120000);
    id = window.turnstile.render(slot, {
      sitekey: TURNSTILE_SITE_KEY, action: 'kasa', appearance: 'interaction-only', theme: 'dark',
      callback: token => done(resolve, token),
      'error-callback': () => done(reject, new KasaError('err_captcha')),
      'before-interactive-callback': () => { box.hidden = false; }
    });
  });
}

async function ensureSession(){
  const { data: { session } } = await sb.auth.getSession();
  if (session) return session.user.id;
  const captchaToken = await getCaptchaToken();
  const { data, error } = await sb.auth.signInAnonymously(captchaToken ? { options: { captchaToken } } : undefined);
  if (error || !data?.user){
    console.error('Kasa: anonymous sign-in failed. Enable it under Authentication → Providers → Anonymous.', error);
    throw new KasaError('err_session');
  }
  return data.user.id;
}

async function getReporterHash(){
  if (reporterHash) return reporterHash;
  try { reporterHash = localStorage.getItem('kasa_reporter_hash'); } catch (e) {}
  if (!reporterHash){
    reporterHash = randomName(16);
    try { localStorage.setItem('kasa_reporter_hash', reporterHash); } catch (e) {}
  }
  return reporterHash;
}

class KasaError extends Error {
  constructor(key, vars){ super(key); this.key = key; this.vars = vars; }
}

/* Turns a server rejection into a sentence the person can act on. */
function errorText(err){
  if (err instanceof KasaError) return t(err.key, err.vars);
  const code = err?.message || '';
  if (/^KASA_[A-Z_]+$/.test(code)){
    let data = {};
    try { data = err.hint ? JSON.parse(err.hint) : {}; } catch (e) {}
    const key = 'err_' + code;
    const hasOwn = I18N[state.lang]?.[key] || I18N.en[key];
    const taken = data.taken_minutes_ago != null ? ago(new Date(Date.now() - data.taken_minutes_ago * 60000).toISOString()) : '';
    return hasOwn ? t(key, { d: data.distance_m, limit: data.limit_m, a: data.accuracy_m, ago: taken }) : (err.details || t('err_generic'));
  }
  return t('err_generic');
}

function rpcError(error){
  const e = new Error(error.message);
  e.details = error.details; e.hint = error.hint; e.code = error.code;
  return e;
}

/* Random flat names: photo links are public and must not reveal who uploaded
   them. The server checks ownership from Storage's own record of the upload. */
async function uploadPhoto(folder, blob){
  const path = `${folder}/${randomName(24)}.jpg`;
  const { error } = await sb.storage.from('kasa-photos').upload(path, blob, { contentType: 'image/jpeg', upsert: false, cacheControl: '31536000' });
  if (error){ console.error('Kasa: upload failed', error); throw new KasaError('err_upload'); }
  return path;
}

/* What the phone said about the photo — capture method, camera time, GPS
   stamp, AI-edit marker (kasa-photo-meta.js). Sent before the photo is used;
   the server applies the rules. Older databases without the function are fine. */
async function sendPhotoMeta(path, meta){
  if (!meta) return;
  const { error } = await sb.rpc('kasa_photo_meta', { p_path: path, p_meta: meta });
  if (error && error.code !== 'PGRST202') console.warn('Kasa: photo metadata not recorded', error);
}

async function readPhotoMeta(file){
  let m = {};
  try { if (window.KasaPhotoMeta) m = await window.KasaPhotoMeta.read(file); } catch (e) { /* treat as no metadata */ }
  return { capture: 'file', ...m };
}

/* One-time camera token, asked for as the camera opens. The server counts a
   photo as live only if its metadata arrives with an unspent token of this
   account. Offline or older servers: null, and the server decides. */
async function getCaptureToken(){
  if (state.mode !== 'v2') return null;
  try {
    await ensureSession();
    const { data, error } = await sb.rpc('kasa_issue_capture_token');
    return error ? null : data;
  } catch (e) { return null; }
}

/* The in-page camera plus a token requested in parallel (issued before the shot). */
async function openLiveCamera(){
  if (!cameraSupported()) return { error: 'unavailable' };
  const token = getCaptureToken();
  const res = await openCamera();
  return { ...res, token: await token };
}

/* Server-side photo check (fingerprint + Google Vision + EXIF verification + token validation).
   Best effort: when the function isn't deployed the database decides whether that's acceptable. */
async function checkPhoto(path, token, lat, lng){
  try {
    const timeout = new Promise(resolve => setTimeout(() => resolve({ error: 'timeout' }), 15000));
    const body = { path };
    if (token) body.token = token;
    if (lat != null) body.lat = lat;
    if (lng != null) body.lng = lng;
    const { data, error } = await Promise.race([sb.functions.invoke('kasa-photo-check', { body }), timeout]);
    if (error) return null;
    // If EXIF mismatch detected, log warning but don't reject (allow manual location).
    if (data?.exif_match === false) {
      console.warn('Kasa: EXIF GPS mismatch detected — server will flag this photo');
    }
    return data;
  } catch (e) { return null; }
}

const api = {
  async createReport(d){
    if (state.mode !== 'v2') return legacyCreateReport(d);
    await ensureSession();
    const path = await uploadPhoto('reports', d.photoBlob);
    // Metadata (with the camera token) must be recorded before the report is created.
    await sendPhotoMeta(path, d.photoMeta);
    // The photo check runs in the background so the report isn't held up.
    checkPhoto(path, null, d.lat, d.lng).catch(err => console.warn('photo check failed', err));
    // Create report in database immediately.
    const { data, error } = await sb.rpc('kasa_create_report', {
      p_category: d.category, p_severity: d.severity, p_lat: d.lat, p_lng: d.lng, p_accuracy: d.accuracy,
      p_ward_no: d.ward, p_description: d.description || null, p_landmark: d.landmark || null,
      p_photo_path: path, p_client_id: d.clientId
    });
    if (error) throw rpcError(error);
    if (data.moderation_status === 'approved' && !data.duplicate_of && !data.replayed) api.notify(String(data.id));
    return { id: String(data.id), moderation: data.moderation_status, duplicateOf: data.duplicate_of, recurrenceOf: data.recurrence_of };
  },

  async markSeen(r, pos){
    if (state.mode !== 'v2'){
      const { data, error } = await sb.rpc('upvote_report', { p_report_id: r.id, p_reporter_hash: await getReporterHash() });
      if (error) throw rpcError(error);
      return { counted: !!data };
    }
    await ensureSession();
    const { data, error } = await sb.rpc('kasa_mark_seen', {
      p_report_id: r.id, p_lat: pos?.lat ?? null, p_lng: pos?.lng ?? null, p_accuracy: pos?.accuracy ?? null
    });
    if (error) throw rpcError(error);
    return data;
  },

  async flag(r, reason, note, suggested){
    if (state.mode !== 'v2'){
      const { data, error } = await sb.rpc('flag_report', { p_report_id: r.id, p_reporter_hash: await getReporterHash(), p_reason: reason });
      if (error) throw rpcError(error);
      return { counted: !!data };
    }
    await ensureSession();
    const { data, error } = await sb.rpc('kasa_flag_report', { p_report_id: r.id, p_reason: reason, p_note: note || null,
      p_suggested_category: reason === 'wrong_category' ? suggested : null });
    if (error) throw rpcError(error);
    return data;
  },

  async evidence(mode, r, blob, pos, note, meta){
    if (state.mode !== 'v2') return legacySubmitProof(r, blob);
    await ensureSession();
    const path = await uploadPhoto(mode === 'claim' ? 'claims' : 'votes', blob);
    await sendPhotoMeta(path, meta);
    // Evidence photos must be checked (reuse/fingerprint) before the server accepts them.
    await checkPhoto(path, null, pos.lat, pos.lng);
    const { data, error } = mode === 'claim'
      ? await sb.rpc('kasa_claim_cleanup', { p_report_id: r.id, p_photo_path: path, p_lat: pos.lat, p_lng: pos.lng, p_accuracy: pos.accuracy })
      : await sb.rpc('kasa_vote_claim', {
          p_claim_id: r.claim.id, p_vote: mode === 'verify' ? 'verify' : 'dispute', p_photo_path: path,
          p_lat: pos.lat, p_lng: pos.lng, p_accuracy: pos.accuracy, p_note: note || null
        });
    if (error) throw rpcError(error);
    return data;
  },

  async rate(r, authenticity, severity, pos){
    await ensureSession();
    const { data, error } = await sb.rpc('kasa_rate_report', {
      p_report_id: r.id, p_authenticity: authenticity ?? null, p_severity: severity ?? null,
      p_lat: pos?.lat ?? null, p_lng: pos?.lng ?? null, p_accuracy: pos?.accuracy ?? null
    });
    if (error) throw rpcError(error);
    return data;
  },

  async replies(id){
    const { data, error } = await sb.from('kasa_public_replies')
      .select('id,responder_name,responder_role,body,verified_note,created_at').eq('report_id', id).order('created_at');
    if (error){ console.warn('Kasa: replies load failed', error); return []; }
    return data || [];
  },

  notify(id){
    sb.functions.invoke('kasa-notify', { body: { report_id: id } }).catch(() => {});
  },

  async events(id){
    if (state.mode !== 'v2') return [];
    const { data, error } = await sb.from('kasa_public_events')
      .select('id,kind,actor_tag,photo_url,distance_m,detail,created_at').eq('report_id', id).order('created_at').order('id');
    if (error){ console.warn('Kasa: events load failed', error); return []; }
    return data || [];
  }
};

async function legacyCreateReport(d){
  const hash = await getReporterHash();
  const filename = `reports/${d.clientId}.jpg`;
  const { error: upErr } = await sb.storage.from('kasa-photos').upload(filename, d.photoBlob, { contentType: 'image/jpeg', upsert: true });
  if (upErr){ console.error('Kasa: upload failed', upErr); throw new KasaError('err_upload'); }
  const { data: urlData } = sb.storage.from('kasa-photos').getPublicUrl(filename);
  const label = d.category === 'garbage' ? '' : `[${t('cat_' + d.category)}] `;
  const details = [d.landmark, d.description].filter(Boolean).join(' — ');
  const { error } = await sb.from('reports').insert({
    lat: d.lat, lng: d.lng, ward_no: d.ward, severity: d.severity,
    description: (label + details).trim() || null, reporter_name: null, reporter_hash: hash,
    photo_url: urlData.publicUrl, status: 'open', upvotes: 0, flags: 0, sla_days: 7,
    parent_report_id: null, is_duplicate: false, sync_status: 'synced',
    moderation_status: 'pending', moderation_labels: {}
  });
  if (error) throw rpcError(error);
  return { id: null, moderation: 'approved', legacyPending: true };
}

async function legacySubmitProof(r, blob){
  const filename = `resolutions/${r.id}-${Date.now()}.jpg`;
  const { error: upErr } = await sb.storage.from('kasa-photos').upload(filename, blob, { contentType: 'image/jpeg' });
  if (upErr) throw new KasaError('err_upload');
  const { data: urlData } = sb.storage.from('kasa-photos').getPublicUrl(filename);
  const { error } = await sb.rpc('submit_resolution', {
    p_report_id: r.id, p_resolved_photo_url: urlData.publicUrl, p_submitted_by: await getReporterHash()
  });
  if (error) throw rpcError(error);
  return { legacy: true };
}

/* ══════════════════════════════════════════════════════════
   FILTERING + DERIVED NUMBERS
   ══════════════════════════════════════════════════════════ */
function onMap(r){
  if (r.duplicate) return false;
  if (r.status === 'resolved' && state.filters.status !== 'resolved' &&
      daysSince(r.resolvedAt || r.createdAt) > MAP_HIDE_RESOLVED_DAYS) return false;
  return true;
}

function filtered(){
  const f = state.filters;
  return state.reports.filter(r =>
    (!f.category || r.category === f.category) &&
    (!f.status || r.status === f.status) &&
    (!f.severity || r.severity === f.severity) &&
    (!f.ward || r.ward === f.ward));
}

const primaries = () => state.reports.filter(r => !r.duplicate);
const daysSince = (iso) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
const isOverdue = (r) => r.status !== 'resolved' && daysSince(r.createdAt) > r.slaDays;
const peopleSaw = (r) => r.seen + 1;

function wardStats(){
  const stats = {};
  for (const r of primaries()){
    if (!r.ward) continue;
    const s = stats[r.ward] ||= { ward: r.ward, open: 0, claimed: 0, resolved: 0, overdue: 0, fake: 0, recurring: 0 };
    if (r.status === 'resolved') s.resolved++;
    else { s.open++; if (r.status === 'claimed') s.claimed++; }
    if (isOverdue(r)) s.overdue++;
    s.fake += r.rejectedClaims;
    if (r.recurrence) s.recurring++;
  }
  return stats;
}

/* ══════════════════════════════════════════════════════════
   RENDER — map, list, stats, leaderboard, ticker
   ══════════════════════════════════════════════════════════ */
function renderAll(){
  updateMap();
  renderList();
  updateStats();
  renderLeaderboard();
  renderFixed();
  renderTicker();
  renderWardCard();
}

function markerColor(r){
  if (r.pending) return COLORS.pending;
  if (r.status === 'resolved') return COLORS.resolved;
  if (r.status === 'claimed') return COLORS.claimed;
  return COLORS[r.severity];
}

function reportGeoJSON(){
  return {
    type: 'FeatureCollection',
    features: filtered().filter(r => onMap(r) && Number.isFinite(r.lat) && Number.isFinite(r.lng)).map(r => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
      properties: {
        id: r.id, color: markerColor(r),
        radius: 6 + Math.min(8, Math.sqrt(r.seen) * 2),
        halo: r.status === 'open' && r.severity === 'critical' ? 1 : 0
      }
    }))
  };
}

function initMainMap(){
  if (!window.maplibregl){ console.error('Kasa: map library missing'); return new Promise(() => {}); }
  mainMap = new maplibregl.Map({
    container: 'k-map', style: MAP_STYLE, center: MAP_CENTER, zoom: MAP_ZOOM,
    attributionControl: { compact: true }, cooperativeGestures: false
  });
  // Safari doesn't always grow the map canvas when its box changes size (late CSS, fonts, toolbar).
  const resizeMap = () => mainMap && mainMap.resize();
  if (window.ResizeObserver) new ResizeObserver(resizeMap).observe(document.getElementById('k-map'));
  window.addEventListener('load', resizeMap);
  window.addEventListener('pageshow', resizeMap);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) resizeMap(); });
  document.fonts?.ready.then(resizeMap);
  mainMap.once('load', resizeMap);
  mainMap.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
  mainMap.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: false }), 'bottom-right');

  return new Promise(resolve => {
    mainMap.on('load', () => {
      mainMap.addSource('reports', { type: 'geojson', data: reportGeoJSON(), cluster: true, clusterMaxZoom: 15, clusterRadius: 42 });
      mainMap.addLayer({ id: 'clusters', type: 'circle', source: 'reports', filter: ['has', 'point_count'], paint: {
        'circle-color': '#7a3f16', 'circle-stroke-color': '#d4882a', 'circle-stroke-width': 1.5, 'circle-opacity': .92,
        'circle-radius': ['step', ['get', 'point_count'], 16, 10, 21, 30, 27]
      }});
      mainMap.addLayer({ id: 'cluster-count', type: 'symbol', source: 'reports', filter: ['has', 'point_count'],
        layout: { 'text-field': '{point_count_abbreviated}', 'text-font': ['Noto Sans Regular'], 'text-size': 12 },
        paint: { 'text-color': '#f0e6d0' } });
      mainMap.addLayer({ id: 'report-halo', type: 'circle', source: 'reports', filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'halo'], 1]], paint: {
        'circle-color': COLORS.critical, 'circle-opacity': .18, 'circle-radius': ['*', ['get', 'radius'], 2.3]
      }});
      mainMap.addLayer({ id: 'report-points', type: 'circle', source: 'reports', filter: ['!', ['has', 'point_count']], paint: {
        'circle-color': ['get', 'color'], 'circle-radius': ['get', 'radius'],
        'circle-stroke-color': '#0a0805', 'circle-stroke-width': 2
      }});

      mainMap.on('click', 'report-points', e => { e.preventDefault(); openSheet(e.features[0].properties.id); });
      mainMap.on('click', 'clusters', async e => {
        e.preventDefault();
        const f = e.features[0];
        const zoom = await mainMap.getSource('reports').getClusterExpansionZoom(f.properties.cluster_id);
        mainMap.easeTo({ center: f.geometry.coordinates, zoom });
      });
      for (const layer of ['report-points', 'clusters']){
        mainMap.on('mouseenter', layer, () => { mainMap.getCanvas().style.cursor = 'pointer'; });
        mainMap.on('mouseleave', layer, () => { mainMap.getCanvas().style.cursor = ''; });
      }
      resolve();
    });
  });
}

function addWardLayers(){
  if (!mainMap || !state.wardGeo || mainMap.getSource('wards')) return;
  mainMap.addSource('wards', { type: 'geojson', data: state.wardGeo });
  mainMap.addLayer({ id: 'wards-fill', type: 'fill', source: 'wards', paint: { 'fill-color': '#d4882a', 'fill-opacity': .035 } }, 'clusters');
  mainMap.addLayer({ id: 'wards-selected', type: 'fill', source: 'wards', filter: ['==', ['get', 'ward'], -1],
    paint: { 'fill-color': '#d4882a', 'fill-opacity': .14 } }, 'clusters');
  mainMap.addLayer({ id: 'wards-line', type: 'line', source: 'wards', paint: { 'line-color': '#d4882a', 'line-opacity': .45, 'line-width': 1 } }, 'clusters');
  mainMap.on('click', 'wards-fill', e => {
    if (e.defaultPrevented) return;
    selectWard(Number(e.features[0].properties.ward));
  });
}

function updateMap(){
  if (!mainMap || !mainMap.getSource('reports')) return;
  mainMap.getSource('reports').setData(reportGeoJSON());
  if (mainMap.getLayer('wards-selected')) mainMap.setFilter('wards-selected', ['==', ['get', 'ward'], state.selectedWard ?? -1]);
}

function selectWard(n){
  state.selectedWard = state.selectedWard === n ? null : n;
  renderWardCard();
  updateMap();
}

function renderWardCard(){
  const el = document.getElementById('k-ward-card');
  const n = state.selectedWard;
  if (!n){ el.hidden = true; return; }
  const s = wardStats()[n] || { open: 0, resolved: 0, fake: 0 };
  const w = state.wards[n] || {};
  const filteredToWard = state.filters.ward === n;
  el.innerHTML = `
    <button type="button" class="k-ward-close" data-ward-close aria-label="${esc(t('sheet_close'))}">✕</button>
    <div class="k-ward-title">${esc(t('acc_ward', { n }))}</div>
    <div class="k-ward-sub">${w.councillor_name ? esc(w.councillor_name) : esc(t('lb_vacant'))}</div>
    <div class="k-ward-nums">
      <span class="k-red">${esc(t('wc_open', { n: s.open }))}</span>
      <span class="k-green">${esc(t('wc_fixed', { n: s.resolved }))}</span>
      ${s.fake ? `<span class="k-red">${esc(t('wc_fake', { n: s.fake }))}</span>` : ''}
    </div>
    <div class="k-ward-actions">
      <button type="button" class="k-ward-filter" data-ward-filter="${n}">${esc(t(filteredToWard ? 'wc_clear' : 'wc_filter'))}</button>
      <button type="button" class="k-ward-filter" data-ward-share="${n}">${esc(t('wc_share'))}</button>
    </div>
    <a class="k-ward-groups${state.groupsByWard[n] ? ' on' : ''}" href="communities.html?ward=${n}">${esc(state.groupsByWard[n]
      ? t('wc_groups', { n: state.groupsByWard[n] }) : t('wc_groups_none'))}</a>
    <div class="k-ward-note">${esc(t('boundary_note'))}</div>`;
  el.hidden = false;
}

function setView(view){
  state.view = view;
  document.querySelectorAll('.k-view-btn').forEach(b => {
    const on = b.dataset.view === view;
    b.classList.toggle('k-view-active', on);
    b.setAttribute('aria-selected', String(on));
  });
  document.getElementById('k-list').hidden = view !== 'list';
  if (view === 'list') renderList();
  else if (mainMap) requestAnimationFrame(() => mainMap.resize());
}

function sortReports(list){
  const sevRank = { critical: 3, severe: 2, minor: 1 };
  const statusRank = { open: 2, claimed: 1, resolved: 0 };
  const by = {
    urgent: (a, b) => statusRank[b.status] - statusRank[a.status] || sevRank[b.severity] - sevRank[a.severity] || daysSince(b.createdAt) - daysSince(a.createdAt),
    newest: (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
    seen: (a, b) => b.seen - a.seen,
    oldest: (a, b) => statusRank[b.status] - statusRank[a.status] || new Date(a.createdAt) - new Date(b.createdAt)
  }[state.sort];
  // Reports neighbours doubt sink below the rest, whatever the chosen order.
  const doubt = r => r.neighbour === 'doubted' ? 2 : (r.ratings >= 3 && r.authAvg != null && r.authAvg <= 2 ? 1 : 0);
  return [...list].sort((a, b) => doubt(a) - doubt(b) || by(a, b));
}

function matchesQuery(r, q){
  if (!q) return true;
  if (/^\d+$/.test(q)) return r.ward === Number(q);
  const hay = [r.landmark, r.description, t('cat_' + r.category), I18N.en['cat_' + r.category], r.ward ? t('acc_ward', { n: r.ward }) : '']
    .join(' ').toLowerCase();
  return q.toLowerCase().split(/\s+/).every(w => hay.includes(w));
}

function renderList(){
  if (state.view !== 'list') return;
  const list = sortReports(filtered().filter(onMap).filter(r => matchesQuery(r, state.listQuery)));
  document.getElementById('k-list-count').textContent = t('list_count', { n: list.length });
  const box = document.getElementById('k-list-items');
  if (!list.length){ box.innerHTML = `<div class="k-lb-empty">${esc(t('list_empty'))}</div>`; return; }
  box.innerHTML = list.slice(0, 300).map(r => {
    const c = CATEGORIES[r.category];
    return `
    <button type="button" class="k-list-item" data-open="${esc(r.id)}">
      ${r.photo ? `<img src="${esc(r.photo)}" alt="" loading="lazy" width="64" height="64">` : `<span class="k-list-noimg">${c.icon}</span>`}
      <span class="k-list-main">
        <span class="k-list-title">${c.icon} ${esc(t('cat_' + r.category))}</span>
        <span class="k-list-where">${esc(r.landmark || t('acc_ward', { n: r.ward ?? '?' }))}${r.landmark && r.ward ? ' · ' + esc(t('acc_ward', { n: r.ward })) : ''}</span>
        <span class="k-list-meta">${statusChip(r)} <span>${esc(peopleSaw(r) > 1 ? t('list_seen', { n: peopleSaw(r) }) : t('list_seen_one'))}</span> <span>${esc(ago(r.createdAt))}</span></span>
      </span>
    </button>`;
  }).join('');
}

function statusChip(r){
  if (r.pending) return `<span class="k-chip k-chip-pending">${esc(t('chip_pending'))}</span>`;
  if (r.status === 'resolved') return `<span class="k-chip k-chip-resolved">${esc(t(r.resolution === 'legacy_unverified' ? 'head_resolved_legacy' : 'status_resolved'))}</span>`;
  if (r.status === 'claimed') return `<span class="k-chip k-chip-claimed">${esc(t('status_claimed'))}</span>`;
  return `<span class="k-chip k-chip-${r.severity}">${esc(t('sev_' + r.severity))} · ${esc(t('days_open', { n: daysSince(r.createdAt) }))}</span>`;
}

function updateStats(){
  const all = primaries();
  const open = all.filter(r => r.status !== 'resolved').length;
  const verified = all.filter(r => r.status === 'resolved' && r.resolution !== 'legacy_unverified').length;
  const fake = all.reduce((n, r) => n + r.rejectedClaims, 0);
  setText('k-pill-active', open);
  setText('k-pill-total', all.length);
  setText('k-stat-total', all.length);
  setText('k-stat-open', open);
  setText('k-stat-resolved', verified);
  setText('k-stat-fake', fake);
}

function renderLeaderboard(){
  const el = document.getElementById('k-lb-list');
  if (!state.reports.length){ el.innerHTML = `<div class="k-lb-empty">${esc(t('lb_empty'))}</div>`; return; }
  const rows = Object.values(wardStats()).filter(s => s.open > 0 || s.fake > 0).sort((a, b) => b.open - a.open || b.fake - a.fake);
  if (!rows.length){ el.innerHTML = `<div class="k-lb-empty">${esc(t('lb_all_clear'))}</div>`; return; }
  const max = Math.max(1, rows[0].open);
  el.innerHTML = rows.map((s, i) => {
    const w = state.wards[s.ward] || {};
    const flags = [
      s.overdue ? `<span class="k-red">⚠ ${esc(t('lb_overdue', { n: s.overdue }))}</span>` : '',
      s.fake ? `<span class="k-red">✗ ${esc(t('lb_fake', { n: s.fake }))}</span>` : '',
      s.recurring ? `<span class="k-orange">↻ ${esc(t('lb_recurring', { n: s.recurring }))}</span>` : ''
    ].filter(Boolean).join(' ');
    return `
    <button type="button" class="k-lb-row" data-ward-select="${s.ward}">
      <span class="k-lb-rank">${String(i + 1).padStart(2, '0')}</span>
      <span>
        <span class="k-lb-name">${esc(t('acc_ward', { n: s.ward }))}</span>
        <span class="k-lb-councillor">${w.councillor_name ? esc(w.councillor_name) : esc(t('lb_vacant'))}</span>
        ${flags ? `<span class="k-lb-flags">${flags}</span>` : ''}
        <span class="k-lb-bar"><span class="k-lb-bar-fill" style="width:${(s.open / max * 100).toFixed(1)}%"></span></span>
      </span>
      <span class="k-lb-count">${s.open}</span>
      <span class="k-lb-rate">${esc(t('lb_fixed', { n: s.resolved }))}</span>
    </button>`;
  }).join('');
}

// Verified fixes, newest first, with how long they took and who confirmed them.
function recentFixes(){
  return primaries()
    .filter(r => r.status === 'resolved' && r.resolution === 'community' && r.resolvedAt)
    .sort((a, b) => new Date(b.resolvedAt) - new Date(a.resolvedAt))
    .slice(0, 6);
}

async function loadFixConfirmations(){
  const ids = recentFixes().map(r => r.id).filter(id => !(id in state.fixConfirms));
  if (!sb || !ids.length || state.mode !== 'v2') return;
  const { data, error } = await sb.from('kasa_public_events').select('report_id,detail')
    .eq('kind', 'resolved').in('report_id', ids);
  if (error) return;
  for (const id of ids) state.fixConfirms[id] = null;
  for (const e of data || []) state.fixConfirms[String(e.report_id)] = Number(e.detail?.verify_count) || null;
  renderFixed();
}

function renderFixed(){
  const el = document.getElementById('k-fixed-list');
  if (!el) return;
  const fixes = recentFixes();
  if (!fixes.length){ el.innerHTML = `<div class="k-lb-empty">${esc(t('fixed_empty'))}</div>`; return; }
  el.innerHTML = fixes.map(r => {
    const c = CATEGORIES[r.category];
    const w = state.wards[r.ward] || {};
    const days = Math.max(0, Math.round((new Date(r.resolvedAt) - new Date(r.createdAt)) / 86400000));
    const n = state.fixConfirms[r.id];
    return `
    <button type="button" class="k-fixed-card" data-open="${esc(r.id)}">
      <span class="k-fixed-photos">
        ${r.photo ? `<img src="${esc(r.photo)}" alt="" loading="lazy">` : '<span></span>'}
        ${r.resolvedPhoto ? `<img src="${esc(r.resolvedPhoto)}" alt="" loading="lazy">` : '<span></span>'}
        <span class="k-fixed-tag k-fixed-before">${esc(t('fixed_before'))}</span>
        <span class="k-fixed-tag k-fixed-after">${esc(t('fixed_after'))}</span>
      </span>
      <span class="k-fixed-body">
        <span class="k-fixed-cat">${c.icon} ${esc(t('cat_' + r.category))}</span>
        <span class="k-fixed-speed">${esc(t(days === 0 ? 'fixed_same_day' : 'fixed_days', { n: days }))}</span>
        <span class="k-fixed-meta">${r.ward ? esc(t('acc_ward', { n: r.ward })) : ''}${w.councillor_name ? ' · ' + esc(t('fixed_councillor', { name: w.councillor_name })) : ''}</span>
        ${n ? `<span class="k-fixed-confirm">✓ ${esc(t('fixed_confirmed', { n }))}</span>` : ''}
      </span>
    </button>`;
  }).join('');
  loadFixConfirmations();
}

function renderTicker(){
  const track = document.getElementById('k-ticker-track');
  const recent = primaries().slice(0, 12);
  if (!recent.length){ track.innerHTML = `<span class="k-ticker-item">${esc(t('lb_empty'))}</span>`; return; }
  const items = recent.map(r => `
    <span class="k-ticker-item"><span class="k-ticker-dot" style="background:${markerColor(r)}"></span>
    ${CATEGORIES[r.category].icon} ${esc(t('acc_ward', { n: r.ward ?? '?' }))} · ${esc(r.status === 'open' ? t('days_open', { n: daysSince(r.createdAt) }) : t('status_' + r.status))}</span>`).join('');
  track.innerHTML = items + items;
}

function renderTrust(){
  const section = document.getElementById('k-trust');
  const how = document.getElementById('k-hero-how');
  const on = state.mode === 'v2';
  section.hidden = !on;
  how.hidden = !on;
  if (!on) return;
  const r = state.rules;
  const vars = { cr: r.claim_radius_m, vr: r.vote_radius_m, q: r.verify_quorum, dq: r.dispute_quorum, h: r.challenge_hours };
  document.getElementById('k-trust-steps').innerHTML = [1, 2, 3, 4, 5, 6]
    .map(i => `<li class="k-trust-step"><span class="k-trust-n">${i}</span><span>${esc(t('trust_' + i, vars))}</span></li>`).join('');
}

/* ══════════════════════════════════════════════════════════
   REPORT SHEET (Namma-Kasa-style detail)
   ══════════════════════════════════════════════════════════ */
function openSheet(id){
  const r = state.byId.get(String(id));
  if (!r) return;
  state.sheetId = r.id;
  renderSheet();
  openModal('k-sheet');
  document.getElementById('k-sheet-body').scrollTop = 0;
  if (!r.pending) try { history.replaceState(null, '', `?report=${encodeURIComponent(r.id)}`); } catch (e) {}
  if (!r.pending && state.mode === 'v2'){
    api.events(r.id).then(list => {
      state.events.set(r.id, list);
      if (state.sheetId === r.id) renderTimeline();
    });
    if (r.replyCount){
      api.replies(r.id).then(list => {
        state.replies.set(r.id, list);
        if (state.sheetId === r.id){ const el = document.getElementById('k-replies'); if (el) el.innerHTML = renderRepliesHTML(r); }
      });
    }
  }
}

function closeSheet(){
  state.sheetId = null;
  try { history.replaceState(null, '', location.pathname); } catch (e) {}
}

function renderSheet(){
  const r = state.byId.get(state.sheetId);
  if (!r) return;
  const c = CATEGORIES[r.category];
  const days = daysSince(r.createdAt);
  const fixDays = r.resolvedAt ? Math.max(0, Math.round((new Date(r.resolvedAt) - new Date(r.createdAt)) / 86400000)) : null;
  const seenByMe = state.seen.has(r.id);

  let head, headClass;
  if (r.pending){ head = t('chip_pending'); headClass = 'pending'; }
  else if (r.status === 'resolved'){ head = t(r.resolution === 'legacy_unverified' ? 'head_resolved_legacy' : 'head_resolved'); headClass = 'resolved'; }
  else if (r.status === 'claimed'){ head = t('head_claimed'); headClass = 'claimed'; }
  else { head = t('head_open'); headClass = 'open'; }

  document.getElementById('k-sheet-head').innerHTML = `
    <div class="k-sheet-status">
      <span class="k-sev-dot" style="background:${COLORS[r.severity]}"></span>
      <span class="k-sheet-sev">${esc(t('sev_' + r.severity))}</span>
      <span class="k-sheet-sep">·</span>
      <span class="k-sheet-state k-state-${headClass}">${esc(head)}</span>
    </div>
    <div class="k-sheet-tools">
      ${r.pending ? '' : `<button type="button" class="k-icon-btn" data-share="${esc(r.id)}" aria-label="${esc(t('sheet_share'))}">${ICON_SHARE}</button>`}
      <button type="button" class="k-icon-btn" data-close aria-label="${esc(t('sheet_close'))}">✕</button>
    </div>`;

  const w = state.wards[r.ward] || {};
  const place = r.landmark || t('acc_ward', { n: r.ward ?? '?' });
  const directions = `https://www.google.com/maps/dir/?api=1&destination=${r.lat},${r.lng}`;

  document.getElementById('k-sheet-body').innerHTML = `
    <div class="k-sheet-photo">
      ${r.photo ? `<img src="${esc(r.photo)}" alt="${esc(t('cat_' + r.category))}" loading="eager">` : `<div class="k-sheet-noimg">${c.icon}</div>`}
      ${r.pending || r.status === 'resolved' ? '' : `
      <button type="button" class="k-seen-btn${seenByMe ? ' k-seen-done' : ''}" data-seen="${esc(r.id)}" ${seenByMe ? 'disabled' : ''}>
        ${ICON_EYE}<span>${esc(t(seenByMe ? 'sheet_seen_done' : 'sheet_seen_btn'))}</span>
      </button>`}
    </div>
    <div class="k-anon">${ICON_SHIELD} ${esc(t('sheet_anonymous'))}</div>
    <div class="k-allegation">⚖ ${esc(t('sheet_allegation'))} <a href="terms.html#allegations">${esc(t('sheet_terms'))}</a></div>

    <div class="k-sheet-place">
      <div class="k-sheet-cat">${c.icon} ${esc(t('cat_' + r.category))}${neighbourBadge(r)}</div>
      <h3 class="k-sheet-title">${esc(place)}</h3>
      <div class="k-sheet-wardline">${esc([r.landmark && r.ward ? t('acc_ward', { n: r.ward }) : '', w.councillor_name || ''].filter(Boolean).join(' · '))}</div>
      ${r.description ? `<p class="k-sheet-desc">${esc(r.description)}</p>` : ''}
      <div class="k-sheet-links">
        <a href="${directions}" target="_blank" rel="noopener">${ICON_NAV} ${esc(t('sheet_directions'))}</a>
        <span class="k-sheet-loc">${r.gps ? '📍 ' + esc(t('sheet_gps')) : state.mode === 'v2' ? '📌 ' + esc(t('sheet_pinned')) : ''}</span>
      </div>
    </div>

    <div class="k-cards">
      <div class="k-card"><b>${peopleSaw(r)}</b><span>${esc(t('stat_people'))}</span></div>
      <div class="k-card"><b>${r.status === 'resolved' && fixDays != null ? fixDays : days}</b><span>${esc(t(r.status === 'resolved' && fixDays != null ? 'stat_days_fix' : 'stat_days_open'))}</span></div>
      <div class="k-card k-card-wide"><b class="k-card-text">${esc(t('cat_' + r.category))}</b><span>${esc(t('stat_type'))}</span></div>
    </div>

    ${renderStatusPanel(r)}
    ${renderRating(r)}
    <div id="k-replies">${renderRepliesHTML(r)}</div>
    ${renderAccountability(r)}
    <div id="k-timeline">${renderTimelineHTML(r)}</div>`;

  const status = r.status === 'resolved'
    ? (fixDays != null ? t('foot_fixed', { d: fixDays }) : t('status_resolved'))
    : t('foot_unresolved', { d: days });
  document.getElementById('k-sheet-foot').innerHTML = `
    <div class="k-foot-line">${esc(t('foot_line', { ago: ago(r.createdAt), n: peopleSaw(r), status }))}</div>
    <div class="k-foot-actions">${renderActions(r)}</div>`;
}

function renderStatusPanel(r){
  const parts = [];
  if (r.pending) parts.push(`<div class="k-note">${esc(t('pn_pending'))}</div>`);
  if (r.flagged) parts.push(`<div class="k-note k-note-warn">⚑ ${esc(t('pn_flagged', { n: r.flags }))}</div>`);
  if (r.recurrence) parts.push(`<div class="k-note k-note-warn">↻ ${esc(t('pn_recurring', { n: r.recurrence }))}</div>`);
  if (r.rejectedClaims) parts.push(`<div class="k-note k-note-bad">✗ ${esc(t('pn_rejected', { n: r.rejectedClaims }))}</div>`);

  if (r.status === 'claimed' && r.claim){
    const q = state.rules.verify_quorum, dq = state.rules.dispute_quorum;
    const dots = Array.from({ length: q }, (_, i) => `<i class="${i < r.claim.verify ? 'on' : ''}"></i>`).join('');
    let timing;
    if (r.claim.finalAfter){
      const hrs = Math.max(0, Math.ceil((new Date(r.claim.finalAfter) - Date.now()) / 3600000));
      timing = t('pn_final_in', { h: hrs });
    } else {
      const expires = new Date(new Date(r.claim.createdAt).getTime() + state.rules.claim_expiry_days * 86400000);
      timing = t('pn_needs_more', { n: Math.max(0, q - r.claim.verify) }) + ' ' + t('pn_expires', { date: fmtDate(expires) });
    }
    parts.push(`
      <div class="k-panel k-panel-claim">
        <div class="k-panel-title">${esc(t('pn_claim_title'))}</div>
        ${beforeAfter(r.photo, r.claim.photo)}
        <div class="k-panel-meta">${esc(r.claim.distance != null ? t('pn_claim_meta', { ago: ago(r.claim.createdAt), d: r.claim.distance }) : t('pn_claim_meta_short', { ago: ago(r.claim.createdAt) }))}</div>
        <div class="k-progress"><span class="k-dots">${dots}</span>
          <span>${esc(t('pn_progress', { v: r.claim.verify, q, d: r.claim.dispute, dq }))}</span></div>
        <div class="k-panel-meta">${esc(timing)}</div>
        ${r.claim.held ? `<div class="k-note k-note-warn">⏸ ${esc(t('pn_claim_held'))}</div>` : ''}
      </div>`);
  } else if (r.status === 'claimed'){
    parts.push(`<div class="k-panel k-panel-claim"><div class="k-panel-meta">${esc(t('pn_legacy_review'))}</div></div>`);
  } else if (r.status === 'resolved' && r.resolution === 'legacy_unverified'){
    parts.push(`
      <div class="k-panel k-panel-legacy">
        <div class="k-panel-title">${esc(t('pn_legacy_title'))}</div>
        ${r.resolvedPhoto ? beforeAfter(r.photo, r.resolvedPhoto) : ''}
        <div class="k-panel-meta">${esc(t('pn_legacy_body'))}</div>
      </div>`);
  } else if (r.status === 'resolved'){
    const fixDays = Math.max(0, Math.round((new Date(r.resolvedAt) - new Date(r.createdAt)) / 86400000));
    parts.push(`
      <div class="k-panel k-panel-resolved">
        <div class="k-panel-title">✓ ${esc(t('pn_resolved_title'))}</div>
        ${beforeAfter(r.photo, r.resolvedPhoto)}
        <div class="k-panel-meta">${esc(t('pn_resolved_meta', { date: fmtDate(r.resolvedAt), days: fixDays }))}</div>
      </div>`);
  }
  return parts.join('');
}

function neighbourBadge(r){
  if (r.neighbour === 'verified') return ` <span class="k-badge k-badge-ok">✓ ${esc(t('nb_verified'))}</span>`;
  if (r.neighbour === 'doubted') return ` <span class="k-badge k-badge-warn">? ${esc(t('nb_doubted'))}</span>`;
  return '';
}

function renderRating(r){
  if (state.mode !== 'v2' || r.pending || r.status === 'resolved') return '';
  const mine = state.ratings[r.id] || {};
  const stars = (kind, value) => [1, 2, 3, 4, 5].map(n => `
    <button type="button" class="k-star${n <= (value || 0) ? ' on' : ''}" data-rate="${kind}:${n}:${esc(r.id)}"
      aria-label="${n}/5">★</button>`).join('');
  const summary = r.ratings
    ? t('rate_summary', { n: r.ratings, site: r.onsiteRatings, a: r.authAvg?.toFixed(1) ?? '–', s: r.sevAvg?.toFixed(1) ?? '–' })
    : t('rate_none');
  return `
    <div class="k-rate">
      <div class="k-acc-label">${esc(t('rate_title'))}</div>
      <div class="k-rate-summary">${esc(summary)}</div>
      <div class="k-rate-row"><span>${esc(t('rate_real'))}</span><span class="k-stars">${stars('a', mine.a)}</span></div>
      <div class="k-rate-row"><span>${esc(t('rate_serious'))}</span><span class="k-stars">${stars('s', mine.s)}</span></div>
      <div class="k-rate-hint">${esc(t('rate_hint', { n: 3 }))}</div>
    </div>`;
}

function renderRepliesHTML(r){
  if (!r.replyCount) return '';
  const list = state.replies.get(r.id);
  if (!list) return `<div class="k-replies"><div class="k-acc-label">${esc(t('reply_title'))}</div><div class="k-tl-empty">${esc(t('tl_loading'))}</div></div>`;
  return `<div class="k-replies"><div class="k-acc-label">${esc(t('reply_title'))}</div>${list.map(x => `
    <article class="k-reply">
      <header><b>${esc(x.responder_name)}</b><span>${esc(x.responder_role)}</span><time>${esc(fmtDate(x.created_at))}</time></header>
      <p>${esc(x.body)}</p>
      ${x.verified_note ? `<footer>✓ ${esc(x.verified_note)}</footer>` : ''}
    </article>`).join('')}
    <div class="k-reply-note">${esc(t('reply_note'))}</div></div>`;
}

function beforeAfter(before, after){
  if (!after) return '';
  return `
    <div class="k-ba">
      <figure><img src="${esc(before)}" alt="" loading="lazy"><figcaption>${esc(t('pn_before'))}</figcaption></figure>
      <figure><img src="${esc(after)}" alt="" loading="lazy"><figcaption class="k-green">${esc(t('pn_after'))}</figcaption></figure>
    </div>`;
}

function renderAccountability(r){
  const chain = CHAINS[CATEGORIES[r.category].chain];
  const w = state.wards[r.ward] || {};
  const nodes = chain.nodes.map((role, i) => `
    ${i ? '<span class="k-tree-link" aria-hidden="true"></span>' : ''}
    <button type="button" class="k-node" data-contact="role:${role}:${esc(r.id)}">
      <span class="k-node-abbr">${esc(ROLE_ABBR[role])}</span>
      <span class="k-node-text"><b>${esc(t('role_' + role))}</b><small>${esc(roleSub(role, i, chain.nodes.length))}</small></span>
    </button>`).join('');
  const councillor = w.councillor_name
    ? `<button type="button" class="k-node k-node-elected" data-contact="councillor:${r.ward}:${esc(r.id)}">
         <span class="k-node-abbr">WC</span>
         <span class="k-node-text"><b>${esc(w.councillor_name)}</b><small>${esc(t('acc_councillor'))}${w.party ? ' · ' + esc(w.party) : ''}</small></span></button>`
    : `<div class="k-node k-node-vacant"><span class="k-node-abbr">⚠</span>
         <span class="k-node-text"><b>${esc(t('acc_councillor'))}</b><small>${esc(r.ward ? t('acc_vacant') : t('acc_unknown'))}</small></span></div>`;
  const reps = ['mla', 'mp'].map(k => `
    <button type="button" class="k-rep-chip" data-contact="rep:${k}:${esc(r.id)}">
      ${repAvatar(REPS[k], 'k-rep-chip-av')}
      <b>${esc(REPS[k].name)}</b><small><span class="k-party k-party-${esc(REPS[k].party.toLowerCase())}">${esc(REPS[k].party)}</span> · ${esc(k.toUpperCase())}</small>
    </button>`).join('');
  return `
    <div class="k-acc">
      <div class="k-acc-label">${esc(t('acc_title'))}</div>
      <div class="k-tree">
        <div class="k-tree-root"><small>${esc(t('acc_your_ward'))}</small><b>${esc(r.ward ? t('acc_ward', { n: r.ward }) : t('acc_unknown'))}</b></div>
        <div class="k-tree-fork">
          <div class="k-tree-branch">
            <div class="k-node k-node-agency"><span class="k-node-abbr">${chain.agency === 'agency_police' ? '👮' : '🏛'}</span>
              <span class="k-node-text"><b>${esc(t(chain.agency))}</b><small>${esc(t('acc_frontline_first'))}</small></span></div>
            <span class="k-tree-link" aria-hidden="true"></span>
            ${nodes}
          </div>
          <div class="k-tree-branch">${councillor}</div>
        </div>
        ${chain.note ? `<div class="k-tree-note">${esc(t(chain.note))}</div>` : ''}
        <div class="k-acc-reps-label">${esc(t('acc_reps'))}</div>
        <div class="k-acc-reps">${reps}</div>
        <div class="k-acc-hint">${esc(t('acc_tap'))}</div>
        <a class="k-respond" href="${esc(replyMailto(r))}">${esc(t('reply_cta'))}</a>
      </div>
    </div>`;
}

function replyMailto(r){
  const subject = `Right of reply — Purulia Kasa report ${r.id}`;
  const body = [
    'Report: ' + `${PAGE_URL}?report=${encodeURIComponent(r.id)}`,
    'Your name:', 'Your position (e.g. Ward Councillor, Ward ' + (r.ward ?? '?') + '):',
    'Your response:', '',
    '(Please write from an official or otherwise verifiable address. We publish responses alongside the report.)'
  ].join('\n');
  return `mailto:${GRIEVANCE_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function roleSub(role, i, n){
  if (role === 'chairman') return REPS.chairman.name + ' · ' + t('acc_top');
  const s = t('role_' + role + '_s');
  if (i === 0) return s + ' · ' + t('acc_frontline');
  if (i === n - 1) return s + ' · ' + t('acc_top');
  return s;
}

function renderTimeline(){
  const el = document.getElementById('k-timeline');
  const r = state.byId.get(state.sheetId);
  if (el && r) el.innerHTML = renderTimelineHTML(r);
}

function renderTimelineHTML(r){
  if (r.pending || state.mode !== 'v2') return '';
  const list = state.events.get(r.id);
  const head = `<div class="k-acc-label">${esc(t('tl_title'))}</div>`;
  if (!list) return `<div class="k-timeline">${head}<div class="k-tl-empty">${esc(t('tl_loading'))}</div></div>`;
  const items = list.map(e => {
    const d = e.detail || {};
    const bits = [];
    if (e.actor_tag) bits.push(t('tl_by', { tag: 'C-' + e.actor_tag }));
    if (e.distance_m != null) bits.push(t('tl_dist', { d: e.distance_m }));
    if (e.kind === 'reported' && d.gps) bits.push(t('tl_gps', { a: d.accuracy_m }));
    if (e.kind === 'claim_rejected' && d.reason) bits.push(d.reason === 'disputed_on_site' ? t('rej_disputed_on_site') : String(d.reason));
    if (e.kind === 'claim_held' && d.reason) bits.push(t('held_' + d.reason));
    if (e.kind === 'resolved') bits.push(t('tl_counts', { v: d.verify_count ?? '?', d: d.dispute_count ?? 0 }));
    if (e.kind === 'flagged' && d.reason) bits.push(t('fr_' + d.reason) + (d.suggested_category ? ' → ' + t('cat_' + d.suggested_category) : ''));
    if (e.kind === 'recategorized' && d.to) bits.push(`${t('cat_' + d.from)} → ${t('cat_' + d.to)}${d.reason ? ' · ' + d.reason : ''}`);
    if (['reported', 'claimed', 'verified', 'disputed'].includes(e.kind)){
      if (d.capture === 'live') bits.push(t('tl_live'));
      else if (d.capture === 'file') bits.push(t('tl_file'));
      if (d.taken_minutes_ago >= 60) bits.push(t('tl_taken', { t: duration(d.taken_minutes_ago) }));
      if (d.flag === 'gps_far' && d.exif_distance_m != null) bits.push(t('tl_exif_far', { d: d.exif_distance_m }));
      if (d.ai_edited) bits.push(t('tl_ai'));
      if (d.needs_review) bits.push(t('tl_held'));
    }
    if (['moderated', 'vote_voided', 'reply_hidden', 'vote_cleared', 'claim_cleared'].includes(e.kind) && d.reason) bits.push(String(d.reason));
    if (e.kind === 'official_reply' && d.name) bits.push(`${d.name}${d.role ? ' · ' + d.role : ''}`);
    if ((e.kind === 'neighbours_verified' || e.kind === 'neighbours_doubted') && d.ratings) bits.push(t('tl_ratings', { n: d.ratings, a: d.average }));
    const photo = safeUrl(e.photo_url);
    return `
      <li class="k-tl-item k-tl-${esc(e.kind)}">
        <span class="k-tl-dot"></span>
        <div class="k-tl-main">
          <div class="k-tl-kind">${esc(t('ev_' + e.kind))}<time>${esc(ago(e.created_at))}</time></div>
          ${bits.length ? `<div class="k-tl-meta">${esc(bits.join(' · '))}</div>` : ''}
        </div>
        ${photo && e.kind !== 'reported' ? `<a href="${esc(photo)}" target="_blank" rel="noopener" class="k-tl-photo"><img src="${esc(photo)}" alt="" loading="lazy"></a>` : ''}
      </li>`;
  }).join('');
  return `<div class="k-timeline">${head}<ol class="k-tl">${items || `<li class="k-tl-empty">${esc(t('tl_empty'))}</li>`}</ol></div>`;
}

function renderActions(r){
  if (r.pending) return '';
  const flag = `<button type="button" class="k-act k-act-flag" data-flag="${esc(r.id)}">${ICON_FLAG} ${esc(t('act_flag'))}</button>`;
  if (r.status === 'resolved'){
    return `<button type="button" class="k-act k-act-again" data-again="${esc(r.id)}">↻ ${esc(t('act_again'))}</button>${flag}`;
  }
  if (r.status === 'claimed'){
    if (state.mode !== 'v2' || !r.claim) return flag;
    return `<button type="button" class="k-act k-act-verify" data-evidence="verify:${esc(r.id)}">✓ ${esc(t('act_confirm'))}</button>
            <button type="button" class="k-act k-act-dispute" data-evidence="dispute:${esc(r.id)}">✗ ${esc(t('act_dispute'))}</button>`;
  }
  return `<button type="button" class="k-act k-act-verify" data-evidence="claim:${esc(r.id)}">${ICON_CHECK} ${esc(t('act_verify'))}</button>${flag}`;
}

/* ══════════════════════════════════════════════════════════
   ACTIONS — seen, flag, share, contact
   ══════════════════════════════════════════════════════════ */
async function handleSeen(id, btn){
  const r = state.byId.get(id);
  if (!r || state.seen.has(id)) return;
  btn.disabled = true;
  const pos = await getPosition({ want: 100, timeout: 6000 }).catch(() => null);
  try {
    const res = await api.markSeen(r, pos);
    state.seen.add(id);
    try { localStorage.setItem('kasa_seen', JSON.stringify([...state.seen])); } catch (e) {}
    if (res.counted) r.seen += 1;
    showToast(t(res.counted ? 'seen_done' : res.reason === 'own_report' ? 'seen_own' : 'seen_dup'));
    renderSheet();
  } catch (e){
    btn.disabled = false;
    showToast(errorText(e));
  }
}

async function handleRate(spec, btn){
  const [kind, value, id] = spec.split(':');
  const r = state.byId.get(id);
  if (!r) return;
  const mine = { ...(state.ratings[id] || {}), [kind]: Number(value) };
  document.querySelectorAll('.k-rate .k-star').forEach(b => { b.disabled = true; });
  const pos = await getPosition({ want: 100, timeout: 6000 }).catch(() => null);
  try {
    const res = await api.rate(r, mine.a ?? null, mine.s ?? null, pos);
    state.ratings[id] = mine;
    try { localStorage.setItem('kasa_ratings', JSON.stringify(state.ratings)); } catch (e) {}
    state.seen.add(id);
    try { localStorage.setItem('kasa_seen', JSON.stringify([...state.seen])); } catch (e) {}
    Object.assign(r, {
      seen: Math.max(r.seen, (res.seen_count ?? r.seen + 1) - 1), ratings: res.rating_count, onsiteRatings: res.onsite_rating_count,
      authAvg: res.authenticity_avg, sevAvg: res.severity_avg, neighbour: res.neighbour_status
    });
    showToast(t(res.on_site ? 'rate_done_site' : 'rate_done'));
  } catch (e){
    showToast(errorText(e));
  }
  renderSheet();
}

function openFlag(id){
  const box = document.getElementById('k-flag-reasons');
  box.innerHTML = FLAG_REASONS.map(k => `
    <label class="k-radio"><input type="radio" name="k-flag-reason" value="${k}"><span>${esc(t('fr_' + k))}</span></label>`).join('');
  document.getElementById('k-flag-note').value = '';
  const submit = document.getElementById('k-flag-submit');
  submit.disabled = true;
  submit.dataset.id = id;
  const r = state.byId.get(id);
  const catWrap = document.getElementById('k-flag-cat-wrap');
  const catSel = document.getElementById('k-flag-cat');
  catSel.innerHTML = `<option value="">${esc(t('flag_pick_category'))}</option>` + Object.keys(CATEGORIES)
    .filter(k => k !== r?.category).map(k => `<option value="${k}">${CATEGORIES[k].icon} ${esc(t('cat_' + k))}</option>`).join('');
  catWrap.hidden = true;
  const update = () => {
    const reason = box.querySelector('input:checked')?.value;
    catWrap.hidden = reason !== 'wrong_category';
    submit.disabled = !reason || (reason === 'wrong_category' && !catSel.value);
  };
  box.onchange = update;
  catSel.onchange = update;
  openModal('k-flag-modal');
}

async function submitFlag(){
  const submit = document.getElementById('k-flag-submit');
  const r = state.byId.get(submit.dataset.id);
  const reason = document.querySelector('input[name="k-flag-reason"]:checked')?.value;
  if (!r || !reason) return;
  submit.disabled = true;
  try {
    const res = await api.flag(r, reason, document.getElementById('k-flag-note').value.trim(), document.getElementById('k-flag-cat').value);
    closeModal('k-flag-modal');
    showToast(t(res.counted ? 'flag_done' : 'flag_dup'));
    if (res.counted){ r.flags += 1; if (res.under_review) r.flagged = true; renderSheet(); }
  } catch (e){
    submit.disabled = false;
    showToast(errorText(e));
  }
}

function shareReport(id){
  const r = state.byId.get(id);
  if (!r) return;
  const url = `${PAGE_URL}?report=${encodeURIComponent(id)}`;
  const text = t('share_text', { cat: t('cat_' + r.category), ward: r.ward ?? '?', days: daysSince(r.createdAt) });
  if (navigator.share){ navigator.share({ title: 'Purulia Kasa', text, url }).catch(() => {}); return; }
  copyText(url);
}

/* A ward link opens the map filtered to that ward: something a councillor can share. */
function shareWard(n){
  const s = wardStats()[n] || { open: 0, resolved: 0 };
  const url = `${PAGE_URL}?ward=${n}`;
  const text = t('ward_share_text', { n, open: s.open, fixed: s.resolved });
  if (navigator.share){ navigator.share({ title: 'Purulia Kasa', text, url }).catch(() => {}); return; }
  copyText(url);
}

/* Open data: reports as a spreadsheet, public columns only. */
const CSV_COLUMNS = ['id', 'created_at', 'ward', 'category', 'severity', 'status', 'resolution', 'resolved_at',
  'days_open', 'overdue', 'lat', 'lng', 'landmark', 'description', 'people_saw', 'rejected_cleanup_claims',
  'times_recurred', 'duplicate', 'photo_url', 'resolved_photo_url', 'link'];

function csvCell(v){
  if (v == null) return '';
  if (typeof v !== 'string') return String(v);
  // A leading = + - @ would make Excel/Sheets run a citizen's text as a formula.
  const s = /^[=+\-@\t\r]/.test(v) ? "'" + v : v;
  return '"' + s.replace(/"/g, '""') + '"';
}

function downloadCSV(scope){
  const rows = (scope === 'all' ? state.reports : filtered()).filter(r => !r.pending);
  if (!rows.length) return showToast(t('csv_empty'));
  const lines = rows.map(r => [
    r.id, r.createdAt, r.ward, r.category, r.severity, r.status, r.resolution, r.resolvedAt,
    r.status === 'resolved' ? null : daysSince(r.createdAt), isOverdue(r), r.lat, r.lng, r.landmark, r.description,
    peopleSaw(r), r.rejectedClaims, r.recurrence, r.duplicate, r.photo, r.resolvedPhoto,
    `${PAGE_URL}?report=${encodeURIComponent(r.id)}`
  ].map(csvCell).join(','));
  // The BOM makes Excel read Bengali and Hindi text as UTF-8.
  const blob = new Blob(['\uFEFF' + [CSV_COLUMNS.join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const ward = scope !== 'all' && state.filters.ward ? `ward-${state.filters.ward}-` : '';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `purulia-kasa-${ward}${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  showToast(t('csv_done', { n: rows.length }));
}

function copyText(s){
  (navigator.clipboard?.writeText(s) || Promise.reject()).then(() => showToast(t('ct_copied')), () => showToast(s, 6000));
}

function reportMessage(r){
  const w = state.wards[r.ward] || {};
  return [
    `Purulia Kasa — ${t('cat_' + r.category)}`,
    `Ward ${r.ward ?? '?'}${w.councillor_name ? ' (' + w.councillor_name + ')' : ''}`,
    r.landmark ? `Near: ${r.landmark}` : '',
    `Severity: ${r.severity} · ${daysSince(r.createdAt)} days unresolved`,
    r.description || '',
    `Map: https://www.google.com/maps?q=${r.lat},${r.lng}`,
    r.pending ? '' : `Report: ${PAGE_URL}?report=${encodeURIComponent(r.id)}`
  ].filter(Boolean).join('\n');
}

function openContact(spec){
  const [kind, key, id] = spec.split(':');
  const r = state.byId.get(id);
  if (!r) return;
  const msg = reportMessage(r);
  const wa = `https://wa.me/${MUNICIPALITY_PHONE}?text=${encodeURIComponent(msg)}`;
  const mail = `mailto:${MUNICIPALITY_EMAIL}?subject=${encodeURIComponent('Purulia Kasa — ' + t('cat_' + r.category) + ' — Ward ' + (r.ward ?? '?'))}&body=${encodeURIComponent(msg)}`;
  const tweet = (handle) => `https://twitter.com/intent/tweet?text=${encodeURIComponent((handle ? '@' + handle + ' ' : '') + msg.split('\n').slice(0, 4).join('\n') + '\n' + PAGE_URL + '?report=' + encodeURIComponent(r.id))}`;

  let title, sub, opts = [];
  if (kind === 'role'){
    title = t('role_' + key);
    sub = t('ct_note_roles');
    const police = ['ps', 'sdpo', 'sp'].includes(key);
    if (police) opts.push(['tel:112', '📞 ' + t('ct_call112')]);
    opts.push([wa, '💬 ' + t('ct_whatsapp')], [mail, '✉️ ' + t('ct_email')]);
  } else if (kind === 'councillor'){
    const w = state.wards[key] || {};
    title = w.councillor_name || t('acc_councillor');
    sub = t('acc_councillor') + ' · ' + t('acc_ward', { n: key }) + (w.party ? ' · ' + w.party : '');
    opts.push([wa, '💬 ' + t('ct_whatsapp')], [mail, '✉️ ' + t('ct_email')]);
  } else {
    const rep = REPS[key];
    title = rep.name;
    sub = t(rep.role) + ' · ' + rep.party;
    opts.push([tweet(key === 'mla' ? MLA_TWITTER_HANDLE : ''), '𝕏 ' + (key === 'mla' ? t('ct_x_tag', { h: MLA_TWITTER_HANDLE }) : t('ct_x'))]);
    opts.push([wa, '💬 ' + t('ct_whatsapp')]);
  }
  document.getElementById('k-contact-content').innerHTML = `
    <h3 class="k-modal-title">${esc(title)}</h3>
    <p class="k-modal-sub">${esc(sub)}</p>
    <div class="k-contact-list">
      ${opts.map(([href, label]) => `<a class="k-btn k-btn-secondary" href="${esc(href)}" target="_blank" rel="noopener">${esc(label)}</a>`).join('')}
      <button type="button" class="k-btn k-btn-ghost" data-copy-link="${esc(r.id)}">🔗 ${esc(t('ct_copy'))}</button>
    </div>`;
  openModal('k-contact-modal');
}

/* ══════════════════════════════════════════════════════════
   ON-SITE EVIDENCE — claim a cleanup, confirm it, dispute it
   ══════════════════════════════════════════════════════════ */
function openEvidence(spec){
  const [mode, id] = spec.split(':');
  const r = state.byId.get(id);
  if (!r) return;
  const legacy = state.mode !== 'v2';
  const m = legacy ? 'legacy' : mode;
  ev = { mode: m, r, pos: null, blob: null, meta: null, setStatus: (s) => { document.getElementById('k-ev-submit').textContent = s; } };
  const rules = state.rules;
  const radius = m === 'claim' ? rules.claim_radius_m : rules.vote_radius_m;
  ev.radius = radius;
  document.getElementById('k-ev-title').textContent = t('ev_title_' + m);
  document.getElementById('k-ev-sub').textContent = t('ev_sub_' + m, { q: rules.verify_quorum, r: radius, dq: rules.dispute_quorum });
  document.getElementById('k-ev-loc-status').textContent = t('ev_loc_hint', { r: radius });
  document.getElementById('k-ev-loc-status').className = 'k-ev-status';
  document.getElementById('k-ev-preview').innerHTML = '';
  document.getElementById('k-ev-photo').value = '';
  document.getElementById('k-ev-file-btn').hidden = true;
  document.getElementById('k-ev-photo-status').className = 'k-ev-status';
  document.getElementById('k-ev-photo-status').textContent = t('ev_photo_hint');
  document.getElementById('k-ev-note').value = '';
  document.getElementById('k-ev-note-wrap').hidden = m !== 'dispute';
  document.getElementById('k-ev-loc-btn').closest('.k-ev-step').hidden = legacy;
  updateEvidenceSubmit();
  openModal('k-ev-modal');
  if (!legacy) checkEvidenceLocation();
}

async function checkEvidenceLocation(){
  const status = document.getElementById('k-ev-loc-status');
  const btn = document.getElementById('k-ev-loc-btn');
  const want = state.rules.max_gps_accuracy_m;
  btn.disabled = true;
  status.className = 'k-ev-status';
  status.textContent = t('ev_loc_wait', { a: '…' });
  try {
    const pos = await getPosition({ want, timeout: 20000, onProgress: p => { status.textContent = t('ev_loc_wait', { a: Math.round(p.accuracy) }); } });
    const d = Math.round(distanceM(pos.lat, pos.lng, ev.r.lat, ev.r.lng));
    const a = Math.round(pos.accuracy);
    if (pos.accuracy > want){ ev.pos = null; setEvStatus(status, 'bad', t('ev_loc_weak', { a })); }
    else if (d > ev.radius){ ev.pos = null; setEvStatus(status, 'bad', t('ev_loc_far', { d, r: ev.radius })); }
    else { ev.pos = pos; setEvStatus(status, 'ok', t('ev_loc_ok', { d, a })); }
  } catch (e){
    ev.pos = null;
    setEvStatus(status, 'bad', t(e && e.code === 1 ? 'ev_loc_denied' : 'ev_loc_fail'));
  }
  btn.disabled = false;
  updateEvidenceSubmit();
}

function setEvStatus(el, kind, text){ el.className = 'k-ev-status k-ev-' + kind; el.textContent = text; }

function setEvidencePhoto(blob, meta, okKey){
  ev.blob = blob;
  ev.meta = meta;
  document.getElementById('k-ev-preview').innerHTML = blob ? `<img src="${URL.createObjectURL(blob)}" alt="">` : '';
  if (okKey) setEvStatus(document.getElementById('k-ev-photo-status'), 'ok', t(okKey));
  updateEvidenceSubmit();
}

function rejectEvidencePhoto(text){
  setEvidencePhoto(null, null);
  setEvStatus(document.getElementById('k-ev-photo-status'), 'bad', text);
}

async function captureEvidencePhoto(){
  if (!ev) return;
  const res = await openLiveCamera();
  if (!ev) return;
  if (res.blob) return setEvidencePhoto(res.blob, { capture: 'live', capture_token: res.token || undefined }, 'ev_photo_live');
  if (res.error === 'cancelled') return;
  // No camera in this browser (some in-app browsers) or permission refused:
  // allow a file, whose time, location and AI markers are then checked.
  if (!state.rules.require_live_capture) document.getElementById('k-ev-file-btn').hidden = false;
  setEvStatus(document.getElementById('k-ev-photo-status'), 'bad', t(res.error === 'denied' ? 'cam_denied' : 'cam_unavailable'));
}

async function handleEvidencePhoto(file){
  if (!file || !ev) return;
  try {
    const meta = await readPhotoMeta(file);
    if (meta.ai_marker) return rejectEvidencePhoto(t('ev_photo_ai'));
    if (meta.taken_at){
      const taken = new Date(meta.taken_at).getTime();
      const skew = 10 * 60000;
      const notBefore = ev.mode === 'claim' ? 0 : new Date(ev.r.claim?.createdAt || 0).getTime() - skew;
      if (taken <= Date.now() + skew && (Date.now() - taken > state.rules.max_photo_age_minutes * 60000 || taken < notBefore)){
        return rejectEvidencePhoto(t('ev_photo_old', { ago: ago(meta.taken_at) }));
      }
    }
    setEvidencePhoto(await compressImage(file), meta, 'ev_photo_file');
  } catch (e){
    rejectEvidencePhoto(t('err_photo_read'));
  }
}

/* ══════════════════════════════════════════════════════════
   LIVE CAMERA — evidence photos come straight from the camera, so
   there is no gallery step where an old, borrowed or AI-edited photo
   could slip in. (Someone determined can still fake it; the people
   confirming on the spot are the real check.)
   ══════════════════════════════════════════════════════════ */
const camera = { stream: null, blob: null, resolve: null };

function cameraSupported(){
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && window.isSecureContext !== false;
}

function showCameraState(s){
  document.getElementById('k-cam-video').hidden = s !== 'live';
  document.getElementById('k-cam-still').hidden = s !== 'still';
  document.getElementById('k-cam-shutter').hidden = s !== 'live';
  document.getElementById('k-cam-retake').hidden = s !== 'still';
  document.getElementById('k-cam-use').hidden = s !== 'still';
}

function openCamera(){
  return new Promise(resolve => {
    camera.resolve = resolve;
    camera.blob = null;
    const shutter = document.getElementById('k-cam-shutter');
    shutter.disabled = true;
    shutter.setAttribute('aria-label', t('cam_capture'));
    showCameraState('live');
    document.getElementById('k-cam-msg').textContent = t('cam_starting');
    document.getElementById('k-cam').hidden = false;
    startCameraStream();
  });
}

async function startCameraStream(){
  const video = document.getElementById('k-cam-video');
  try {
    camera.stream = await navigator.mediaDevices.getUserMedia({
      audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }
    });
    if (!camera.resolve){ stopCameraStream(); return; } // closed while starting
    video.srcObject = camera.stream;
    await video.play().catch(() => {});
    document.getElementById('k-cam-msg').textContent = '';
    document.getElementById('k-cam-shutter').disabled = false;
  } catch (e){
    closeCamera({ error: e && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? 'denied' : 'unavailable' });
  }
}

function stopCameraStream(){
  if (camera.stream) camera.stream.getTracks().forEach(tr => tr.stop());
  camera.stream = null;
  document.getElementById('k-cam-video').srcObject = null;
}

function closeCamera(result){
  stopCameraStream();
  document.getElementById('k-cam').hidden = true;
  const done = camera.resolve;
  camera.resolve = null;
  if (done) done(result);
}

async function takeCameraShot(){
  const video = document.getElementById('k-cam-video');
  if (!video.videoWidth) return;
  const scale = Math.min(1, PHOTO_MAX_PX / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  try {
    camera.blob = await new Promise((resolve, reject) =>
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', 0.85));
  } catch (e){
    showToast(t('err_photo_read'));
    return;
  }
  const still = document.getElementById('k-cam-still');
  if (still.src) URL.revokeObjectURL(still.src);
  still.src = URL.createObjectURL(camera.blob);
  showCameraState('still');
}

function updateEvidenceSubmit(){
  const btn = document.getElementById('k-ev-submit');
  if (!ev) return;
  btn.textContent = t('ev_submit_' + ev.mode);
  btn.className = 'k-btn ' + (ev.mode === 'dispute' ? 'k-btn-flag' : 'k-btn-verify');
  btn.disabled = !ev.blob || (ev.mode !== 'legacy' && !ev.pos);
}

async function submitEvidence(){
  if (!ev || !ev.blob) return;
  const btn = document.getElementById('k-ev-submit');
  const { mode, r } = ev;
  btn.disabled = true;
  btn.textContent = t('ev_sending');
  try {
    const res = await api.evidence(mode, r, ev.blob, ev.pos, document.getElementById('k-ev-note').value.trim(), ev.meta);
    closeModal('k-ev-modal');
    const q = state.rules.verify_quorum, dq = state.rules.dispute_quorum;
    let msg;
    if (mode === 'legacy') msg = t('ev_done_legacy');
    else if (mode === 'claim') msg = t(res.needs_review ? 'ev_done_claim_held' : 'ev_done_claim', { q });
    else if (res.needs_review) msg = t('ev_done_held');
    else if (res.claim_status === 'rejected') msg = t('ev_done_rejected');
    else if (res.claim_status === 'accepted') msg = t('ev_resolved');
    else if (mode === 'verify' && res.final_after) msg = t('ev_done_quorum_at', { at: new Date(res.final_after).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }) });
    else if (mode === 'verify') msg = t('ev_done_verify', { v: res.verify_count, q });
    else msg = t('ev_done_dispute', { d: res.dispute_count, dq });
    showToast(msg, 6000);
    ev = null;
    state.events.delete(r.id);
    await loadReports();
    renderAll();
    if (state.sheetId === r.id) openSheet(r.id);
  } catch (e){
    showToast(errorText(e), 7000);
    updateEvidenceSubmit();
  }
}

/* ══════════════════════════════════════════════════════════
   NEW REPORT FLOW
   ══════════════════════════════════════════════════════════ */
function newDraft(){
  return { category: null, photoBlob: null, photoMeta: null, lat: null, lng: null, accuracy: null, ward: null, severity: 'minor', landmark: '', description: '' };
}

function openReport(prefill){
  draft = newDraft();
  document.getElementById('k-next-2').disabled = true;
  document.getElementById('k-photo-preview').innerHTML = '';
  document.getElementById('k-photo-note').hidden = true;
  document.getElementById('k-landmark').value = '';
  document.getElementById('k-desc').value = '';
  document.getElementById('k-ward').value = '';
  document.getElementById('k-coords').textContent = t('step3_no_loc');
  document.getElementById('k-gps-btn').textContent = t('step3_gps');
  setSeverity('minor');
  if (miniMarker){ miniMarker.remove(); miniMarker = null; }
  renderCategoryGrid();
  if (prefill){
    selectCategory(prefill.category, false);
    setLocation(prefill.lat, prefill.lng, null);
    document.getElementById('k-landmark').value = prefill.landmark || '';
  } else {
    useGPS();
  }
  goToStep(1);
  openModal('k-modal');
}

function goToStep(n){
  document.querySelectorAll('#k-modal .k-modal-step').forEach(s => { s.hidden = s.dataset.step !== String(n); });
  document.querySelectorAll('#k-modal .k-steps-bar i').forEach(i => { i.classList.toggle('on', n === 'done' || Number(i.dataset.bar) <= Number(n)); });
  document.querySelector('#k-modal .k-modal-sheet').scrollTop = 0;
  if (n === 3){
    initMiniMap();
    setTimeout(() => miniMap && miniMap.resize(), 60);
  }
  updateSubmitState();
}

function renderCategoryGrid(){
  const grid = document.getElementById('k-cat-grid');
  grid.innerHTML = GROUPS.map(g => `
    <div class="k-cat-group">
      <div class="k-cat-group-label">${esc(t('grp_' + g))}</div>
      <div class="k-cat-tiles">
        ${Object.entries(CATEGORIES).filter(([, c]) => c.group === g).map(([k, c]) => `
          <button type="button" class="k-cat-tile${draft?.category === k ? ' on' : ''}" data-cat="${k}">
            <span class="k-cat-icon">${c.icon}</span><span>${esc(t('cat_' + k))}</span>
          </button>`).join('')}
      </div>
    </div>`).join('');
}

function selectCategory(key, advance = true){
  if (!CATEGORIES[key]) return;
  draft.category = key;
  const warn = document.getElementById('k-cat-warning');
  warn.hidden = !CATEGORIES[key].review;
  warn.textContent = CATEGORIES[key].review ? t('illegal_note') : '';
  renderCategoryGrid();
  if (advance) goToStep(3);
}

/* Report photos come only from the in-page camera: no gallery, no file picker. */
async function captureReportPhoto(){
  if (!draft) return;
  const note = document.getElementById('k-photo-note');
  const res = await openLiveCamera();
  if (!draft) return;
  if (!res.blob){
    if (res.error === 'cancelled') return;
    note.hidden = false;
    note.textContent = t(res.error === 'denied' ? 'cam_permission_denied' : 'cam_report_unavailable');
    return;
  }
  draft.photoBlob = res.blob;
  draft.photoMeta = { capture: 'live', capture_token: res.token || undefined };
  const preview = document.getElementById('k-photo-preview');
  const old = preview.querySelector('img');
  if (old) URL.revokeObjectURL(old.src);
  preview.innerHTML = `<img src="${URL.createObjectURL(res.blob)}" alt="">`;
  note.hidden = true;
  note.textContent = '';
  document.getElementById('k-next-2').disabled = false;
}

function initMiniMap(){
  if (miniMap || !window.maplibregl) return;
  miniMap = new maplibregl.Map({
    container: 'k-mini-map', style: MAP_STYLE,
    center: draft.lng != null ? [draft.lng, draft.lat] : MAP_CENTER, zoom: draft.lng != null ? 16 : MAP_ZOOM, attributionControl: false
  });
  miniMap.on('click', e => setLocation(e.lngLat.lat, e.lngLat.lng, null));
  if (draft.lng != null) placeMiniMarker();
}

function placeMiniMarker(){
  if (!miniMap) return;
  if (miniMarker) miniMarker.setLngLat([draft.lng, draft.lat]);
  else miniMarker = new maplibregl.Marker({ color: '#d4882a' }).setLngLat([draft.lng, draft.lat]).addTo(miniMap);
}

function setLocation(lat, lng, accuracy){
  draft.lat = lat; draft.lng = lng; draft.accuracy = accuracy;
  const ward = detectWard(lat, lng);
  if (ward){ draft.ward = ward; document.getElementById('k-ward').value = String(ward); }
  document.getElementById('k-coords').textContent =
    `${lat.toFixed(5)}, ${lng.toFixed(5)} · ${accuracy != null ? t('step3_loc_gps', { acc: Math.round(accuracy) }) : t('step3_loc_pin')}` +
    (ward ? '' : ' · ' + t('step3_pick_ward'));
  placeMiniMarker();
  if (miniMap) miniMap.easeTo({ center: [lng, lat], zoom: Math.max(miniMap.getZoom(), 16) });
  updateSubmitState();
}

/* Fast Wi-Fi/cached fix — usually under a second, even on Macs without GPS. */
function quickPosition(){
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('no geolocation'));
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      reject, { enableHighAccuracy: false, maximumAge: 300000, timeout: 8000 });
  });
}

let gpsRun = 0;
async function useGPS(){
  const btn = document.getElementById('k-gps-btn');
  const run = ++gpsRun;
  const d = draft;
  // A manual map pin (accuracy null) or a newer request wins over a late fix.
  const stillMine = () => run === gpsRun && draft === d && !(d.lat != null && d.accuracy == null);
  const label = p => `✓ Location found (±${Math.round(p.accuracy)}m)`;
  btn.textContent = t('step3_gps_wait');

  let got = false;
  const quick = quickPosition().then(p => {
    if (!stillMine()) return;
    got = true;
    setLocation(p.lat, p.lng, p.accuracy);
    btn.textContent = label(p);
  }).catch(() => {});

  // Refine quietly with high accuracy; only replaces the fix if it is better.
  const precise = getPosition({ want: 30, timeout: 10000, onProgress: p => {
    if (!stillMine() || (got && p.accuracy >= d.accuracy)) return;
    got = true;
    setLocation(p.lat, p.lng, p.accuracy);
    btn.textContent = label(p);
  } }).catch(e => e);

  const err = await Promise.all([quick, precise]).then(([, e]) => e);
  if (!got && stillMine()){
    btn.textContent = t('step3_gps');
    showToast(err?.code === 1
      ? 'Location permission denied. Tap the map to pin the spot.'
      : 'Could not get location. Tap the map to pin the spot.');
  }
}

function setSeverity(sev){
  if (draft) draft.severity = sev;
  document.querySelectorAll('#k-severity button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.sev === sev)));
}

function updateSubmitState(){
  const btn = document.getElementById('k-submit');
  const coords = document.getElementById('k-coords');
  const hasGoodGPS = draft?.lat != null;
  const canSubmit = draft?.category && draft?.photoBlob && hasGoodGPS && draft?.ward;

  if (btn) {
    btn.disabled = !canSubmit;
    // Show GPS status in submit button
    if (!draft?.ward) {
      btn.title = 'Select a ward';
    } else if (!draft?.photoBlob) {
      btn.title = 'Take a photo';
    } else if (draft.lat == null) {
      btn.title = 'Get your location or tap the map';
    } else {
      btn.title = '';
    }
  }
}

async function submitReport(){
  const btn = document.getElementById('k-submit');
  draft.ward = parseInt(document.getElementById('k-ward').value, 10) || null;
  draft.landmark = document.getElementById('k-landmark').value.trim();
  draft.description = document.getElementById('k-desc').value.trim();
  const hasGoodGPS = draft.lat != null;
  if (!draft.category || !draft.photoBlob || !hasGoodGPS || !draft.ward){ updateSubmitState(); return; }
  draft.clientId = 'R' + Date.now() + randomName(6);
  btn.disabled = true;
  btn.textContent = t('step3_uploading');

  if (!navigator.onLine){
    await queuePendingReport(draft);
    btn.textContent = t('step3_submit');
    return afterSubmit({ offline: true }, draft);
  }
  try {
    const res = await api.createReport(draft);
    btn.textContent = t('step3_submit');
    afterSubmit(res, draft);
  } catch (e){
    btn.textContent = t('step3_submit');
    // The report service can't start a session (e.g. sign-in switched off):
    // keep the report on the phone and upload it on a later visit.
    if (e instanceof KasaError && e.key === 'err_session'){
      await queuePendingReport(draft);
      return afterSubmit({ saved: true }, draft);
    }
    if (e instanceof KasaError || /^KASA_/.test(e?.message || '')){
      btn.disabled = false;
      showToast(errorText(e), 7000);
      return;
    }
    console.warn('Kasa: submit failed, saving offline', e);
    await queuePendingReport(draft);
    afterSubmit({ offline: true }, draft);
  }
}

async function afterSubmit(res, d){
  let title = 'done_title', sub = 'done_sub';
  if (res.offline){ title = 'done_title_offline'; sub = 'done_sub_offline'; }
  else if (res.saved){ title = 'done_title_saved'; sub = 'done_sub_saved'; }
  else if (res.moderation === 'review'){ title = 'done_title_review'; sub = 'done_sub_review'; }
  else if (res.duplicateOf){ title = 'done_title_dup'; sub = 'done_sub_dup'; }
  else if (res.recurrenceOf){ title = 'done_title_recur'; sub = 'done_sub_recur'; }
  else if (res.legacyPending){ sub = 'done_sub_legacy'; }
  document.getElementById('k-done-title').textContent = t(title);
  document.getElementById('k-done-sub').textContent = t(sub);
  const id = res.duplicateOf ? String(res.duplicateOf) : res.id;
  const shareBtn = document.getElementById('k-done-share');
  shareBtn.hidden = !id || res.moderation === 'review';
  shareBtn.dataset.id = id || '';
  const fake = { ...d, id: id || d.clientId, createdAt: new Date().toISOString(), ward: d.ward, pending: !id };
  document.getElementById('k-wa-escalate').href = `https://wa.me/${MUNICIPALITY_PHONE}?text=${encodeURIComponent(reportMessage(fake))}`;
  goToStep('done');
  await loadReports();
  renderAll();
}

/* ── Offline queue (IndexedDB) ── */
async function getPendingReports(){
  try { return (await window.idbKeyval?.get('pending_reports_v2')) || []; } catch (e) { return []; }
}

async function queuePendingReport(d){
  const list = await getPendingReports();
  list.push({ ...d, createdAt: new Date().toISOString() });
  try { await window.idbKeyval.set('pending_reports_v2', list); } catch (e) { console.error('Kasa: could not save offline', e); }
}

async function removePendingReport(clientId){
  const list = await getPendingReports();
  try { await window.idbKeyval.set('pending_reports_v2', list.filter(p => p.clientId !== clientId)); } catch (e) {}
}

function pendingToRow(p){
  return {
    id: p.clientId, created_at: p.createdAt, lat: p.lat, lng: p.lng, ward_no: p.ward, category: p.category,
    severity: p.severity, status: 'open', description: p.description, landmark: p.landmark,
    photo_url: p.photoBlob ? URL.createObjectURL(p.photoBlob) : null, _pending: true
  };
}

let syncing = false;
async function syncOfflineQueue(){
  if (syncing || !navigator.onLine) return;
  const list = await getPendingReports();
  if (!list.length) return;
  syncing = true;
  showToast(t('sync_start', { n: list.length }));
  let done = 0;
  for (const p of list){
    try { await api.createReport(p); await removePendingReport(p.clientId); done++; }
    catch (e){
      console.warn('Kasa: sync failed for', p.clientId, e);
      if (/^KASA_/.test(e?.message || '')) await removePendingReport(p.clientId);
    }
  }
  syncing = false;
  if (done){ showToast(t('sync_done', { n: done })); await loadReports(); renderAll(); }
}

function setupOfflineDetection(){
  const update = () => { document.getElementById('k-offline').hidden = navigator.onLine; };
  window.addEventListener('online', () => { update(); syncOfflineQueue(); });
  window.addEventListener('offline', update);
  update();
}

/* ══════════════════════════════════════════════════════════
   STATIC SECTIONS — chains, representatives, QR
   ══════════════════════════════════════════════════════════ */
function renderChainSection(){
  const tabs = document.getElementById('k-chain-tabs');
  const tabKeys = [['sanitation', 'garbage'], ['engineering', 'road'], ['lighting', 'streetlight'], ['water', 'water'], ['enforcement', 'encroachment'], ['mining', 'illegal_mining'], ['police', 'illegal_other']];
  tabs.innerHTML = tabKeys.map(([chain, cat]) => `
    <button type="button" class="k-chain-tab${state.chainTab === chain ? ' on' : ''}" data-chain="${chain}" role="tab" aria-selected="${state.chainTab === chain}">
      ${CATEGORIES[cat].icon} ${esc(t('chaintab_' + chain))}</button>`).join('');
  const chain = CHAINS[state.chainTab];
  const n = chain.nodes.length;
  document.getElementById('k-chain').innerHTML = `
    <div class="k-chain-node k-chain-agency"><div class="k-chain-icon">${chain.agency === 'agency_police' ? '👮' : '🏛'}</div>
      <div class="k-chain-text"><div class="k-chain-name">${esc(t(chain.agency))}</div><div class="k-chain-role">${esc(t('acc_frontline_first'))}</div></div></div>
    ${chain.nodes.map((role, i) => `
      <div class="k-chain-arrow">${i ? esc(t('acc_escalate')) : '↓'}</div>
      <div class="k-chain-node"><div class="k-chain-icon">${esc(ROLE_ABBR[role])}</div>
        <div class="k-chain-text"><div class="k-chain-name">${esc(t('role_' + role))}</div><div class="k-chain-role">${esc(roleSub(role, i, n))}</div></div></div>`).join('')}
    ${chain.note ? `<div class="k-chain-note"><div class="k-chain-note-text">${esc(t(chain.note))}</div></div>` : ''}
    <div class="k-chain-note"><div class="k-chain-note-label">${esc(t('chain_councillor_label'))}</div>
      <div class="k-chain-note-text">${esc(t('chain_councillor_text'))}</div></div>`;
}

function renderReps(){
  document.getElementById('k-auth-grid').innerHTML = ['mla', 'mp', 'chairman'].map(k => {
    const rep = REPS[k];
    return `
      <div class="k-auth-card">
        ${repAvatar(rep, 'k-rep-avatar k-auth-avatar')}
        <div>
          <div class="k-auth-label">${esc(t(rep.role))}</div>
          <div class="k-auth-name">${esc(rep.name)}</div>
          <div class="k-auth-meta">${esc(rep.party)}${rep.meta ? ' · ' + esc(t(rep.meta)) : ''}</div>
          ${rep.photo && rep.photoCredit ? `<div class="k-auth-credit">${esc(t('rep_photo_credit', { credit: rep.photoCredit }))}</div>` : ''}
        </div>
        <button type="button" class="k-auth-action" data-profile="${k}">${esc(t('auth_view'))}</button>
      </div>`;
  }).join('');
}

function openRepProfile(key){
  const rep = REPS[key];
  const all = primaries();
  const open = all.filter(r => r.status !== 'resolved');
  const verified = all.filter(r => r.status === 'resolved' && r.resolution !== 'legacy_unverified');
  const byWard = {};
  open.forEach(r => { if (r.ward) byWard[r.ward] = (byWard[r.ward] || 0) + 1; });
  const worst = Object.entries(byWard).sort((a, b) => b[1] - a[1]).slice(0, 5);
  document.getElementById('k-rep-content').innerHTML = `
    <div class="k-rep-header">
      ${repAvatar(rep, 'k-rep-avatar')}
      <div><div class="k-rep-name">${esc(rep.name)}</div><div class="k-rep-role">${esc(t(rep.role))} · ${esc(rep.party)}</div></div>
    </div>
    <div class="k-rep-stats">
      <div class="k-rep-stat"><div class="k-rep-stat-n">${open.length}</div><div class="k-rep-stat-l">${esc(t('rep_open'))}</div></div>
      <div class="k-rep-stat"><div class="k-rep-stat-n">${verified.length}</div><div class="k-rep-stat-l">${esc(t('rep_resolved'))}</div></div>
      <div class="k-rep-stat"><div class="k-rep-stat-n">${Object.keys(byWard).length}</div><div class="k-rep-stat-l">${esc(t('rep_wards'))}</div></div>
    </div>
    <div class="k-rep-worst-title">${esc(t('rep_worst'))}</div>
    ${worst.length ? worst.map(([w, n]) => `<div class="k-rep-worst-item"><span>${esc(t('acc_ward', { n: w }))} · ${esc(state.wards[w]?.councillor_name || '—')}</span><span class="k-rep-worst-count">${n}</span></div>`).join('')
      : `<div class="k-rep-worst-item">${esc(t('rep_none'))}</div>`}`;
  openModal('k-rep-modal');
}

async function openQR(){
  const wrap = document.getElementById('k-qr-wrap');
  document.getElementById('k-qr-url').textContent = PAGE_URL;
  openModal('k-qr-modal');
  if (!window.QRCode){
    await new Promise(resolve => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/qrcode@1.4.4/build/qrcode.min.js';
      s.onload = s.onerror = resolve;
      document.head.appendChild(s);
    });
  }
  wrap.innerHTML = '';
  if (!window.QRCode){ wrap.textContent = PAGE_URL; return; }
  const canvas = document.createElement('canvas');
  wrap.appendChild(canvas);
  window.QRCode.toCanvas(canvas, PAGE_URL, { width: 220, margin: 1, color: { dark: '#0a0805', light: '#f0e6d0' } });
}

function populateCategoryFilter(){
  const sel = document.getElementById('k-filter-category');
  sel.innerHTML = `<option value="">${esc(t('filter_all_cat'))}</option>` +
    Object.entries(CATEGORIES).map(([k, c]) => `<option value="${k}">${c.icon} ${esc(t('cat_' + k))}</option>`).join('');
  sel.value = state.filters.category;
}

function populateWardDropdown(){
  const sel = document.getElementById('k-ward');
  const current = sel.value;
  sel.innerHTML = '<option value="">—</option>' + Array.from({ length: 23 }, (_, i) => i + 1).map(n => {
    const w = state.wards[n];
    return `<option value="${n}">${esc(t('acc_ward', { n }))}${w?.councillor_name ? ' — ' + esc(w.councillor_name) : ''}</option>`;
  }).join('');
  sel.value = current;
}

function openDeepLink(){
  const q = new URLSearchParams(location.search);
  const id = q.get('report');
  if (id && state.byId.has(id)) return openSheet(id);
  const ward = Number(q.get('ward'));
  if (Number.isInteger(ward) && ward >= 1 && ward <= 23){
    state.filters.ward = ward;
    state.selectedWard = ward;
    document.getElementById('k-search-ward').value = ward;
    renderAll();
    document.querySelector('.k-map-section').scrollIntoView();
  }
}

/* ══════════════════════════════════════════════════════════
   NEARBY ALERTS (web push) + OFFLINE SHELL
   ══════════════════════════════════════════════════════════ */
function alertsSupported(){
  return state.mode === 'v2' && !!VAPID_PUBLIC_KEY && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function alertsOn(){
  try { return localStorage.getItem('kasa_alerts') === '1' && Notification.permission === 'granted'; } catch (e) { return false; }
}

function renderAlertsButtons(){
  const on = alertsOn();
  document.querySelectorAll('[data-alerts]').forEach(b => {
    b.hidden = !alertsSupported();
    b.disabled = false;
    b.textContent = t(on ? 'alerts_off_btn' : 'alerts_btn');
    b.classList.toggle('on', on);
  });
}

function b64ToUint8(b64){
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

async function toggleAlerts(btn){
  if (!alertsSupported()) return;
  btn.disabled = true;
  try {
    const reg = await navigator.serviceWorker.register('sw.js');
    await navigator.serviceWorker.ready;
    if (alertsOn()){
      const sub = await reg.pushManager.getSubscription();
      if (sub){
        await ensureSession();
        await sb.rpc('kasa_push_unsubscribe', { p_endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      try { localStorage.removeItem('kasa_alerts'); } catch (e) {}
      showToast(t('alerts_off'));
    } else {
      if (await Notification.requestPermission() !== 'granted') throw new KasaError('alerts_denied');
      const pos = await getPosition({ want: 200, timeout: 12000 }).catch(() => { throw new KasaError('alerts_need_location'); });
      await ensureSession();
      const sub = (await reg.pushManager.getSubscription()) ||
        await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8(VAPID_PUBLIC_KEY) });
      const j = sub.toJSON();
      const { error } = await sb.rpc('kasa_push_subscribe', {
        p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth,
        p_lat: pos.lat, p_lng: pos.lng, p_radius: 500, p_lang: state.lang
      });
      if (error) throw rpcError(error);
      try { localStorage.setItem('kasa_alerts', '1'); } catch (e) {}
      showToast(t('alerts_on'), 5000);
    }
  } catch (e){
    showToast(errorText(e), 6000);
  }
  renderAlertsButtons();
}

/* "Install app": Chrome/Android hand us a prompt; iPhones need Share → Add to Home Screen. */
let installPrompt = null;
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  installPrompt = e;
  renderInstallButton();
});
window.addEventListener('appinstalled', () => { installPrompt = null; renderInstallButton(); });

function renderInstallButton(){
  const show = !isStandalone() && (!!installPrompt || isIOS());
  document.querySelectorAll('[data-install]').forEach(b => { b.hidden = !show; });
}

async function installApp(){
  if (!installPrompt) return showToast(t('install_ios'), 8000);
  const p = installPrompt;
  installPrompt = null;
  p.prompt();
  await p.userChoice.catch(() => null);
  renderInstallButton();
}

/* Caches the app shell so repeat visits open instantly (see sw.js). */
function registerServiceWorker(){
  if (!('serviceWorker' in navigator) || location.protocol !== 'https:') return;
  const go = () => navigator.serviceWorker.register('sw.js').catch(e => console.info('Kasa: service worker not registered', e));
  setTimeout(() => (window.requestIdleCallback || setTimeout)(go), 3000);
}

/* ══════════════════════════════════════════════════════════
   UI WIRING
   ══════════════════════════════════════════════════════════ */
function wireUI(){
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action],[data-close],[data-open],[data-seen],[data-rate],[data-alerts],[data-flag],[data-share],[data-evidence],[data-again],[data-contact],[data-copy-link],[data-cat],[data-goto],[data-lang],[data-view],[data-ward-select],[data-ward-filter],[data-ward-share],[data-ward-close],[data-profile],[data-chain],[data-sev],[data-csv],[data-install]');
    if (!el) return;
    const d = el.dataset;
    if (d.action === 'report') return openReport();
    if ('close' in d){ const m = el.closest('.k-modal'); if (m) closeModal(m.id); return; }
    if (d.open) return openSheet(d.open);
    if (d.seen) return handleSeen(d.seen, el);
    if (d.rate) return handleRate(d.rate, el);
    if (d.alerts) return toggleAlerts(el);
    if (d.flag) return openFlag(d.flag);
    if (d.share) return shareReport(d.share);
    if (d.evidence) return openEvidence(d.evidence);
    if (d.again){ const r = state.byId.get(d.again); closeModal('k-sheet'); return openReport({ category: r.category, lat: r.lat, lng: r.lng, landmark: r.landmark }); }
    if (d.contact) return openContact(d.contact);
    if (d.copyLink) return copyText(`${PAGE_URL}?report=${encodeURIComponent(d.copyLink)}`);
    if (d.cat) return selectCategory(d.cat);
    if (d.goto) return goToStep(Number(d.goto));
    if (d.lang) return setLang(d.lang);
    if (d.view) return setView(d.view);
    if (d.wardSelect){
      selectWard(Number(d.wardSelect));
      document.querySelector('.k-map-section').scrollIntoView({ behavior: 'smooth' });
      return;
    }
    if (d.wardFilter){
      const n = Number(d.wardFilter);
      state.filters.ward = state.filters.ward === n ? null : n;
      document.getElementById('k-search-ward').value = state.filters.ward || '';
      return renderAll();
    }
    if (d.wardShare) return shareWard(Number(d.wardShare));
    if ('wardClose' in d){ state.selectedWard = null; renderWardCard(); return updateMap(); }
    if (d.csv) return downloadCSV(d.csv);
    if ('install' in d) return installApp();
    if (d.profile) return openRepProfile(d.profile);
    if (d.chain){ state.chainTab = d.chain; return renderChainSection(); }
    if (d.sev){ setSeverity(d.sev); return; }
  });

  document.getElementById('k-filter-category').addEventListener('change', e => { state.filters.category = e.target.value; renderAll(); });
  document.getElementById('k-filter-status').addEventListener('change', e => { state.filters.status = e.target.value; renderAll(); });
  document.getElementById('k-filter-severity').addEventListener('change', e => { state.filters.severity = e.target.value; renderAll(); });
  document.getElementById('k-search-ward').addEventListener('input', e => {
    const n = parseInt(e.target.value, 10);
    state.filters.ward = n >= 1 && n <= 23 ? n : null;
    renderAll();
  });
  document.getElementById('k-sort').addEventListener('change', e => { state.sort = e.target.value; renderList(); });

  document.getElementById('k-photo-btn').addEventListener('click', captureReportPhoto);
  // A prefilled report ("same problem here") already has its category; skip straight to the location.
  document.getElementById('k-next-2').addEventListener('click', () => goToStep(draft?.category ? 3 : 2));
  document.getElementById('k-gps-btn').addEventListener('click', useGPS);
  document.getElementById('k-ward').addEventListener('change', e => { draft.ward = parseInt(e.target.value, 10) || null; updateSubmitState(); });
  document.getElementById('k-submit').addEventListener('click', submitReport);
  document.getElementById('k-done-share').addEventListener('click', e => { if (e.target.dataset.id) shareReport(e.target.dataset.id); });

  document.getElementById('k-ev-loc-btn').addEventListener('click', checkEvidenceLocation);
  document.getElementById('k-ev-photo').addEventListener('change', e => handleEvidencePhoto(e.target.files[0]));
  document.getElementById('k-ev-cam-btn').addEventListener('click', captureEvidencePhoto);
  document.getElementById('k-cam-shutter').addEventListener('click', takeCameraShot);
  document.getElementById('k-cam-retake').addEventListener('click', () => showCameraState('live'));
  document.getElementById('k-cam-use').addEventListener('click', () => closeCamera({ blob: camera.blob }));
  document.getElementById('k-cam-close').addEventListener('click', () => closeCamera({ error: 'cancelled' }));
  document.getElementById('k-ev-submit').addEventListener('click', submitEvidence);
  document.getElementById('k-flag-submit').addEventListener('click', submitFlag);
  document.getElementById('k-list-search').addEventListener('input', e => { state.listQuery = e.target.value.trim(); renderList(); });

  // Tap a report photo to see it full screen.
  document.addEventListener('click', e => {
    const img = e.target.closest('.k-sheet-photo img, .k-ba img, .k-tl-photo img, .k-ev-proof img');
    if (!img) return;
    e.preventDefault();
    openLightbox(img.currentSrc || img.src, img.alt);
  });
  document.getElementById('k-qr-btn').addEventListener('click', openQR);

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (document.getElementById('k-lightbox')) return closeLightbox();
    if (!document.getElementById('k-cam').hidden) return closeCamera({ error: 'cancelled' });
    const open = [...document.querySelectorAll('.k-modal.open')].pop();
    if (open) closeModal(open.id);
  });
}

// Centre the map on the visitor, only if they already allowed location (no prompt on page load).
async function locateOnOpen(){
  try {
    if (!navigator.geolocation || !navigator.permissions?.query) return;
    const st = await navigator.permissions.query({ name: 'geolocation' });
    if (st.state !== 'granted') return;
    showToast(t('locating_you'));
    navigator.geolocation.getCurrentPosition(p => {
      const { latitude: lat, longitude: lng } = p.coords;
      const b = state.rules.bbox;
      if (b && (lat < b.min_lat || lat > b.max_lat || lng < b.min_lng || lng > b.max_lng)) return;
      mainMap.flyTo({ center: [lng, lat], zoom: Math.max(mainMap.getZoom(), 15), duration: 1200 });
    }, () => {}, { enableHighAccuracy: false, maximumAge: 300000, timeout: 8000 });
  } catch (e) {}
}

function openLightbox(src, alt){
  closeLightbox();
  const box = document.createElement('div');
  box.id = 'k-lightbox';
  box.className = 'k-lightbox';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.innerHTML = `<img src="${esc(src)}" alt="${esc(alt || '')}"><button type="button" class="k-lightbox-close" aria-label="${esc(t('sheet_close'))}">✕</button>`;
  box.addEventListener('click', closeLightbox);
  document.body.appendChild(box);
}

function closeLightbox(){ document.getElementById('k-lightbox')?.remove(); }

function openModal(id){
  const m = document.getElementById(id);
  m.classList.add('open');
  m.setAttribute('aria-hidden', 'false');
  document.body.classList.add('k-noscroll');
}

function closeModal(id){
  const m = document.getElementById(id);
  m.classList.remove('open');
  m.setAttribute('aria-hidden', 'true');
  if (id === 'k-sheet') closeSheet();
  if (id === 'k-ev-modal') ev = null;
  if (!document.querySelector('.k-modal.open')) document.body.classList.remove('k-noscroll');
}

/* ══════════════════════════════════════════════════════════
   UTILITIES
   ══════════════════════════════════════════════════════════ */
const ICON_SHARE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4"/></svg>';
const ICON_EYE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const ICON_SHIELD = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3l8 3v6c0 5-3.4 8.4-8 9-4.6-.6-8-4-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/></svg>';
const ICON_NAV = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 11l18-8-8 18-2-8z"/></svg>';
const ICON_FLAG = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 21V4h11l-2 4 2 4H5"/></svg>';
const ICON_CHECK = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/></svg>';

function esc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function safeUrl(u){
  return typeof u === 'string' && /^(https:\/\/|blob:)/.test(u) ? u : '';
}

function setText(id, v){ const el = document.getElementById(id); if (el) el.textContent = v; }

function randomName(n){
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return Array.from(a, b => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
}

function duration(m){
  if (m < 60) return t('dur_m', { n: Math.round(m) });
  if (m < 1440) return t('dur_h', { n: Math.floor(m / 60) });
  return t('dur_d', { n: Math.floor(m / 1440) });
}

function ago(iso){
  const m = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 1) return t('ago_now');
  if (m < 60) return t('ago_m', { n: m });
  if (m < 1440) return t('ago_h', { n: Math.floor(m / 60) });
  return t('ago_d', { n: Math.floor(m / 1440) });
}

function fmtDate(d){
  const locale = { en: 'en-IN', bn: 'bn-IN', hi: 'hi-IN' }[state.lang] || 'en-IN';
  return new Date(d).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
}

function distanceM(lat1, lng1, lat2, lng2){
  const rad = x => x * Math.PI / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(a));
}

/* Watches GPS until the fix is good enough (or time runs out) and returns the best one. */
function getPosition({ want = 50, timeout = 15000, onProgress } = {}){
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('no geolocation'));
    let best = null;
    const finish = () => {
      navigator.geolocation.clearWatch(watch);
      clearTimeout(timer);
      best ? resolve(best) : reject(new Error('timeout'));
    };
    const watch = navigator.geolocation.watchPosition(p => {
      const pos = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy };
      if (!best || pos.accuracy < best.accuracy) best = pos;
      onProgress?.(best);
      if (best.accuracy <= want) finish();
    }, err => {
      navigator.geolocation.clearWatch(watch);
      clearTimeout(timer);
      best ? resolve(best) : reject(err);
    }, { enableHighAccuracy: true, maximumAge: 0, timeout });
    const timer = setTimeout(finish, timeout);
  });
}

/* Resizes to ≤1600px JPEG, respecting camera orientation. */
async function compressImage(file){
  let source;
  try { source = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch (e){
    source = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }
  const scale = Math.min(1, PHOTO_MAX_PX / Math.max(source.width, source.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(source.width * scale);
  canvas.height = Math.round(source.height * scale);
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', 0.8));
}

function showToast(msg, ms = 3500){
  const el = document.getElementById('k-toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => el.classList.remove('show'), ms);
}

/* ── GO ── */
init();
