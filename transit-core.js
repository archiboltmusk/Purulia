/* Shared, dependency-free transit contract. Published data only; no inferred live ETAs. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Transit = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MODES = ['bus', 'train', 'tram', 'metro', 'ferry', 'cable'];
  const instant = x => typeof x === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(x) && Number.isFinite(Date.parse(x));
  const https = x => { try { return new URL(x).protocol === 'https:'; } catch (_) { return false; } };
  const text = x => typeof x === 'string' && x.trim().length > 0 && x.length <= 500;
  function validate(data) {
    const fail = message => { throw new Error(message); };
    if (!data || data.schema_version !== 1 || data.timezone !== 'Asia/Kolkata') fail('Unsupported network version or timezone.');
    for (const key of ['sources', 'stops', 'trips', 'positions']) if (!Array.isArray(data[key])) fail('Missing ' + key + ' array.');
    if (data.trips.length > 50000 || data.stops.length > 100000 || data.positions.length > 50000) fail('Network exceeds supported size.');
    const sources = new Map(), stops = new Map(), trips = new Map();
    for (const s of data.sources) {
      if (!text(s.id) || sources.has(s.id) || !text(s.name) || !https(s.url) || !https(s.license_url) || !instant(s.retrieved_at) || !instant(s.valid_from) || !instant(s.valid_until) || Date.parse(s.valid_until) <= Date.parse(s.valid_from)) fail('Invalid source metadata.');
      if (s.timing_quality !== undefined && !['published', 'estimated'].includes(s.timing_quality)) fail('Invalid timing quality.');
      if ((s.id === 'delhi-otd' || new URL(s.url).hostname === 'otd.delhi.gov.in') && s.timing_quality !== 'estimated') fail('Delhi OTD times must be marked estimated.');
      sources.set(s.id, s);
    }
    for (const s of data.stops) {
      if (!text(s.id) || stops.has(s.id) || !text(s.name) || !sources.has(s.source_id) || !Number.isFinite(s.lat) || !Number.isFinite(s.lon) || Math.abs(s.lat) > 90 || Math.abs(s.lon) > 180) fail('Invalid or duplicate stop.');
      stops.set(s.id, s);
    }
    for (const t of data.trips) {
      if (!text(t.id) || trips.has(t.id) || !sources.has(t.source_id) || !MODES.includes(t.mode) || !text(t.name) || !text(t.operator) || !Array.isArray(t.calls) || t.calls.length < 2 || !['yes', 'no', 'unknown'].includes(t.wheelchair)) fail('Invalid or duplicate trip.');
      let previous = -Infinity;
      for (const c of t.calls) {
        if (!stops.has(c.stop_id) || stops.get(c.stop_id).source_id !== t.source_id || !instant(c.arrival) || !instant(c.departure) || typeof c.pickup !== 'boolean' || typeof c.dropoff !== 'boolean') fail('Invalid stop call.');
        const a = Date.parse(c.arrival), d = Date.parse(c.departure), source = sources.get(t.source_id);
        if (a < previous || d < a || a < Date.parse(source.valid_from) || d >= Date.parse(source.valid_until)) fail('Invalid timetable order or validity window.');
        previous = d;
      }
      trips.set(t.id, t);
    }
    const seen = new Set();
    for (const p of data.positions) {
      if (!trips.has(p.trip_id) || seen.has(p.trip_id) || !sources.has(p.source_id) || !instant(p.observed_at) || !Number.isFinite(p.lat) || !Number.isFinite(p.lon) || Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180) fail('Invalid or duplicate vehicle observation.');
      seen.add(p.trip_id);
    }
    return data;
  }
  function sourceCurrent(source, now) {
    return Date.parse(source.retrieved_at) <= now && Date.parse(source.valid_from) <= now && now < Date.parse(source.valid_until);
  }
  function position(data, tripId, now = Date.now()) {
    const p = data.positions.find(x => x.trip_id === tripId);
    if (!p) return { status: 'unavailable' };
    const source = data.sources.find(s => s.id === p.source_id), age = now - Date.parse(p.observed_at);
    if (!source || !sourceCurrent(source, now) || age < 0 || age > 90000) return { status: 'stale', observed_at: p.observed_at };
    return { ...p, status: 'live' };
  }
  function plan(data, options) {
    const { from, to, at, modes = MODES, accessible = false } = options;
    const now = options.now === undefined ? Date.now() : options.now;
    const start = Date.parse(at), end = start + 24 * 3600000;
    if (!Number.isFinite(start) || start < now - 60000 || from === to) return [];
    const valid = new Set(data.sources.filter(s => s.timing_quality !== 'estimated' && sourceCurrent(s, now) && start >= Date.parse(s.valid_from) && start < Date.parse(s.valid_until)).map(s => s.id));
    const trips = data.trips.filter(t => valid.has(t.source_id) && modes.includes(t.mode) && (!accessible || t.wheelchair === 'yes'));
    const results = [], first = [];
    function leg(t, i, j) { return { trip_id: t.id, source_id: t.source_id, name: t.name, operator: t.operator, mode: t.mode, wheelchair: t.wheelchair, from: t.calls[i].stop_id, to: t.calls[j].stop_id, departure: t.calls[i].departure, arrival: t.calls[j].arrival, calls: t.calls.slice(i, j + 1) }; }
    for (const t of trips) for (let i = 0; i < t.calls.length - 1; i++) {
      const c = t.calls[i], dep = Date.parse(c.departure);
      if (c.stop_id !== from || !c.pickup || dep < start || dep > end) continue;
      for (let j = i + 1; j < t.calls.length; j++) {
        if (!t.calls[j].dropoff || Date.parse(t.calls[j].arrival) > end) continue;
        const l = leg(t, i, j);
        if (l.to === to) results.push({ legs: [l], departure: l.departure, arrival: l.arrival });
        else first.push(l);
      }
    }
    // At most one change, at exactly the same stop ID; no invented station walks.
    const onward = new Map();
    for (const t of trips) for (let i = 0; i < t.calls.length - 1; i++) {
      if (!t.calls[i].pickup) continue;
      for (let j = i + 1; j < t.calls.length; j++) if (t.calls[j].stop_id === to && t.calls[j].dropoff) {
        const list = onward.get(t.calls[i].stop_id) || [];
        list.push(leg(t, i, j)); onward.set(t.calls[i].stop_id, list);
      }
    }
    for (const a of first) for (const b of onward.get(a.to) || []) {
      const wait = Date.parse(b.departure) - Date.parse(a.arrival);
      if (a.trip_id !== b.trip_id && wait >= 10 * 60000 && wait <= 120 * 60000 && Date.parse(b.arrival) <= end) results.push({ legs: [a, b], departure: a.departure, arrival: b.arrival });
    }
    const unique = new Map();
    for (const r of results) unique.set(r.legs.map(l => [l.trip_id, l.from, l.to, l.departure].join('|')).join('>'), r);
    return [...unique.values()].sort((a, b) => Date.parse(a.arrival) - Date.parse(b.arrival) || a.legs.length - b.legs.length || Date.parse(a.departure) - Date.parse(b.departure)).slice(0, 12);
  }
  // The server endpoint provides native vehicle identities even without a static timetable.
  function liveVehicles(data, now = Date.now()) {
    if (!data || data.schema_version !== 1 || data.source_id !== 'delhi-otd' || data.source_url !== 'https://otd.delhi.gov.in/documentation/' || !instant(data.feed_observed_at) || !instant(data.fetched_at) || !Array.isArray(data.positions) || data.positions.length > 20000) throw new Error('Invalid vehicle feed.');
    const valid = x => instant(x) && Date.parse(x) <= now && now - Date.parse(x) <= 90000;
    if (!valid(data.feed_observed_at) || Date.parse(data.fetched_at) > now) return [];
    const seen = new Set(), rows = [];
    for (const p of data.positions) {
      if (!p || !text(p.vehicle_id) || seen.has(p.vehicle_id) || !valid(p.observed_at) || Date.parse(p.observed_at) > Date.parse(data.feed_observed_at) || !Number.isFinite(p.lat) || !Number.isFinite(p.lon) || Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180 || (p.lat === 0 && p.lon === 0) || (p.route_id !== null && !text(p.route_id)) || (p.trip_id !== null && !text(p.trip_id))) continue;
      seen.add(p.vehicle_id); rows.push(p);
    }
    return rows;
  }
  // Pages snapshots are historical observations, never a continuous/live tracking promise.
  function snapshotVehicles(data, now = Date.now()) {
    if (!data || data.schema_version !== 1 || data.source_id !== 'delhi-otd' || data.source_url !== 'https://otd.delhi.gov.in/documentation/' || data.delivery !== 'github-pages-snapshot' || !Array.isArray(data.positions) || data.positions.length > 20000) throw new Error('Invalid snapshot.');
    const statuses = ['ok', 'not_configured', 'access_denied', 'rate_limited', 'upstream_unavailable', 'invalid_feed', 'unsupported_feed', 'stale_feed', 'oversized_feed'];
    if (!statuses.includes(data.status)) throw new Error('Invalid snapshot status.');
    if (data.status !== 'ok') {
      if (data.positions.length) throw new Error('Failed snapshot contains positions.');
      return [];
    }
    const current = x => instant(x) && Date.parse(x) <= now && now - Date.parse(x) <= 15 * 60000;
    if (!current(data.generated_at) || !current(data.fetched_at) || !current(data.feed_observed_at)) return [];
    if (Date.parse(data.feed_observed_at) > Date.parse(data.fetched_at) || Date.parse(data.fetched_at) > Date.parse(data.generated_at)) throw new Error('Invalid snapshot timestamp order.');
    const seen = new Set();
    return data.positions.filter(p => {
      if (!p || !text(p.vehicle_id) || seen.has(p.vehicle_id) || !current(p.observed_at) || Date.parse(p.observed_at) > Date.parse(data.feed_observed_at) || !Number.isFinite(p.lat) || !Number.isFinite(p.lon) || Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180 || (p.lat === 0 && p.lon === 0) || (p.route_id !== null && !text(p.route_id))) return false;
      seen.add(p.vehicle_id); return true;
    });
  }
  return { MODES, validate, plan, position, sourceCurrent, liveVehicles, snapshotVehicles };
});
