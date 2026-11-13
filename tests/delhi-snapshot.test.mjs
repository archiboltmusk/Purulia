import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Bindings from 'gtfs-realtime-bindings';
import { collectSnapshot, writeSnapshot } from '../tools/transit/publish-snapshot.mjs';
import Transit from '../transit-core.js';
const now = Date.parse('2026-11-08T12:30:00Z'), key = 'SYNTHETIC_SECRET';
const fixture = () => Bindings.transit_realtime.FeedMessage.encode(Bindings.transit_realtime.FeedMessage.fromObject({ header: { gtfsRealtimeVersion: '2.0', timestamp: now / 1000 }, entity: [{ id: 'one', vehicle: { timestamp: now / 1000 - 10, vehicle: { id: 'bus-a' }, trip: { routeId: 'r' }, position: { latitude: 28.6, longitude: 77.2 } } }] })).finish();
const options = () => ({ env: { DELHI_OTD_API_KEY: key }, clock: () => now, fetchImpl: async () => new Response(fixture()) });
test('collector publishes sanitised snapshot with independent observation and generation times', async () => {
 const s = await collectSnapshot(options()); assert.equal(s.status, 'ok'); assert.equal(s.delivery, 'github-pages-snapshot'); assert.notEqual(s.positions[0].observed_at, s.generated_at); assert.ok(!JSON.stringify(s).includes(key));
 assert.equal(Transit.snapshotVehicles(s, now + 5 * 60000).length, 1); assert.equal(Transit.liveVehicles(s, now + 5 * 60000).length, 0);
 assert.equal(Transit.snapshotVehicles(s, now + 15 * 60000 - 10000).length, 1); assert.equal(Transit.snapshotVehicles(s, now + 15 * 60000 - 9999).length, 0);
});
test('missing secret and upstream failures publish empty snapshots, not stale fallbacks', async () => {
 const missing = await collectSnapshot({ ...options(), env: {} }); assert.equal(missing.status, 'not_configured'); assert.deepEqual(Transit.snapshotVehicles(missing, now), []);
 const failed = await collectSnapshot({ ...options(), fetchImpl: async () => new Response(key, { status: 403 }) }); assert.equal(failed.status, 'access_denied'); assert.equal(failed.positions.length, 0); assert.ok(!JSON.stringify(failed).includes(key));
});
test('output is atomic and no credential appears in the public JSON', async () => {
 const dir = await mkdtemp(join(tmpdir(), 'transit-'));
 try { const path = join(dir, 'delhi.json'); await writeSnapshot(path, options()); const text = await readFile(path, 'utf8'); assert.ok(!text.includes(key)); assert.equal(JSON.parse(text).status, 'ok'); await assert.rejects(readFile(path + '.tmp')); }
 finally { await rm(dir, { recursive: true, force: true }); }
});
test('malformed and failed snapshots cannot smuggle positions into the board', async () => {
 const s = await collectSnapshot(options()); assert.throws(() => Transit.snapshotVehicles({ ...s, status: 'access_denied' }, now)); assert.throws(() => Transit.snapshotVehicles({ ...s, delivery: 'other' }, now));
 assert.deepEqual(Transit.snapshotVehicles({ ...s, generated_at: new Date(now + 1).toISOString() }, now), []);
});
test('project-relative snapshot URL works under the GitHub Pages repository path', async () => {
 const text = await readFile(new URL('../delhi-live.js', import.meta.url), 'utf8');
 assert.ok(text.includes("fetch('places/transit/delhi.json'")); assert.ok(!text.includes("fetch('/api/"));
 assert.equal(new URL('places/transit/delhi.json', 'https://archiboltmusk.github.io/Purulia/travel.html').pathname, '/Purulia/places/transit/delhi.json');
});
