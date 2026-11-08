import { test } from 'node:test';
import assert from 'node:assert/strict';
import Bindings from 'gtfs-realtime-bindings';
import Protobuf from 'protobufjs/minimal.js';
import { createDelhiHandler, decodePositions } from '../server/delhi-otd.mjs';
import Transit from '../transit-core.js';
import delhiFunction from '../api/transit/delhi.js';
const Feed = Bindings.transit_realtime.FeedMessage;
const now = Date.parse('2026-11-08T18:00:00+05:30'), seconds = now / 1000;
const key = 'synthetic-secret-not-a-real-key';
const req = () => new Request('https://example.org/api/transit/delhi');
function fixture() { return { header: { gtfsRealtimeVersion: '2.0', timestamp: seconds, incrementality: 0 }, entity: [{ id: 'one', vehicle: { vehicle: { id: 'test-bus' }, trip: { tripId: 'trip-a', routeId: 'route-a', startDate: '20261108' }, position: { latitude: 28.6, longitude: 77.2 }, timestamp: seconds - 10 } }] }; }
const encode = f => Feed.encode(Feed.fromObject(f)).finish();
const response = f => new Response(encode(f), { headers: { 'Content-Type': 'application/x-protobuf' } });
const adapter = fetchImpl => createDelhiHandler({ fetchImpl, clock: () => now });

test('decodes actual protobuf bytes, preserves observation timestamp and dated identity', () => {
  const data = decodePositions(encode(fixture()), now);
  assert.equal(data.positions[0].trip_id, 'delhi-otd:trip-a:20261108');
  assert.equal(data.positions[0].observed_at, new Date(now - 10000).toISOString());
  assert.equal(Transit.liveVehicles(data, now).length, 1);
});
test('missing key makes zero upstream calls', async () => {
  const handle = adapter(() => { throw new Error('Must not fetch'); });
  const r = await handle(req(), {}); assert.equal(r.status, 503); assert.equal((await r.json()).status, 'not_configured');
});
test('fixed HTTPS host, key encoded only upstream, redirects forbidden, public output sanitized', async () => {
  let calls = 0;
  const handle = adapter(async (url, options) => { calls++; assert.equal(url.origin, 'https://otd.delhi.gov.in'); assert.equal(url.pathname, '/api/realtime/VehiclePositions.pb'); assert.equal(url.searchParams.get('key'), key); assert.equal(options.redirect, 'error'); return response(fixture()); });
  const r = await handle(req(), { DELHI_OTD_API_KEY: key });
  assert.equal(r.status, 200); assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.ok(!(await r.text()).includes(key)); await handle(req(), { DELHI_OTD_API_KEY: key }); assert.equal(calls, 1);
});
test('auth/rate-limit/bad gateway never echo provider body or key', async () => {
  for (const [code, expected] of [[403, 'access_denied'], [429, 'rate_limited'], [500, 'upstream_unavailable']]) {
    let calls = 0;
    const handle = adapter(async () => { calls++; return new Response('SECRET ' + key, { status: code }); });
    const r = await handle(req(), { DELHI_OTD_API_KEY: key }); const body = await r.text();
    assert.ok(!body.includes(key)); assert.equal(JSON.parse(body).status, expected);
    await handle(req(), { DELHI_OTD_API_KEY: key }); assert.equal(calls, 1);
  }
});
test('network exception URL never leaks', async () => {
  const r = await adapter(async () => { throw new Error('https://otd.delhi.gov.in/?key=' + key); })(req(), { DELHI_OTD_API_KEY: key });
  assert.ok(!(await r.text()).includes(key));
});
test('stale/future feed timestamps and differential feeds rejected', () => {
  for (const change of [f => f.header.timestamp = seconds - 91, f => f.header.timestamp = seconds + 1, f => delete f.header.timestamp, f => f.header.incrementality = 1]) {
    const f = fixture(); change(f); assert.throws(() => decodePositions(encode(f), now));
  }
});
test('missing coordinates/timestamp/id, stale/future observations, canceled trips, null island excluded', () => {
  for (const change of [v => delete v.timestamp, v => v.timestamp = seconds - 91, v => v.timestamp = seconds + 1, v => v.position.latitude = 91, v => v.position = { latitude: 0, longitude: 0 }, v => delete v.vehicle.id, v => v.trip.scheduleRelationship = 3]) {
    const f = fixture(); change(f.entity[0].vehicle); assert.equal(decodePositions(encode(f), now).positions.length, 0, change.toString());
  }
});
test('malformed protobuf with a missing required coordinate is rejected', () => {
  // The generated encoder always writes required coordinate fields, so build this malformed wire fixture explicitly.
  const header = Bindings.transit_realtime.FeedHeader.encode(Bindings.transit_realtime.FeedHeader.fromObject(fixture().header)).finish();
  const bytes = Protobuf.Writer.create().uint32(10).bytes(header).uint32(18).fork().uint32(10).string('one').uint32(34).fork().uint32(18).fork().uint32(21).float(77.2).ldelim().ldelim().ldelim().finish();
  assert.throws(() => decodePositions(bytes, now));
});
test('never substitutes observation day for missing/invalid service date', () => {
  for (const value of [undefined, '20261301', '20260230']) {
    const f = fixture(); f.entity[0].vehicle.trip.startDate = value;
    const p = decodePositions(encode(f), now).positions[0]; assert.equal(p.trip_id, null); assert.equal(p.service_date, null);
  }
});
test('duplicates and deleted entities cannot inflate the board', () => {
  const f = fixture(); f.entity.push(structuredClone(f.entity[0]), { id: 'removed', isDeleted: true });
  const d = decodePositions(encode(f), now); assert.equal(d.positions.length, 1); assert.equal(d.rejected.duplicate, 1); assert.equal(d.rejected.deleted, 1);
});
test('malformed protobuf and oversized body return safe errors', async () => {
  for (const make of [() => new Response('not protobuf'), () => new Response('x', { headers: { 'Content-Length': String(9 * 1024 * 1024) } }), () => new Response(new Uint8Array(9 * 1024 * 1024))]) {
    const r = await adapter(async () => make())(req(), { DELHI_OTD_API_KEY: key }); assert.equal(r.status, 503); assert.deepEqual((await r.json()).positions, []);
  }
});
test('coalesces concurrent calls without publishing a stale cached observation', async () => {
  let time = now, calls = 0;
  const f = fixture(); f.entity[0].vehicle.timestamp = seconds - 85;
  const handle = createDelhiHandler({ clock: () => time, fetchImpl: async () => { calls++; return response(f); } });
  const rs = await Promise.all([handle(req(), { DELHI_OTD_API_KEY: key }), handle(req(), { DELHI_OTD_API_KEY: key })]);
  assert.equal(calls, 1); assert.equal((await rs[0].json()).positions.length, 1);
  time += 6000;
  assert.equal((await (await handle(req(), { DELHI_OTD_API_KEY: key })).json()).positions.length, 0);
  assert.equal(calls, 1);
});
test('browser drops stale observations/feed even if network refresh fails', () => {
  const data = decodePositions(encode(fixture()), now);
  assert.equal(Transit.liveVehicles(data, now + 80000).length, 1);
  assert.equal(Transit.liveVehicles(data, now + 80001).length, 0);
  assert.equal(Transit.liveVehicles(data, now + 90001).length, 0);
  assert.throws(() => Transit.liveVehicles({ ...data, source_id: 'other' }, now));
});
test('rejects methods and query keys before touching upstream', async () => {
  const handle = adapter(() => { throw new Error('Must not fetch'); });
  assert.equal((await handle(new Request(req().url, { method: 'POST' }), { DELHI_OTD_API_KEY: key })).status, 405);
  assert.equal((await handle(new Request(req().url + '?key=secret'), { DELHI_OTD_API_KEY: key })).status, 400);
});
test('Vercel entry point fails safely with no configured secret', async () => {
  const previous = process.env.DELHI_OTD_API_KEY; delete process.env.DELHI_OTD_API_KEY;
  const res = { headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(body) { this.body = JSON.parse(body); } };
  try { await delhiFunction({ method: 'GET', url: '/api/transit/delhi' }, res); assert.equal(res.statusCode, 503); assert.equal(res.body.status, 'not_configured'); }
  finally { if (previous !== undefined) process.env.DELHI_OTD_API_KEY = previous; }
});
test('timeout returns no cached positions', async () => {
  const handle = createDelhiHandler({ clock: () => now, timeoutMs: 5, fetchImpl: (_, options) => new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted ' + key)))) });
  const r = await handle(req(), { DELHI_OTD_API_KEY: key }); assert.equal(r.status, 503); assert.ok(!(await r.text()).includes(key));
});
