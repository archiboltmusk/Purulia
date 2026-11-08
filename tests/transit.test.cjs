const { test } = require('node:test');
const assert = require('node:assert/strict');
const T = require('../transit-core.js');
const at = '2026-11-08T09:00:00+05:30', now = Date.parse(at);
const iso = minute => new Date(now + minute * 60000).toISOString();
function fixture() {
  const source = { id: 'test', name: 'Synthetic test agency', url: 'https://example.org/gtfs', license_url: 'https://example.org/license', retrieved_at: iso(-10), valid_from: iso(-60), valid_until: iso(2000) };
  const stops = ['a', 'b', 'c'].map(id => ({ id, name: id, source_id: 'test', lat: 23, lon: 86 }));
  function trip(id, mode, calls) { return { id, mode, name: id, operator: 'Test only', source_id: 'test', wheelchair: 'unknown', calls: calls.map(([stop_id, m]) => ({ stop_id, arrival: iso(m), departure: iso(m), pickup: true, dropoff: true })) }; }
  return { schema_version: 1, timezone: 'Asia/Kolkata', sources: [source], stops, trips: [trip('one', 'bus', [['a', 5], ['b', 20]]), trip('two', 'metro', [['b', 30], ['c', 45]])], positions: [] };
}
function plan(d, extra = {}) { return T.plan(T.validate(d), { from: 'a', to: 'c', at, now, ...extra }); }
test('one change across modes at same stop; ten minute buffer', () => { const r = plan(fixture()); assert.equal(r.length, 1); assert.equal(r[0].legs.length, 2); });
test('missed or too tight connections cannot be offered', () => { const d = fixture(); d.trips[1].calls[0].arrival = d.trips[1].calls[0].departure = iso(29); assert.deepEqual(plan(d), []); });
test('mode and confirmed accessibility filters', () => { assert.deepEqual(plan(fixture(), { modes: ['bus'] }), []); assert.deepEqual(plan(fixture(), { accessible: true }), []); });
test('expired/future retrieved source and past departure excluded', () => { const d = fixture(); d.sources[0].valid_until = iso(50); assert.deepEqual(plan(d, { now: now + 51 * 60000 }), []); d.sources[0].retrieved_at = iso(1); assert.deepEqual(plan(d), []); });
test('unknown stop, duplicate trips, invalid coordinates and backwards times rejected', () => {
  for (const change of [d => d.trips[0].calls[0].stop_id = 'missing', d => d.trips.push(d.trips[0]), d => d.stops[0].lat = NaN, d => d.trips[0].calls[1].arrival = iso(1)]) { const d = fixture(); change(d); assert.throws(() => T.validate(d)); }
});
test('no boarding or alighting where prohibited', () => { const d = fixture(); d.trips[0].calls[0].pickup = false; assert.deepEqual(plan(d), []); });
test('freshness boundary, future telemetry, and expiry fail closed', () => {
  const d = fixture(); d.positions = [{ trip_id: 'one', source_id: 'test', observed_at: iso(-1.5), lat: 23, lon: 86 }]; T.validate(d);
  assert.equal(T.position(d, 'one', now).status, 'live'); assert.equal(T.position(d, 'one', now + 1).status, 'stale');
  d.positions[0].observed_at = iso(1); assert.equal(T.position(d, 'one', now).status, 'stale'); assert.equal(T.position(d, 'two', now).status, 'unavailable');
});
test('empty production network validates without invented routes', () => { const d = require('../places/transit/network.json'); T.validate(d); assert.deepEqual(plan(d), []); });
test('overnight calls use absolute instants and ignore device timezone', () => { const d = fixture(); const shift = 14 * 3600000; d.trips.forEach(t => t.calls.forEach(c => { c.arrival = new Date(Date.parse(c.arrival) + shift).toISOString(); c.departure = c.arrival; })); assert.equal(plan(d, { at: new Date(now + shift).toISOString() }).length, 1); });
test('estimated timing sources never produce exact departure or transfer recommendations', () => { const d = fixture(); d.sources[0].timing_quality = 'estimated'; assert.deepEqual(plan(d), []); });
test('Delhi OTD source cannot be mislabeled as a published exact timetable', () => { const d = fixture(); d.sources[0].url = 'https://otd.delhi.gov.in/data/static/'; assert.throws(() => T.validate(d)); d.sources[0].timing_quality = 'estimated'; T.validate(d); assert.deepEqual(plan(d), []); });
