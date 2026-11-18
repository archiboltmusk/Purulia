import { measure, shareable, colourRegions, RESULT_TTL_MS } from './internet-speed-core.mjs';
const $ = id => document.getElementById(id);
const status = msg => { $('status').textContent = msg; };
const authStatus = msg => { $('auth-status').textContent = msg; };
let db, user = null, result = null, controller = null, sharing = false, expiry;
let map, mapReady = false, boundaries, rows = [], dataError = false;
try {
  const config = window.KASA_CONFIG;
  if (config && window.supabase) db = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
    // Keep email identities separate from the civic app's anonymous session.
    auth: { storageKey: 'parishkar-internet-speed-auth' }
  });
} catch { authStatus('Contribution service unavailable. Private testing still works.'); }
function updateShare() {
  $('publish').disabled = sharing || !!controller || !user || !$('consent').checked || !shareable(result, $('kind').value);
}
function invalidate(message) {
  result = null; clearTimeout(expiry); updateShare();
  if (message) status(message);
}
function setUser(value) {
  user = value && !value.is_anonymous && value.email_confirmed_at ? value : null;
  $('logout').hidden = !user; $('delete').hidden = !user; $('login-form').hidden = !!user;
  if (user) { $('verify-form').hidden = true; $('email').value = ''; $('otp').value = ''; }
  authStatus(user ? 'Signed in for contributions. Your email stays private.' : 'Sign in to contribute. Private tests need no account.');
  updateShare();
}
if (db) {
  db.auth.onAuthStateChange((_event, session) => setUser(session?.user));
  db.auth.getUser().then(({ data, error }) => { if (!error) setUser(data.user); }).catch(() => authStatus('Sign-in unavailable. Try again.'));
} else authStatus('Contribution service unavailable. Private testing still works.');
$('consent').onchange = updateShare;
$('kind').onchange = () => invalidate('Connection type changed. Run a fresh test.');
$('run').onclick = async () => {
  invalidate(); controller = new AbortController();
  $('run').disabled = true; $('kind').disabled = true; $('cancel').hidden = false;
  for (const id of ['down', 'up', 'ping']) $(id).textContent = '—';
  updateShare();
  try {
    result = await measure($('kind').value, { signal: controller.signal, progress: status });
    $('down').textContent = result.download_mbps; $('up').textContent = result.upload_mbps; $('ping').textContent = result.latency_ms;
    status('Test complete — browser estimate. Share within five minutes if you choose.');
    expiry = setTimeout(() => invalidate('Result expired for sharing. Run a fresh test.'), RESULT_TTL_MS);
  } catch (e) {
    invalidate();
    status(controller.signal.aborted ? 'Test cancelled or interrupted. Run again with this page visible.' : 'Test failed: ' + e.message + '. Retry or check access to the test server.');
  } finally {
    controller = null; $('run').disabled = false; $('kind').disabled = false; $('cancel').hidden = true; updateShare();
  }
};
$('cancel').onclick = () => controller?.abort();
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { controller?.abort(); invalidate('Page hidden. Run a fresh test before sharing.'); }
});
navigator.connection?.addEventListener('change', () => {
  controller?.abort(); invalidate('Network changed. Run a fresh test.');
});
$('login-form').onsubmit = async e => {
  e.preventDefault(); if (!db) return authStatus('Contribution service unavailable.');
  $('login').disabled = true;
  try {
    const { error } = await db.auth.signInWithOtp({ email: $('email').value.trim(), options: { emailRedirectTo: location.origin + location.pathname } });
    if (error) throw error;
    $('verify-form').hidden = false;
    authStatus('Check your email for a sign-in link. Open it in this browser, then run a fresh test. If your email contains a code, enter it below.');
  } catch (e) { authStatus('Sign-in failed: ' + e.message); }
  finally { $('login').disabled = false; }
};
$('verify-form').onsubmit = async e => {
  e.preventDefault(); if (!db) return;
  $('verify').disabled = true;
  try {
    const { data, error } = await db.auth.verifyOtp({ email: $('email').value.trim(), token: $('otp').value.trim(), type: 'email' });
    if (error) throw error; setUser(data.user);
  } catch (e) { authStatus('Sign-in failed: ' + e.message); }
  finally { $('verify').disabled = false; }
};
$('logout').onclick = async () => {
  try { const { error } = await db.auth.signOut(); if (error) throw error; setUser(null); invalidate('Signed out. Run a fresh test to contribute later.'); }
  catch (e) { authStatus('Could not sign out: ' + e.message); }
};
$('delete').onclick = async () => {
  $('delete').disabled = true;
  try {
    const { error } = await db.rpc('delete_my_internet_speed'); if (error) throw error;
    invalidate('Your speed contributions were deleted. Public aggregates will update on refresh.'); await loadData();
  } catch (e) { status('Could not delete contributions: ' + e.message); }
  finally { $('delete').disabled = false; }
};
function locate() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(Error('Location is unavailable in this browser'));
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: false, timeout: 12000, maximumAge: 0 });
  });
}
$('publish').onclick = async () => {
  if (sharing || !db || !user || !$('consent').checked || !shareable(result, $('kind').value)) return;
  const pending = result;
  sharing = true; $('run').disabled = true; $('kind').disabled = true; updateShare();
  try {
    const { data, error: authError } = await db.auth.getUser();
    if (authError || !data.user || data.user.is_anonymous || !data.user.email_confirmed_at) throw Error('Sign in with a confirmed email first');
    status('Requesting approximate location for your contribution…');
    const pos = await locate();
    if (!Number.isFinite(pos.coords.accuracy) || pos.coords.accuracy > 5000 || Date.now() - pos.timestamp > 60000) throw Error('Location is too old or inaccurate. Try outdoors');
    // Never transmit a fine coordinate. Server lookup uses the same grid.
    const lat = Math.round(pos.coords.latitude * 10) / 10, lng = Math.round(pos.coords.longitude * 10) / 10;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 6 || lat > 38 || lng < 68 || lng > 98) throw Error('This atlas accepts mapped India locations only');
    if (result !== pending || !$('consent').checked || !shareable(pending, $('kind').value) || document.hidden) throw Error('Result or consent changed. Run a fresh test before sharing');
    const { error } = await db.rpc('submit_internet_speed', { p_lat: lat, p_lng: lng, p_download: pending.download_mbps, p_upload: pending.upload_mbps, p_latency: pending.latency_ms, p_kind: pending.connection_type });
    if (error) throw error;
    invalidate('Contribution saved. Regions appear after five distinct accounts; your result may not appear yet.');
    await loadData();
  } catch (e) { status('Could not share: ' + e.message); }
  finally { sharing = false; $('run').disabled = false; $('kind').disabled = false; updateShare(); }
};
function render() {
  if (!boundaries) return;
  const data = colourRegions(boundaries, rows, $('map-kind').value);
  if (mapReady) map.getSource('regions').setData(data);
  $('regions').replaceChildren();
  for (const f of data.features) {
    const p = f.properties, tr = document.createElement('tr');
    for (const value of [p.state, p.contributors ? p.download_mbps : 'Insufficient data', p.contributors ? p.upload_mbps : '—', p.contributors ? p.latency_ms : '—', p.contributors || '—']) {
      const td = document.createElement('td'); td.textContent = value; tr.append(td);
    }
    $('regions').append(tr);
  }
  if (!dataError) $('map-status').textContent = rows.some(r => r.connection_type === $('map-kind').value)
    ? 'Regional medians loaded. Select a region for details.' : 'No regions have enough contributions for this connection type yet. Grey means insufficient data.';
}
async function loadData() {
  $('refresh').disabled = true;
  try {
    if (!boundaries) {
      const response = await fetch('places/in_states.geojson');
      if (!response.ok) throw Error('Boundary data unavailable'); boundaries = await response.json();
    }
    if (!db) throw Error('Contribution service unavailable');
    const { data, error } = await db.rpc('internet_speed_regions'); if (error) throw error;
    rows = data || []; dataError = false; render();
  } catch {
    rows = []; dataError = true;
    $('map-status').textContent = 'Regional data unavailable. Try Refresh map data. The private speed test still works.';
    render();
  } finally { $('refresh').disabled = false; }
}
$('map-kind').onchange = render;
$('refresh').onclick = loadData;
async function initMap() {
  try {
    const maplibre = await import('./vendor/maplibre-gl-6.14.0/maplibre-gl.mjs');
    map = new maplibre.Map({ container: 'map', style: 'https://tiles.openfreemap.org/styles/liberty', center: [80, 22.5], zoom: 3.5 });
    map.addControl(new maplibre.NavigationControl());
    map.on('load', () => {
      map.addSource('regions', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'speed-regions', type: 'fill', source: 'regions', paint: { 'fill-color': ['get', 'colour'], 'fill-opacity': 0.72 } });
      map.addLayer({ id: 'speed-borders', type: 'line', source: 'regions', paint: { 'line-color': '#fff', 'line-width': 0.7 } });
      mapReady = true; render();
      map.on('click', 'speed-regions', e => {
        const p = e.features[0].properties;
        new maplibre.Popup().setLngLat(e.lngLat).setText(p.state + ': ' + (p.contributors ? `${p.download_mbps} Mbps down · ${p.upload_mbps} Mbps up · ${p.latency_ms} ms HTTP latency · ${p.contributors} accounts` : 'Insufficient data (fewer than five accounts)')).addTo(map);
      });
      map.on('mouseenter', 'speed-regions', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'speed-regions', () => { map.getCanvas().style.cursor = ''; });
    });
    map.on('error', () => { $('map').setAttribute('aria-label', 'Map tiles unavailable or loading. Regional data is available in the table below.'); });
  } catch { $('map').textContent = 'Interactive map unavailable. Use the regional table below.'; }
}
loadData(); initMap();
