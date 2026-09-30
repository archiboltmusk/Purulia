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
const GRIEVANCE_EMAIL = CFG.GRIEVANCE_EMAIL || 'thelosthillproject@gmail.com';
// Local names, places and contacts come from city.js (see DEPLOY.md).
const CITY = window.KASA_CITY || {};
const CITY_NAME = CITY.name || 'Purulia';
const MUNICIPALITY_PHONE = CITY.municipalityPhone || '';
const MUNICIPALITY_EMAIL = CITY.municipalityEmail || '';
const MLA_TWITTER_HANDLE = CITY.mlaTwitterHandle || '';
const MAP_CENTER = CITY.mapCenter || [86.3654, 23.3320];
const MAP_ZOOM = CITY.mapZoom || 13;
// "Daylight map" (menu) swaps the dark basemap for a light one that stays readable in bright sun.
let daylightMap = false;
try { daylightMap = localStorage.getItem('kasa_daylight') === '1'; } catch (e) {}
const MAP_STYLE = 'https://tiles.openfreemap.org/styles/' + (daylightMap ? 'positron' : 'dark');
const PAGE_URL = location.origin + location.pathname;
// Links people share. With SHARE_URL set (the Cloudflare worker, worker.js), /r/<id> shows the
// report's photo in WhatsApp/X/Facebook previews and then opens the report here.
const SHARE_URL = (window.KASA_CONFIG?.SHARE_URL || '').replace(/\/$/, '');
const reportLink = id => SHARE_URL ? `${SHARE_URL}/r/${encodeURIComponent(id)}` : `${PAGE_URL}?report=${encodeURIComponent(id)}`;
const PHOTO_MAX_PX = 1280;
const PHOTO_QUALITY = 0.75;
// Exactly what the public view offers; never select('*') from it.
const PUBLIC_REPORT_COLUMNS = 'id,created_at,lat,lng,ward_no,category,severity,status,description,landmark,photo_url,upvotes,seen_on_site,flags,moderation_status,is_duplicate,parent_report_id,recurrence_count,rejected_claims,resolved_at,resolved_photo_url,resolution_method,sla_days,gps_verified,claim_id,claim_photo_url,claim_created_at,claim_verify_count,claim_dispute_count,claim_quorum_reached_at,claim_finalize_after,claim_distance_m,rating_count,onsite_rating_count,authenticity_avg,severity_avg,neighbour_status,reply_count,claim_needs_review,claim_reviewed_at,area_kind,block_name,verify_needed,boundary_type,waste_type,local_body';
const CACHE_KEY = 'kasa_reports_cache_v2';
const MAP_HIDE_RESOLVED_DAYS = 90;   // resolved reports leave the map (not the record) after this
const DEFAULT_RULES = {
  verify_quorum: 3, dispute_quorum: 2, challenge_hours: 12, claim_expiry_days: 14,
  claim_radius_m: 50, vote_radius_m: 100, max_gps_accuracy_m: 60,
  max_photo_age_minutes: 120, photo_gps_far_m: 500, require_live_capture: 0
};
const SEVERITIES = ['minor', 'severe', 'critical'];
const WASTE_TYPES = ['household', 'construction', 'mixed', 'e_waste', 'biomedical'];
const COLORS = { minor: '#d4882a', severe: '#e88a4a', critical: '#e8524a', claimed: '#8f7ae6', resolved: '#6db88a', pending: '#9a8f7c' };

/* Issue types. `chain` picks who is responsible; `review` means a moderator
   approves it before it is public (enforced on the server). */
const CATEGORIES = {
  garbage:              { icon: '🗑️', group: 'clean',   chain: 'sanitation',   fix: 'cleaned' },
  drain:                { icon: '🌊', group: 'clean',   chain: 'sanitation',   fix: 'cleared' },
  dumpsite:             { icon: '🚛', group: 'clean',   chain: 'sanitation',   fix: 'cleared' },
  road:                 { icon: '🚧', group: 'infra',   chain: 'engineering',  fix: 'repaired' },
  streetlight:          { icon: '💡', group: 'infra',   chain: 'lighting',     fix: 'working' },
  water:                { icon: '🚰', group: 'infra',   chain: 'water',        fix: 'fixed' },
  missing:              { icon: '🕳️', group: 'infra',   chain: 'engineering',  fix: 'replaced' },
  encroachment:         { icon: '🚫', group: 'illegal', chain: 'enforcement',  fix: 'removed', review: true },
  illegal_construction: { icon: '🏗️', group: 'illegal', chain: 'enforcement',  fix: 'stopped', review: true },
  illegal_mining:       { icon: '⛏️', group: 'illegal', chain: 'mining',       fix: 'stopped', review: true },
  illegal_other:        { icon: '⚠️', group: 'illegal', chain: 'police',       fix: 'stopped', review: true },
  other:                { icon: '📍', group: 'infra',   chain: 'municipality', fix: 'fixed' },
  hand_pump:            { icon: '💧', group: 'services', chain: 'water',       fix: 'fixed' },
  anganwadi:            { icon: '🧒', group: 'services', chain: 'icds',        fix: 'fixed' },
  health_centre:        { icon: '🏥', group: 'services', chain: 'health',      fix: 'fixed' },
  school:               { icon: '🏫', group: 'services', chain: 'education',   fix: 'repaired' },
  toilet:               { icon: '🚻', group: 'services', chain: 'sanitation',  fix: 'fixed' }
};
const GROUPS = ['clean', 'infra', 'services', 'illegal'];

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
  police:       { agency: 'agency_police', nodes: ['ps', 'sdpo', 'sp'], note: 'note_112' },
  icds:         { agency: 'agency_icds', nodes: ['cdpo', 'dpo', 'dm'] },
  health:       { agency: 'agency_health', nodes: ['bmoh', 'cmoh', 'dm'] },
  education:    { agency: 'agency_education', nodes: ['si_school', 'adi_school', 'di_school', 'dm'] }
};

/* Outside Purulia town the municipality's work falls to the gram panchayat and the block,
   except in Jhalda and Raghunathpur towns, which have their own municipalities. */
function chainFor(r){
  const base = CHAINS[CATEGORIES[r.category].chain];
  if (r.area !== 'rural' || base.agency !== 'agency_municipality') return base;
  if (otherTown(r)) return { ...base, agencyName: r.body };
  const enforcement = CATEGORIES[r.category].chain === 'enforcement';
  return { agency: 'agency_panchayat', nodes: enforcement ? ['bllro', 'bdo', 'sdo_area'] : ['pradhan', 'bdo', 'dm'], note: base.note };
}

/* A report in Jhalda or Raghunathpur town: rural by Parishkar's rules (no ward map), but a municipality's job. */
function otherTown(r){
  return r.area === 'rural' && r.bodyType === 'municipality' && !!r.body;
}

/* "Ward 5" in town, "Jhalda Municipality", "Sirkabad gram panchayat, Arsha block", or "Arsha block". */
function placeLabel(r, tr = t){
  if (r.area === 'place') return placeOther(r, tr);
  if (otherTown(r)) return r.body;
  if (r.area === 'rural' && r.body && r.block) return tr('acc_gp', { g: r.body, b: r.block });
  if (r.area === 'rural' && r.block) return tr('acc_block', { b: r.block });
  return r.ward ? tr('acc_ward', { n: r.ward }) : tr('acc_unknown');
}

/* "Kolkata · Ward 93" for a report in another West Bengal place (places.js). */
function placeOther(r, tr){
  const p = window.KasaPlaces?.bySlug(r.place);
  const name = p?.isDistrict ? tr('pl_district', { d: p.name }) : p ? p.name : r.place;
  return [name, r.placeWard ? tr('acc_ward', { n: r.placeWard }) : ''].filter(Boolean).join(' · ');
}

// What a person would call the spot: their own landmark, else the map address, else the ward/block.
function placeText(r){
  return r.landmark || r.address || placeLabel(r);
}

function verifyNeeded(r){
  return r?.verifyNeeded || state.rules.verify_quorum;
}
const ROLE_ABBR = {
  conservancy: 'CS', si: 'SI', eo: 'EO', chairman: 'CH', sae: 'SAE', ae: 'AE', sae_elec: 'SAE',
  waterworks: 'WW', building: 'BL', sdo: 'SDO', bllro: 'BL&LRO', dllro: 'DL&LRO', dm: 'DM', ps: 'PS', sdpo: 'SDPO', sp: 'SP',
  pradhan: 'GP', bdo: 'BDO', sdo_area: 'SDO', cdpo: 'CDPO', dpo: 'DPO', bmoh: 'BMOH', cmoh: 'CMOH', si_school: 'SI', adi_school: 'ADI', di_school: 'DI'
};

// Elected representatives, from city.js.
const REPS = CITY.reps || {};

function repAvatar(rep, cls){
  return `<span class="${cls}"><span>${esc(rep.initials)}</span>${rep.photo ? `<img class="k-rep-photo" src="${esc(rep.photo)}" alt="" loading="lazy"${rep.photoPos ? ` style="object-position:${esc(rep.photoPos)}"` : ''}>` : ''}</span>`;
}
// A photo that fails to load leaves the initials showing.
document.addEventListener('error', e => { if (e.target.classList?.contains('k-rep-photo')) e.target.remove(); }, true);
const FLAG_REASONS = ['not_an_issue', 'wrong_category', 'wrong_location', 'duplicate', 'inappropriate', 'fake_or_old_photo', 'other'];

/* ── Category Config Parser ── */
let CATEGORIES_CONFIG = null;

function loadCategoriesConfig(){
  if (!CATEGORIES_CONFIG && window.KASA_CATEGORIES_CONFIG) {
    CATEGORIES_CONFIG = window.KASA_CATEGORIES_CONFIG.categories;
  }
  return CATEGORIES_CONFIG;
}

function getCategoryConfig(categoryKey){
  const config = loadCategoriesConfig();
  return config ? config[categoryKey] : null;
}

function getCategoryLabel(categoryKey, lang = 'en'){
  const config = getCategoryConfig(categoryKey);
  if (!config) return categoryKey;
  return config[lang] || config.en || categoryKey;
}

function getResponsibleBody(categoryKey, boundaryType){
  const config = getCategoryConfig(categoryKey);
  if (!config || !config.responsible_body) return null;
  const bodies = config.responsible_body;
  for (let body of bodies) {
    if (body.type === boundaryType) return body;
  }
  return bodies[0];
}

function buildFormQuestions(categoryKey){
  const config = getCategoryConfig(categoryKey);
  if (!config || !config.questions) return [];
  return config.questions.sort((a, b) => (a.order || 0) - (b.order || 0));
}

function getSLAHours(categoryKey, boundaryType){
  const responsible = getResponsibleBody(categoryKey, boundaryType);
  return responsible ? responsible.sla_hours : 24;
}

/* ── State ── */
const state = {
  listQuery: '',
  lbQuery: '',
  groupsByWard: {},
  fixConfirms: {},        // report id -> confirmations when it was verified fixed
  mode: null,              // 'v2' once the migration is live, else 'legacy'
  rules: { ...DEFAULT_RULES },
  reports: [],
  byId: new Map(),
  wards: {},
  wardGeo: null,
  blockGeo: null,
  townGeo: null,
  gpGeo: null,
  filters: { category: '', status: '', severity: '', ward: null, place: null },
  nearbyOnly: false,
  userLocation: null,
  view: 'map',
  sort: 'urgent',
  lang: 'en',
  sheetId: null,
  events: new Map(),
  photos: new Map(),   // report id → extra photo URLs (kasa_report_photos)
  seen: new Set(),
  ratings: {},
  replies: new Map(),
  selectedWard: null,
  selectedPlace: null,
  chainTab: 'sanitation'
};
let sb = null;
let mainMap = null, miniMap = null, miniMarker = null, userMovedMap = false;
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

/* Always English, regardless of the viewer's chosen language — for documents (like the RTI
   draft) that must stay in one consistent, correctly-formatted language throughout rather than
   mixing translated labels into English legal boilerplate. */
function tEN(key, vars){
  let s = I18N.en[key] ?? key;
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
  document.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.dataset.i18nTitle); el.setAttribute('aria-label', el.title); });
  document.querySelectorAll('.k-lang-btn').forEach(b => b.classList.toggle('k-lang-active', b.dataset.lang === state.lang));
  showVersion();
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

function loadTheme(){
  try { state.theme = localStorage.getItem('kasa_theme'); } catch (e) {}
  if (state.theme && ['light', 'dark'].includes(state.theme)){
    document.documentElement.setAttribute('data-theme', state.theme);
  } else {
    document.documentElement.removeAttribute('data-theme');
    state.theme = null;
  }
  const btn = document.getElementById('k-theme-toggle');
  if (btn) btn.innerHTML = '<span aria-hidden="true">' + (state.theme === 'light' ? '🌙' : '☀️') + '</span>';
}

function setTheme(theme){
  if (!['light', 'dark'].includes(theme)) return;
  state.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem('kasa_theme', theme); } catch (e) {}
  const btn = document.getElementById('k-theme-toggle');
  if (btn) btn.textContent = theme === 'light' ? '🌙' : '☀️';
}

function toggleTheme(){
  const newTheme = (state.theme === 'light') ? 'dark' : 'light';
  setTheme(newTheme);
}

/* ══════════════════════════════════════════════════════════
   BOOT
   ══════════════════════════════════════════════════════════ */
async function init(){
  loadLang();
  applyLang();
  loadTheme();
  try { state.seen = new Set(JSON.parse(localStorage.getItem('kasa_seen') || '[]')); } catch (e) {}
  try { state.ratings = JSON.parse(localStorage.getItem('kasa_ratings') || '{}'); } catch (e) {}

  if (!window.supabase || !SUPABASE_URL || !SUPABASE_ANON_KEY){
    console.error('Parishkar: Supabase library or config.js missing');
    showToast(t('err_config'), 8000);
    return;
  }
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  });

  wireUI();
  if (location.hash){ const t = document.getElementById(location.hash.slice(1)); if (t && t.tagName === 'DETAILS') t.open = true; }
  populateCategoryFilter();
  renderCategoryGrid();
  renderChainSection();
  renderReps();
  setupOfflineDetection();
  setupInAppBrowser();

  const cached = readCache();
  if (cached){
    state.mode = cached.mode;
    setReports(cached.rows);
    renderAll();
  }

  mapReady = initMainMap();
  if (window.KasaPlaces){
    KasaPlaces.setSender(slug => sb?.rpc('kasa_place_visit', { p_place: slug }).then(() => {}, () => {}));
    KasaPlaces.on((what, slug) => {
      if (what === 'geo'){ mapReady.then(() => addPlaceLayers(slug)); councillorsOf(slug); }
      // The counts, the "fixed" chip, the ticker and the join line follow the place in view.
      if (what === 'brand'){ updateStats(); renderFixed(); renderTicker(); renderJoin(); }
    });
    for (const slug of Object.keys(KasaPlaces.geo)) mapReady.then(() => addPlaceLayers(slug));
    // ?at=lat,lng,zoom (a shared area card) opens the map there with the card.
    const at = (new URLSearchParams(location.search).get('at') || '').split(',').map(Number);
    if (at.length === 3 && at.every(Number.isFinite)){
      userMovedMap = true;
      mapReady.then(() => { mainMap.jumpTo({ center: [at[1], at[0]], zoom: at[2] }); openArea(at[0], at[1]); });
    }
    const jumpToStart = () => {
      const start = KasaPlaces.fromUrl();
      if (!start?.center || jumpToStart.done) return;
      jumpToStart.done = userMovedMap = true;
      mapReady.then(() => mainMap.jumpTo({ center: start.center, zoom: 12 }));
    };
    jumpToStart();
    // Towns approved on add-town.html since this page was built.
    if (sb) KasaPlaces.setServer({
      places: () => sb.rpc('kasa_places').then(r => r.data || []),
      wards: slug => sb.rpc('kasa_place_wards', { p_slug: slug }).then(r => r.data)
    }).then(jumpToStart);
  }
  await Promise.all([loadReports(), loadWards(), loadWardGeo(), loadCommunities()]);
  renderAll();
  renderTrust();
  mapReady.then(() => { addWardLayers(); updateMap(); });
  // Block outlines for village reports; not needed for the first paint.
  Promise.all([mapReady, loadBlockGeo()]).then(addBlockLayers);
  Promise.all([mapReady, loadLocalGeo()]).then(addLocalLayers);
  if (window.KasaPlaces) mapReady.then(addDistrictLayers);
  openDeepLink();
  if (!location.hash && !location.search) mapReady.then(openOnHomePlace).then(locateOnOpen);
  initPlacePicker();
  if (state.mode === 'v2') showJoin();
  // Tips also start on their own if the location question didn't run (a shared link, for example).
  setTimeout(startTips, 5000);
  syncOfflineQueue();
  startLiveRefresh();

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
  // A column the page asks for but the database doesn't have yet (a migration not applied)
  // makes the whole query fail, which emptied the map. Fall back to '*' — the view only has
  // public columns — so reports still show.
  const query = cols => sb.from('kasa_public_reports').select(cols).order('created_at', { ascending: false }).limit(1000);
  let v2 = await query(PUBLIC_REPORT_COLUMNS);
  if (v2.error){
    console.warn('Parishkar: report columns missing, retrying with *', v2.error.message);
    v2 = await query('*');
  }
  if (!v2.error){
    if (state.mode !== 'v2') loadRules();
    state.mode = 'v2';
    // Reports from the other West Bengal places (places.js) live in their own view.
    const other = window.KasaPlaces ? await sb.from('kasa_public_place_reports').select(PUBLIC_REPORT_COLUMNS + ',place,place_ward')
      .order('created_at', { ascending: false }).limit(500).then(r => r.data || [], () => []) : [];
    return [...(v2.data || []), ...other];
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
    const [rows, fast, addrs] = await Promise.all([fetchRows(), sb.rpc('kasa_fast_claims').then(r => r.data, () => null),
                                                   sb.rpc('kasa_report_addresses').then(r => r.data, () => null)]);
    state.fast = new Map((Array.isArray(fast) ? fast : []).map(f => [String(f.claim_id), f]));
    if (addrs && typeof addrs === 'object') state.addresses = addrs;
    const pending = await getPendingReports();
    setReports([...pending.map(pendingToRow), ...rows]);
    writeCache(rows);
  } catch (e){
    console.error('Parishkar: reports load failed', e);
    if (!state.reports.length) showToast(t('err_load'));
  }
}

/* New reports and fixes show up without a reload: re-fetch every two minutes while the page
   is on screen, and straight away when someone comes back to the tab. Skipped while a form
   is open or offline, and nothing is redrawn unless something changed. */
function startLiveRefresh(){
  let last = Date.now();
  const sig = () => state.reports.map(r => `${r.id}:${r.status}:${r.seen}`).join();
  const tick = async () => {
    if (document.hidden || !navigator.onLine || document.querySelector('.k-modal.open')) return;
    last = Date.now();
    const before = sig();
    await loadReports();
    if (sig() !== before) renderAll();
  };
  setInterval(tick, 120000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - last > 120000) tick(); });
}

function setReports(rows){
  state.reports = rows.map(normalize);
  state.byId = new Map(state.reports.map(r => [r.id, r]));
  // Fixes that didn't last: reported again at the spot within fixMustLastDays of being fixed.
  const days = CITY.fixMustLastDays || 14;
  for (const c of state.reports){
    const p = c.parentId && !c.duplicate && state.byId.get(c.parentId);
    if (!p || p.status !== 'resolved' || !p.resolvedAt) continue;
    const gap = new Date(c.createdAt) - new Date(p.resolvedAt);
    if (gap >= -3600000 && gap <= days * 86400000){ p.relapsed = true; p.relapsedBy = p.relapsedBy || c.id; }
  }
}

function normalize(r){
  let status = r.status === 'pending_verification' ? 'claimed' : r.status;
  const fast = r.claim_id ? state.fast?.get(String(r.claim_id)) : null;
  if (!['open', 'claimed', 'resolved'].includes(status)) status = 'open';
  return {
    id: String(r.id),
    createdAt: r.created_at,
    lat: Number(r.lat), lng: Number(r.lng),
    ward: r.ward_no ? Number(r.ward_no) : null,
    area: r.area_kind === 'wb' ? 'place' : r.area_kind || (r.ward_no ? 'town' : null),
    block: r.block_name || null,
    place: r.place || null,
    placeWard: r.place_ward ? Number(r.place_ward) : null,
    body: r.local_body || null,
    bodyType: r.boundary_type || null,
    verifyNeeded: fast?.need ? Number(fast.need) : r.verify_needed ? Number(r.verify_needed) : null,
    category: CATEGORIES[r.category] ? r.category : 'garbage',
    severity: SEVERITIES.includes(r.severity) ? r.severity : 'minor',
    wasteType: WASTE_TYPES.includes(r.waste_type) ? r.waste_type : null,
    status,
    description: r.description || '',
    landmark: r.landmark || '',
    parentId: r.parent_report_id != null ? String(r.parent_report_id) : null,
    address: state.addresses?.[String(r.id)] || '',
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
      held: !!r.claim_needs_review, reviewedAt: r.claim_reviewed_at || null,
      fast: !!fast, photoOnlyAt: fast?.photo_only_at || null
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
  if (error){ console.warn('Parishkar: wards load failed', error); return; }
  state.wards = {};
  (data || []).forEach(w => { state.wards[w.ward_no] = w; });
  populateWardDropdown();
}

async function loadCommunities(){
  if (!sb) return;
  const { data, error } = await sb.from('kasa_public_communities').select('wards,all_district');
  if (error) return;
  state.groupsByWard = {};
  // A district-wide community counts in every ward.
  const everywhere = (data || []).filter(g => g.all_district).length;
  for (let w = 1; w <= 23; w++) if (everywhere) state.groupsByWard[w] = everywhere;
  for (const g of data || []) if (!g.all_district) for (const w of g.wards || []) state.groupsByWard[w] = (state.groupsByWard[w] || 0) + 1;
}

async function loadWardGeo(){
  try {
    const res = await fetch(CITY.wardsGeojson || 'purulia_wards.geojson');
    if (res.ok) state.wardGeo = await res.json();
  } catch (e) { console.info('Parishkar: no ward boundaries'); }
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

async function loadBlockGeo(){
  if (state.blockGeo) return;
  try {
    const res = await fetch(CITY.blocksGeojson || 'purulia_blocks.geojson');
    if (res.ok) state.blockGeo = await res.json();
  } catch (e) { console.info('Parishkar: no block boundaries'); }
}

/* Version badge beside the logo; it opens that day's entry on the What's new page. */
function showVersion(){
  const el = document.getElementById('k-version');
  const v = window.PARISHKAR_VERSION?.version;
  if (!el || !v) return;
  el.textContent = 'v' + v;
  el.href = 'changelog.html#v' + v;
  el.title = t('version_title', { v });
  el.setAttribute('aria-label', el.title);
  el.hidden = false;
}

/* Jhalda and Raghunathpur town outlines, and the 170 gram panchayats. Only needed once
   someone places a report or zooms in, so they load after everything else. */
async function loadLocalGeo(){
  if (state.townGeo && state.gpGeo) return;
  const get = async (url) => { try { const res = await fetch(url); return res.ok ? await res.json() : null; } catch (e) { return null; } };
  const [towns, gps] = await Promise.all([get(CITY.townsGeojson || 'purulia_towns.geojson'), get(CITY.gpsGeojson || 'purulia_gps.geojson')]);
  state.townGeo = towns || { type: 'FeatureCollection', features: [] };
  state.gpGeo = gps || { type: 'FeatureCollection', features: [] };
}

function featureAt(geo, lat, lng){
  return (geo?.features || []).find(f => pointInPolygon([lng, lat], f.geometry)) || null;
}

function detectBlock(lat, lng){
  const f = (state.blockGeo?.features || []).find(f => pointInPolygon([lng, lat], f.geometry));
  return f ? f.properties.block : null;
}

function nearTown(lat, lng){
  const margin = Number(state.rules.town_ward_margin_m) || 1500;
  return (state.wardGeo?.features || []).some(f => {
    const polys = f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates];
    return polys.some(p => p[0].some(([x, y]) => distanceM(lat, lng, y, x) <= margin));
  });
}

/* Mirrors the server's kasa_private.locate(): town (in a ward), edge (near town, ward optional),
   rural (a block), outside the district, or unknown while the maps load. The server decides. */
function placeOf(lat, lng){
  const ward = detectWard(lat, lng);
  if (ward) return { kind: 'town', ward };
  if (!state.blockGeo || !state.wardGeo) return { kind: 'unknown' };
  const block = detectBlock(lat, lng);
  if (nearTown(lat, lng)) return { kind: 'edge', block };
  const town = featureAt(state.townGeo, lat, lng);
  if (town) return { kind: 'rural', block, body: town.properties.body, bodyType: 'municipality' };
  const gp = featureAt(state.gpGeo, lat, lng);
  if (gp) return { kind: 'rural', block: block || gp.properties.block, body: gp.properties.gp, bodyType: 'gram_panchayat' };
  if (block) return { kind: 'rural', block, bodyType: 'gram_panchayat' };
  return window.KasaPlaces?.at(lat, lng) || { kind: 'outside' };
}

function detectWard(lat, lng){
  const f = (state.wardGeo?.features || []).find(f => pointInPolygon([lng, lat], f.geometry));
  const n = f && (f.properties.ward ?? f.properties.ward_no ?? f.properties.WARD);
  return n ? parseInt(String(n).replace(/\D/g, ''), 10) : null;
}

/* Municipality or gram panchayat, for the phone's own display. The server sets the stored value. */
function detectBoundary(lat, lng){
  const place = placeOf(lat, lng);
  if (place.kind === 'town') return 'municipality';
  if (place.kind === 'rural') return place.bodyType || 'gram_panchayat';
  if (place.kind === 'edge') return 'gram_panchayat';
  return null; // outside district
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
    console.error('Parishkar: anonymous sign-in failed. Enable it under Authentication → Providers → Anonymous.', error);
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
  if (error){ console.error('Parishkar: upload failed', error); throw new KasaError('err_upload'); }
  return path;
}

/* What the phone said about the photo — capture method, camera time, GPS
   stamp, AI-edit marker (kasa-photo-meta.js). Sent before the photo is used;
   the server applies the rules. Older databases without the function are fine. */
async function sendPhotoMeta(path, meta){
  if (!meta) return;
  const { error } = await sb.rpc('kasa_photo_meta', { p_path: path, p_meta: meta });
  if (error && error.code !== 'PGRST202') console.warn('Parishkar: photo metadata not recorded', error);
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
      console.warn('Parishkar: EXIF GPS mismatch detected — server will flag this photo');
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
      p_photo_path: path, p_client_id: d.clientId, p_boundary_type: d.boundary_type,
      // Sent only when picked, so a page newer than the database still files the report.
      ...(d.wasteType ? { p_waste_type: d.wasteType } : {})
    });
    if (error) throw rpcError(error);
    if (!data.replayed && d.extraPhotos?.length) await api.addPhotos(String(data.id), d);
    if (data.moderation_status === 'approved' && !data.duplicate_of && !data.replayed) api.notify(String(data.id));
    return { id: String(data.id), moderation: data.moderation_status, duplicateOf: data.duplicate_of, recurrenceOf: data.recurrence_of };
  },

  // Extra photos never block the report: one that fails is reported and skipped.
  async addPhotos(id, d){
    let failed = 0;
    for (const x of d.extraPhotos){
      try {
        const path = await uploadPhoto('reports', x.blob);
        await sendPhotoMeta(path, x.meta);
        await checkPhoto(path, null, d.lat, d.lng);
        const { error } = await sb.rpc('kasa_add_report_photo', { p_report_id: id, p_photo_path: path });
        if (error) throw rpcError(error);
      } catch (e){ failed++; console.warn('Parishkar: extra photo not added', e); }
    }
    if (failed) showToast(t('photo_extra_failed', { n: failed }), 6000);
  },

  async reportPhotos(id){
    const { data, error } = await sb.rpc('kasa_report_photos', { p_report_id: id });
    return error ? [] : (data || []).map(p => safeUrl(p.photo_url)).filter(Boolean);
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
    if (error){ console.warn('Parishkar: replies load failed', error); return []; }
    return data || [];
  },

  notify(id){
    sb.functions.invoke('kasa-notify', { body: { report_id: id } }).catch(() => {});
  },

  async events(id){
    if (state.mode !== 'v2') return [];
    const { data, error } = await sb.from('kasa_public_events')
      .select('id,kind,actor_tag,photo_url,distance_m,detail,created_at').eq('report_id', id).order('created_at').order('id');
    if (error){ console.warn('Parishkar: events load failed', error); return []; }
    return data || [];
  }
};

async function legacyCreateReport(d){
  const hash = await getReporterHash();
  const filename = `reports/${d.clientId}.jpg`;
  const { error: upErr } = await sb.storage.from('kasa-photos').upload(filename, d.photoBlob, { contentType: 'image/jpeg', upsert: true });
  if (upErr){ console.error('Parishkar: upload failed', upErr); throw new KasaError('err_upload'); }
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

function distanceMeters(aLat, aLng, bLat, bLng){
  const rad = n => n * Math.PI / 180;
  const a = Math.sin(rad(bLat - aLat) / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(rad(bLng - aLng) / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function filtered(){
  const f = state.filters;
  return state.reports.filter(r =>
    (!f.category || r.category === f.category) &&
    (!f.status || r.status === f.status) &&
    (!f.severity || r.severity === f.severity) &&
    (!f.ward || (f.place ? r.place === f.place && r.placeWard === f.ward : r.ward === f.ward)) &&
    (!state.nearbyOnly || (state.userLocation && distanceMeters(state.userLocation.lat, state.userLocation.lng, r.lat, r.lng) <= 5000)));
}

const primaries = () => state.reports.filter(r => !r.duplicate);
/* Reports of the place the page is named after: Purulia, or the town or district the map is on (places.js). */
const inScope = r => window.KasaPlaces?.current === 'bengal' || (r.place || null) === (window.KasaPlaces?.current || null);
const scopedPrimaries = () => primaries().filter(inScope);
const daysSince = (iso) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
const isOverdue = (r) => r.status !== 'resolved' && daysSince(r.createdAt) > r.slaDays;
const peopleSaw = (r) => r.seen + 1;

/* The visible clock: how long until (or past) the deadline the severity sets — hours once
   under a day, so a 24-hour critical SLA doesn't just read "0 days" until it's already blown. */
function slaCountdown(r){
  const dueAt = new Date(r.createdAt).getTime() + r.slaDays * 86400000;
  const ms = dueAt - Date.now();
  const over = ms < 0;
  const h = Math.abs(ms) / 3600000;
  const value = h < 48 ? t('sla_hours', { n: Math.max(0, Math.round(h)) }) : t('sla_days', { n: Math.round(h / 24) });
  return { over, text: t(over ? 'sla_overdue_by' : 'sla_due_in', { t: value }) };
}

/* Per-ward counts: Purulia's wards, or with a slug that town's wards (places.js). */
function wardStats(place){
  const stats = {};
  for (const r of primaries()){
    const w = place ? (r.place === place ? r.placeWard : null) : r.ward;
    if (!w) continue;
    const s = stats[w] ||= { ward: w, open: 0, claimed: 0, resolved: 0, overdue: 0, fake: 0, recurring: 0, fixDaysSum: 0, fixDaysCount: 0 };
    if (r.status === 'resolved') s.resolved++;
    else { s.open++; if (r.status === 'claimed') s.claimed++; }
    if (isOverdue(r)) s.overdue++;
    s.fake += r.rejectedClaims;
    if (r.recurrence) s.recurring++;
    if (r.status === 'resolved' && r.resolvedAt){
      s.fixDaysSum += Math.round((new Date(r.resolvedAt) - new Date(r.createdAt)) / 86400000);
      s.fixDaysCount++;
    }
  }
  for (const s of Object.values(stats)) s.avgFixDays = s.fixDaysCount ? Math.round(s.fixDaysSum / s.fixDaysCount) : null;
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
  renderFilterCount();
}

/* Filters sit behind one button so the map stays clear; the badge shows how many are on. */
function renderFilterCount(){
  const f = state.filters;
  const n = [f.category, f.status, f.severity, f.ward].filter(Boolean).length + (state.nearbyOnly ? 1 : 0);
  const el = document.getElementById('k-filter-count');
  el.textContent = n;
  el.hidden = !n;
}

/* Everything that isn't the map (intro, stats, wards, representatives, footer) lives in this drawer. */
function setDrawer(open){
  const drawer = document.getElementById('k-drawer');
  drawer.classList.toggle('open', open);
  drawer.toggleAttribute('inert', !open);
  drawer.setAttribute('aria-hidden', String(!open));
  document.getElementById('k-drawer-backdrop').hidden = !open;
  document.getElementById('k-more-btn').setAttribute('aria-expanded', String(open));
  document.getElementById('k-fab-menu').setAttribute('aria-expanded', String(open));
  if (open) document.getElementById('k-drawer-close').focus();
  else if (drawer.contains(document.activeElement)) document.getElementById('k-fab-menu').focus();
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
        id: r.id, color: markerColor(r), severity: r.severity,
        radius: 6 + Math.min(8, Math.sqrt(r.seen) * 2),
        halo: r.status === 'open' && r.severity === 'critical' ? 1 : 0
      }
    }))
  };
}

/* The map library loads in parallel (async script), so buttons, list and reports don't wait for it. */
function mapLibrary(){
  if (window.maplibregl) return Promise.resolve();
  const tag = document.getElementById('k-maplibre');
  return new Promise(resolve => {
    if (!tag){ console.error('Parishkar: map library missing'); return; }
    tag.addEventListener('load', () => resolve());
    tag.addEventListener('error', () => console.error('Parishkar: map library failed to load'));
    if (window.maplibregl) resolve();
  });
}

function initMainMap(){
  return mapLibrary().then(initMainMapNow);
}

// The map tile source (OpenFreeMap) has no key and no usage cap, but it's still one host:
// if its style JSON never loads, people would otherwise just see an empty grey box with no
// clue why. One friendly notice per page load, not one per map instance.
let mapStyleWarned = false;
function watchMapStyleLoad(map){
  setTimeout(() => {
    if (mapStyleWarned || !map || map.isStyleLoaded()) return;
    mapStyleWarned = true;
    showToast(t('map_tiles_down'), 6000);
  }, 8000);
}

// OpenFreeMap's dark style already carries OSM road names (the transportation_name source
// layer), but at a near-invisible dark-grey-on-black contrast meant for a subtle backdrop under
// other data. Purulia's roads are the whole point of this map, so raise them to legible —
// this can't add road names OSM doesn't have, only make the ones it does have readable.
function boostRoadLabels(map){
  if (daylightMap) return;
  if (map.getLayer('highway_name_other')){
    map.setPaintProperty('highway_name_other', 'text-color', 'rgba(196,182,158,.92)');
    map.setPaintProperty('highway_name_other', 'text-halo-color', 'rgba(10,8,5,.9)');
    map.setPaintProperty('highway_name_other', 'text-halo-width', 1.2);
    map.setLayoutProperty('highway_name_other', 'text-size', 11);
  }
  if (map.getLayer('highway_name_motorway')){
    map.setPaintProperty('highway_name_motorway', 'text-color', 'rgba(232,138,74,.95)');
    map.setPaintProperty('highway_name_motorway', 'text-halo-color', 'rgba(10,8,5,.9)');
    map.setPaintProperty('highway_name_motorway', 'text-halo-width', 1.2);
  }
}

function initMainMapNow(){
  mainMap = new maplibregl.Map({
    container: 'k-map', style: MAP_STYLE, center: MAP_CENTER, zoom: MAP_ZOOM,
    minZoom: 5, maxZoom: 19,
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
  // Any drag/zoom/rotate by a person carries originalEvent; programmatic moves don't.
  mainMap.on('movestart', e => { if (e.originalEvent) userMovedMap = true; });
  if (window.KasaPlaces){
    const follow = () => { const c = mainMap.getCenter(); KasaPlaces.onView(c.lat, c.lng, mainMap.getZoom()); };
    mainMap.on('moveend', follow);
    mainMap.once('load', follow);
  }
  watchMapStyleLoad(mainMap);
  mainMap.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
  mainMap.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: false }), 'bottom-right');

  return new Promise(resolve => {
    mainMap.on('load', () => {
      boostRoadLabels(mainMap);
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

function addBlockLayers(){
  if (!mainMap || !state.blockGeo || mainMap.getSource('blocks')) return;
  mainMap.addSource('blocks', { type: 'geojson', data: state.blockGeo });
  const below = mainMap.getLayer('wards-fill') ? 'wards-fill' : 'clusters';
  mainMap.addLayer({ id: 'blocks-line', type: 'line', source: 'blocks',
    paint: { 'line-color': '#6db88a', 'line-opacity': .35, 'line-width': 1, 'line-dasharray': [3, 2] } }, below);
  mainMap.addLayer({ id: 'blocks-label', type: 'symbol', source: 'blocks', maxzoom: 12,
    layout: { 'text-field': ['get', 'block'], 'text-size': 11, 'text-font': ['Noto Sans Regular'] },
    paint: { 'text-color': '#6db88a', 'text-opacity': .7, 'text-halo-color': '#0a0805', 'text-halo-width': 1 } }, below);
}

/* Gram panchayat outlines show from district zoom in; the two other towns are shaded like Purulia's wards. */
function addLocalLayers(){
  if (!mainMap || !state.gpGeo || mainMap.getSource('gps')) return;
  const below = mainMap.getLayer('blocks-line') ? 'blocks-line' : mainMap.getLayer('wards-fill') ? 'wards-fill' : 'clusters';
  mainMap.addSource('gps', { type: 'geojson', data: state.gpGeo });
  mainMap.addSource('towns', { type: 'geojson', data: state.townGeo });
  mainMap.addLayer({ id: 'gps-line', type: 'line', source: 'gps', minzoom: 10,
    paint: { 'line-color': '#6db88a', 'line-opacity': .22, 'line-width': .6 } }, below);
  mainMap.addLayer({ id: 'gps-label', type: 'symbol', source: 'gps', minzoom: 11.5,
    layout: { 'text-field': ['get', 'gp'], 'text-size': 10, 'text-font': ['Noto Sans Regular'] },
    paint: { 'text-color': '#6db88a', 'text-opacity': .6, 'text-halo-color': '#0a0805', 'text-halo-width': 1 } }, below);
  mainMap.addLayer({ id: 'towns-fill', type: 'fill', source: 'towns', paint: { 'fill-color': '#d4882a', 'fill-opacity': .05 } }, below);
  mainMap.addLayer({ id: 'towns-line', type: 'line', source: 'towns', paint: { 'line-color': '#d4882a', 'line-opacity': .45, 'line-width': 1 } }, below);
  mainMap.addLayer({ id: 'towns-label', type: 'symbol', source: 'towns', minzoom: 10,
    layout: { 'text-field': ['get', 'town'], 'text-size': 11, 'text-font': ['Noto Sans Regular'] },
    paint: { 'text-color': '#d4882a', 'text-opacity': .8, 'text-halo-color': '#0a0805', 'text-halo-width': 1 } }, below);
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

/* Ward outlines of the other West Bengal places (places.js), drawn once loaded. */
function addPlaceLayers(slug){
  const g = window.KasaPlaces?.geo[slug];
  if (!mainMap || !g) return;
  if (mainMap.getSource('place-' + slug)) return mainMap.getSource('place-' + slug).setData(g);
  const p = KasaPlaces.bySlug(slug);
  const provisional = p.status === 'provisional';
  mainMap.addSource('place-' + slug, { type: 'geojson', data: g,
    attribution: /^https:\/\//i.test(p.source || '') && !p.community
      ? `<a href="${esc(p.source)}" target="_blank" rel="noopener">${esc(p.name)} wards: ${esc(p.sourceName)}</a> (${esc(p.licence)})`
      : `${esc(p.name)} wards: ${esc(provisional ? t('pl_border_note') : p.licence || p.source || '')}` });
  // A near-invisible fill makes each ward tappable; the selected one is shaded like Purulia's.
  mainMap.addLayer({ id: 'place-' + slug + '-fill', type: 'fill', source: 'place-' + slug,
    paint: { 'fill-color': '#d4882a', 'fill-opacity': .035 } }, 'clusters');
  mainMap.addLayer({ id: 'place-' + slug + '-selected', type: 'fill', source: 'place-' + slug, filter: ['==', ['get', 'ward'], -1],
    paint: { 'fill-color': '#d4882a', 'fill-opacity': .14 } }, 'clusters');
  mainMap.on('click', 'place-' + slug + '-fill', e => {
    if (e.defaultPrevented) return;
    selectWard(Number(e.features[0].properties.ward), slug);
  });
  mainMap.addLayer({ id: 'place-' + slug + '-line', type: 'line', source: 'place-' + slug,
    paint: { 'line-color': '#d4882a', 'line-opacity': .45, 'line-width': 1, ...(provisional ? { 'line-dasharray': [3, 2] } : {}) } }, 'clusters');
  mainMap.addLayer({ id: 'place-' + slug + '-label', type: 'symbol', source: 'place-' + slug, minzoom: 13,
    layout: { 'text-field': ['to-string', ['get', 'ward']], 'text-size': 11, 'text-font': ['Noto Sans Regular'] },
    paint: { 'text-color': '#d4882a', 'text-opacity': .7, 'text-halo-color': '#0a0805', 'text-halo-width': 1 } }, 'clusters');
}

/* All West Bengal: district outlines always; each district's blocks and gram panchayats
   (places/wb/<slug>.geojson, tools/build-wb-local.py) load once it is in view from zoom 8,
   so the map never fetches the whole state. Styled like Purulia's own layers. */
const WB_LOCAL_ZOOM = 8;
let wbIndex = null;
async function addDistrictLayers(){
  const g = await KasaPlaces.loadDistricts();
  if (!mainMap || !g?.features?.length || mainMap.getSource('wb-districts')) return;
  mainMap.addSource('wb-districts', { type: 'geojson', data: g,
    attribution: 'District outlines: Local Government Directory, via india-geodata (CC0)' });
  mainMap.addLayer({ id: 'wb-districts-line', type: 'line', source: 'wb-districts',
    paint: { 'line-color': '#e8d9b8', 'line-opacity': ['interpolate', ['linear'], ['zoom'], 5, .35, 10, .2], 'line-width': 1.1 } }, 'clusters');
  mainMap.addLayer({ id: 'wb-districts-label', type: 'symbol', source: 'wb-districts', minzoom: 6, maxzoom: 9,
    filter: ['!=', ['get', 'slug'], 'purulia'],
    layout: { 'text-field': ['get', 'district'], 'text-size': 11, 'text-font': ['Noto Sans Regular'], 'text-letter-spacing': .05 },
    paint: { 'text-color': '#e8d9b8', 'text-opacity': .6, 'text-halo-color': '#0a0805', 'text-halo-width': 1 } }, 'clusters');
  mainMap.on('moveend', loadLocalInView);
  mainMap.on('click', onAreaTap);
  loadLocalInView();
}

async function loadLocalInView(){
  if (!mainMap || mainMap.getZoom() < WB_LOCAL_ZOOM) return;
  if (!wbIndex) wbIndex = fetch('places/wb/index.json').then(r => r.ok ? r.json() : null).catch(() => null);
  const idx = await wbIndex;
  if (!idx?.districts) return;
  const b = mainMap.getBounds();
  for (const [slug, d] of Object.entries(idx.districts)){
    const [x0, y0, x1, y1] = d.bbox;
    if (x1 < b.getWest() || x0 > b.getEast() || y1 < b.getSouth() || y0 > b.getNorth()) continue;
    addDistrictLocal(slug, idx.attribution);
  }
}

const wbLocalLoading = {}, wbLocalGeo = {};
function addDistrictLocal(slug, attribution){
  if (wbLocalLoading[slug]) return wbLocalLoading[slug];
  return wbLocalLoading[slug] = fetch('places/wb/' + slug + '.geojson').then(r => r.ok ? r.json() : null).then(g => {
    if (!g || !mainMap) { delete wbLocalLoading[slug]; return; }
    wbLocalGeo[slug] = g;
    attribution ||= g.attribution;
    const src = 'wb-' + slug, kind = k => ['==', ['get', 'kind'], k];
    mainMap.addSource(src, { type: 'geojson', data: g, attribution });
    const green = { 'text-color': '#6db88a', 'text-halo-color': '#0a0805', 'text-halo-width': 1 };
    mainMap.addLayer({ id: src + '-gp-line', type: 'line', source: src, minzoom: 10, filter: kind('gp'),
      paint: { 'line-color': '#6db88a', 'line-opacity': .22, 'line-width': .6 } }, 'clusters');
    mainMap.addLayer({ id: src + '-block-line', type: 'line', source: src, minzoom: WB_LOCAL_ZOOM, filter: kind('block'),
      paint: { 'line-color': '#6db88a', 'line-opacity': .35, 'line-width': 1, 'line-dasharray': [3, 2] } }, 'clusters');
    mainMap.addLayer({ id: src + '-block-label', type: 'symbol', source: src, minzoom: 9, maxzoom: 12, filter: kind('block'),
      layout: { 'text-field': ['get', 'block'], 'text-size': 11, 'text-font': ['Noto Sans Regular'] },
      paint: { ...green, 'text-opacity': .7 } }, 'clusters');
    mainMap.addLayer({ id: src + '-gp-label', type: 'symbol', source: src, minzoom: 11.5, filter: kind('gp'),
      layout: { 'text-field': ['get', 'gp'], 'text-size': 10, 'text-font': ['Noto Sans Regular'] },
      paint: { ...green, 'text-opacity': .6 } }, 'clusters');
  }).catch(() => { delete wbLocalLoading[slug]; });
}

/* Area card: tap a district, block or gram panchayat anywhere in West Bengal (outside a mapped
   ward) for its name, the reports inside it, and the MLA and MP for that spot. Leaders come from
   places/wb_leaders.json (tools/build-wb-leaders.py, cited); panchayat heads are not on record yet,
   so the card says so rather than guess. The level follows the zoom; the crumbs switch it. */
let wbLeaders = null, wbAssembly = null;
const getJson = url => fetch(url).then(r => r.ok ? r.json() : null).catch(() => null);
const inBbox = (b, [x, y]) => !b || (x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]);

async function areasAt(lat, lng){
  const pt = [lng, lat];
  const d = (await KasaPlaces.loadDistricts())?.features.find(f => pointInPolygon(pt, f.geometry));
  if (!d) return null;
  const slug = d.properties.slug;
  let fs = [];
  if (slug === 'purulia'){
    await Promise.all([loadBlockGeo(), loadLocalGeo()]);
    fs = [...(state.blockGeo?.features || []).map(f => ({ ...f, properties: { ...f.properties, kind: 'block' } })),
          ...(state.gpGeo?.features || []).map(f => ({ ...f, properties: { ...f.properties, kind: 'gp' } }))];
  } else if (slug !== 'kolkata'){
    await addDistrictLocal(slug);
    fs = wbLocalGeo[slug]?.features || [];
  }
  const find = kind => fs.find(f => f.properties.kind === kind && inBbox(f.bbox, pt) && pointInPolygon(pt, f.geometry)) || null;
  return { district: d, block: find('block'), gp: find('gp') };
}

async function leadersAt(lat, lng){
  [wbLeaders, wbAssembly] = await Promise.all([wbLeaders || getJson('places/wb_leaders.json'), wbAssembly || getJson('places/wb_assembly.geojson')]);
  if (!wbLeaders || !wbAssembly) return null;
  const f = wbAssembly.features.find(f => inBbox(f.bbox, [lng, lat]) && pointInPolygon([lng, lat], f.geometry));
  return f ? { ac: wbLeaders.ac[f.properties.ac], pc: wbLeaders.pc[f.properties.pc] } : null;
}

// MLAs of a district by party, e.g. "BJP 7 · AITC 2".
function districtSeats(slug){
  const n = {};
  for (const f of wbAssembly?.features || []) if (f.properties.d === slug){ const p = wbLeaders.ac[f.properties.ac].party; n[p] = (n[p] || 0) + 1; }
  return Object.entries(n).sort((a, b) => b[1] - a[1]);
}

async function openArea(lat, lng, level){
  const [areas, leaders] = await Promise.all([areasAt(lat, lng), leadersAt(lat, lng)]);
  if (!areas) return closeArea();
  if (state.selectedWard != null){ state.selectedWard = null; renderWardCard(); updateMap(); }
  const z = mainMap.getZoom();
  level ||= z >= 10.5 && areas.gp ? 'gp' : z >= 8 && areas.block ? 'block' : 'district';
  state.area = { lat, lng, level, areas, leaders };
  renderAreaCard();
}

function closeArea(){
  state.area = null;
  const el = document.getElementById('k-area-card');
  if (el) el.hidden = true;
  mainMap?.getSource('area-sel')?.setData({ type: 'FeatureCollection', features: [] });
}

function areaFeature(a = state.area){ return a.areas[a.level] || a.areas.district; }
function areaName(f){ return f.properties.gp || f.properties.block || f.properties.district; }

function renderAreaCard(){
  const a = state.area;
  let el = document.getElementById('k-area-card');
  if (!el){
    el = document.createElement('div');
    el.id = 'k-area-card'; el.className = 'k-ward-card k-area-card';
    document.getElementById('k-ward-card').after(el);
  }
  const f = areaFeature(), { district, block, gp } = a.areas;
  const inside = primaries().filter(r => Number.isFinite(r.lat) && inBbox(f.bbox, [r.lng, r.lat]) && pointInPolygon([r.lng, r.lat], f.geometry));
  const open = inside.filter(r => r.status !== 'resolved').length, fixed = inside.length - open;
  const crumb = (lvl, g) => g ? `<button type="button" class="k-area-crumb${lvl === a.level ? ' on' : ''}" data-area-level="${lvl}">${esc(areaName(g))}</button>` : '';
  const sub = a.level === 'gp' ? t('ar_gp_sub', { b: block?.properties.block || gp.properties.block, d: district.properties.district })
            : a.level === 'block' ? t('ar_block_sub', { d: district.properties.district }) : t('ar_district_sub');
  const L = a.leaders, row = (role, who, extra) => `<div class="k-area-row"><span class="k-area-role">${esc(role)}</span><span class="k-area-who">${who}</span>${extra ? `<span class="k-area-extra">${esc(extra)}</span>` : ''}</div>`;
  const seats = a.level === 'district' ? districtSeats(district.properties.slug) : [];
  el.innerHTML = `
    <button type="button" class="k-ward-close" data-area-close aria-label="${esc(t('sheet_close'))}">✕</button>
    <div class="k-area-crumbs">${[crumb('district', district), crumb('block', block), crumb('gp', gp)].filter(Boolean).join('<span aria-hidden="true">›</span>')}</div>
    <div class="k-ward-title">${esc(areaName(f))}</div>
    <div class="k-ward-sub">${esc(sub)}</div>
    <div class="k-ward-nums">
      <span>${esc(t('wc_reported', { n: inside.length }))}</span>
      <span class="k-red">${esc(t('wc_open', { n: open }))}</span>
      <span class="k-green">${esc(t('wc_fixed', { n: fixed }))}</span>
    </div>
    <div class="k-area-leaders">
      ${seats.length ? row(t('ar_mlas', { n: seats.reduce((s, x) => s + x[1], 0) }), esc(seats.map(([p, n]) => `${p} ${n}`).join(' · '))) : ''}
      ${L?.ac ? row(t('ar_mla', { c: L.ac.name }), esc(L.ac.person), L.ac.party) : ''}
      ${L?.pc ? (L.pc.vacant ? row(t('ar_mp', { c: L.pc.name }), `<a href="${esc(L.pc.vacant.source)}" target="_blank" rel="noopener">${esc(t('ar_vacant', { d: L.pc.vacant.since }))}</a>`)
                            : row(t('ar_mp', { c: L.pc.name }), esc(L.pc.person), t('ar_elected', { p: L.pc.party, y: 2024 }))) : ''}
      ${row(t('ar_head_' + a.level), `<span class="k-area-none">${esc(t('ar_not_on_record'))}</span>`)}
    </div>
    <div class="k-ward-actions">
      <button type="button" class="k-ward-filter" data-area-zoom>${esc(t('ar_zoom'))}</button>
      <button type="button" class="k-ward-filter" data-area-share>${esc(t('ar_share'))}</button>
    </div>
    <div class="k-ward-note">${esc(t('ar_note'))} ${wbLeaders ? `<a href="${esc(wbLeaders.sources.mla)}" target="_blank" rel="noopener">${esc(t('ar_src_mla'))}</a> · <a href="${esc(wbLeaders.sources.mp)}" target="_blank" rel="noopener">${esc(t('ar_src_mp'))}</a>` : ''}</div>`;
  el.hidden = false;
  if (!mainMap.getSource('area-sel')){
    mainMap.addSource('area-sel', { type: 'geojson', data: f });
    mainMap.addLayer({ id: 'area-sel-fill', type: 'fill', source: 'area-sel', paint: { 'fill-color': '#d4882a', 'fill-opacity': .12, 'fill-opacity-transition': { duration: 300 } } }, 'clusters');
    mainMap.addLayer({ id: 'area-sel-line', type: 'line', source: 'area-sel', paint: { 'line-color': '#d4882a', 'line-opacity': .8, 'line-width': 1.6 } }, 'clusters');
  } else mainMap.getSource('area-sel').setData(f);
}

function areaBounds(f){
  if (f.bbox) return [[f.bbox[0], f.bbox[1]], [f.bbox[2], f.bbox[3]]];
  const pts = (f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates.flat(2) : f.geometry.coordinates.flat());
  return [[Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1]))], [Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))]];
}

function zoomToArea(){
  userMovedMap = true;
  mainMap.fitBounds(areaBounds(areaFeature()), { padding: { top: 90, bottom: 260, left: 40, right: 40 }, duration: 900, essential: true });
}

function shareArea(){
  const a = state.area, zoom = { gp: 12, block: 10, district: 8.5 }[a.level];
  const url = `${location.origin}${location.pathname}?at=${a.lat.toFixed(5)},${a.lng.toFixed(5)},${zoom}`;
  const text = t('ar_share_text', { name: areaName(areaFeature()) });
  if (navigator.share) navigator.share({ title: 'Parishkar', text, url }).catch(() => {});
  else copyText(`${text} ${url}`);
}

// Any tap on the map that isn't a report, cluster or mapped ward opens the area card.
function onAreaTap(e){
  if (e.defaultPrevented) return;
  const hit = ['report-points', 'clusters', 'wards-fill', ...Object.keys(window.KasaPlaces?.geo || {}).map(s => 'place-' + s + '-fill')]
    .filter(id => mainMap.getLayer(id));
  if (hit.length && mainMap.queryRenderedFeatures(e.point, { layers: hit }).length) return;
  if (state.area && pointInPolygon([e.lngLat.lng, e.lngLat.lat], areaFeature().geometry) && e.originalEvent?.detail < 2) return closeArea();
  openArea(e.lngLat.lat, e.lngLat.lng);
}

/* "Parishkar Kolkata" for a report there, else this deployment's name. */
function brandName(r){
  const p = r?.area === 'place' && window.KasaPlaces?.bySlug(r.place);
  return 'Parishkar ' + (p ? p.name : CITY_NAME);
}

function updateMap(){
  if (!mainMap || !mainMap.getSource('reports')) return;
  mainMap.getSource('reports').setData(reportGeoJSON());
  const sel = p => ['==', ['get', 'ward'], (state.selectedPlace || null) === p ? state.selectedWard ?? -1 : -1];
  if (mainMap.getLayer('wards-selected')) mainMap.setFilter('wards-selected', sel(null));
  for (const slug of Object.keys(window.KasaPlaces?.geo || {})){
    if (mainMap.getLayer('place-' + slug + '-selected')) mainMap.setFilter('place-' + slug + '-selected', sel(slug));
  }
}

/* A ward of Purulia, or with a slug a ward of another town (Kolkata). Tapping it again closes it. */
function selectWard(n, place = null){
  const same = state.selectedWard === n && (state.selectedPlace || null) === place;
  state.selectedWard = same ? null : n;
  state.selectedPlace = same ? null : place;
  if (state.selectedWard != null) closeArea();
  renderWardCard();
  updateMap();
}

function renderWardCard(){
  const el = document.getElementById('k-ward-card');
  const n = state.selectedWard;
  if (!n){ el.hidden = true; return; }
  if (state.selectedPlace) return renderPlaceWardCard(el, n, state.selectedPlace);
  const s = wardStats()[n] || { open: 0, resolved: 0, fake: 0, avgFixDays: null };
  const w = state.wards[n] || {};
  const filteredToWard = state.filters.ward === n && !state.filters.place;
  el.innerHTML = `
    <button type="button" class="k-ward-close" data-ward-close aria-label="${esc(t('sheet_close'))}">✕</button>
    <div class="k-ward-title">${esc(t('acc_ward', { n }))}</div>
    <div class="k-ward-sub">${w.councillor_name ? esc(w.councillor_name) : esc(t('lb_vacant'))}</div>
    <div class="k-ward-nums">
      <span>${esc(t('wc_reported', { n: s.open + s.resolved }))}</span>
      <span class="k-red">${esc(t('wc_open', { n: s.open }))}</span>
      <span class="k-green">${esc(t('wc_fixed', { n: s.resolved }))}</span>
      ${s.fake ? `<span class="k-red">${esc(t('wc_fake', { n: s.fake }))}</span>` : ''}
    </div>
    ${s.avgFixDays != null ? `<div class="k-ward-avg">${esc(t('wc_avg_fix', { n: s.avgFixDays }))}</div>` : ''}
    <div class="k-ward-actions">
      <button type="button" class="k-ward-filter" data-ward-filter="${n}">${esc(t(filteredToWard ? 'wc_clear' : 'wc_filter'))}</button>
      <button type="button" class="k-ward-filter" data-ward-share="${n}">${esc(t('wc_share'))}</button>
      <a class="k-ward-filter" href="digest.html?ward=${n}">${esc(t('wc_digest'))}</a>
    </div>
    <a class="k-ward-money" href="ward.html?ward=${n}">${esc(t('wc_page'))}</a>
    <a class="k-ward-money" href="municipality.html">${esc(t('wc_money'))}</a>
    <a class="k-ward-groups${state.groupsByWard[n] ? ' on' : ''}" href="communities.html?ward=${n}">${esc(state.groupsByWard[n]
      ? t('wc_groups', { n: state.groupsByWard[n] }) : t('wc_groups_none'))}</a>
    <div class="k-ward-note">${esc(t('boundary_note'))}</div>`;
  el.hidden = false;
}

/* A town's ward councillors (places.js `councillors`), fetched once. */
const placeCouncillors = {};
function councillorsOf(slug){
  const p = window.KasaPlaces?.bySlug(slug);
  if (!p?.councillors) return null;
  if (!(slug in placeCouncillors)){
    placeCouncillors[slug] = null;
    fetch(p.councillors).then(r => r.ok ? r.json() : null).then(j => {
      placeCouncillors[slug] = j;
      if (j && state.selectedPlace === slug) renderWardCard();
    }).catch(() => {});
  }
  return placeCouncillors[slug];
}
function councillorOf(slug, n){
  const c = councillorsOf(slug);
  const w = c?.wards?.[n];
  return w ? { ...w, src: c } : null;
}

/* Another town's ward: the same counts and filter as Purulia's, with its councillor where on record. */
function renderPlaceWardCard(el, n, slug){
  const p = window.KasaPlaces?.bySlug(slug) || { name: slug };
  const c = councillorOf(slug, n);
  const s = wardStats(slug)[n] || { open: 0, resolved: 0, fake: 0, avgFixDays: null };
  const filteredToWard = state.filters.ward === n && state.filters.place === slug;
  el.innerHTML = `
    <button type="button" class="k-ward-close" data-ward-close aria-label="${esc(t('sheet_close'))}">✕</button>
    <div class="k-ward-title">${esc(p.name)} · ${esc(t('acc_ward', { n }))}</div>
    <div class="k-ward-sub">${c ? esc(c.councillor) + (c.party ? ' · ' + esc(c.party) : '') : esc(t('pw_councillor_unknown'))}</div>
    ${c ? `<div class="k-ward-note">${esc(t('pw_councillor_src', { when: c.src.elected }))} <a href="${esc(c.src.sourceUrl)}" target="_blank" rel="noopener">${esc(t('pw_source'))}</a></div>` : ''}
    <div class="k-ward-nums">
      <span>${esc(t('wc_reported', { n: s.open + s.resolved }))}</span>
      <span class="k-red">${esc(t('wc_open', { n: s.open }))}</span>
      <span class="k-green">${esc(t('wc_fixed', { n: s.resolved }))}</span>
      ${s.fake ? `<span class="k-red">${esc(t('wc_fake', { n: s.fake }))}</span>` : ''}
    </div>
    ${s.avgFixDays != null ? `<div class="k-ward-avg">${esc(t('wc_avg_fix', { n: s.avgFixDays }))}</div>` : ''}
    <div class="k-ward-actions">
      <button type="button" class="k-ward-filter" data-ward-filter="${n}" data-ward-place="${esc(slug)}">${esc(t(filteredToWard ? 'wc_clear' : 'wc_filter'))}</button>
      <button type="button" class="k-ward-filter" data-ward-share="${n}" data-ward-place="${esc(slug)}">${esc(t('wc_share'))}</button>
    </div>
    ${c?.borough && c.src.boroughOffices ? `<a class="k-ward-money" href="${esc(c.src.boroughOffices)}" target="_blank" rel="noopener">${esc(t('pw_borough', { b: c.borough, body: p.body || p.name }))}</a>` : ''}
    <div class="k-ward-note">${esc(t('pw_map_note', { src: p.sourceName || p.source || '' }))}</div>`;
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

const SEV_RANK = { critical: 3, severe: 2, minor: 1 }, STATUS_RANK = { open: 2, claimed: 1, resolved: 0 };
const urgentFirst = (a, b) => STATUS_RANK[b.status] - STATUS_RANK[a.status] || SEV_RANK[b.severity] - SEV_RANK[a.severity] || daysSince(b.createdAt) - daysSince(a.createdAt);

function sortReports(list){
  const sevRank = SEV_RANK, statusRank = STATUS_RANK;
  const by = {
    urgent: (a, b) => statusRank[b.status] - statusRank[a.status] || sevRank[b.severity] - sevRank[a.severity] || daysSince(b.createdAt) - daysSince(a.createdAt),
    newest: (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
    seen: (a, b) => b.seen - a.seen,
    oldest: (a, b) => statusRank[b.status] - statusRank[a.status] || new Date(a.createdAt) - new Date(b.createdAt)
  }[state.sort] || urgentFirst;
  // Reports neighbours doubt sink below the rest, whatever the chosen order.
  const doubt = r => r.neighbour === 'doubted' ? 2 : (r.ratings >= 3 && r.authAvg != null && r.authAvg <= 2 ? 1 : 0);
  return [...list].sort((a, b) => doubt(a) - doubt(b) || by(a, b));
}

function matchesQuery(r, q){
  if (!q) return true;
  if (/^\d+$/.test(q)) return r.ward === Number(q);
  const hay = [r.landmark, r.address, r.description, t('cat_' + r.category), I18N.en['cat_' + r.category], r.ward ? t('acc_ward', { n: r.ward }) : '', r.block || '']
    .join(' ').toLowerCase();
  return q.toLowerCase().split(/\s+/).every(w => hay.includes(w));
}

function renderList(){
  if (state.view !== 'list') return;
  const list = sortReports(filtered().filter(onMap).filter(r => matchesQuery(r, state.listQuery)));
  document.getElementById('k-list-count').textContent = t('list_count', { n: list.length });
  const box = document.getElementById('k-list-items');
  if (!list.length){ box.innerHTML = `<div class="k-lb-empty">${esc(t('list_empty'))}</div>`; return; }
  // "By ward": one heading per town ward (villages by block), the ward with most unresolved first.
  let groupOf = null, heads = null;
  if (state.sort === 'ward'){
    groupOf = r => r.area !== 'rural' && r.ward ? 'w' + r.ward : r.block ? 'b' + r.block : '-';
    const open = {};
    for (const r of list) open[groupOf(r)] = (open[groupOf(r)] || 0) + (r.status !== 'resolved');
    const order = Object.keys(open).sort((a, b) => (a === '-') - (b === '-') || open[b] - open[a] || a.localeCompare(b, undefined, { numeric: true }));
    const rank = Object.fromEntries(order.map((k, i) => [k, i]));
    list.sort((a, b) => rank[groupOf(a)] - rank[groupOf(b)] || urgentFirst(a, b));
    heads = k => {
      const w = k[0] === 'w' && state.wards[k.slice(1)];
      const name = k === '-' ? t('list_no_area') : k[0] === 'w' ? t('acc_ward', { n: k.slice(1) }) + (w?.councillor_name ? ' · ' + w.councillor_name : '') : t('list_block', { b: k.slice(1) });
      return `<div class="k-list-group"><span>${esc(name)}</span><span>${esc(t('list_ward_open', { n: open[k] }))}</span></div>`;
    };
  }
  let prev = null;
  box.innerHTML = list.slice(0, 300).map(r => {
    const c = CATEGORIES[r.category];
    const head = groupOf && groupOf(r) !== prev ? heads(prev = groupOf(r)) : '';
    return `${head}
    <button type="button" class="k-list-item" data-open="${esc(r.id)}">
      ${r.photo ? `<img src="${esc(r.photo)}" alt="" loading="lazy" width="64" height="64">` : `<span class="k-list-noimg">${c.icon}</span>`}
      <span class="k-list-main">
        <span class="k-list-title">${c.icon} ${esc(t('cat_' + r.category))}</span>
        <span class="k-list-where">${esc(placeText(r))}${(r.landmark || r.address) && (r.ward || r.block) ? ' · ' + esc(placeLabel(r)) : ''}</span>
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
  const all = scopedPrimaries();
  const open = all.filter(r => r.status !== 'resolved').length;
  const verified = all.filter(r => r.status === 'resolved' && r.resolution !== 'legacy_unverified').length;
  const fake = all.reduce((n, r) => n + r.rejectedClaims, 0);
  setText('k-pill-active', open);
  setText('k-pill-total', all.length);
  setText('k-stat-total', all.length);
  setText('k-stat-open', open);
  setText('k-stat-resolved', verified);
  setText('k-fixed-chip-n', verified);
  setText('k-stat-fake', fake);
}

function renderLeaderboard(){
  const el = document.getElementById('k-lb-list');
  if (!state.reports.length){ el.innerHTML = `<div class="k-lb-empty">${esc(t('lb_empty'))}</div>`; return; }
  const stats = wardStats();
  // Searching shows every ward that matches, even ones with nothing open, so people can find their own.
  const q = state.lbQuery.toLowerCase();
  const rows = (q
    ? Object.keys(state.wards).map(Number).map(n => stats[n] || { ward: n, open: 0, resolved: 0, overdue: 0, fake: 0, recurring: 0 })
        .filter(s => String(s.ward) === q.replace(/^ward\s*/, '') || (state.wards[s.ward]?.councillor_name || '').toLowerCase().includes(q))
    : Object.values(stats).filter(s => s.open > 0 || s.fake > 0)
  ).sort((a, b) => b.open - a.open || b.fake - a.fake || a.ward - b.ward);
  if (!rows.length){ el.innerHTML = `<div class="k-lb-empty">${esc(t(q ? 'lb_no_match' : 'lb_all_clear'))}</div>`; return; }
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

// Fixed reports, newest first, with how long they took and who confirmed them.
// Every resolution method counts — community verification, the photo fast-lane,
// an admin's manual accept, and legacy reports resolved before verification existed.
function recentFixes(){
  return scopedPrimaries()
    .filter(r => r.status === 'resolved' && r.resolvedAt && !r.relapsed)
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
  // Same cards on the map screen, behind a "✓ N fixed" chip so the map stays clear.
  const chip = document.getElementById('k-fixed-chip');
  chip.hidden = !fixes.length;
  document.getElementById('k-fixed-chip-sep').hidden = !fixes.length;
  if (!fixes.length) document.getElementById('k-fixed-strip').hidden = true;
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
        <span class="k-fixed-meta">${esc(r.ward || r.block || r.place ? placeLabel(r) : '')}${w.councillor_name && r.area !== 'rural' ? ' · ' + esc(t('fixed_councillor', { name: w.councillor_name })) : ''}</span>
        ${n ? `<span class="k-fixed-confirm">✓ ${esc(t('fixed_confirmed', { n }))}</span>` : ''}
      </span>
    </button>`;
  }).join('');
  document.getElementById('k-fixed-strip-list').innerHTML = el.innerHTML;
  loadFixConfirmations();
}

function setFixedStrip(open){
  document.getElementById('k-fixed-strip').hidden = !open;
  document.getElementById('k-fixed-chip').setAttribute('aria-expanded', String(open));
}

function renderTicker(){
  const track = document.getElementById('k-ticker-track');
  const recent = scopedPrimaries().slice(0, 12);
  if (!recent.length){ track.innerHTML = `<span class="k-ticker-item">${esc(t('lb_empty'))}</span>`; return; }
  const items = recent.map(r => `
    <span class="k-ticker-item"><span class="k-ticker-dot" style="background:${markerColor(r)}"></span>
    ${CATEGORIES[r.category].icon} ${esc(placeLabel(r))} · ${esc(r.status === 'open' ? t('days_open', { n: daysSince(r.createdAt) }) : t('status_' + r.status))}</span>`).join('');
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
/* Ticks the open sheet's countdown once a minute — cheap since it only touches one small
   element's text, not a full re-render, and only runs while a sheet is actually open. */
function updateSlaClock(){
  const el = document.getElementById('k-sla-clock');
  if (!el) return;
  const r = state.byId.get(state.sheetId);
  if (!r) return;
  const { over, text } = slaCountdown(r);
  el.textContent = text;
  el.classList.toggle('k-sla-overdue', over);
}

function openSheet(id){
  const r = state.byId.get(String(id));
  if (!r) return;
  state.sheetId = r.id;
  renderSheet();
  openModal('k-sheet');
  clearInterval(openSheet._tick);
  openSheet._tick = setInterval(updateSlaClock, 60000);
  document.getElementById('k-sheet-body').scrollTop = 0;
  if (!r.pending) try { history.replaceState(null, '', `?report=${encodeURIComponent(r.id)}`); } catch (e) {}
  if (!r.pending && state.mode === 'v2' && !state.photos.has(r.id)){
    api.reportPhotos(r.id).then(list => {
      state.photos.set(r.id, list);
      if (state.sheetId === r.id) renderGalleryInPlace(r);
    });
  }
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
  clearInterval(openSheet._tick);
  try { history.replaceState(null, '', location.pathname); } catch (e) {}
}

function galleryPhotos(r){
  return [r.photo, ...(state.photos.get(r.id) || [])].filter(Boolean);
}

function renderGalleryHTML(r, seenByMe){
  const c = CATEGORIES[r.category];
  const seenBtn = r.pending || r.status === 'resolved' ? '' : `
      <button type="button" class="k-seen-btn${seenByMe ? ' k-seen-done' : ''}" data-seen="${esc(r.id)}" ${seenByMe ? 'disabled' : ''}>
        ${ICON_EYE}<span>${esc(t(seenByMe ? 'sheet_seen_done' : 'sheet_seen_btn'))}</span>
      </button>`;
  const photos = galleryPhotos(r);
  if (!photos.length) return `<div class="k-sheet-photo"><div class="k-sheet-noimg">${c.icon}</div>${seenBtn}</div>`;
  return `
    <div class="k-gallery" id="k-sheet-gallery">
      <div class="k-gallery-track">
        ${photos.map((u, i) => `<div class="k-gallery-slide"><img src="${esc(u)}" alt="${esc(t('cat_' + r.category))}" loading="${i === 0 ? 'eager' : 'lazy'}"></div>`).join('')}
      </div>
      ${photos.length > 1 ? `<div class="k-gallery-dots">${photos.map((_, i) => `<span class="k-gallery-dot${i === 0 ? ' active' : ''}"></span>`).join('')}</div>` : ''}
      ${seenBtn}
    </div>`;
}

function setupGalleryScroll(gallery){
  if (!gallery) return;
  const track = gallery.querySelector('.k-gallery-track');
  const dots = gallery.querySelectorAll('.k-gallery-dot');
  if (!track || dots.length < 2) return;
  const slides = [...track.querySelectorAll('.k-gallery-slide')];
  const obs = new IntersectionObserver(entries => {
    entries.forEach(en => {
      if (!en.isIntersecting) return;
      const i = slides.indexOf(en.target);
      dots.forEach((d, di) => d.classList.toggle('active', di === i));
    });
  }, { root: track, threshold: 0.6 });
  slides.forEach(s => obs.observe(s));
}

function renderGalleryInPlace(r){
  const seenByMe = state.seen.has(r.id);
  const el = document.getElementById('k-sheet-gallery') || document.querySelector('#k-sheet-body .k-sheet-photo');
  if (!el) return;
  el.outerHTML = renderGalleryHTML(r, seenByMe);
  setupGalleryScroll(document.getElementById('k-sheet-gallery'));
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
  const place = placeText(r);
  const directions = `https://www.google.com/maps/dir/?api=1&destination=${r.lat},${r.lng}`;

  document.getElementById('k-sheet-body').innerHTML = `
    ${renderGalleryHTML(r, seenByMe)}
    <div class="k-anon">${ICON_SHIELD} ${esc(t('sheet_anonymous'))}</div>
    <div class="k-allegation">⚖ ${esc(t('sheet_allegation'))} <a href="terms.html#allegations">${esc(t('sheet_terms'))}</a></div>
    ${!r.pending && r.status !== 'resolved' ? `
    <button type="button" class="k-watch-btn${watchedReports().has(r.id) ? ' on' : ''}" data-watch="${esc(r.id)}" ${watchSupported() ? '' : 'hidden'}>
      ${esc(t(watchedReports().has(r.id) ? 'watch_off_btn' : 'watch_btn'))}
    </button>` : ''}

    <div class="k-sheet-place">
      <div class="k-sheet-cat">${c.icon} ${esc(t('cat_' + r.category))}${r.wasteType ? ' · ' + esc(t('waste_' + r.wasteType)) : ''}${neighbourBadge(r)}</div>
      <h3 class="k-sheet-title">${esc(place)}</h3>
      <div class="k-sheet-wardline">${esc([(r.landmark || r.address) && (r.ward || r.block || r.place) ? placeLabel(r) : '', r.area === 'rural' ? '' : w.councillor_name || ''].filter(Boolean).join(' · '))}</div>
      ${r.description ? `<p class="k-sheet-desc">${esc(r.description)}</p>` : ''}
      <div class="k-sheet-links">
        <a href="${directions}" target="_blank" rel="noopener">${ICON_NAV} ${esc(t('sheet_directions'))}</a>
        <span class="k-sheet-loc">${r.gps ? '📍 ' + esc(t('sheet_gps')) : state.mode === 'v2' ? '📌 ' + esc(t('sheet_pinned')) : ''}</span>
      </div>
    </div>

    <div class="k-cards">
      <div class="k-card"><b>${peopleSaw(r)}</b><span>${esc(t('stat_people'))}</span></div>
      <div class="k-card${r.status !== 'resolved' && isOverdue(r) ? ' k-card-overdue' : ''}"><b>${r.status === 'resolved' && fixDays != null ? fixDays : days}</b><span>${esc(t(r.status === 'resolved' && fixDays != null ? 'stat_days_fix' : isOverdue(r) ? 'stat_days_overdue' : 'stat_days_open'))}</span></div>
      <div class="k-card k-card-wide"><b class="k-card-text">${esc(t('cat_' + r.category))}</b><span>${esc(t('stat_type'))}</span></div>
    </div>
    ${!r.pending && r.status !== 'resolved' ? `<div class="k-sla-clock" id="k-sla-clock"></div>` : ''}

    ${renderStatusPanel(r)}
    ${renderRating(r)}
    <div id="k-replies">${renderRepliesHTML(r)}</div>
    ${renderAccountability(r)}
    <div id="k-timeline">${renderTimelineHTML(r)}</div>`;

  updateSlaClock();

  const status = r.status === 'resolved'
    ? (fixDays != null ? t('foot_fixed', { d: fixDays }) : t('status_resolved'))
    : isOverdue(r) ? t('foot_unresolved_overdue', { d: days, sla: r.slaDays }) : t('foot_unresolved', { d: days });
  document.getElementById('k-sheet-foot').innerHTML = `
    <div class="k-foot-line">${esc(t('foot_line', { ago: ago(r.createdAt), n: peopleSaw(r), status }))}</div>
    <div class="k-foot-actions">${renderActions(r)}</div>`;
  setupGalleryScroll(document.getElementById('k-sheet-gallery'));
}

/* "Resolved by 3 confirmers · Verified by moderator · Ward 12 · SLA met" — a small credit
   line for a community-verified resolution, built only from what's actually on the record. */
function resolutionCaption(r){
  if (r.status !== 'resolved' || r.resolution === 'legacy_unverified') return '';
  const bits = [];
  if (r.resolution === 'photo_check') bits.push(t('cap_photo_check'));
  else if (r.resolution === 'moderator') bits.push(t('cap_mod_accepted'));
  else if (r.claim?.verify) bits.push(t('cap_confirmers', { n: r.claim.verify }));
  if (r.claim?.reviewedAt) bits.push(t('cap_moderator'));
  bits.push(placeLabel(r));
  if (r.resolvedAt){
    const fixDays = Math.max(0, Math.round((new Date(r.resolvedAt) - new Date(r.createdAt)) / 86400000));
    bits.push(fixDays <= r.slaDays ? t('cap_sla_met') : t('cap_sla_missed', { d: fixDays }));
  }
  return bits.join(' · ');
}

function renderStatusPanel(r){
  const parts = [];
  if (r.pending) parts.push(`<div class="k-note">${esc(t('pn_pending'))}</div>`);
  if (r.flagged) parts.push(`<div class="k-note k-note-warn">⚑ ${esc(t('pn_flagged', { n: r.flags }))}</div>`);
  if (r.recurrence) parts.push(`<div class="k-note k-note-warn">↻ ${esc(t('pn_recurring', { n: r.recurrence }))}</div>`);
  if (r.rejectedClaims) parts.push(`<div class="k-note k-note-bad">✗ ${esc(t('pn_rejected', { n: r.rejectedClaims }))}</div>`);

  if (r.status === 'claimed' && r.claim){
    const q = verifyNeeded(r), dq = state.rules.dispute_quorum;
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
        ${r.claim.fast && !r.claim.held ? `<div class="k-note">📷 ${esc(t(r.claim.photoOnlyAt && !r.claim.verify && !r.claim.dispute ? 'pn_fast_photo_only' : 'pn_fast', { n: q, date: r.claim.photoOnlyAt ? fmtDate(new Date(r.claim.photoOnlyAt)) : '' }))}</div>` : ''}
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
        <div class="k-panel-title">✓ ${esc(t(r.resolution === 'photo_check' ? 'pn_resolved_photo_title' : r.resolution === 'moderator' ? 'pn_resolved_mod_title' : 'pn_resolved_title'))}</div>
        ${beforeAfter(r.photo, r.resolvedPhoto)}
        <div class="k-panel-meta">${esc(t('pn_resolved_meta', { date: fmtDate(r.resolvedAt), days: fixDays }))}</div>
        <div class="k-panel-caption">${esc(resolutionCaption(r))}</div>
        ${r.relapsed ? `<div class="k-note k-note-bad">↻ ${esc(t('pn_relapsed', { n: CITY.fixMustLastDays || 14 }))} <button type="button" class="k-link" data-open="${esc(r.relapsedBy)}">${esc(t('pn_relapsed_open'))}</button></div>` : ''}
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

/* Another West Bengal place: only its municipal body and its own complaint form are named.
   Its officers and representatives are not on record here, so none are shown. */
function renderPlaceAccountability(r){
  const p = window.KasaPlaces?.bySlug(r.place);
  return `
    <div class="k-acc">
      <div class="k-acc-label">${esc(t('acc_title'))}</div>
      <div class="k-tree">
        <div class="k-tree-root"><small>${esc(t('acc_your_ward'))}</small><b>${esc(placeLabel(r))}</b></div>
        ${p?.isDistrict || !p?.body ? `<div class="k-node k-node-vacant"><span class="k-node-abbr">🏛</span>
          <span class="k-node-text"><b>${esc(t('pl_incharge_unknown'))}</b></span></div>
          <a class="k-esc-item" href="add-town.html${p?.isDistrict ? '?district=' + encodeURIComponent(p.name) : ''}"><b>${esc(t('pl_add_town'))}</b></a>`
        : `<div class="k-node k-node-vacant"><span class="k-node-abbr">🏛</span>
          <span class="k-node-text"><b>${esc(p.body)}</b><small>${esc(t('pl_officers_unknown'))}</small></span></div>`}
        ${(() => { const c = r.placeWard && councillorOf(r.place, r.placeWard); return c ? `<div class="k-node k-node-elected"><span class="k-node-abbr">🗳</span>
          <span class="k-node-text"><b>${esc(c.councillor)}</b><small>${esc(t('pw_councillor_of', { n: r.placeWard }))}${c.party ? ' · ' + esc(c.party) : ''} · <a href="${esc(c.src.sourceUrl)}" target="_blank" rel="noopener">${esc(t('pw_source'))}</a></small></span></div>` : ''; })()}
        ${p?.incharge ? `<div class="k-node"><span class="k-node-abbr">🧹</span>
          <span class="k-node-text"><b>${esc(p.incharge)}</b><small>${esc(t('pl_incharge'))}${p.inchargeSource ? ': ' + esc(p.inchargeSource) : ''}</small></span></div>` : ''}
        ${p?.complaintUrl && /^https:\/\//i.test(p.complaintUrl) ? `<a class="k-esc-item" href="${esc(p.complaintUrl)}" target="_blank" rel="noopener"><b>${esc(t('pl_complain', { body: p.body }))}</b><small>${esc(t('pl_complain_s'))}</small></a>` : ''}
        ${p?.contacts?.length ? `<details class="k-acc-more">
          <summary>${esc(t('pl_contacts', { body: p.body }))}</summary>
          ${p.contacts.map(c => `<a class="k-esc-item" href="${c.wa ? 'https://wa.me/' + esc(c.wa) : 'tel:' + esc(c.tel)}"${c.wa ? ' target="_blank" rel="noopener"' : ''}><b>${esc(t('pl_c_' + c.kind))}</b><small>${esc(c.show)}</small></a>`).join('')}
          ${p.address ? `<p class="k-acc-src">${esc(p.address)}</p>` : ''}
          <p class="k-acc-src"><a href="${esc(p.contactsSource)}" target="_blank" rel="noopener">${esc(t('pl_c_source'))}</a></p>
        </details>` : ''}
        ${p && !p.isDistrict ? `<a class="k-esc-item" href="add-town.html?fix=${encodeURIComponent(p.slug)}"><b>${esc(t('pl_fix_border'))}</b>${p.status === 'provisional' ? `<small>${esc(t('pl_border_note'))}</small>` : ''}</a>` : ''}
        <details class="k-acc-more">
          <summary>${esc(t('acc_more'))}</summary>
          ${renderEscalate(r)}
        </details>
      </div>
    </div>`;
}

function renderAccountability(r){
  if (r.area === 'place') return renderPlaceAccountability(r);
  const chain = chainFor(r);
  const rural = r.area === 'rural';
  const town2 = otherTown(r);
  const w = state.wards[r.ward] || {};
  const node = (role, i) => `
    <button type="button" class="k-node" data-contact="role:${role}:${esc(r.id)}">
      <span class="k-node-abbr">${esc(ROLE_ABBR[role])}</span>
      <span class="k-node-text"><b>${esc(t('role_' + role))}</b><small>${esc(roleSub(role, i, chain.nodes.length, r))}</small></span>
    </button>`;
  // The tree shows two people: who fixes it first, and who you elected. Everyone above
  // them, the reps and the escalation routes sit behind one tap.
  const [first, ...above] = chain.nodes;
  const councillor = rural ? '' : w.councillor_name
    ? `<button type="button" class="k-node k-node-elected" data-contact="councillor:${r.ward}:${esc(r.id)}">
         <span class="k-node-abbr">WC</span>
         <span class="k-node-text"><b>${esc(w.councillor_name)}</b><small>${esc(t('acc_councillor'))}${w.party ? ' · ' + esc(w.party) : ''}</small></span></button>`
    : `<div class="k-node k-node-vacant"><span class="k-node-abbr">⚠</span>
         <span class="k-node-text"><b>${esc(t('acc_councillor'))}</b><small>${esc(r.ward ? t('acc_vacant') : t('acc_unknown'))}</small></span></div>`;
  // Named MLA/MP cards are for Purulia town's seat; villages belong to several assembly seats.
  const reps = rural ? `<div class="k-acc-rural-note">${esc(t(town2 ? 'acc_town_reps' : 'acc_rural_reps'))}</div>` : ['mla', 'mp'].map(k => `
    <button type="button" class="k-rep-chip" data-contact="rep:${k}:${esc(r.id)}">
      ${repAvatar(REPS[k], 'k-rep-chip-av')}
      <b>${esc(REPS[k].name)}</b><small><span class="k-party k-party-${esc(REPS[k].party.toLowerCase())}">${esc(REPS[k].party)}</span> · ${esc(k.toUpperCase())}</small>
    </button>`).join('');
  return `
    <div class="k-acc">
      <div class="k-acc-label">${esc(t('acc_title'))}</div>
      <div class="k-tree">
        <div class="k-tree-root"><small>${esc(t(town2 ? 'acc_your_town' : rural ? (r.body ? 'acc_your_gp' : 'acc_your_block') : 'acc_your_ward'))}</small><b>${esc(placeLabel(r))}</b></div>
        <div class="k-tree-fork${councillor ? '' : ' k-tree-fork-one'}">
          <div class="k-tree-branch">${first ? node(first, 0) : ''}</div>
          ${councillor ? `<div class="k-tree-branch">${councillor}</div>` : ''}
        </div>
        <div class="k-acc-hint">${esc(t('acc_tap'))}</div>
        <details class="k-acc-more">
          <summary>${esc(t('acc_more'))}</summary>
          ${above.length ? `<div class="k-acc-reps-label">${esc(t('acc_escalate_chain'))}</div>
          <div class="k-acc-above">${above.map((role, i) => node(role, i + 1)).join('')}</div>` : ''}
          ${chain.note ? `<div class="k-tree-note">${esc(t(chain.note))}</div>` : ''}
          ${rural ? '' : `<div class="k-acc-reps-label">${esc(t('acc_reps'))}</div>`}
          <div class="k-acc-reps">${reps}</div>
          ${rural ? '' : `<a class="k-acc-money" href="municipality.html">${esc(t('wc_money'))}</a>`}
          ${renderEscalate(r)}
        </details>
        <a class="k-respond" href="${esc(replyMailto(r))}">${esc(t('reply_cta'))}</a>
      </div>
    </div>`;
}

/* Official channels with their own deadlines, from city.js. */
const STATE_HELPLINE = CITY.stateHelpline || '';
const STATE_HELPLINE_EMAIL = CITY.stateHelplineEmail || '';
const CENTRAL_CATS = ['road', 'water', 'hand_pump', 'anganwadi', 'health_centre', 'school'];
function renderEscalate(r){
  const msg = reportMessage(r);
  const items = [];
  if (STATE_HELPLINE) items.push([`tel:+91${STATE_HELPLINE}`, t('esc_state', { n: CITY.stateHelplineDisplay || STATE_HELPLINE }), t('esc_state_s')]);
  if (STATE_HELPLINE_EMAIL) items.push([`mailto:${STATE_HELPLINE_EMAIL}?subject=${encodeURIComponent(CITY_NAME + ' — ' + t('cat_' + r.category))}&body=${encodeURIComponent(msg)}`, t('esc_state_mail'), STATE_HELPLINE_EMAIL]);
  if (CENTRAL_CATS.includes(r.category)) items.push(['https://pgportal.gov.in/', t('esc_cpgrams'), t('esc_cpgrams_s')]);
  // WBSEDCL is Purulia's supplier; other places (Kolkata: CESC) have their own.
  if (r.category === 'streetlight' && CITY.powerUtilityUrl && r.area !== 'place') items.push([CITY.powerUtilityUrl, t('esc_power'), t('esc_power_s')]);
  if (CITY.rtiPortalUrl) items.push([CITY.rtiPortalUrl, t('esc_rti'), t('esc_rti_s')]);
  return `
    <div class="k-escalate">
      <div class="k-acc-reps-label">${esc(t('esc_title'))}</div>
      <p class="k-esc-note">${esc(t('esc_note'))}</p>
      ${items.map(([href, label, sub]) => `<a class="k-esc-item" href="${esc(href)}" ${href.startsWith('http') ? 'target="_blank" rel="noopener"' : ''}><b>${esc(label)}</b><small>${esc(sub)}</small></a>`).join('')}
      ${isOverdue(r) && r.area !== 'place' ? `<button type="button" class="k-esc-item k-esc-rti-gen" data-rti="${esc(r.id)}"><b>${esc(t('esc_rti_gen'))}</b><small>${esc(t('esc_rti_gen_s'))}</small></button>` : ''}
      <button type="button" class="k-btn k-btn-ghost k-esc-copy" data-copy-msg="${esc(r.id)}">📋 ${esc(t('esc_copy_msg'))}</button>
      <button type="button" class="k-btn k-btn-ghost k-esc-copy" data-copy-link="${esc(r.id)}">🔗 ${esc(t('ct_copy'))}</button>
    </div>`;
}

/* RTI application generator. Produces a filled draft the citizen reviews, signs with their
   own name/address, and files themselves — never auto-submitted, never sent by this site.
   RTI legally needs a named, addressed applicant, which cuts against how reports are filed
   here (anonymous); this stays a template a human completes, not an automated escalation. */
function rtiAgencyLine(r){
  const chain = chainFor(r);
  const path = chain.nodes.map(n => tEN('role_' + n + '_s')).join(' → ');
  return `${chain.agencyName || tEN(chain.agency)} (${path})`;
}

/* English-only place label for documents; mirrors placeLabel() but never follows the viewer's language. */
function placeLabelEN(r){
  return placeLabel(r, tEN);
}

function rtiHTML(r){
  const catLabel = tEN('cat_' + r.category);
  const place = placeLabelEN(r);
  const filed = new Date(r.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  const days = daysSince(r.createdAt);
  const link = reportLink(r.id);
  const agencyLine = rtiAgencyLine(r);
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>RTI application — ${esc(catLabel)}, ${esc(place)}</title>
<style>
body{font-family:'Times New Roman',Georgia,serif;font-size:15px;line-height:1.7;max-width:760px;margin:40px auto;padding:0 24px;color:#1a1a1a;}
h1{font-size:19px;text-align:center;margin-bottom:2px;}
.sub{text-align:center;font-size:13px;color:#666;margin-top:0;}
.banner{background:#fef3e2;border:2px solid #d97706;border-radius:6px;padding:14px 18px;margin-bottom:28px;font-family:Georgia,serif;font-size:13px;line-height:1.6;}
.banner strong{color:#92400e;}
@media print{.banner{display:none;}}
.blank{border-bottom:1px solid #333;display:inline-block;min-width:260px;}
.block{border:1px solid #999;border-radius:4px;padding:10px 14px;margin:16px 0;}
ol{padding-left:22px;}
li{margin:6px 0;}
.foot{font-size:12px;color:#666;margin-top:40px;border-top:1px solid #ccc;padding-top:14px;}
</style></head><body>

<div class="banner">
<strong>This is a filled draft, not a submitted application.</strong> Fill in your name and address below (RTI legally requires a named, addressed applicant — the report itself stays anonymous; this is a separate document you choose to file). Attach the ₹10 fee (postal order/court fee stamp, per the office's process; fee-exempt if you hold a BPL card). <strong>For Purulia Municipality: file this offline (by post or in person) to the Purulia Municipality office, not through any state or online portal.</strong> Confirm you have the correct Public Information Officer for the office named below before sending — this line is generated from the report's category, not verified against a live PIO directory.
</div>

<h1>APPLICATION UNDER THE RIGHT TO INFORMATION ACT, 2005</h1>
<p class="sub">Section 6(1)</p>

<p>To,<br>
The Public Information Officer,<br>
<strong>${esc(agencyLine)}</strong><br>
Purulia, West Bengal — <span class="blank">&nbsp;</span></p>

<p>From,<br>
Name: <span class="blank">&nbsp;</span><br>
Address: <span class="blank">&nbsp;</span><br>
Phone / e-mail (optional): <span class="blank">&nbsp;</span></p>

<p><strong>Subject: Request for information regarding an unresolved civic report — ${esc(catLabel)}, ${esc(place)}</strong></p>

<p>Sir/Madam,</p>
<p>Under Section 6(1) of the Right to Information Act, 2005, I request the following information from your office.</p>

<div class="block">
<strong>Reference</strong><br>
A report of <strong>${esc(catLabel)}</strong> at <strong>${esc(place)}</strong> was filed on the public civic-reporting platform Parishkar Purulia on <strong>${esc(filed)}</strong> and remains unresolved as of this application (${days} days). The report, its photograph and location, and its full public history are available at:<br>
<span class="blank">${esc(link)}</span>
</div>

<p>I request the following information:</p>
<ol>
  <li>Whether a complaint or report regarding the above civic problem, at the location described, has been received by your office or department, through any channel, as of the date of this application.</li>
  <li>If received, a copy of the action-taken report, inspection report, or file noting recorded in response to it.</li>
  <li>The name and designation of the officer to whom the matter has been, or would be, assigned.</li>
  <li>The expected timeline for resolving the matter, if one has been recorded.</li>
  <li>If no such complaint has been received through any other channel, a written confirmation of that fact.</li>
</ol>

<p>I am enclosing the prescribed fee of ₹10 (Indian Postal Order / Court Fee Stamp / as accepted by your office). <em>[Delete this line if applying under the BPL fee exemption, and attach your BPL certificate instead.]</em></p>

<p>I request the information be provided within 30 days as required under Section 7(1) of the Act.</p>

<p style="margin-top:32px;">Date: <span class="blank">&nbsp;</span></p>
<p>Place: Purulia</p>
<p style="margin-top:24px;">Signature: <span class="blank">&nbsp;</span></p>

<p class="foot">
Generated from a public report on Parishkar Purulia. This platform did not file this application and is not the applicant — you are. If the reply is inadequate or doesn't arrive within 30 days, a First Appeal to the same department's appellate authority is the next legal step under Section 19(1) of the Act.
</p>

</body></html>`;
}

function openRTI(reportId){
  const r = state.byId.get(reportId);
  if (!r) return;
  const blob = new Blob([rtiHTML(r)], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function replyMailto(r){
  const subject = `Right of reply — Parishkar Purulia report ${r.id}`;
  const body = [
    'Report: ' + reportLink(r.id),
    'Your name:', 'Your position (e.g. Ward Councillor, Ward ' + (r.ward ?? '?') + '):',
    'Your response:', '',
    '(Please write from an official or otherwise verifiable address. We publish responses alongside the report.)'
  ].join('\n');
  return `mailto:${GRIEVANCE_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function roleSub(role, i, n, r){
  if (role === 'chairman' && !(r && otherTown(r))) return REPS.chairman.name + ' · ' + t('acc_top');
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
    if (e.kind === 'resolved' && d.by === 'moderator' && d.reason) bits.push(String(d.reason));
    if (e.kind === 'flagged' && d.reason) bits.push(t('fr_' + d.reason) + (d.suggested_category ? ' → ' + t('cat_' + d.suggested_category) : ''));
    if ((e.kind === 'recategorized' || e.kind === 'auto_recategorized') && d.to) bits.push(`${t('cat_' + d.from)} → ${t('cat_' + d.to)}${d.reason ? ' · ' + d.reason : ''}`);
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
          <div class="k-tl-kind">${esc(t(e.kind === 'resolved' && d.by === 'photo_check' ? 'ev_resolved_photo' : e.kind === 'resolved' && d.by === 'moderator' ? 'ev_resolved_mod' : 'ev_' + e.kind))}<time>${esc(ago(e.created_at))}</time></div>
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

async function shareReport(id){
  const r = state.byId.get(id);
  if (!r) return;
  const url = reportLink(id);
  const text = r.area === 'place'
    ? t('pl_share', { cat: t('cat_' + r.category), place: placeOther(r, t), days: daysSince(r.createdAt) })
    : r.area === 'rural' && r.block
    ? t('share_text_rural', { cat: t('cat_' + r.category), block: r.block, days: daysSince(r.createdAt) })
    : t('share_text', { cat: t('cat_' + r.category), ward: r.ward ?? '?', days: daysSince(r.createdAt) });
  // A picture travels on WhatsApp where a bare link doesn't: send the card with the link.
  const card = await shareCard(r).catch(() => null);
  const file = card && new File([card], `parishkar-${id.slice(0, 8)}.png`, { type: 'image/png' });
  if (file && navigator.canShare?.({ files: [file] })){
    try { await navigator.share({ files: [file], title: brandName(r), text: `${text} ${url}` }); } catch (e) {}
    return;
  }
  if (navigator.share){ navigator.share({ title: brandName(r), text, url }).catch(() => {}); return; }
  // Desktop: save the card and copy the link, ready to paste into WhatsApp Web.
  if (card){
    const a = document.createElement('a');
    a.href = URL.createObjectURL(card);
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  copyText(url, card ? 'share_card_saved' : 'ct_copied');
}

/* Which assembly seat a report falls in, from city.js (null for split or unmapped blocks). */
function seatFor(r){
  const seats = CITY.constituencies || [];
  if (r.area !== 'rural') return r.ward ? seats.find(c => c.town) || null : null;
  const b = (r.block || '').toLowerCase();
  return seats.find(c => (c.blocks || []).some(x => x.toLowerCase() === b)) || null;
}

/* 1080×1350 share card: the photo, how long it's been open, who is responsible, the link. */
async function shareCard(r){
  const W = 1080, H = 1350, PH = 820, PAD = 64;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  await document.fonts?.ready;
  g.fillStyle = '#0a0805'; g.fillRect(0, 0, W, H);
  if (r.photo){
    const img = await new Promise((resolve, reject) => {
      const i = new Image(); i.crossOrigin = 'anonymous';
      i.onload = () => resolve(i); i.onerror = reject; i.src = r.photo;
    }).catch(() => null);
    if (img){
      const s = Math.max(W / img.width, PH / img.height);
      g.save(); g.beginPath(); g.rect(0, 0, W, PH); g.clip();
      g.drawImage(img, (W - img.width * s) / 2, (PH - img.height * s) / 2, img.width * s, img.height * s);
      g.restore();
    }
  }
  const fixed = r.status === 'resolved', days = daysSince(r.createdAt);
  const serif = '"EB Garamond", "Noto Sans Bengali", "Noto Sans Devanagari", Georgia, serif';
  const mono = '"DM Mono", "Noto Sans Bengali", "Noto Sans Devanagari", ui-monospace, monospace';
  // Status badge over the photo
  const badge = fixed ? t('card_fixed') : days < 1 ? t('card_today') : t(isOverdue(r) ? 'card_overdue' : 'card_open', { d: days });
  g.font = `500 34px ${mono}`;
  const bw = g.measureText(badge).width + 48;
  g.fillStyle = fixed ? COLORS.resolved : isOverdue(r) ? COLORS.critical : COLORS.minor;
  g.fillRect(PAD, PH - 90, bw, 64);
  g.fillStyle = '#0a0805'; g.textBaseline = 'middle';
  g.fillText(badge, PAD + 24, PH - 58);
  // Text block
  const wrap = (txt, x, y, maxW, lh, maxLines) => {
    const words = String(txt).split(/\s+/); let line = '', n = 0;
    for (const w of words){
      const next = line ? line + ' ' + w : w;
      if (g.measureText(next).width > maxW && line){ g.fillText(line, x, y); y += lh; line = w; if (++n >= maxLines - 1) break; }
      else line = next;
    }
    if (line) g.fillText(line, x, y);
    return y + lh;
  };
  g.textBaseline = 'alphabetic';
  let y = PH + 100;
  g.fillStyle = '#f0e6d0'; g.font = `700 72px ${serif}`;
  y = wrap(t('cat_' + r.category), PAD, y, W - 2 * PAD, 80, 2);
  g.fillStyle = 'rgba(240,230,208,.72)'; g.font = `400 40px ${serif}`;
  y = wrap(r.landmark || r.address ? `${placeText(r)} · ${placeLabel(r)}` : placeLabel(r), PAD, y, W - 2 * PAD, 50, 2) + 16;
  const chain = chainFor(r), seat = seatFor(r), mla = seat && (typeof seat.mla === 'string' ? REPS[seat.mla] : seat.mla);
  g.font = `500 32px ${mono}`; g.fillStyle = '#e8a34a';
  const otherBody = r.area === 'place' && (window.KasaPlaces?.bySlug(r.place)?.body || t('pl_incharge_unknown'));
  y = wrap(`${t('card_responsible')}: ${otherBody || t('role_' + chain.nodes[0])}`, PAD, y, W - 2 * PAD, 44, 2);
  if (mla) y = wrap(`MLA: ${mla.name}${mla.party ? ' (' + mla.party + ')' : ''}`, PAD, y, W - 2 * PAD, 44, 1);
  // Footer
  g.fillStyle = '#d4882a'; g.fillRect(0, H - 120, W, 120);
  g.fillStyle = '#0a0805'; g.font = `700 40px ${serif}`;
  g.fillText(brandName(r), PAD, H - 68);
  g.font = `500 28px ${mono}`;
  g.fillText(t(fixed ? 'card_cta_fixed' : 'card_cta'), PAD, H - 28);
  return new Promise((resolve, reject) => c.toBlob(b => (b ? resolve(b) : reject(new Error('card'))), 'image/png'));
}

/* A ward link opens that ward's own page (ward.html): something a councillor can share. */
function shareWard(n, place = null){
  const s = wardStats(place)[n] || { open: 0, resolved: 0 };
  const p = place && window.KasaPlaces?.bySlug(place);
  const url = new URL(p ? `kasa.html?place=${encodeURIComponent(place)}&ward=${n}` : `ward.html?ward=${n}`, location.href).href;
  const text = p ? t('pw_share_text', { n, place: p.name, open: s.open, fixed: s.resolved })
    : t('ward_share_text', { n, open: s.open, fixed: s.resolved });
  if (navigator.share){ navigator.share({ title: 'Parishkar ' + (p ? p.name : 'Purulia'), text, url }).catch(() => {}); return; }
  copyText(url);
}

/* Open data: reports as a spreadsheet, public columns only. */
const CSV_COLUMNS = ['id', 'created_at', 'ward', 'category', 'waste_type', 'severity', 'status', 'resolution', 'resolved_at',
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
    r.id, r.createdAt, r.ward, r.category, r.wasteType, r.severity, r.status, r.resolution, r.resolvedAt,
    r.status === 'resolved' ? null : daysSince(r.createdAt), isOverdue(r), r.lat, r.lng, r.landmark, r.description,
    peopleSaw(r), r.rejectedClaims, r.recurrence, r.duplicate, r.photo, r.resolvedPhoto,
    reportLink(r.id)
  ].map(csvCell).join(','));
  // The BOM makes Excel read Bengali and Hindi text as UTF-8.
  const blob = new Blob(['\uFEFF' + [CSV_COLUMNS.join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const ward = scope !== 'all' && state.filters.ward ? `${state.filters.place ? state.filters.place + '-' : ''}ward-${state.filters.ward}-` : '';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `purulia-kasa-${ward}${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  showToast(t('csv_done', { n: rows.length }));
}

function copyText(s, done = 'ct_copied'){
  (navigator.clipboard?.writeText(s) || Promise.reject()).then(() => showToast(t(done)), () => showToast(s, 6000));
}

function reportMessage(r){
  const w = state.wards[r.ward] || {};
  return [
    `${brandName(r)} — ${t('cat_' + r.category)}`,
    r.area === 'place' ? `${placeOther(r, tEN)}, West Bengal`
      : r.area === 'rural' && (r.block || r.body) ? `${placeLabel(r, tEN)}, Purulia district` : `Ward ${r.ward ?? '?'}${w.councillor_name ? ' (' + w.councillor_name + ')' : ''}`,
    r.landmark ? `Near: ${r.landmark}` : '',
    r.address && r.address !== r.landmark ? `Address: ${r.address}` : '',
    `Severity: ${r.severity} · ${daysSince(r.createdAt)} days unresolved`,
    r.description || '',
    `Map: https://www.google.com/maps?q=${r.lat},${r.lng}`,
    r.pending ? '' : `Report: ${reportLink(r.id)}`
  ].filter(Boolean).join('\n');
}

function openContact(spec){
  const [kind, key, id] = spec.split(':');
  const r = state.byId.get(id);
  if (!r) return;
  const msg = reportMessage(r);
  // The municipality's WhatsApp and e-mail are only for town reports; elsewhere the person picks who to send it to.
  const town = r.area !== 'rural' && r.area !== 'place';
  const wa = town ? `https://wa.me/${MUNICIPALITY_PHONE}?text=${encodeURIComponent(msg)}` : `https://wa.me/?text=${encodeURIComponent(msg)}`;
  const mail = town ? `mailto:${MUNICIPALITY_EMAIL}?subject=${encodeURIComponent('Parishkar Purulia — ' + t('cat_' + r.category) + ' — Ward ' + (r.ward ?? '?'))}&body=${encodeURIComponent(msg)}` : null;
  const tweet = (handle) => `https://twitter.com/intent/tweet?text=${encodeURIComponent((handle ? '@' + handle + ' ' : '') + msg.split('\n').slice(0, 4).join('\n') + '\n' + reportLink(r.id))}`;

  let title, sub, opts = [];
  if (kind === 'role'){
    title = t('role_' + key);
    sub = t('ct_note_roles');
    const police = ['ps', 'sdpo', 'sp'].includes(key);
    if (police) opts.push(['tel:112', '📞 ' + t('ct_call112')]);
    opts.push([wa, '💬 ' + t('ct_whatsapp')]); if (mail) opts.push([mail, '✉️ ' + t('ct_email')]);
  } else if (kind === 'councillor'){
    const w = state.wards[key] || {};
    title = w.councillor_name || t('acc_councillor');
    sub = t('acc_councillor') + ' · ' + t('acc_ward', { n: key }) + (w.party ? ' · ' + w.party : '');
    opts.push([wa, '💬 ' + t('ct_whatsapp')]); if (mail) opts.push([mail, '✉️ ' + t('ct_email')]);
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
  document.getElementById('k-ev-sub').textContent = t('ev_sub_' + m, { q: verifyNeeded(r), r: radius, dq: rules.dispute_quorum });
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
  const live = state.rules.require_live_capture;
  setEvStatus(document.getElementById('k-ev-photo-status'), 'bad',
    t(res.error === 'denied' ? (live ? 'cam_ev_denied' : 'cam_denied') : (live ? 'cam_ev_unavailable' : 'cam_unavailable')));
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
const camera = { stream: null, blob: null, resolve: null, posPromise: null, torch: false, zoom: 1, hwZoom: null };

function cameraSupported(){
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && window.isSecureContext !== false;
}

function showCameraState(s){
  document.getElementById('k-cam-video').hidden = s !== 'live';
  document.getElementById('k-cam-still').hidden = s !== 'still';
  document.getElementById('k-cam-check').hidden = true;
  document.getElementById('k-cam-shutter').hidden = s !== 'live';
  document.getElementById('k-cam-retake').hidden = s !== 'still';
  document.getElementById('k-cam-use').hidden = s !== 'still';
  document.getElementById('k-cam-tools').hidden = s !== 'live' || !camera.stream;
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
    setupCameraTools();
  } catch (e){
    closeCamera({ error: e && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? 'denied' : 'unavailable' });
  }
}

/* Flash and zoom. Hardware torch/zoom where the browser exposes them (mostly Chrome on
   Android); otherwise zoom is digital — the preview is scaled and the shot cropped to
   match, so what you see is what gets sent. iOS Safari has no torch control at all. */
const ZOOM_STEPS = [1, 2, 4];

function setupCameraTools(){
  const track = camera.stream?.getVideoTracks()[0];
  let caps = {};
  try { caps = track?.getCapabilities?.() || {}; } catch (e) {}
  camera.torch = false;
  camera.zoom = 1;
  camera.hwZoom = caps.zoom && caps.zoom.max > caps.zoom.min ? caps.zoom : null;
  const flash = document.getElementById('k-cam-flash');
  flash.hidden = !caps.torch;
  flash.setAttribute('aria-pressed', 'false');
  // Digital zoom past 2× throws away too many pixels to be useful evidence.
  const maxZoom = camera.hwZoom ? camera.hwZoom.max : 2;
  const steps = ZOOM_STEPS.filter(z => z <= maxZoom);
  const box = document.getElementById('k-cam-zoom');
  box.innerHTML = steps.map(z => `<button type="button" data-zoom="${z}" aria-pressed="${z === 1}">${z}×</button>`).join('');
  box.hidden = steps.length < 2;
  applyCameraZoom(1);
  document.getElementById('k-cam-tools').hidden = false;
}

async function toggleTorch(){
  const track = camera.stream?.getVideoTracks()[0];
  if (!track) return;
  const on = !camera.torch;
  try {
    await track.applyConstraints({ advanced: [{ torch: on }] });
    camera.torch = on;
  } catch (e) { showToast(t('cam_flash_fail')); }
  document.getElementById('k-cam-flash').setAttribute('aria-pressed', String(camera.torch));
}

async function applyCameraZoom(z){
  const track = camera.stream?.getVideoTracks()[0];
  const video = document.getElementById('k-cam-video');
  camera.zoom = z;
  if (camera.hwZoom && track){
    const v = Math.min(camera.hwZoom.max, Math.max(camera.hwZoom.min, z));
    try { await track.applyConstraints({ advanced: [{ zoom: v }] }); video.style.transform = ''; }
    catch (e) { camera.hwZoom = null; }
  }
  if (!camera.hwZoom) video.style.transform = z > 1 ? `scale(${z})` : '';
  document.querySelectorAll('#k-cam-zoom [data-zoom]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.zoom) === z)));
}

function stopCameraStream(){
  camera.torch = false;
  document.getElementById('k-cam-video').style.transform = '';
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
  // Anchor the GPS fix to this exact shutter press, not to whenever the reporter finishes
  // reviewing the still and taps "Use" — a retake gets its own fresh fix the same way.
  camera.posPromise = getPosition({ want: 30, timeout: 10000 }).catch(() => null);
  // Square, not the sensor's native 16:9/HD frame: crop to the shorter side, centred.
  // Digital zoom shrinks that same square further, to match the scaled preview.
  const dz = camera.hwZoom ? 1 : camera.zoom;
  const side = Math.min(video.videoWidth, video.videoHeight) / dz;
  const sw = side, sh = side;
  const sx = (video.videoWidth - sw) / 2, sy = (video.videoHeight - sh) / 2;
  const scale = Math.min(1, PHOTO_MAX_PX / Math.max(sw, sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  canvas.getContext('2d').drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  const problem = photoProblem(canvas);
  try {
    camera.blob = await new Promise((resolve, reject) =>
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', PHOTO_QUALITY));
  } catch (e){
    showToast(t('err_photo_read'));
    return;
  }
  const still = document.getElementById('k-cam-still');
  if (still.src) URL.revokeObjectURL(still.src);
  still.src = URL.createObjectURL(camera.blob);
  showCameraState('still');
  if (problem){
    const check = document.getElementById('k-cam-check');
    check.textContent = t(problem === 'dark' ? 'cam_too_dark' : 'cam_blurry');
    check.hidden = false;
  }
}

/* A warning only, never a block: 'dark' when the average brightness is very low,
   'blurry' when there's almost no edge detail (variance of a Laplacian on a small
   grey copy). Thresholds are deliberately loose so a plain wall or a night shot with
   some light doesn't trip them. */
function photoProblem(src){
  const N = 128;
  const c = document.createElement('canvas');
  c.width = N; c.height = N;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  let px;
  try { ctx.drawImage(src, 0, 0, N, N); px = ctx.getImageData(0, 0, N, N).data; }
  catch (e) { return null; }
  const g = new Float32Array(N * N);
  let sum = 0;
  for (let i = 0; i < N * N; i++){
    g[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
    sum += g[i];
  }
  if (sum / (N * N) < 40) return 'dark';
  let n = 0, m = 0, m2 = 0;
  for (let y = 1; y < N - 1; y++){
    for (let x = 1; x < N - 1; x++){
      const i = y * N + x;
      const l = g[i - 1] + g[i + 1] + g[i - N] + g[i + N] - 4 * g[i];
      n++; m += l; m2 += l * l;
    }
  }
  const variance = m2 / n - (m / n) * (m / n);
  return variance < 25 ? 'blurry' : null;
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
    const q = res.verify_needed || verifyNeeded(r), dq = res.dispute_needed || state.rules.dispute_quorum;
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
  return { category: null, photoBlob: null, photoMeta: null, extraPhotos: [], lat: null, lng: null, accuracy: null, ward: null, severity: 'minor', wasteType: null, landmark: '', description: '', locked: false };
}

function openReport(prefill){
  draft = newDraft();
  // "Report again" reuses the original problem's exact spot on purpose (the citizen may not
  // be standing there right now) — GPS must never overwrite that pin at photo-capture time.
  draft.locked = !!prefill;
  // Village reports need the block map; if it arrives after the location, place the pin again.
  if (!state.blockGeo || !state.gpGeo) Promise.all([loadBlockGeo(), loadLocalGeo()]).then(() => { if (draft?.lat != null) setLocation(draft.lat, draft.lng, draft.accuracy); });
  document.getElementById('k-ward-field').hidden = false;
  document.getElementById('k-place').hidden = true;
  document.getElementById('k-photo-preview').innerHTML = '';
  renderExtraPhotos();
  document.getElementById('k-photo-note').hidden = true;
  document.getElementById('k-landmark').value = '';
  document.getElementById('k-desc').value = '';
  stopVoice(); document.getElementById('k-voice-text').textContent = '';
  document.getElementById('k-ward').value = '';
  document.getElementById('k-coords').textContent = t('step3_no_loc');
  const gpsBtn = document.getElementById('k-gps-btn');
  gpsBtn.textContent = t('step3_gps');
  // Automatic GPS is the norm; the button/map only reappear if it fails (see useGPS()).
  gpsBtn.hidden = true;
  document.getElementById('k-mini-map').hidden = true;
  document.getElementById('k-iab-report').hidden = true;
  document.getElementById('k-iab-report-note').hidden = true;
  document.getElementById('k-iab-report-copy').hidden = true;
  setSeverity('minor');
  setWasteType(null);
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
  // One screen, camera first: open it right away so "Report" really does mean
  // "camera opens" with no extra tap. The button stays for a retake.
  captureReportPhoto();
}

function goToStep(n){
  document.querySelectorAll('#k-modal .k-modal-step').forEach(s => { s.hidden = s.dataset.step !== String(n); });
  document.querySelector('#k-modal .k-modal-sheet').scrollTop = 0;
  updateSubmitState();
}

function renderCategoryGrid(){
  // No-op once the create-report flow drops the category step; #k-cat-grid no longer
  // exists in the DOM. Left callable so init()/setLang() don't need special-casing.
  const grid = document.getElementById('k-cat-grid');
  if (!grid) return;
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

// Categories that need a one-line reminder (what to photograph, or why the report matters) beyond the review warning.
const CATEGORY_NOTES = { garbage: 'garbage_note', dumpsite: 'dumpsite_note', toilet: 'toilet_note' };
function selectCategory(key, advance = true){
  if (!CATEGORIES[key]) return;
  draft.category = key;
  const warn = document.getElementById('k-cat-warning');
  warn.hidden = !CATEGORIES[key].review && !CATEGORY_NOTES[key];
  warn.textContent = CATEGORIES[key].review ? t('illegal_note') : CATEGORY_NOTES[key] ? t(CATEGORY_NOTES[key]) : '';
  renderCategoryGrid();
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
  renderExtraPhotos();
  note.hidden = true;
  note.textContent = '';
  updateSubmitState();
  // GPS started fetching when the report modal opened, before the camera did — if the
  // photo is taken somewhere else (opened the app, walked to the actual spot, shot it),
  // that first fix is stale. Use the fix requested at the exact shutter click instead
  // (takeCameraShot), so the report lands where the photo was actually taken.
  // "Report again" pins deliberately reuse the original spot and must stay untouched.
  if (!draft.locked){
    const pos = camera.posPromise ? await camera.posPromise : null;
    if (!draft) return;
    if (pos) setLocation(pos.lat, pos.lng, pos.accuracy);
    else useGPS();
  }
}

/* Up to 2 more photos, from the same in-page camera. They're attached right after the
   report is created (kasa_add_report_photo), each checked like the first. */
const MAX_EXTRA_PHOTOS = 2;
async function captureExtraPhoto(){
  if (!draft?.photoBlob || draft.extraPhotos.length >= MAX_EXTRA_PHOTOS) return;
  const res = await openLiveCamera();
  if (!draft || !res.blob) return;
  draft.extraPhotos.push({ blob: res.blob, meta: { capture: 'live', capture_token: res.token || undefined }, url: URL.createObjectURL(res.blob) });
  renderExtraPhotos();
}

function renderExtraPhotos(){
  const box = document.getElementById('k-photo-extras');
  const extras = draft?.extraPhotos || [];
  box.innerHTML = extras.map((x, i) => `<span class="k-photo-extra"><img src="${x.url}" alt=""><button type="button" data-extra-remove="${i}" aria-label="${esc(t('photo_remove'))}">✕</button></span>`).join('');
  const more = document.getElementById('k-photo-more');
  more.hidden = !draft?.photoBlob || extras.length >= MAX_EXTRA_PHOTOS;
  more.textContent = t('photo_more', { n: extras.length + 2 });
}

function initMiniMap(){
  if (miniMap) return;
  if (!window.maplibregl){ mapLibrary().then(initMiniMap); return; }
  miniMap = new maplibregl.Map({
    container: 'k-mini-map', style: MAP_STYLE,
    center: draft.lng != null ? [draft.lng, draft.lat] : MAP_CENTER, zoom: draft.lng != null ? 16 : MAP_ZOOM, attributionControl: false
  });
  miniMap.on('click', e => setLocation(e.lngLat.lat, e.lngLat.lng, null));
  miniMap.on('load', () => boostRoadLabels(miniMap));
  watchMapStyleLoad(miniMap);
  if (draft.lng != null) placeMiniMarker();
}

function placeMiniMarker(){
  if (!miniMap) return;
  if (miniMarker) miniMarker.setLngLat([draft.lng, draft.lat]);
  else miniMarker = new maplibregl.Marker({ color: '#d4882a' }).setLngLat([draft.lng, draft.lat]).addTo(miniMap);
}

function setLocation(lat, lng, accuracy){
  draft.lat = lat; draft.lng = lng; draft.accuracy = accuracy;
  const place = draft.place = placeOf(lat, lng);
  const wardSel = document.getElementById('k-ward');
  if (place.kind === 'town'){ draft.ward = place.ward; wardSel.value = String(place.ward); }
  if (place.kind !== 'town' && place.kind !== 'unknown'){ draft.ward = null; wardSel.value = ''; }
  wardSel.options[0].textContent = place.kind === 'edge' ? t('step3_not_town') : '—';
  document.getElementById('k-ward-field').hidden = ['rural', 'outside', 'place'].includes(place.kind);
  const note = document.getElementById('k-place');
  note.hidden = !['rural', 'edge', 'outside', 'place'].includes(place.kind);
  note.className = 'k-field-note' + (place.kind === 'outside' ? ' k-field-bad' : '');
  note.textContent = place.kind === 'rural'
      ? (place.bodyType === 'municipality' ? t('step3_town', { t: place.body })
        : place.body && place.block ? t('step3_gp', { g: place.body, b: place.block }) : t('step3_block', { b: place.block }))
    : place.kind === 'place' ? (place.isDistrict ? t('pl_step3_wb', { d: place.name })
        : t('pl_step3', { place: place.name, n: place.ward, body: place.body }) + (place.provisional ? ' ' + t('pl_provisional') : ''))
    : place.kind === 'edge' ? t('step3_edge')
    : place.kind === 'outside' ? t('step3_outside') : '';
  if (place.kind === 'place' && place.isDistrict){
    const add = document.createElement('a');
    add.href = 'add-town.html?district=' + encodeURIComponent(place.name);
    add.textContent = ' ' + t('pl_add_town');
    note.append(add);
  }
  document.getElementById('k-coords').textContent =
    `${lat.toFixed(5)}, ${lng.toFixed(5)} · ${accuracy != null ? t('step3_loc_gps', { acc: Math.round(accuracy) }) : t('step3_loc_pin')}` +
    (['town', 'rural', 'outside', 'place'].includes(place.kind) || draft.ward ? '' : ' · ' + t('step3_pick_ward'));
  placeMiniMarker();
  if (miniMap) miniMap.easeTo({ center: [lng, lat], zoom: Math.max(miniMap.getZoom(), 16) });
  updateSubmitState();
}

/* Fast Wi-Fi/cached fix — usually under a second, even on Macs without GPS. */
/* Voice typing for the description, using the phone's own speech recognition
   (in the page's language). Hidden where the browser has none. */
const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
let voiceRec = null;
function stopVoice(){
  if (voiceRec){ try { voiceRec.stop(); } catch (e) {} }
}
function toggleVoice(){
  if (voiceRec) return stopVoice();
  const btn = document.getElementById('k-voice-btn'), out = document.getElementById('k-voice-text'), desc = document.getElementById('k-desc');
  const rec = new Speech();
  // No speech engine understands Santali yet; most Santali speakers here also speak Bengali.
  rec.lang = { bn: 'bn-IN', hi: 'hi-IN', sat: 'bn-IN' }[state.lang] || 'en-IN';
  rec.interimResults = true;
  rec.continuous = false;
  const before = desc.value.trim();
  rec.onresult = (e) => {
    const said = Array.from(e.results).map(r => r[0].transcript).join(' ').trim();
    desc.value = [before, said].filter(Boolean).join(' ').slice(0, 500);
    out.textContent = desc.value;
  };
  rec.onerror = (e) => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') showToast(t('voice_denied')); };
  rec.onend = () => { voiceRec = null; btn.textContent = t('voice_btn'); btn.setAttribute('aria-pressed', 'false'); };
  try { rec.start(); } catch (e) { return; }
  voiceRec = rec;
  btn.textContent = t('voice_stop');
  btn.setAttribute('aria-pressed', 'true');
}
function initVoice(){
  if (!Speech) return;
  document.getElementById('k-voice').hidden = false;
  document.getElementById('k-voice-btn').addEventListener('click', toggleVoice);
}

/* ══════════════════════════════════════════════════════════
   SCHOOL CHECK — one listed school (by UDISE code), six answers,
   a live photo and GPS. The server applies the same photo and
   location checks as reports, and holds checks that look wrong.
   ══════════════════════════════════════════════════════════ */
const SC_QUESTIONS = ['water', 'toilets', 'boundary', 'electricity', 'mdm'];
// Answered yes / no / can't tell: "can't tell" (school closed, no access) stays out of the score.
const SC_MAYBE = ['girls_toilet', 'meal_today'];
let sc = null;

async function openSchoolCheck(code){
  sc = { schools: [], school: null, ans: {}, cond: null, pos: null, blob: null, meta: null, problems: {} };
  setDrawer(false);
  document.getElementById('k-sc-qs').innerHTML = SC_QUESTIONS.map(k => `
    <div class="k-sc-row"><span>${esc(t('sc_q_' + k))}</span>
      <div class="k-seg k-seg-yn" role="radiogroup" data-scq="${k}">
        <button type="button" role="radio" aria-checked="false" data-v="yes">${esc(t('sc_yes'))}</button>
        <button type="button" role="radio" aria-checked="false" data-v="no">${esc(t('sc_no'))}</button>
      </div>
      <button type="button" class="k-sc-probcam" data-probcam="${k}" hidden>${esc(t('sc_prob_photo'))}</button></div>`).join('') + SC_MAYBE.map(k => `
    <div class="k-sc-row"><span>${esc(t('sc_q_' + k))}</span>
      <div class="k-seg k-seg-yn" role="radiogroup" data-scq="${k}">
        <button type="button" role="radio" aria-checked="false" data-v="yes">${esc(t('sc_yes'))}</button>
        <button type="button" role="radio" aria-checked="false" data-v="no">${esc(t('sc_no'))}</button>
        <button type="button" role="radio" aria-checked="false" data-v="unknown">${esc(t('sc_cant_tell'))}</button>
      </div>
      <button type="button" class="k-sc-probcam" data-probcam="${k}" hidden>${esc(t('sc_prob_photo'))}</button></div>`).join('') + `
    <div class="k-sc-row"><label for="k-sc-teachers">${esc(t('sc_q_teachers'))}</label>
      <input type="number" id="k-sc-teachers" class="k-input" inputmode="numeric" min="0" max="200" step="1" placeholder="${esc(t('sc_teachers_ph'))}"></div>
    <div class="k-sc-row"><span>${esc(t('sc_q_building'))}</span>
      <div class="k-seg k-seg-yn" role="radiogroup" data-scq="building">
        <button type="button" role="radio" aria-checked="false" data-v="good">${esc(t('sc_good'))}</button>
        <button type="button" role="radio" aria-checked="false" data-v="needs_repair">${esc(t('sc_repair'))}</button>
        <button type="button" role="radio" aria-checked="false" data-v="unsafe">${esc(t('sc_unsafe'))}</button>
      </div>
      <button type="button" class="k-sc-probcam" data-probcam="building" hidden>${esc(t('sc_prob_photo'))}</button></div>`;
  document.getElementById('k-sc-preview').innerHTML = '';
  document.getElementById('k-sc-photo-status').className = 'k-ev-status';
  document.getElementById('k-sc-photo-status').textContent = t('sc_photo_hint');
  document.getElementById('k-sc-picked').textContent = '';
  document.getElementById('k-sc-near').innerHTML = `<div class="k-ev-status">${esc(t('sc_near_wait'))}</div>`;
  const blockSel = document.getElementById('k-sc-block');
  const { data } = await sb.rpc('kasa_school_blocks');
  blockSel.innerHTML = `<option value="">${esc(t('sc_block_pick'))}</option>` +
    (data || []).map(b => `<option value="${esc(b.block)}">${esc(b.block)} (${b.schools})</option>`).join('');
  document.getElementById('k-sc-find').hidden = true;
  document.getElementById('k-sc-school').hidden = true;
  updateSchoolSubmit();
  openModal('k-sc-modal');
  checkSchoolLocation();
  if (code){
    const { data: s } = await sb.from('schools').select('udise_code,name,block_name,panchayat,village,lat,seen_lat').eq('udise_code', code).maybeSingle();
    if (s){ blockSel.value = s.block_name; await loadSchoolBlock(s.block_name); pickSchool(s.udise_code); }
  }
}

/* Like the UTS app's nearby stations: once GPS is in, fill in the block and list the
   schools around you — ones with a known location (official, or learned from earlier
   checks) by distance, plus schools in the villages OpenStreetMap names around you. */
const blockKey = b => String(b || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/II/g, '2').replace(/I/g, '1');
const placeKey = v => String(v || '').toLowerCase().replace(/[^a-z]/g, '');

async function loadNearbySchools(pos){
  sc.nearLoaded = true;
  const box = document.getElementById('k-sc-near');
  const [{ data: nb }, places] = await Promise.all([
    sb.rpc('kasa_nearby_schools', { p_lat: pos.lat, p_lng: pos.lng }),
    fetch(`https://photon.komoot.io/reverse?lat=${pos.lat}&lon=${pos.lng}&lang=en&limit=10&radius=3`)
      .then(r => r.ok ? r.json() : { features: [] }).catch(() => ({ features: [] }))
  ]);
  if (!sc) return;
  const blockSel = document.getElementById('k-sc-block');
  if (nb?.block && !blockSel.value){
    const opt = [...blockSel.options].find(o => o.value && blockKey(o.value) === blockKey(nb.block));
    if (opt){ blockSel.value = opt.value; await loadSchoolBlock(opt.value); }
  }
  if (!sc) return;
  const near = (nb?.near || []).map(s => ({ ...s, why: t(s.learned ? 'sc_near_seen' : 'sc_near_dist', { d: s.distance_m < 1000 ? s.distance_m + ' m' : (s.distance_m / 1000).toFixed(1) + ' km' }) }));
  const names = new Set();
  for (const f of places.features || []){
    for (const k of ['name', 'city', 'locality', 'district']) if (f.properties?.[k]) names.add(placeKey(f.properties[k]));
  }
  names.delete('');
  const seen = new Set(near.map(s => s.udise_code));
  const inVillage = sc.schools.filter(s => s.village && names.has(placeKey(s.village)) && !seen.has(s.udise_code))
    .map(s => ({ ...s, block_name: blockSel.value, inVillage: true, why: t('sc_near_village', { v: s.village }) }));
  const list = [...near, ...inVillage].slice(0, 10);
  box.innerHTML = list.length
    ? `<div class="k-ev-label">${esc(t('sc_near_title'))}</div><div class="k-sc-chips">${list.map(s =>
        `<button type="button" class="k-sc-chip" data-near="${esc(s.udise_code)}" data-near-block="${esc(s.block_name || '')}">
           <strong>${esc(s.name)}</strong><span>${esc(s.why)}${s.village && !s.inVillage ? ' · ' + esc(s.village) : ''}</span></button>`).join('')}</div>`
    : `<div class="k-ev-status">${esc(t('sc_near_none'))}</div>`;
}

async function pickNearby(code, block){
  const blockSel = document.getElementById('k-sc-block');
  if (block && blockKey(block) !== blockKey(blockSel.value)){
    const opt = [...blockSel.options].find(o => o.value && blockKey(o.value) === blockKey(block));
    if (opt){ blockSel.value = opt.value; await loadSchoolBlock(opt.value); }
  }
  pickSchool(code);
}

async function loadSchoolBlock(block){
  const sel = document.getElementById('k-sc-school'), find = document.getElementById('k-sc-find');
  sc.school = null;
  document.getElementById('k-sc-picked').textContent = '';
  if (!block){ sel.hidden = find.hidden = true; updateSchoolSubmit(); return; }
  const { data } = await sb.from('schools').select('udise_code,name,panchayat,village,lat,seen_lat').eq('block_name', block).order('name').limit(1000);
  sc.schools = data || [];
  find.value = '';
  sel.hidden = find.hidden = false;
  renderSchoolOptions();
  updateSchoolSubmit();
}

function renderSchoolOptions(){
  const q = document.getElementById('k-sc-find').value.trim().toLowerCase();
  const list = sc.schools.filter(s => !q || `${s.name} ${s.village || ''} ${s.panchayat || ''}`.toLowerCase().includes(q));
  document.getElementById('k-sc-school').innerHTML = list.slice(0, 300).map(s =>
    `<option value="${esc(s.udise_code)}">${esc(s.name)}${s.village ? ' — ' + esc(s.village) : ''}</option>`).join('');
}

function pickSchool(code){
  const s = sc.schools.find(x => x.udise_code === code);
  if (!s) return;
  sc.school = s;
  document.getElementById('k-sc-school').value = code;
  setEvStatus(document.getElementById('k-sc-picked'), 'ok',
    `✓ ${s.name} · ${[s.village, s.panchayat].filter(Boolean).join(', ')} · UDISE ${s.udise_code}` +
    (s.lat == null && s.seen_lat == null ? ' — ' + t('sc_will_place') : ''));
  updateSchoolSubmit();
}

async function checkSchoolLocation(){
  const status = document.getElementById('k-sc-loc-status'), btn = document.getElementById('k-sc-loc-btn');
  const want = state.rules.max_gps_accuracy_m;
  btn.disabled = true;
  status.className = 'k-ev-status';
  status.textContent = t('ev_loc_wait', { a: '…' });
  try {
    const pos = await getPosition({ want, timeout: 20000, onProgress: p => { status.textContent = t('ev_loc_wait', { a: Math.round(p.accuracy) }); } });
    if (!sc) return;
    if (pos.accuracy > want){ sc.pos = null; setEvStatus(status, 'bad', t('ev_loc_weak', { a: Math.round(pos.accuracy) })); }
    else { sc.pos = pos; setEvStatus(status, 'ok', t('sc_loc_ok', { a: Math.round(pos.accuracy) })); }
    if (!sc.nearLoaded) loadNearbySchools(pos);
  } catch (e){
    if (!sc) return;
    sc.pos = null;
    setEvStatus(status, 'bad', t(e && e.code === 1 ? 'ev_loc_denied' : 'ev_loc_fail'));
  }
  btn.disabled = false;
  updateSchoolSubmit();
}

async function captureSchoolPhoto(){
  if (!sc) return;
  const res = await openLiveCamera();
  if (!sc) return;
  const status = document.getElementById('k-sc-photo-status');
  if (res.blob){
    sc.blob = res.blob;
    sc.meta = { capture: 'live', capture_token: res.token || undefined };
    document.getElementById('k-sc-preview').innerHTML = `<img src="${URL.createObjectURL(res.blob)}" alt="">`;
    setEvStatus(status, 'ok', t('ev_photo_live'));
  } else if (res.error !== 'cancelled'){
    setEvStatus(status, 'bad', t(res.error === 'denied' ? 'cam_ev_denied' : 'cam_ev_unavailable'));
  }
  updateSchoolSubmit();
}

function updateSchoolSubmit(){
  if (!sc) return;
  const answered = SC_QUESTIONS.every(k => typeof sc.ans[k] === 'boolean') && SC_MAYBE.every(k => k in sc.ans) && !!sc.cond;
  document.getElementById('k-sc-submit').disabled = !(sc.school && answered && sc.pos && sc.blob);
}

/* A photo of one problem found at the school ("No" answers, a building needing repair)
   becomes its own report on the report map, routed to the school inspector like any
   school report. At most three, to stay inside the hourly report limit. */
const SC_PROB_MAX = 3;
const SC_PROB_TEXT = {
  water: 'no drinking water', toilets: 'toilets not usable', boundary: 'boundary wall broken or missing',
  electricity: 'no working electricity', mdm: 'no mid-day meal kitchen or utensils',
  girls_toilet: "girls' toilet not usable", meal_today: 'no mid-day meal cooked today',
  building: 'building needs repair'
};
function schoolProblemOpen(k){
  if (!sc) return false;
  if (k === 'building') return sc.cond === 'needs_repair' || sc.cond === 'unsafe';
  return sc.ans[k] === false;
}
function syncProblemButtons(){
  if (!sc) return;
  document.querySelectorAll('#k-sc-qs [data-probcam]').forEach(b => {
    const k = b.dataset.probcam, open = schoolProblemOpen(k);
    b.hidden = !open;
    if (!open) delete sc.problems[k];
    const p = sc.problems[k];
    b.classList.toggle('done', !!p);
    b.innerHTML = p ? `<img src="${p.url}" alt="">${esc(t('sc_prob_added'))}` : esc(t('sc_prob_photo'));
  });
}
async function captureProblemPhoto(k){
  if (!sc) return;
  if (!sc.problems[k] && Object.keys(sc.problems).length >= SC_PROB_MAX){ showToast(t('sc_prob_max', { n: SC_PROB_MAX })); return; }
  const res = await openLiveCamera();
  if (!sc) return;
  if (res.blob) sc.problems[k] = { blob: res.blob, url: URL.createObjectURL(res.blob), meta: { capture: 'live', capture_token: res.token || undefined } };
  else if (res.error !== 'cancelled') showToast(t(res.error === 'denied' ? 'cam_ev_denied' : 'cam_ev_unavailable'));
  syncProblemButtons();
}
async function sendSchoolProblems(c){
  let ok = 0, failed = 0;
  for (const [k, p] of Object.entries(c.problems)){
    if (!schoolProblemOpen(k)) continue;
    try {
      await api.createReport({
        category: 'school', severity: k === 'building' && c.cond === 'unsafe' ? 'critical' : 'severe',
        lat: c.pos.lat, lng: c.pos.lng, accuracy: c.pos.accuracy, ward: null,
        description: `${c.school.name} (UDISE ${c.school.udise_code}): ${k === 'building' && c.cond === 'unsafe' ? 'building unsafe' : SC_PROB_TEXT[k]}. Found during a school check.`.slice(0, 500),
        landmark: c.school.name.slice(0, 120), photoBlob: p.blob, photoMeta: p.meta, extraPhotos: [],
        clientId: 'R' + Date.now() + randomName(6), boundary_type: detectBoundary(c.pos.lat, c.pos.lng)
      });
      ok++;
    } catch (e){ failed++; console.warn('Parishkar: school problem report not filed', e); }
  }
  return { ok, failed };
}

// Optional: blank means the resident did not count, not zero teachers.
function schoolTeachersSeen(){
  const v = document.getElementById('k-sc-teachers')?.value.trim();
  const n = v === '' || v == null ? null : Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 && n <= 200 ? n : null;
}

async function submitSchoolCheck(){
  if (!sc) return;
  const btn = document.getElementById('k-sc-submit');
  btn.disabled = true;
  btn.textContent = t('ev_sending');
  try {
    await ensureSession();
    const path = await uploadPhoto('reports', sc.blob);
    await sendPhotoMeta(path, sc.meta);
    await checkPhoto(path, null, sc.pos.lat, sc.pos.lng);
    const { data, error } = await sb.rpc('kasa_school_check', {
      p_udise_code: sc.school.udise_code, p_lat: sc.pos.lat, p_lng: sc.pos.lng, p_accuracy: sc.pos.accuracy,
      p_water_ok: sc.ans.water, p_toilets_ok: sc.ans.toilets, p_boundary_ok: sc.ans.boundary,
      p_electricity_ok: sc.ans.electricity, p_mdm_ok: sc.ans.mdm, p_building_condition: sc.cond,
      p_photo_path: path, p_client_id: randomName(16),
      p_girls_toilet_ok: sc.ans.girls_toilet, p_meal_today_ok: sc.ans.meal_today, p_teachers_seen: schoolTeachersSeen()
    });
    if (error) throw rpcError(error);
    const sent = await sendSchoolProblems(sc);
    closeModal('k-sc-modal');
    showToast(t(data.moderation_status === 'approved' ? 'sc_done' : 'sc_done_review') +
      (sent.ok ? ' ' + t('sc_probs_sent', { n: sent.ok }) : '') + (sent.failed ? ' ' + t('photo_extra_failed', { n: sent.failed }) : ''), 9000);
    sc = null;
    if (sent.ok) loadReports();
  } catch (e){
    showToast(errorText(e), 7000);
  }
  btn.textContent = t('sc_submit');
  updateSchoolSubmit();
}

/* A school's report card: a screenshot from Know Your School (or a photo of the card the
   school displays) plus the figures read off it. A moderator compares the two before the
   figures become the school's official record on the schools page. */
const RC_NUMS = ['enrolment', 'teachers', 'classrooms'];
const RC_FACTS = ['drinking_water', 'girls_toilet', 'boys_toilet', 'electricity', 'boundary_wall', 'handwash', 'library', 'playground', 'ramp'];
let rc = null;
async function openReportCard(code){
  const { data: s } = await sb.from('schools').select('udise_code,name,block_name,village').eq('udise_code', code).maybeSingle();
  if (!s){ showToast(t('err_KASA_NOT_FOUND')); return; }
  rc = { school: s, blob: null, facts: {} };
  setDrawer(false);
  document.getElementById('k-rc-school').textContent = `${s.name} · ${[s.village, s.block_name].filter(Boolean).join(', ')} · UDISE ${s.udise_code}`;
  document.getElementById('k-rc-how').innerHTML = esc(t('rc_how', { code: '\u0000' })).replace('\u0000', `<code>${esc(s.udise_code)}</code>`);
  document.getElementById('k-rc-nums').innerHTML = RC_NUMS.map(k =>
    `<label><span>${esc(t('rc_' + k))}</span><input type="number" class="k-input" inputmode="numeric" min="0" max="5000" step="1" data-rcnum="${k}"></label>`).join('');
  document.getElementById('k-rc-facts').innerHTML = RC_FACTS.map(k => `
    <div class="k-sc-row"><span>${esc(t('rc_' + k))}</span>
      <div class="k-seg k-seg-yn" role="radiogroup" data-rcfact="${k}">
        <button type="button" role="radio" aria-checked="false" data-v="yes">${esc(t('sc_yes'))}</button>
        <button type="button" role="radio" aria-checked="false" data-v="no">${esc(t('sc_no'))}</button>
        <button type="button" role="radio" aria-checked="false" data-v="skip">${esc(t('rc_not_shown'))}</button>
      </div></div>`).join('');
  document.getElementById('k-rc-preview').innerHTML = '';
  document.getElementById('k-rc-file').value = '';
  updateReportCardSubmit();
  openModal('k-rc-modal');
}
function reportCardFigures(){
  const f = {};
  document.querySelectorAll('#k-rc-nums [data-rcnum]').forEach(i => {
    const v = i.value.trim();
    if (/^\d{1,4}$/.test(v)) f[i.dataset.rcnum] = Number(v);
  });
  for (const [k, v] of Object.entries(rc?.facts || {})) if (typeof v === 'boolean') f[k] = v;
  return f;
}
function updateReportCardSubmit(){
  document.getElementById('k-rc-submit').disabled = !(rc && rc.blob && Object.keys(reportCardFigures()).length);
}
async function pickReportCardPicture(file){
  if (!rc || !file) return;
  try {
    rc.blob = await compressImage(file);
    document.getElementById('k-rc-preview').innerHTML = `<img src="${URL.createObjectURL(rc.blob)}" alt="">`;
  } catch (e){ rc.blob = null; showToast(t('err_photo_read')); }
  updateReportCardSubmit();
}
async function submitReportCard(){
  if (!rc) return;
  const btn = document.getElementById('k-rc-submit');
  btn.disabled = true;
  btn.textContent = t('ev_sending');
  try {
    await ensureSession();
    const path = await uploadPhoto('reports', rc.blob);
    await checkPhoto(path, null, null, null);
    const { error } = await sb.rpc('kasa_submit_report_card', {
      p_udise_code: rc.school.udise_code, p_year: document.getElementById('k-rc-year').value,
      p_figures: reportCardFigures(), p_photo_path: path
    });
    if (error) throw rpcError(error);
    closeModal('k-rc-modal');
    showToast(t('rc_done'), 8000);
    rc = null;
  } catch (e){
    showToast(errorText(e), 7000);
  }
  btn.textContent = t('rc_submit');
  updateReportCardSubmit();
}

/* A school missing from the list: a live photo of its gate or name board, taken there,
   plus its name and block. A moderator finds its UDISE code before it joins the list. */
let ns = null;
async function openMissingSchool(){
  const block = sc && document.getElementById('k-sc-block').value;
  if (sc) closeModal('k-sc-modal');
  sc = null;
  ns = { pos: null, blob: null, meta: null };
  setDrawer(false);
  const sel = document.getElementById('k-ns-block');
  const { data } = await sb.rpc('kasa_school_blocks');
  sel.innerHTML = `<option value="">${esc(t('sc_block_pick'))}</option>` +
    (data || []).map(b => `<option value="${esc(b.block)}">${esc(b.block)}</option>`).join('');
  if (block) sel.value = block;
  for (const id of ['k-ns-name', 'k-ns-village', 'k-ns-udise']) document.getElementById(id).value = '';
  document.getElementById('k-ns-preview').innerHTML = '';
  const ps = document.getElementById('k-ns-photo-status');
  ps.className = 'k-ev-status';
  ps.textContent = t('ns_photo_hint');
  updateMissingSchoolSubmit();
  openModal('k-ns-modal');
  const status = document.getElementById('k-ns-loc'), want = state.rules.max_gps_accuracy_m;
  status.className = 'k-ev-status';
  status.textContent = t('ev_loc_wait', { a: '…' });
  try {
    const pos = await getPosition({ want, timeout: 25000, onProgress: p => { status.textContent = t('ev_loc_wait', { a: Math.round(p.accuracy) }); } });
    if (!ns) return;
    if (pos.accuracy > want) setEvStatus(status, 'bad', t('ev_loc_weak', { a: Math.round(pos.accuracy) }));
    else { ns.pos = pos; setEvStatus(status, 'ok', t('sc_loc_ok', { a: Math.round(pos.accuracy) })); }
  } catch (e){
    if (ns) setEvStatus(status, 'bad', t(e && e.code === 1 ? 'ev_loc_denied' : 'ev_loc_fail'));
  }
  updateMissingSchoolSubmit();
}

async function captureMissingSchoolPhoto(){
  if (!ns) return;
  const res = await openLiveCamera();
  if (!ns) return;
  const status = document.getElementById('k-ns-photo-status');
  if (res.blob){
    ns.blob = res.blob;
    ns.meta = { capture: 'live', capture_token: res.token || undefined };
    document.getElementById('k-ns-preview').innerHTML = `<img src="${URL.createObjectURL(res.blob)}" alt="">`;
    setEvStatus(status, 'ok', t('ev_photo_live'));
  } else if (res.error !== 'cancelled'){
    setEvStatus(status, 'bad', t(res.error === 'denied' ? 'cam_ev_denied' : 'cam_ev_unavailable'));
  }
  updateMissingSchoolSubmit();
}

function updateMissingSchoolSubmit(){
  if (!ns) return;
  const udise = document.getElementById('k-ns-udise').value.trim();
  document.getElementById('k-ns-submit').disabled = !(ns.blob && ns.pos
    && document.getElementById('k-ns-name').value.trim().length >= 3
    && document.getElementById('k-ns-block').value && (!udise || /^\d{11}$/.test(udise)));
}

async function submitMissingSchool(){
  if (!ns) return;
  const btn = document.getElementById('k-ns-submit');
  btn.disabled = true;
  btn.textContent = t('ev_sending');
  try {
    await ensureSession();
    const path = await uploadPhoto('reports', ns.blob);
    await sendPhotoMeta(path, ns.meta);
    await checkPhoto(path, null, ns.pos.lat, ns.pos.lng);
    const { error } = await sb.rpc('kasa_suggest_school', {
      p_name: document.getElementById('k-ns-name').value, p_block: document.getElementById('k-ns-block').value,
      p_village: document.getElementById('k-ns-village').value, p_lat: ns.pos.lat, p_lng: ns.pos.lng,
      p_accuracy: ns.pos.accuracy, p_photo_path: path, p_udise_hint: document.getElementById('k-ns-udise').value.trim() || null });
    if (error) throw rpcError(error);
    closeModal('k-ns-modal');
    showToast(t('ns_done'), 8000);
    ns = null;
  } catch (e){
    showToast(errorText(e), 7000);
  }
  btn.textContent = t('ns_submit');
  updateMissingSchoolSubmit();
}

/* "The school is here": someone standing at a school puts it on the map, or corrects its pin. */
let sf = null;
async function openSchoolFix(code){
  const { data: s } = await sb.from('schools').select('udise_code,name,block_name,village').eq('udise_code', code).maybeSingle();
  if (!s) return;
  if (sf?.map) sf.map.remove();
  document.getElementById('k-sf-mapwrap').hidden = true;
  sf = { school: s, pos: null, map: null };
  document.getElementById('k-sf-sub').textContent = `${s.name} · ${[s.village, s.block_name].filter(Boolean).join(', ')} · UDISE ${s.udise_code}`;
  document.getElementById('k-sf-submit').disabled = true;
  openModal('k-sf-modal');
  const status = document.getElementById('k-sf-loc'), want = state.rules.max_gps_accuracy_m;
  status.className = 'k-ev-status';
  status.textContent = t('ev_loc_wait', { a: '…' });
  try {
    const pos = await getPosition({ want, timeout: 25000, onProgress: p => { status.textContent = t('ev_loc_wait', { a: Math.round(p.accuracy) }); } });
    if (!sf) return;
    if (pos.accuracy > want) return setEvStatus(status, 'bad', t('ev_loc_weak', { a: Math.round(pos.accuracy) }));
    sf.pos = pos;
    setEvStatus(status, 'ok', t('sc_loc_ok', { a: Math.round(pos.accuracy) }));
    document.getElementById('k-sf-submit').disabled = false;
    // Like food-delivery apps: a pin fixed in the middle; move the map until it sits on the gate.
    const wrap = document.getElementById('k-sf-mapwrap');
    wrap.hidden = false;
    if (window.maplibregl){
      if (sf.map) sf.map.remove();
      sf.map = new maplibregl.Map({ container: 'k-sf-map', style: MAP_STYLE, center: [pos.lng, pos.lat], zoom: 18, attributionControl: false });
      sf.map.on('load', () => boostRoadLabels(sf.map));
      watchMapStyleLoad(sf.map);
    }
  } catch (e){
    if (sf) setEvStatus(status, 'bad', t(e && e.code === 1 ? 'ev_loc_denied' : 'ev_loc_fail'));
  }
}

async function submitSchoolFix(){
  if (!sf?.pos) return;
  const btn = document.getElementById('k-sf-submit');
  btn.disabled = true;
  try {
    await ensureSession();
    const c = sf.map ? sf.map.getCenter() : { lat: sf.pos.lat, lng: sf.pos.lng };
    const { error } = await sb.rpc('kasa_mark_school_location', {
      p_udise_code: sf.school.udise_code, p_lat: c.lat, p_lng: c.lng, p_accuracy: sf.pos.accuracy,
      p_gps_lat: sf.pos.lat, p_gps_lng: sf.pos.lng });
    if (error) throw rpcError(error);
    closeModal('k-sf-modal');
    showToast(t('sf_done'), 6000);
    sf = null;
  } catch (e){
    showToast(errorText(e), 7000);
    btn.disabled = false;
  }
}

/* "We look after this spot": a shop, school or club standing at a spot adopts the 50 m around it.
   A shop and a club (one of each role) can share a spot: the second one joins the first. */
let ad = null;
async function openAdopt(){
  ad = { pos: null };
  const btn = document.getElementById('k-ad-submit'), status = document.getElementById('k-ad-loc'), want = state.rules.max_gps_accuracy_m;
  btn.disabled = true;
  openModal('k-ad-modal');
  status.className = 'k-ev-status';
  status.textContent = t('ev_loc_wait', { a: '…' });
  try {
    const pos = await getPosition({ want, timeout: 25000, onProgress: p => { status.textContent = t('ev_loc_wait', { a: Math.round(p.accuracy) }); } });
    if (!ad) return;
    if (pos.accuracy > want) return setEvStatus(status, 'bad', t('ev_loc_weak', { a: Math.round(pos.accuracy) }));
    ad.pos = pos;
    setEvStatus(status, 'ok', t('sc_loc_ok', { a: Math.round(pos.accuracy) }));
    btn.disabled = false;
  } catch (e){
    if (ad) setEvStatus(status, 'bad', t(e && e.code === 1 ? 'ev_loc_denied' : 'ev_loc_fail'));
  }
}

async function submitAdopt(){
  if (!ad?.pos) return;
  const btn = document.getElementById('k-ad-submit');
  btn.disabled = true;
  try {
    await ensureSession();
    const { data, error } = await sb.rpc('kasa_adopt_spot', {
      p_name: document.getElementById('k-ad-name').value, p_lat: ad.pos.lat, p_lng: ad.pos.lng, p_accuracy: ad.pos.accuracy,
      p_role: document.getElementById('k-ad-role').value });
    if (error) throw rpcError(error);
    closeModal('k-ad-modal');
    showToast(data?.joined ? t('ad_joined', { name: data.with }) : t('ad_done'), 7000);
    ad = null;
  } catch (e){
    showToast(errorText(e), 7000);
    btn.disabled = false;
  }
}

function initSchoolCheck(){
  document.querySelectorAll('[data-school-check]').forEach(b => b.addEventListener('click', () => openSchoolCheck()));
  document.getElementById('k-sc-block').addEventListener('change', e => loadSchoolBlock(e.target.value));
  document.getElementById('k-sc-find').addEventListener('input', renderSchoolOptions);
  document.getElementById('k-sc-near').addEventListener('click', e => {
    const b = e.target.closest('[data-near]');
    if (b && sc) pickNearby(b.dataset.near, b.dataset.nearBlock);
  });
  document.getElementById('k-sc-school').addEventListener('change', e => pickSchool(e.target.value));
  document.getElementById('k-sc-loc-btn').addEventListener('click', checkSchoolLocation);
  document.getElementById('k-sc-cam-btn').addEventListener('click', captureSchoolPhoto);
  document.getElementById('k-sc-submit').addEventListener('click', submitSchoolCheck);
  document.getElementById('k-sf-submit').addEventListener('click', submitSchoolFix);
  document.getElementById('k-sc-missing').addEventListener('click', openMissingSchool);
  document.getElementById('k-ns-cam-btn').addEventListener('click', captureMissingSchoolPhoto);
  document.getElementById('k-ns-submit').addEventListener('click', submitMissingSchool);
  for (const id of ['k-ns-name', 'k-ns-block', 'k-ns-udise']) document.getElementById(id).addEventListener('input', updateMissingSchoolSubmit);
  document.getElementById('k-ns-block').addEventListener('change', updateMissingSchoolSubmit);
  document.getElementById('k-ad-submit').addEventListener('click', submitAdopt);
  document.querySelectorAll('[data-adopt]').forEach(b => b.addEventListener('click', () => openAdopt()));
  document.getElementById('k-rc-file-btn').addEventListener('click', () => document.getElementById('k-rc-file').click());
  document.getElementById('k-rc-file').addEventListener('change', e => pickReportCardPicture(e.target.files[0]));
  document.getElementById('k-rc-nums').addEventListener('input', updateReportCardSubmit);
  document.getElementById('k-rc-submit').addEventListener('click', submitReportCard);
  document.getElementById('k-rc-facts').addEventListener('click', e => {
    const b = e.target.closest('[data-v]'), g = b?.closest('[data-rcfact]');
    if (!b || !g || !rc) return;
    g.querySelectorAll('button').forEach(x => x.setAttribute('aria-checked', String(x === b)));
    rc.facts[g.dataset.rcfact] = b.dataset.v === 'skip' ? null : b.dataset.v === 'yes';
    updateReportCardSubmit();
  });
  document.getElementById('k-sc-qs').addEventListener('click', e => {
    const pc = e.target.closest('[data-probcam]');
    if (pc){ captureProblemPhoto(pc.dataset.probcam); return; }
    const b = e.target.closest('[data-v]'), g = b?.closest('[data-scq]');
    if (!b || !g || !sc) return;
    g.querySelectorAll('button').forEach(x => x.setAttribute('aria-checked', String(x === b)));
    if (g.dataset.scq === 'building') sc.cond = b.dataset.v;
    else sc.ans[g.dataset.scq] = b.dataset.v === 'unknown' ? null : b.dataset.v === 'yes';
    syncProblemButtons();
    updateSchoolSubmit();
  });
  const q = new URLSearchParams(location.search), code = q.get('school');
  const fix = q.get('fix'), card = q.get('card');
  if (q.get('adopt') === '1') openAdopt();
  else if (q.get('add') === 'school') openMissingSchool();
  else if (card && /^\d{11}$/.test(card)) openReportCard(card);
  else if (fix && /^\d{11}$/.test(fix)) openSchoolFix(fix);
  else if (code && /^\d{11}$/.test(code)) openSchoolCheck(code);
  else if (q.get('check') === 'school') openSchoolCheck();
}

/* Instagram, Facebook and similar apps open links in their own browser, where location
   usually doesn't work. On Android the page is handed to Chrome once, automatically; everywhere
   a small bar offers one tap to the real browser. Pinning on the map works in any case. */
const UA = navigator.userAgent;
const IN_APP = /Instagram|FBAN|FBAV|FB_IAB|FBIOS|Barcelona|Snapchat|musical_ly|Bytedance|LinkedInApp|Line\//i.test(UA);
const IS_ANDROID = /Android/i.test(UA), IS_IOS = /iPhone|iPad|iPod/i.test(UA);

function browserUrl(){
  const u = location.href.split('#')[0];
  if (IS_ANDROID) return 'intent://' + u.replace(/^https?:\/\//, '') + '#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=' + encodeURIComponent(u) + ';end';
  // Instagram's own "open in external browser" link is the exit it doesn't block; other apps
  // get x-safari-https (iOS 17+). Both need a real tap, so they only sit behind buttons.
  if (IS_IOS) return /Instagram/i.test(UA) ? 'instagram://extbrowser/?url=' + encodeURIComponent(u) : 'x-safari-' + u;
  return null;
}

function setupInAppBrowser(){
  if (!IN_APP) return;
  const url = browserUrl();
  if (IS_ANDROID && url){
    let tried = true;
    try { tried = sessionStorage.getItem('kasa_iab_tried') === '1'; sessionStorage.setItem('kasa_iab_tried', '1'); } catch (e) {}
    if (!tried){ location.href = url; }
  }
  const bar = document.getElementById('k-iab');
  bar.querySelector('#k-iab-hint').hidden = !IS_IOS;
  const open = bar.querySelector('#k-iab-open');
  if (url){ open.href = url; document.getElementById('k-iab-report').href = url; } else open.hidden = true;
  bar.querySelector('#k-iab-close').addEventListener('click', () => { bar.hidden = true; });
  document.querySelectorAll('[data-iab-copy]').forEach(b => b.addEventListener('click', copyPageLink));
  bar.hidden = false;
}

/* The one exit every in-app browser allows: paste the link into Safari or Chrome. */
async function copyPageLink(){
  const u = location.href.split('#')[0];
  let ok = false;
  try { await navigator.clipboard.writeText(u); ok = true; } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = u; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { ok = document.execCommand('copy'); } catch (e2) {}
    ta.remove();
  }
  showToast(ok ? t('iab_copied') : u, 6000);
}

function showPinMap(){
  document.getElementById('k-gps-btn').hidden = false;
  document.getElementById('k-mini-map').hidden = false;
  initMiniMap();
  setTimeout(() => miniMap && miniMap.resize(), 60);
}

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
    // Automatic GPS failed — reveal the manual fallback (hidden by default in the quick-report flow).
    // Inside Instagram and similar apps a live GPS fix is the only proof of place we get, so
    // send people to their real browser instead of offering a hand-placed pin.
    if (IN_APP){
      btn.hidden = false;
      document.getElementById('k-iab-report').hidden = !browserUrl();
      document.getElementById('k-iab-report-note').hidden = false;
      document.getElementById('k-iab-report-copy').hidden = false;
      return;
    }
    showPinMap();
    showToast(t(err?.code === 1 ? 'loc_denied_pin' : 'loc_fail_pin'));
  }
}

function setSeverity(sev){
  if (draft) draft.severity = sev;
  document.querySelectorAll('#k-severity button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.sev === sev)));
}

/* Optional: picking a waste type marks the report as garbage (the server does the same).
   Tapping the chosen one again clears it, for problems that aren't garbage. */
function setWasteType(type){
  if (draft) draft.wasteType = type;
  document.querySelectorAll('#k-waste button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.waste === type)));
}

/* No category to pick any more — the server assigns it. A ward is needed only inside the
   town's ward map (auto-detected from GPS); villages go by block, which the server works out. */
function draftReady(){
  if (!draft?.photoBlob || draft?.lat == null) return false;
  const kind = draft.place?.kind || 'unknown';
  if (kind === 'outside') return false;
  return kind !== 'town' || !!draft.ward;
}

function updateSubmitState(){
  const btn = document.getElementById('k-submit');
  const coords = document.getElementById('k-coords');
  const hasGoodGPS = draft?.lat != null;
  const canSubmit = draftReady();

  if (btn) {
    btn.disabled = !canSubmit;
    // Show GPS status in submit button
    if (draft?.place?.kind === 'outside') {
      btn.title = t('step3_outside');
    } else if (draft?.place?.kind === 'town' && !draft?.ward) {
      btn.title = 'Finding your ward…';
    } else if (!draft?.photoBlob) {
      btn.title = 'Take a photo';
    } else if (draft.lat == null) {
      btn.title = 'Getting your location…';
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
  if (!hasGoodGPS || !draftReady()){ updateSubmitState(); return; }
  const kind = draft.place?.kind;
  draft.area = kind === 'place' ? 'place' : kind === 'rural' || (kind === 'edge' && !draft.ward) ? 'rural' : 'town';
  draft.block = draft.place?.block || null;
  draft.otherPlace = kind === 'place' ? draft.place.place : null;
  draft.placeWard = kind === 'place' ? draft.place.ward : null;
  draft.boundary_type = detectBoundary(draft.lat, draft.lng);
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
    console.warn('Parishkar: submit failed, saving offline', e);
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
  // One tap to hear back: watch the report (or the one it joined) for the "Fixed" message.
  const watchBtn = document.getElementById('k-done-watch');
  const canWatch = !!id && res.moderation !== 'review' && watchSupported() && !watchedReports().has(id);
  watchBtn.hidden = !canWatch;
  watchBtn.disabled = false;
  watchBtn.textContent = t('done_watch');
  watchBtn.onclick = async () => {
    await toggleWatch(id, watchBtn);
    if (watchedReports().has(id)){ watchBtn.textContent = t('done_watch_on'); watchBtn.disabled = true; }
  };
  const shareBtn = document.getElementById('k-done-share');
  shareBtn.hidden = !id || res.moderation === 'review';
  shareBtn.dataset.id = id || '';
  // d.category is null for a quick report (never chosen by the user); the server
  // stores it as 'other', so match that here for the share text and WhatsApp message.
  const fake = { ...d, id: id || d.clientId, createdAt: new Date().toISOString(), ward: d.ward,
    place: d.otherPlace || null, placeWard: d.placeWard || null,
    category: d.category || 'other', pending: !id };
  document.getElementById('k-wa-escalate').href = d.area === 'rural' || d.area === 'place'
    ? `https://wa.me/?text=${encodeURIComponent(reportMessage(fake))}`
    : `https://wa.me/${MUNICIPALITY_PHONE}?text=${encodeURIComponent(reportMessage(fake))}`;
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
  try { await window.idbKeyval.set('pending_reports_v2', list); } catch (e) { console.error('Parishkar: could not save offline', e); }
}

async function removePendingReport(clientId){
  const list = await getPendingReports();
  try { await window.idbKeyval.set('pending_reports_v2', list.filter(p => p.clientId !== clientId)); } catch (e) {}
}

function pendingToRow(p){
  return {
    id: p.clientId, created_at: p.createdAt, lat: p.lat, lng: p.lng, ward_no: p.ward, category: p.category,
    severity: p.severity, status: 'open', description: p.description, landmark: p.landmark,
    photo_url: p.photoBlob ? URL.createObjectURL(p.photoBlob) : null, _pending: true,
    area_kind: p.otherPlace ? 'place' : undefined, place: p.otherPlace || null, place_ward: p.placeWard || null
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
      console.warn('Parishkar: sync failed for', p.clientId, e);
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
   STATIC SECTIONS — chains, representatives
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

/* Everyone elected for the district, from city.js: MPs, MLAs, municipal chairpersons and the
   Zilla Parishad. Each gets a key for data-profile and, where Parishkar can tell, a test for
   which reports fall in their area. */
const initialsOf = name => String(name || '').split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 3).toUpperCase();
function allReps(){
  const seats = CITY.constituencies || [], splits = CITY.splitBlocks || {}, src = CITY.repSources || {};
  const low = s => (s || '').toLowerCase();
  const rep = (key, group, p, extra) => {
    const base = (typeof p === 'string' ? REPS[p] : p) || {};
    return { key, group, ...base, initials: base.initials || initialsOf(base.name), ...extra };
  };
  const out = [];
  Object.entries(CITY.lokSabha || {}).forEach(([ls, v]) => {
    const split = Object.entries(splits).filter(([, s]) => s.lokSabha === ls).map(([b]) => low(b));
    out.push(rep('mp:' + ls, 'mp', v.mp, { place: t('rep_place_ls', { s: ls }), seats: seats.filter(c => c.lokSabha === ls), mplads: v.mplads, source: src.mp,
      covers: r => { const c = seatFor(r); return c ? c.lokSabha === ls : r.area === 'rural' && split.includes(low(r.block)); } }));
  });
  seats.forEach(c => out.push(rep('mla:' + c.no, 'mla', c.mla, { place: t('rep_place_ac', { s: c.name, n: c.no }), seat: c, source: src.mla, town: !!c.town,
    covers: r => seatFor(r) === c })));
  (CITY.municipalities || []).forEach(m => out.push(rep('chair:' + m.name, 'chair', m.chair, { place: t('rep_place_muni', { s: m.name }), muni: m, town: !!m.town,
    source: m.source && { url: m.source, name: m.sourceName },
    covers: m.town ? (r => r.area !== 'rural' && !!r.ward) : (r => otherTown(r) && low(r.body) === low(`${m.name} Municipality`)) })));
  const zp = CITY.zillaParishad;
  if (zp) out.push(rep('zp', 'zp', zp, { place: t('rep_place_zp'), source: zp.source && { url: zp.source, name: zp.sourceName }, covers: r => r.area === 'rural' && !otherTown(r) }));
  // Purulia town's own MLA first among the MLAs; everything else keeps city.js order.
  return out.filter(r => r.name).sort((a, b) => (a.group === b.group && a.group === 'mla') ? (b.town - a.town) : 0);
}

function renderReps(){
  const reps = allReps();
  document.getElementById('k-auth-grid').innerHTML = ['mp', 'mla', 'chair', 'zp'].map(g => {
    const list = reps.filter(r => r.group === g);
    if (!list.length) return '';
    return `<div class="k-auth-group">${esc(t('rep_g_' + g))}</div>` + list.map(rep => `
      <div class="k-auth-card${rep.photo ? '' : ' k-auth-card-sm'}">
        ${repAvatar(rep, 'k-rep-avatar k-auth-avatar')}
        <div>
          <div class="k-auth-label">${esc(t('rep_t_' + g))} · ${esc(rep.place)}</div>
          <div class="k-auth-name">${esc(rep.name)}</div>
          ${rep.party || rep.meta ? `<div class="k-auth-meta">${esc([rep.party, rep.meta && t(rep.meta)].filter(Boolean).join(' · '))}</div>` : ''}
          ${rep.photo && rep.photoCredit ? `<div class="k-auth-credit">${esc(t('rep_photo_credit', { credit: rep.photoCredit }))}</div>` : ''}
        </div>
        <button type="button" class="k-auth-action" data-profile="${esc(rep.key)}">${esc(t('auth_view'))}</button>
      </div>`).join('');
  }).join('');
}

// Promises, demands and news from promises.html / noticeboard.html, loaded once when a sheet opens.
let repUpdates = null;
function loadRepUpdates(){
  if (!repUpdates && sb){
    repUpdates = Promise.all([sb.rpc('kasa_promises'), sb.rpc('kasa_demands')]).then(([p, d]) => {
      if (p.error && d.error) throw p.error;
      return { promises: p.data?.promises || [], news: p.data?.news || [], demands: d.data || [] };
    });
    repUpdates.catch(() => { repUpdates = null; });
  }
  return repUpdates || Promise.reject(new Error('offline'));
}

function renderRepUpdates(rep, u){
  const el = document.getElementById('k-rep-updates');
  if (!el || el.dataset.key !== rep.key) return;
  const norm = s => String(s || '').trim().toLowerCase();
  const me = norm(rep.name);
  const date = d => d ? new Date(d).toLocaleDateString(state.lang === 'en' ? 'en-IN' : state.lang + '-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const promises = u.promises.filter(p => norm(p.who) === me);
  const demands = u.demands.filter(d => norm(d.leader_name) === me);
  const news = u.news.filter(n => norm(n.who) === me || norm(n.title).includes(me)).slice(0, 3);
  const leaderHref = `noticeboard.html?leader=${encodeURIComponent(rep.name)}`;
  const promisesHref = `promises.html?who=${encodeURIComponent(rep.name)}`;
  const answered = demands.filter(d => d.promise || (d.replies || []).length).length;
  el.innerHTML = `
    <div class="k-rep-upd">
      <div class="k-rep-upd-h"><a href="${esc(promisesHref)}">${esc(t('rep_promises'))} →</a>
        <small>${esc(promises.length ? t('rep_promises_n', { n: promises.length, d: promises.filter(p => p.status === 'delivered').length }) : t('rep_promises_none'))}</small></div>
      ${promises.slice(0, 2).map(p => `<a class="k-rep-upd-item" href="promises.html?who=${encodeURIComponent(rep.name)}#p-${esc(p.id)}">
        <span class="k-rep-upd-tag k-rep-st-${esc(p.status)}">${esc(t('rep_st_' + p.status))}</span>${esc(p.promise)}<small>${esc(date(p.made_on))}</small></a>`).join('')}
    </div>
    <div class="k-rep-upd">
      <div class="k-rep-upd-h"><a href="${esc(leaderHref)}">${esc(t('rep_demands'))} →</a>
        <small>${esc(demands.length ? t('rep_demands_n', { n: demands.length, a: answered }) : t('rep_demands_none'))}</small></div>
      ${demands.slice(0, 2).map(d => `<a class="k-rep-upd-item" href="${esc(leaderHref)}#d-${esc(d.id)}">${esc(d.title)}<small>${esc(t('rep_supports', { n: d.supports || 0 }))}</small></a>`).join('')}
    </div>
    ${news.length ? `<div class="k-rep-upd"><div class="k-rep-upd-h">${esc(t('rep_news'))}</div>
      ${news.map(n => `<a class="k-rep-upd-item" href="${esc(safeUrl(n.url) || '#')}" target="_blank" rel="noopener nofollow">${esc(n.title)}<small>${esc([n.source, date(n.published_at)].filter(Boolean).join(' · '))} ↗</small></a>`).join('')}</div>` : ''}`;
}

function openRepProfile(key){
  const reps = allReps();
  const rep = reps.find(r => r.key === key) || reps.find(r => r.key === { mla: 'mla:' + (CITY.constituencies || []).find(c => c.town)?.no, mp: 'mp:' + CITY.name, chairman: 'chair:' + CITY.name }[key]);
  if (!rep) return;
  const all = rep.covers ? primaries().filter(rep.covers) : [];
  const open = all.filter(r => r.status !== 'resolved');
  const verified = all.filter(r => r.status === 'resolved' && r.resolution !== 'legacy_unverified');
  // Unresolved reports by place: wards in town, blocks in the villages. Each links to its own page.
  const byPlace = new Map();
  open.forEach(r => {
    const p = otherTown(r) ? { k: 'm:' + r.body, href: `ward.html?block=${encodeURIComponent(r.block || '')}`, label: r.body }
      : r.area === 'rural' ? (r.block && { k: 'b:' + r.block, href: `ward.html?block=${encodeURIComponent(r.block)}`, label: t('acc_block', { b: r.block }) })
      : (r.ward && { k: 'w:' + r.ward, href: `ward.html?ward=${r.ward}`, label: `${t('acc_ward', { n: r.ward })} · ${state.wards[r.ward]?.councillor_name || '—'}` });
    if (!p) return;
    if (!byPlace.has(p.k)) byPlace.set(p.k, { ...p, n: 0 });
    byPlace.get(p.k).n++;
  });
  const worst = [...byPlace.values()].sort((a, b) => b.n - a.n).slice(0, 5);
  const inr = n => '₹' + (n >= 1e7 ? (n / 1e7).toFixed(2) + ' ' + t('rep_crore') : (n / 1e5).toFixed(1) + ' ' + t('rep_lakh'));
  const m = rep.mplads;
  const areaLine = rep.seats ? `<div class="k-rep-worst-title">${esc(t('rep_seats'))}</div><div class="k-rep-seats">${rep.seats.map(c =>
      `<button type="button" class="k-rep-seat" data-profile="mla:${c.no}">${esc(c.name)} · ${esc(c.mla?.name || '—')}</button>`).join('')}</div>`
    : rep.seat ? `<p class="k-rep-area">${esc(t('rep_covers', { b: [rep.seat.town && t('rep_town'), ...(rep.seat.blocks || [])].filter(Boolean).join(', ') }))}
        ${rep.seat.lokSabha ? `<button type="button" class="k-rep-seat" data-profile="mp:${esc(rep.seat.lokSabha)}">${esc(t('rep_in_ls', { s: rep.seat.lokSabha }))}</button>` : ''}</p>` : '';
  const links = [
    [`noticeboard.html?leader=${encodeURIComponent(rep.name)}`, t('rep_l_leader')],
    rep.group !== 'chair' && rep.group !== 'zp' && ['analytics.html', t('rep_l_board')],
    rep.muni?.town && ['municipality.html', t('rep_l_money')],
    rep.muni?.block && [`ward.html?block=${encodeURIComponent(rep.muni.block)}`, t('acc_block', { b: rep.muni.block })]
  ].filter(Boolean);
  document.getElementById('k-rep-content').innerHTML = `
    <div class="k-rep-header">
      ${repAvatar(rep, 'k-rep-avatar')}
      <div><div class="k-rep-name">${esc(rep.name)}</div><div class="k-rep-role">${esc([t('rep_t_' + rep.group) + ' · ' + rep.place, rep.party].filter(Boolean).join(' · '))}</div></div>
    </div>
    ${areaLine}
    ${rep.covers ? `
    <div class="k-rep-stats">
      <div class="k-rep-stat"><div class="k-rep-stat-n">${open.length}</div><div class="k-rep-stat-l">${esc(t('rep_open'))}</div></div>
      <div class="k-rep-stat"><div class="k-rep-stat-n">${verified.length}</div><div class="k-rep-stat-l">${esc(t('rep_resolved'))}</div></div>
      <div class="k-rep-stat"><div class="k-rep-stat-n">${byPlace.size}</div><div class="k-rep-stat-l">${esc(t('rep_places'))}</div></div>
    </div>
    <div class="k-rep-worst-title">${esc(t('rep_worst_places'))}</div>
    ${worst.length ? worst.map(p => `<a class="k-rep-worst-item" href="${esc(p.href)}"><span>${esc(p.label)}</span><span class="k-rep-worst-count">${p.n}</span></a>`).join('')
      : `<div class="k-rep-worst-item">${esc(t('rep_none'))}</div>`}`
    : ''}
    ${m ? `<div class="k-rep-worst-title">${esc(t('rep_mplads'))}</div>
    <div class="k-rep-stats">
      <div class="k-rep-stat"><div class="k-rep-stat-n">${esc(inr(m.allocated))}</div><div class="k-rep-stat-l">${esc(t('rep_mp_alloc'))}</div></div>
      <div class="k-rep-stat"><div class="k-rep-stat-n">${esc(inr(m.spent))}</div><div class="k-rep-stat-l">${esc(t('rep_mp_spent'))}</div></div>
      <div class="k-rep-stat"><div class="k-rep-stat-n">${m.worksCompleted}/${m.worksRecommended}</div><div class="k-rep-stat-l">${esc(t('rep_mp_works'))}</div></div>
    </div>
    <p class="k-rep-src">${esc(t('rep_mp_note', { r: inr(m.recommended), d: new Date(m.asOf).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) }))}
      <a href="${esc(safeUrl(m.url) || '#')}" target="_blank" rel="noopener nofollow">Empowered Indian ↗</a></p>` : ''}
    <div class="k-rep-worst-title">${esc(t('rep_updates'))}</div>
    <div id="k-rep-updates" data-key="${esc(rep.key)}"><div class="k-rep-worst-item">${esc(t('rep_loading'))}</div></div>
    <div class="k-rep-links">${links.map(([h, l]) => `<a href="${esc(h)}">${esc(l)} →</a>`).join('')}</div>
    ${rep.source?.url ? `<p class="k-rep-src">${esc(t('rep_source'))} <a href="${esc(safeUrl(rep.source.url) || '#')}" target="_blank" rel="noopener nofollow">${esc(rep.source.name || rep.source.url)} ↗</a></p>` : ''}`;
  openModal('k-rep-modal');
  document.querySelector('#k-rep-modal .k-modal-sheet')?.scrollTo?.(0, 0);
  loadRepUpdates().then(u => renderRepUpdates(rep, u), () => {
    const el = document.getElementById('k-rep-updates');
    if (el && el.dataset.key === rep.key) el.innerHTML = `<div class="k-rep-worst-item">${esc(t('rep_updates_failed'))}
      <a href="noticeboard.html?leader=${encodeURIComponent(rep.name)}">${esc(t('rep_l_leader'))} →</a></div>`;
  });
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
  // kasa.html?report=new&category=dumpsite — open the camera with the kind already chosen.
  if (id === 'new'){
    openReport();
    if (CATEGORIES[q.get('category')]) selectCategory(q.get('category'), false);
    return;
  }
  if (id && state.byId.has(id)) return openSheet(id);
  const at = (q.get('at') || '').split(',').map(Number);
  if (at.length === 2 && at.every(Number.isFinite)){
    mapReady.then(() => mainMap.flyTo({ center: [at[1], at[0]], zoom: 17, duration: 1200 }));
    return;
  }
  const ward = Number(q.get('ward'));
  // kasa.html?place=kolkata&ward=46 — that town's ward, as shared from its ward card.
  const place = window.KasaPlaces?.fromUrl();
  if (place?.wardsGeojson || place?.wardsMapped){
    if (Number.isInteger(ward) && ward >= 1 && ward <= (place.wardsTotal || 500)){
      state.filters.ward = state.selectedWard = ward;
      state.filters.place = state.selectedPlace = place.slug;
      renderAll(); renderWardCard();
    }
    return;
  }
  if (Number.isInteger(ward) && ward >= 1 && ward <= 23){
    state.filters.ward = ward;
    state.selectedWard = ward;
    document.getElementById('k-search-ward').value = ward;
    renderAll();
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
  renderNotify();
}

/* Alerts sheet: one place for nearby alerts, watched reports and the email digest.
   iPhones only get web push from the home-screen app, so say that instead of hiding it. */
function renderNotify(){
  const watching = watchedReports().size;
  const on = alertsOn() || (watching > 0 && watchSupported());
  document.querySelectorAll('.k-bell').forEach(b => b.classList.toggle('on', on));
  document.querySelectorAll('.k-bell-dot').forEach(d => { d.hidden = !on; });
  const ios = isIOS() && !isStandalone() && !('PushManager' in window);
  const ios_el = document.getElementById('k-nt-ios');
  if (!ios_el) return;
  ios_el.hidden = !ios;
  document.getElementById('k-nt-nopush').hidden = ios || alertsSupported() || watchSupported();
  const c = document.getElementById('k-nt-count');
  c.hidden = !watching;
  c.textContent = t('notify_watching', { n: watching });
}

function openNotify(){
  renderAlertsButtons();
  openModal('k-nt-modal');
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

/* "Watch this report": push alerts about status changes on ONE report — claimed,
   confirmed, disputed, resolved. No location grant needed (unlike nearby alerts):
   watching a report you're already looking at needs no area, so it shares the
   same VAPID/service-worker plumbing as toggleAlerts() but skips getPosition(). */
function watchSupported(){
  return !!VAPID_PUBLIC_KEY && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}
function watchedReports(){
  try { return new Set(JSON.parse(localStorage.getItem('kasa_watched_reports') || '[]')); } catch (e) { return new Set(); }
}
function saveWatched(set){
  try { localStorage.setItem('kasa_watched_reports', JSON.stringify([...set])); } catch (e) {}
}

async function toggleWatch(id, btn){
  if (!watchSupported()) return;
  btn.disabled = true;
  try {
    const reg = await navigator.serviceWorker.register('sw.js');
    await navigator.serviceWorker.ready;
    const watched = watchedReports();
    if (watched.has(id)){
      const sub = await reg.pushManager.getSubscription();
      if (sub){
        await ensureSession();
        await sb.rpc('kasa_unwatch_report', { p_report_id: id, p_endpoint: sub.endpoint });
      }
      watched.delete(id);
      saveWatched(watched);
      showToast(t('watch_off'));
    } else {
      if (await Notification.requestPermission() !== 'granted') throw new KasaError('alerts_denied');
      await ensureSession();
      const sub = (await reg.pushManager.getSubscription()) ||
        await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8(VAPID_PUBLIC_KEY) });
      const j = sub.toJSON();
      const { error } = await sb.rpc('kasa_watch_report', {
        p_report_id: id, p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_lang: state.lang
      });
      if (error) throw rpcError(error);
      watched.add(id);
      saveWatched(watched);
      showToast(t('watch_on'), 5000);
    }
  } catch (e){
    showToast(errorText(e), 6000);
  }
  btn.disabled = false;
  renderWatchButton();
  renderNotify();
}

function renderWatchButton(){
  const r = state.byId.get(state.sheetId);
  const btn = document.querySelector('[data-watch]');
  if (!btn || !r) return;
  btn.hidden = !watchSupported() || r.pending || r.status === 'resolved';
  const on = watchedReports().has(r.id);
  btn.textContent = t(on ? 'watch_off_btn' : 'watch_btn');
  btn.classList.toggle('on', on);
}

/* "Your reports": a private history for the device's own anonymous session, reusing
   normalize() and the public detail sheet — includes reports the public feed hides
   (under review, hidden by a moderator) since the owner should still see their own. */
let myReportsList = [];
async function loadMyReports(){
  const box = document.getElementById('k-mine-list');
  box.innerHTML = `<div class="k-lb-empty">${esc(t('mine_loading'))}</div>`;
  try {
    await ensureSession();
    const { data, error } = await sb.rpc('kasa_my_reports');
    if (error) throw rpcError(error);
    myReportsList = (data || []).map(normalize);
    renderMyReports(myReportsList);
  } catch (e){
    box.innerHTML = `<div class="k-lb-empty">${esc(errorText(e))}</div>`;
  }
}

function renderMyReports(list){
  const box = document.getElementById('k-mine-list');
  if (!list.length){ box.innerHTML = `<div class="k-lb-empty">${esc(t('mine_empty'))}</div>`; return; }
  box.innerHTML = list.map(r => {
    const c = CATEGORIES[r.category];
    return `
    <button type="button" class="k-list-item" data-mine-open="${esc(r.id)}">
      ${r.photo ? `<img src="${esc(r.photo)}" alt="" loading="lazy" width="64" height="64">` : `<span class="k-list-noimg">${c.icon}</span>`}
      <span class="k-list-main">
        <span class="k-list-title">${c.icon} ${esc(t('cat_' + r.category))}</span>
        <span class="k-list-where">${esc(placeText(r))}</span>
        <span class="k-list-meta">${statusChip(r)} <span>${esc(ago(r.createdAt))}</span></span>
      </span>
    </button>`;
  }).join('');
}

function openMine(){
  openModal('k-mine-modal');
  loadMyReports();
}

function openMineReport(id){
  const r = myReportsList.find(x => x.id === id);
  if (!r) return;
  if (!state.byId.has(id)) state.byId.set(id, r);
  closeModal('k-mine-modal');
  openSheet(id);
}

/* Caches the app shell so repeat visits open instantly (see sw.js). */
function registerServiceWorker(){
  if (!('serviceWorker' in navigator) || location.protocol !== 'https:') return;
  const go = () => navigator.serviceWorker.register('sw.js').catch(e => console.info('Parishkar: service worker not registered', e));
  setTimeout(() => (window.requestIdleCallback || setTimeout)(go), 3000);
}

/* ══════════════════════════════════════════════════════════
   UI WIRING
   ══════════════════════════════════════════════════════════ */
function wireUI(){
  // Jumping to a collapsed landing section (e.g. "How verification works ↓") should open it, not just scroll to its closed heading.
  document.addEventListener('click', e => {
    const a = e.target.closest('a[href^="#"]');
    const target = a && document.getElementById(a.getAttribute('href').slice(1));
    if (target && target.tagName === 'DETAILS') target.open = true;
  });
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action],[data-close],[data-open],[data-seen],[data-rate],[data-alerts],[data-watch],[data-mine],[data-mine-open],[data-flag],[data-share],[data-evidence],[data-again],[data-contact],[data-copy-link],[data-copy-msg],[data-cat],[data-goto],[data-lang],[data-view],[data-ward-select],[data-ward-filter],[data-ward-share],[data-ward-close],[data-area-close],[data-area-level],[data-area-zoom],[data-area-share],[data-profile],[data-chain],[data-sev],[data-waste],[data-csv],[data-install],[data-rti],[data-notify]');
    if (!el) return;
    const d = el.dataset;
    if (d.action === 'report') return openReport();
    if ('close' in d){ const m = el.closest('.k-modal'); if (m) closeModal(m.id); return; }
    if (d.open) return openSheet(d.open);
    if (d.seen) return handleSeen(d.seen, el);
    if (d.rate) return handleRate(d.rate, el);
    if (d.alerts) return toggleAlerts(el);
    if (d.watch) return toggleWatch(d.watch, el);
    if ('mine' in d) return openMine();
    if (d.mineOpen) return openMineReport(d.mineOpen);
    if (d.flag) return openFlag(d.flag);
    if (d.share) return shareReport(d.share);
    if (d.rti) return openRTI(d.rti);
    if (d.evidence) return openEvidence(d.evidence);
    if (d.again){ const r = state.byId.get(d.again); closeModal('k-sheet'); return openReport({ category: r.category, lat: r.lat, lng: r.lng, landmark: r.landmark }); }
    if (d.contact) return openContact(d.contact);
    if (d.copyMsg){ const r = state.byId.get(d.copyMsg); return r && copyText(reportMessage(r), 'esc_copied_msg'); }
    if (d.copyLink) return copyText(reportLink(d.copyLink));
    if (d.cat) return selectCategory(d.cat);
    if (d.goto) return goToStep(Number(d.goto));
    if (d.lang) return setLang(d.lang);
    if (d.view) return setView(d.view);
    if (d.wardSelect){
      selectWard(Number(d.wardSelect));
      setDrawer(false);
      return;
    }
    if (d.wardFilter){
      const n = Number(d.wardFilter), place = d.wardPlace || null;
      const on = state.filters.ward === n && (state.filters.place || null) === place;
      state.filters.ward = on ? null : n;
      state.filters.place = on ? null : place;
      document.getElementById('k-search-ward').value = place ? '' : state.filters.ward || '';
      return renderAll();
    }
    if (d.wardShare) return shareWard(Number(d.wardShare), d.wardPlace || null);
    if ('areaClose' in d) return closeArea();
    if (d.areaLevel){ state.area.level = d.areaLevel; renderAreaCard(); return; }
    if ('areaZoom' in d) return zoomToArea();
    if ('areaShare' in d) return shareArea();
    if ('wardClose' in d){ state.selectedWard = state.selectedPlace = null; renderWardCard(); return updateMap(); }
    if (d.csv) return downloadCSV(d.csv);
    if ('install' in d) return installApp();
    if ('notify' in d){ setDrawer(false); return openNotify(); }
    if (d.profile) return openRepProfile(d.profile);
    if (d.chain){ state.chainTab = d.chain; return renderChainSection(); }
    if (d.sev){ setSeverity(d.sev); return; }
    if (d.waste){ setWasteType(draft?.wasteType === d.waste ? null : d.waste); return; }
  });

  const daylight = document.getElementById('k-daylight');
  daylight.setAttribute('aria-pressed', String(daylightMap));
  daylight.addEventListener('click', () => {
    try { localStorage.setItem('kasa_daylight', daylightMap ? '0' : '1'); } catch (e) {}
    location.reload();
  });
  document.getElementById('k-fixed-chip').addEventListener('click', () => setFixedStrip(document.getElementById('k-fixed-strip').hidden));
  document.getElementById('k-fixed-strip-close').addEventListener('click', () => setFixedStrip(false));
  document.getElementById('k-fixed-strip').addEventListener('click', e => { if (e.target.closest('[data-open]')) setFixedStrip(false); });
  document.getElementById('k-more-btn').addEventListener('click', () => setDrawer(true));
  initVoice();
  initSchoolCheck();
  document.getElementById('k-drawer-close').addEventListener('click', () => setDrawer(false));
  document.getElementById('k-fab-menu').addEventListener('click', () => setDrawer(true));
  document.getElementById('k-drawer-backdrop').addEventListener('click', () => setDrawer(false));
  const drawerToggle = document.getElementById('k-drawer-toggle-more');
  if (drawerToggle) {
    const moreList = document.querySelector('.k-drawer-more-list');
    drawerToggle.addEventListener('click', () => {
      const isExpanded = moreList.hasAttribute('hidden');
      if (isExpanded) moreList.removeAttribute('hidden');
      else moreList.setAttribute('hidden', '');
      drawerToggle.setAttribute('aria-expanded', String(isExpanded));
    });
  }
  document.getElementById('k-theme-toggle').addEventListener('click', toggleTheme);
  document.getElementById('k-social-toggle').addEventListener('click', e => {
    e.stopPropagation();
    const btn = e.currentTarget;
    const open = btn.getAttribute('aria-expanded') !== 'true';
    btn.setAttribute('aria-expanded', String(open));
    document.getElementById('k-social-dropdown').hidden = !open;
  });
  document.addEventListener('click', e => {
    if (e.target.closest('.k-social-menu')) return;
    document.getElementById('k-social-toggle').setAttribute('aria-expanded', 'false');
    document.getElementById('k-social-dropdown').hidden = true;
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    document.getElementById('k-social-toggle').setAttribute('aria-expanded', 'false');
    document.getElementById('k-social-dropdown').hidden = true;
  });
  document.getElementById('k-filter-toggle').addEventListener('click', e => {
    const bar = document.querySelector('.k-map-topbar');
    const open = bar.classList.toggle('k-filters-open');
    e.currentTarget.setAttribute('aria-expanded', String(open));
  });
  document.getElementById('k-nearby-btn').addEventListener('click', () => {
    if (state.nearbyOnly) {
      state.nearbyOnly = false;
      document.getElementById('k-nearby-btn').setAttribute('aria-pressed', 'false');
      showToast(t('nearby_off'));
      return renderAll();
    }
    if (!navigator.geolocation) return showToast(t('nearby_permission'));
    navigator.geolocation.getCurrentPosition(pos => {
      state.userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      state.nearbyOnly = true;
      document.getElementById('k-nearby-btn').setAttribute('aria-pressed', 'true');
      showToast(t('nearby_on'));
      renderAll();
    }, () => showToast(t('nearby_permission')), { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 });
  });
  // "Report" and "Your reports" inside the drawer open their own dialogs; drop the drawer behind them.
  document.getElementById('k-drawer').addEventListener('click', e => {
    if (e.target.closest('[data-action="report"],[data-mine],[data-adopt],[data-school-check],[data-view]')) setDrawer(false);
  });

  document.getElementById('k-filter-category').addEventListener('change', e => { state.filters.category = e.target.value; renderAll(); });
  document.getElementById('k-filter-status').addEventListener('change', e => { state.filters.status = e.target.value; renderAll(); });
  document.getElementById('k-filter-severity').addEventListener('change', e => { state.filters.severity = e.target.value; renderAll(); });
  document.getElementById('k-search-ward').addEventListener('input', e => {
    const n = parseInt(e.target.value, 10);
    state.filters.ward = n >= 1 && n <= 23 ? n : null;
    state.filters.place = null;
    renderAll();
  });
  document.getElementById('k-sort').addEventListener('change', e => { state.sort = e.target.value; renderList(); });

  document.getElementById('k-photo-btn').addEventListener('click', captureReportPhoto);
  document.getElementById('k-photo-more').addEventListener('click', captureExtraPhoto);
  document.getElementById('k-photo-extras').addEventListener('click', e => {
    const b = e.target.closest('[data-extra-remove]');
    if (!b || !draft) return;
    const [x] = draft.extraPhotos.splice(Number(b.dataset.extraRemove), 1);
    if (x) URL.revokeObjectURL(x.url);
    renderExtraPhotos();
  });
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
  document.getElementById('k-cam-flash').addEventListener('click', toggleTorch);
  document.getElementById('k-cam-zoom').addEventListener('click', e => {
    const b = e.target.closest('[data-zoom]');
    if (b) applyCameraZoom(Number(b.dataset.zoom));
  });
  document.getElementById('k-ev-submit').addEventListener('click', submitEvidence);
  document.getElementById('k-flag-submit').addEventListener('click', submitFlag);
  document.getElementById('k-list-search').addEventListener('input', e => { state.listQuery = e.target.value.trim(); renderList(); });
  document.getElementById('k-lb-search').addEventListener('input', e => { state.lbQuery = e.target.value.trim(); renderLeaderboard(); });

  // Tap a report photo to see it full screen; a gallery photo also gets prev/next.
  document.addEventListener('click', e => {
    const img = e.target.closest('.k-gallery-slide img, .k-ba img, .k-tl-photo img, .k-ev-proof img');
    if (!img) return;
    e.preventDefault();
    const track = img.closest('.k-gallery-track');
    if (track){
      const imgs = [...track.querySelectorAll('img')];
      openLightbox(imgs.map(im => im.currentSrc || im.src), imgs.indexOf(img), img.alt);
    } else {
      openLightbox([img.currentSrc || img.src], 0, img.alt);
    }
  });

  document.addEventListener('keydown', e => {
    const box = document.getElementById('k-lightbox');
    if (box && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return stepLightbox(box, e.key === 'ArrowRight' ? 1 : -1);
    if (e.key !== 'Escape') return;
    if (box) return closeLightbox();
    if (!document.getElementById('k-cam').hidden) return closeCamera({ error: 'cancelled' });
    const open = [...document.querySelectorAll('.k-modal.open')].pop();
    if (open) return closeModal(open.id);
    if (document.getElementById('k-drawer').classList.contains('open')) setDrawer(false);
  });
}

// Centre the map on the visitor, only if they already allowed location (no prompt on page load).
/* On the first visit the phone asks for location straight away (once per device), so the
   map opens where the person stands. After that it only uses location already allowed.
   The position stays on the phone; nothing is sent until they file a report. */
async function locateOnOpen(){
  try {
    if (!navigator.geolocation) return;
    const st = navigator.permissions?.query ? (await navigator.permissions.query({ name: 'geolocation' })).state : 'prompt';
    if (st === 'denied') return startTips();
    if (st === 'prompt'){
      let asked = false;
      try { asked = localStorage.getItem('kasa_loc_asked') === '1'; localStorage.setItem('kasa_loc_asked', '1'); } catch (e) {}
      if (asked) return startTips();
    }
    showToast(t('locating_you'));
    navigator.geolocation.getCurrentPosition(p => {
      const { latitude: lat, longitude: lng } = p.coords;
      const b = state.rules.bbox;
      const other = window.KasaPlaces?.inWB(lat, lng);
      if (!other && b && (lat < b.min_lat || lat > b.max_lat || lng < b.min_lng || lng > b.max_lng)){ showToast(t('loc_outside')); return startTips(); }
      askStillThere(lat, lng, p.coords.accuracy);
      startTips();
      if (userMovedMap) return; // they're already panning/zooming — don't fly the map out from under them
      mainMap.flyTo({ center: [lng, lat], zoom: Math.max(mainMap.getZoom(), 15), duration: 1200 });
      // Where they are becomes their home place for next time (once the page has been renamed after it).
      mainMap.once('moveend', () => setTimeout(() => {
        if (window.KasaPlaces && KasaPlaces.current !== 'bengal') KasaPlaces.remember(KasaPlaces.current);
      }, 300));
    }, () => startTips(), { enableHighAccuracy: false, maximumAge: 300000, timeout: 8000 });
  } catch (e) { startTips(); }
}

/* A plain visit opens on the place this device last chose or was found in, else all of West Bengal
   ("Parishkar Bengal"); the location question then moves it to where they are. */
async function openOnHomePlace(){
  if (!window.KasaPlaces || userMovedMap) return;
  const b = await KasaPlaces.boxOf(KasaPlaces.saved() || 'bengal') || await KasaPlaces.boxOf('bengal');
  if (userMovedMap) return;
  mainMap.fitBounds([[b.min_lng, b.min_lat], [b.max_lng, b.max_lat]], { padding: 20, duration: 0 });
}

/* "Parishkar Bankura ▾": pick any place to look at. Reporting still needs the live photo and real GPS. */
function initPlacePicker(){
  const btn = document.getElementById('k-place-pick'), dlg = document.getElementById('k-place-dialog');
  if (!btn || !dlg || !window.KasaPlaces) { if (btn) btn.hidden = true; return; }
  const pick = async key => {
    dlg.close();
    const b = await KasaPlaces.boxOf(key);
    if (!b || !mainMap) return;
    userMovedMap = true;
    KasaPlaces.remember(key);
    mainMap.fitBounds([[b.min_lng, b.min_lat], [b.max_lng, b.max_lat]], { padding: 20, duration: 800 });
  };
  btn.addEventListener('click', () => {
    const cur = KasaPlaces.current || 'purulia';
    const towns = KasaPlaces.list.filter(p => p.bbox).map(p => [p.slug, p.name]);
    const districts = Object.entries(KasaPlaces.districts).filter(([k]) => k !== 'purulia').map(([k, v]) => ['district:' + k, t('pl_district', { d: v })]);
    const items = [['bengal', t('pk_state'), 'k-place-wide'], ['purulia', 'Purulia'], ...towns,
      ...districts.sort((a, b) => a[1].localeCompare(b[1]))];
    document.getElementById('k-place-list').innerHTML = items.map(([k, name, cls]) =>
      `<button type="button" data-place="${esc(k)}" class="${cls || ''}" aria-current="${k === cur}">${esc(name)}</button>`).join('');
    dlg.showModal();
  });
  dlg.addEventListener('click', e => {
    if (e.target === dlg || e.target.closest('[data-close]')) return dlg.close();
    const b = e.target.closest('[data-place]');
    if (b) pick(b.dataset.place);
  });
}

/* First-visit tips: a few small bubbles that point at a feature and say what it does.
   Shown once per device, after the location question, and never while a form is open. */
const TIPS = [
  { key: 'tip_lang_menu', target: () => visible('#k-more-btn'), when: () => state.lang === 'en' },
  { key: 'tip_report', target: () => visible('.k-map-report-btn') },
];
function visible(sel){ const el = document.querySelector(sel); return el && el.offsetParent !== null ? el : null; }
function startTips(){
  if (startTips.started) return;
  startTips.started = true;
  try { if (localStorage.getItem('kasa_tips_done') === '1') return; } catch (e) { return; }
  const list = TIPS.filter(x => (!x.when || x.when()) && x.target());
  const box = document.getElementById('k-tip'), next = document.getElementById('k-tip-next');
  let i = 0;
  const finish = () => { box.hidden = true; try { localStorage.setItem('kasa_tips_done', '1'); } catch (e) {} };
  const show = () => {
    if (i >= list.length) return finish();
    const el = list[i].target();
    if (!el || document.querySelector('.k-modal.open')) return finish();
    const k = list[i].key;
    document.getElementById('k-tip-text').textContent = t(typeof k === 'function' ? k() : k);
    next.textContent = t(i === list.length - 1 ? 'tip_done' : 'tip_next');
    box.hidden = false;
    const r = el.getBoundingClientRect(), w = box.offsetWidth, h = box.offsetHeight;
    const below = r.top < window.innerHeight / 2;
    box.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px';
    box.style.top = (below ? r.bottom + 10 : r.top - h - 10) + 'px';
    box.dataset.dir = below ? 'down' : 'up';
  };
  next.onclick = () => { i++; show(); };
  document.getElementById('k-tip-skip').onclick = finish;
  setTimeout(show, 600);
}

/* The count is Purulia's; elsewhere the line names the town or district in view. */
function renderJoin(){
  const el = document.getElementById('k-join-text');
  if (!el) return;
  const p = window.KasaPlaces?.current && KasaPlaces.bySlug(KasaPlaces.current);
  const n = state.peopleCount;
  el.textContent = p ? t('join_first_place', { place: p.name }) : n >= 20 ? t('join_n', { n }) : t('join_first');
}

/* "Join N people keeping Purulia clean" — a small, closable line on the map. */
async function showJoin(){
  try { if (localStorage.getItem('kasa_join_closed') === '1') return; } catch (e) {}
  const { data: n } = await sb.rpc('kasa_people_count');
  state.peopleCount = n;
  const el = document.getElementById('k-join');
  renderJoin();
  el.hidden = false;
  document.getElementById('k-join-x').onclick = () => { el.hidden = true; try { localStorage.setItem('kasa_join_closed', '1'); } catch (e) {} };
}

/* "Still there?" Someone who already shares their location, standing within 100 m of an
   unresolved report at least 2 days old, is asked once (per report, per week, per phone)
   whether it's still there. "Yes" is an on-site sighting; "It's been cleaned" starts the
   usual photo-proof cleanup claim. Nothing is asked of people who haven't allowed location. */
const STILL_RADIUS_M = 100, STILL_MIN_DAYS = 2, STILL_REASK_DAYS = 7;
function askStillThere(lat, lng, accuracy){
  if (askStillThere.done || accuracy > STILL_RADIUS_M) return;
  let asked = {};
  try { asked = JSON.parse(localStorage.getItem('kasa_still_asked') || '{}'); } catch (e) {}
  const now = Date.now();
  const r = primaries()
    .filter(x => x.status === 'open' && !x.pending && !state.seen.has(x.id) && daysSince(x.createdAt) >= STILL_MIN_DAYS
      && !(asked[x.id] && now - asked[x.id] < STILL_REASK_DAYS * 86400000))
    .map(x => ({ x, d: distanceM(lat, lng, x.lat, x.lng) }))
    .filter(o => o.d <= STILL_RADIUS_M)
    .sort((a, b) => a.d - b.d)[0]?.x;
  if (!r) return;
  askStillThere.done = true;
  asked[r.id] = now;
  try { localStorage.setItem('kasa_still_asked', JSON.stringify(asked)); } catch (e) {}
  const el = document.getElementById('k-still');
  el.innerHTML = `
    ${r.photo ? `<img src="${esc(r.photo)}" alt="" data-open="${esc(r.id)}">` : ''}
    <div>
      <div class="k-still-q">${esc(t('still_q', { cat: t('cat_' + r.category) }))}</div>
      <div class="k-still-m">${esc(t('still_meta', { d: daysSince(r.createdAt), place: placeText(r) }))}</div>
      <div class="k-still-a">
        <button type="button" class="k-still-yes" data-still="yes">${esc(t('still_yes'))}</button>
        <button type="button" class="k-still-gone" data-still="gone">${esc(t('still_gone'))}</button>
        <button type="button" data-still="no">${esc(t('still_later'))}</button>
      </div>
    </div>`;
  el.hidden = false;
  el.onclick = e => {
    const b = e.target.closest('[data-still]');
    if (e.target.closest('[data-open]')) el.hidden = true;
    if (!b) return;
    el.hidden = true;
    if (b.dataset.still === 'yes') handleSeen(r.id, b);
    else if (b.dataset.still === 'gone') openEvidence('claim:' + r.id);
  };
}

function openLightbox(srcs, index, alt){
  closeLightbox();
  const box = document.createElement('div');
  box.id = 'k-lightbox';
  box.className = 'k-lightbox';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box._srcs = srcs;
  box._alt = alt;
  box._index = index;
  box.addEventListener('click', e => {
    if (e.target.closest('.k-lightbox-nav, .k-lightbox-close')) return;
    closeLightbox();
  });
  document.body.appendChild(box);
  renderLightbox(box);
}

function renderLightbox(box){
  const nav = box._srcs.length > 1 ? `
    <button type="button" class="k-lightbox-nav k-lightbox-prev" aria-label="${esc(t('sheet_prev'))}">‹</button>
    <button type="button" class="k-lightbox-nav k-lightbox-next" aria-label="${esc(t('sheet_next'))}">›</button>` : '';
  box.innerHTML = `<img src="${esc(box._srcs[box._index])}" alt="${esc(box._alt || '')}">${nav}<button type="button" class="k-lightbox-close" aria-label="${esc(t('sheet_close'))}">✕</button>`;
  box.querySelector('.k-lightbox-prev')?.addEventListener('click', e => { e.stopPropagation(); stepLightbox(box, -1); });
  box.querySelector('.k-lightbox-next')?.addEventListener('click', e => { e.stopPropagation(); stepLightbox(box, 1); });
}

function stepLightbox(box, dir){
  const n = box._srcs.length;
  box._index = (box._index + dir + n) % n;
  renderLightbox(box);
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

/* Resizes to ≤PHOTO_MAX_PX JPEG, respecting camera orientation. */
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
  return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', PHOTO_QUALITY));
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
