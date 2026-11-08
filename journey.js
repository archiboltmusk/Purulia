/* Explicit foreground GPS only; no location goes to the server without a separate Share action. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  let watch = null, samples = [], lastFix = null, backend = false, token = null;
  function show() {
    if (!lastFix || Date.now() - lastFix.at > 30000) { $('journey-estimate').textContent = 'Waiting for a fresh accurate GPS fix. No moving-time estimate is shown.'; return; }
    const e = Journey.estimate(samples, Number($('journey-distance').value));
    const messages = { distance_needed: 'Enter your remaining route distance in kilometres from your route or map.', collecting: 'Waiting for at least three good fixes over 30 seconds. Keep the page open.', stationary: 'No reliable forward movement detected. A moving-time estimate is unavailable.', unstable: 'Movement is too variable for a reliable moving-time estimate.' };
    $('journey-estimate').textContent = e.status === 'estimate' ? 'About ' + e.minutes + ' minutes of moving time' + ($('journey-destination').value.trim() ? ' towards ' + $('journey-destination').value.trim() : '') + ' at ' + e.speed_kmh + ' km/h for your entered ' + e.remaining_km + ' km. This excludes stops, traffic changes and transfers; it is not an arrival prediction.' : messages[e.status];
  }
  function stop() {
    if (watch !== null) navigator.geolocation.clearWatch(watch);
    watch = null; samples = []; lastFix = null; $('journey-start').disabled = false; $('journey-stop').disabled = true; $('journey-share').disabled = true;
    $('journey-location').textContent = 'Location tracking is off. No GPS history is stored.'; $('journey-estimate').textContent = 'Start location tracking to measure your movement.';
  }
  $('journey-start').addEventListener('click', () => {
    if (!navigator.geolocation) { $('journey-location').textContent = 'Location is not supported on this browser.'; return; }
    if (watch !== null) return;
    $('journey-start').disabled = true; $('journey-stop').disabled = false;
    watch = navigator.geolocation.watchPosition(p => {
      const fix = { lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy, at: p.timestamp };
      if (!Journey.valid(fix) || fix.at > Date.now() || Date.now() - fix.at > 30000) { lastFix = null; $('journey-share').disabled = true; $('journey-location').textContent = 'Location accuracy is too poor. Move to a clearer view of the sky.'; return; }
      lastFix = fix;
      if (!samples.length || fix.at - samples[samples.length - 1].at >= 5000) samples.push(fix);
      samples = samples.filter(x => Date.now() - x.at <= 120000);
      $('journey-location').textContent = 'Tracking on this device · GPS accuracy about ' + Math.round(fix.accuracy) + ' m. Coordinates are not displayed or stored.';
      $('journey-share').disabled = !backend; show();
    }, () => { stop(); $('journey-location').textContent = 'Location could not be read. Check browser permission and try again.'; }, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
  });
  $('journey-stop').addEventListener('click', stop);
  $('journey-destination').addEventListener('input', () => { if (watch !== null) show(); });
  $('journey-distance').addEventListener('input', () => { if (watch !== null) show(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  window.addEventListener('pagehide', stop);
  setInterval(() => { if (watch !== null) { if (lastFix && Date.now() - lastFix.at > 30000) { lastFix = null; $('journey-share').disabled = true; } show(); } }, 1000);

  async function rpc(name, payload) {
    const c = window.KASA_CONFIG;
    if (!c?.SUPABASE_URL || !c?.SUPABASE_ANON_KEY) throw new Error('not_connected');
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10000);
    try {
      const r = await fetch(c.SUPABASE_URL + '/rest/v1/rpc/' + name, { method: 'POST', headers: { apikey: c.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + c.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: controller.signal });
      if (!r.ok) throw new Error('unavailable'); return await r.json();
    } finally { clearTimeout(timer); }
  }
  function sessionToken() {
    if (!token) { try { token = sessionStorage.getItem('transit_session'); } catch (_) {} }
    if (!token) { token = crypto.randomUUID(); try { sessionStorage.setItem('transit_session', token); } catch (_) {} }
    return token;
  }
  $('journey-share').addEventListener('click', async () => {
    const fix = lastFix, route = $('journey-route').value.trim();
    if (!fix || Date.now() - fix.at > 30000 || !route || route.length > 120 || !$('journey-consent').checked) { $('community-status').textContent = 'Enter a route ID, tick the sharing consent, and obtain a recent accurate location first.'; return; }
    $('journey-share').disabled = true;
    try {
      await rpc('kasa_transit_submit', { p_token: sessionToken(), p_route: route, p_lat: fix.lat, p_lon: fix.lon, p_accuracy: fix.accuracy, p_observed_at: new Date(fix.at).toISOString() });
      $('community-status').textContent = 'Your approximate area was shared for up to 10 minutes as an unverified passenger report. Sharing is one-time; GPS tracking does not automatically send another report.';
      $('journey-withdraw').disabled = false;
    } catch (_) { $('community-status').textContent = 'Report could not be shared. The service may be unavailable or the rate limit reached.'; }
    finally { $('journey-share').disabled = !backend || !lastFix; }
  });
  $('journey-withdraw').addEventListener('click', async () => {
    try { await rpc('kasa_transit_withdraw', { p_token: sessionToken() }); $('community-status').textContent = 'Your passenger report was withdrawn.'; $('journey-withdraw').disabled = true; }
    catch (_) { $('community-status').textContent = 'Withdrawal could not be confirmed. Reports expire from public results after 10 minutes.'; }
  });
  $('community-load').addEventListener('click', async () => {
    const route = $('journey-route').value.trim(), out = $('community-results'); out.replaceChildren();
    if (!route) { $('community-status').textContent = 'Enter a route ID to check passenger reports.'; return; }
    try {
      const rows = await rpc('kasa_transit_reports', { p_route: route });
      $('community-status').textContent = 'Passenger reports are unverified browser submissions. A group is shown only with at least three recent reporting sessions in the same approximate area. They do not establish a bus location or ETA.';
      if (!rows.length) { out.textContent = 'No eligible recent passenger groups for this route. This does not mean no service exists.'; return; }
      for (const row of rows) {
        if (!Number.isFinite(row.lat) || !Number.isFinite(row.lon) || Math.abs(row.lat) > 90 || Math.abs(row.lon) > 180 || !Number.isInteger(row.sessions) || row.sessions < 3 || !Number.isFinite(Date.parse(row.latest_at)) || Date.parse(row.latest_at) > Date.now() || Date.now() - Date.parse(row.latest_at) > 600000 || !Number.isFinite(Date.parse(row.expires_at)) || Date.parse(row.expires_at) <= Date.now()) continue;
        const p = document.createElement('p'); p.textContent = row.sessions + ' reporting sessions near an approximate 1 km grid area · latest report ' + new Date(row.latest_at).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST.'; const link = document.createElement('a'); link.textContent = ' View approximate area ↗'; link.href = 'https://www.openstreetmap.org/?mlat=' + row.lat + '&mlon=' + row.lon + '#map=12/' + row.lat + '/' + row.lon; link.target = '_blank'; link.rel = 'noopener noreferrer'; p.append(link); out.append(p); setTimeout(() => p.remove(), Math.max(0, Math.min(600000, Date.parse(row.expires_at) - Date.now())));
      }
      setTimeout(() => { out.replaceChildren(); }, 60000);
    } catch (_) { $('community-status').textContent = 'Passenger reports are not connected or could not be loaded.'; }
  });
  rpc('kasa_transit_status', {}).then(() => { backend = true; $('community-load').disabled = false; $('community-status').textContent = 'Passenger reporting is available. Reports are approximate, temporary and unverified.'; }).catch(() => { $('community-status').textContent = 'Passenger sharing is not connected yet. Device GPS tracking and moving-time estimates work without it.'; });
})();
