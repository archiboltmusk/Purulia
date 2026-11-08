/* Network data stays same-origin. All source strings are rendered as text. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  let network = null, loading = false, searched = false;
  let positionNodes = [];
  const clock = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' });
  function node(tag, content, className) { const e = document.createElement(tag); if (content !== undefined) e.textContent = content; if (className) e.className = className; return e; }
  function link(label, href) { const e = node('a', label); e.href = href; e.target = '_blank'; e.rel = 'noopener noreferrer'; return e; }
  function stopName(id) { return network.stops.find(s => s.id === id)?.name || id; }
  function setDefaults() { $('departure').value = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 16); }
  function coverage() {
    const wrap = $('coverage-list'); wrap.replaceChildren();
    for (const mode of Transit.MODES) {
      const active = network.trips.filter(t => t.mode === mode && Transit.sourceCurrent(network.sources.find(s => s.id === t.source_id), Date.now()));
      const row = node('div', undefined, 'coverage-row');
      row.append(node('b', mode[0].toUpperCase() + mode.slice(1)), node('span', active.length ? active.length + ' scheduled trips' : 'Not connected'));
      wrap.append(row);
    }
    for (const s of network.sources) {
      const detail = node('details'), summary = node('summary', s.name + ' · ' + (Transit.sourceCurrent(s, Date.now()) ? 'within validity window' : 'not current'));
      detail.append(summary, node('p', 'Retrieved ' + clock.format(new Date(s.retrieved_at)) + '. Valid until ' + clock.format(new Date(s.valid_until)) + ' IST.'), link('Publisher source ↗', s.url), document.createTextNode(' · '), link('Reuse terms ↗', s.license_url));
      wrap.append(detail);
    }
  }
  function render() {
    const out = $('results'); out.replaceChildren(); positionNodes = [];
    if (!network) return;
    const from = $('from').value, to = $('to').value;
    if (!from || !to) return;
    if (from === to) { out.append(node('p', 'Choose two different stops.', 'empty')); return; }
    const at = $('departure').value + ':00+05:30';
    if (!Number.isFinite(Date.parse(at)) || Date.parse(at) < Date.now() - 60000) { out.append(node('p', 'Choose a departure time from now onwards, in IST.', 'empty')); return; }
    const modes = [...document.querySelectorAll('#mode-filters input:checked')].map(x => x.value);
    const results = Transit.plan(network, { from, to, at, modes, accessible: $('accessible').checked });
    if (!results.length) { out.append(node('p', 'No journey found in the connected schedules for the next 24 hours. This does not mean no service exists. Try other stops, modes or a later departure, or check the operator.', 'empty')); return; }
    out.append(node('p', results.length + ' timetable options · earliest arrival first. Recheck actual running before travel.', 'small'));
    for (const r of results) {
      const card = node('article', undefined, 'journey');
      const heading = node('div', undefined, 'journey-summary');
      heading.append(node('span', clock.format(new Date(r.departure)) + ' → ' + clock.format(new Date(r.arrival)) + ' IST'), node('span', Math.round((Date.parse(r.arrival) - Date.parse(r.departure)) / 60000) + ' min · ' + (r.legs.length === 1 ? 'Direct' : '1 change')));
      card.append(heading, node('span', 'Scheduled · not a live arrival', 'badge'));
      r.legs.forEach((l, index) => {
        if (index) card.append(node('p', 'Change at ' + stopName(l.from) + ' · ' + Math.round((Date.parse(l.departure) - Date.parse(r.legs[index - 1].arrival)) / 60000) + ' min scheduled connection. Delays may break it.', 'small'));
        const e = node('div', undefined, 'leg');
        e.append(node('b', l.mode.toUpperCase() + ' · ' + l.name), node('p', stopName(l.from) + ' → ' + stopName(l.to)), node('small', l.operator + ' · Wheelchair access: ' + l.wheelchair));
        const source = network.sources.find(s => s.id === l.source_id);
        e.append(node('p', 'Scheduled ' + clock.format(new Date(l.departure)) + ' → ' + clock.format(new Date(l.arrival)) + ' IST'), link('Timetable source ↗', source.url));
        const positionWrap = node('div');
        positionNodes.push({ wrap: positionWrap, tripId: l.trip_id, signature: null });
        e.append(positionWrap);
        const details = node('details'); details.append(node('summary', 'Stops and scheduled times'));
        const list = node('ol');
        l.calls.forEach(c => list.append(node('li', stopName(c.stop_id) + ' · arr ' + clock.format(new Date(c.arrival)) + ' / dep ' + clock.format(new Date(c.departure)) + ' IST')));
        details.append(list); e.append(details); card.append(e);
      });
      out.append(card);
    }
    updatePositions();
  }
  function updatePositions() {
    if (!network) return;
    for (const item of positionNodes) {
      const p = Transit.position(network, item.tripId);
      const signature = JSON.stringify(p);
      if (signature === item.signature) continue;
      item.signature = signature; item.wrap.replaceChildren();
      if (p.status === "live") {
        const source = network.sources.find(s => s.id === p.source_id);
        item.wrap.append(node("p", "Live observation at " + clock.format(new Date(p.observed_at)) + " IST · not an ETA"), link("View observed position on OpenStreetMap ↗", "https://www.openstreetmap.org/?mlat=" + p.lat + "&mlon=" + p.lon + "#map=15/" + p.lat + "/" + p.lon), document.createTextNode(" · "), link("Position source ↗", source.url));
      } else item.wrap.append(node("p", p.status === "stale" ? "Vehicle position is stale or its source is not current. No live location shown." : "Live vehicle position unavailable."));
    }
  }
  async function load() {
    if (loading) return;
    loading = true; $('refresh').disabled = true;
    try {
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 12000);
      let response;
      try { response = await fetch('places/transit/network.json', { cache: 'no-store', signal: controller.signal }); }
      finally { clearTimeout(timeout); }
      if (!response.ok) throw new Error('Network unavailable');
      const raw = await response.text();
      if (raw.length > 15000000) throw new Error('Network too large');
      network = Transit.validate(JSON.parse(raw));
      const now = Date.now(), active = network.sources.filter(s => Transit.sourceCurrent(s, now));
      const ids = new Set(active.map(s => s.id)), stops = network.stops.filter(s => ids.has(s.source_id)).sort((a, b) => a.name.localeCompare(b.name));
      for (const field of ['from', 'to']) {
        const previous = $(field).value;
        $(field).replaceChildren(new Option(stops.length ? 'Choose a stop' : 'No stops connected', ''));
        stops.forEach(s => $(field).append(new Option(s.name + ' · ' + s.id, s.id)));
        if (stops.some(s => s.id === previous)) $(field).value = previous;
        $(field).disabled = stops.length === 0;
      }
      $('search').disabled = $('swap').disabled = stops.length === 0;
      $('feed-status').textContent = stops.length ? active.length + ' current source(s) · schedules are not live running information. Times shown in IST.' : 'No operator feed is connected for travel planning. Live tracking and journey results are unavailable. Use the official services below.';
      coverage();
      if (searched) render();
    } catch (_) {
      network = null;
      $('feed-status').textContent = 'Transport data could not be loaded or validated. Journey search is unavailable. Refresh or use the official services below.';
      for (const id of ['from', 'to', 'search', 'swap']) $(id).disabled = true;
      $('coverage-list').replaceChildren(node('p', 'Coverage unavailable. No live status can be confirmed.', 'small'));
      $('results').replaceChildren();
    } finally { loading = false; $('refresh').disabled = false; }
  }
  $('journey-form').addEventListener('submit', e => { e.preventDefault(); searched = true; render(); });
  $('swap').addEventListener('click', () => { const a = $('from').value; $('from').value = $('to').value; $('to').value = a; if (searched) render(); });
  $('refresh').addEventListener('click', load);
  setDefaults(); load();
  setInterval(updatePositions, 1000);
  setInterval(() => { if (!document.hidden) load(); }, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
})();
