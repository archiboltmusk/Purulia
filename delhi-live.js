/* Delhi snapshot board: public, project-relative JSON only. Never accepts or stores a key. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const clock = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  let snapshot = null, inFlight = false, lastView = null;
  function node(tag, text, className) { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (className) e.className = className; return e; }
  function render() {
    const list = $('delhi-vehicles');
    if (!snapshot) return;
    const current = Transit.snapshotVehicles(snapshot);
    const query = $('delhi-filter').value.trim().toLowerCase();
    const rows = current.filter(p => !query || (p.route_id || '').toLowerCase().includes(query) || p.vehicle_id.toLowerCase().includes(query));
    const signature = JSON.stringify([query, current.length, rows, snapshot.status, snapshot.generated_at]);
    if (signature === lastView) return;
    lastView = signature; list.replaceChildren();
    $('delhi-status').textContent = current.length ? current.length + ' last-observed locations · snapshot prepared ' + clock.format(new Date(snapshot.generated_at)) + ' IST. Vehicles may have moved.' : (snapshot.status === 'not_configured' ? 'Delhi bus snapshots are not connected yet.' : snapshot.status !== 'ok' ? 'The last collection attempt could not provide vehicle locations.' : 'This snapshot has no vehicle observations from the last 15 minutes. No locations are shown.');
    if (!rows.length) { list.append(node('p', current.length ? 'No matching route ID or vehicle ID in the current observations.' : 'No recent locations to show.', 'small')); return; }
    list.append(node('p', rows.length + ' matches · showing up to 40. Times are IST.', 'small'));
    for (const p of rows.slice(0, 40)) {
      const card = node('article', undefined, 'vehicle-card');
      card.append(node('b', p.route_id ? 'Bus · Route ID ' + p.route_id : 'Bus · route not supplied'), node('p', 'Vehicle ID ' + p.vehicle_id), node('small', 'Observed ' + clock.format(new Date(p.observed_at)) + ' IST'));
      const a = node('a', 'View last-observed location ↗');
      a.href = 'https://www.openstreetmap.org/?mlat=' + p.lat + '&mlon=' + p.lon + '#map=15/' + p.lat + '/' + p.lon;
      a.target = '_blank'; a.rel = 'noopener noreferrer'; card.append(a);
      card.append(node('small', 'Snapshot only · vehicle may have moved · timetable match not verified.'));
      list.append(card);
    }
  }
  async function refresh() {
    if (inFlight) return;
    inFlight = true; $('delhi-refresh').disabled = true;
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch('places/transit/delhi.json', { signal: controller.signal, cache: 'no-store', redirect: 'error' });
      if (!response.ok) throw new Error('Unavailable');
      const text = await response.text();
      if (text.length > 8000000) throw new Error('Too large');
      const data = JSON.parse(text);
      Transit.snapshotVehicles(data); // Validate the response before it becomes visible.
      snapshot = data; render();
    } catch (_) {
      snapshot = null; lastView = null; $('delhi-vehicles').replaceChildren();
      $('delhi-status').textContent = 'Delhi bus snapshots could not be loaded. No locations are shown. Retry or check the operator.';
    } finally { clearTimeout(timer); inFlight = false; $('delhi-refresh').disabled = false; }
  }
  $('delhi-refresh').addEventListener('click', refresh);
  $('delhi-filter').addEventListener('input', render);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { if (snapshot) render(); refresh(); } });
  setInterval(() => { if (!document.hidden) refresh(); }, 30000);
  setInterval(() => { if (snapshot && !document.hidden) render(); }, 1000);
  refresh();
})();
