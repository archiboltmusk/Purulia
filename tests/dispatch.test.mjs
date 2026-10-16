// Tests for tools/dispatch/dispatch.mjs (offline prototype, synthetic data only).
//   node tests/dispatch.test.mjs
import assert from 'node:assert/strict';
import {
  haversineM, dbscan, dedupe, splitByCapacity, buildRuns, routeRun, scoreWorker, assignRuns, plan, synthetic, WEIGHTS,
} from '../tools/dispatch/dispatch.mjs';

const NOW = Date.parse('2026-10-16T12:00:00Z');
const at = (lat, lng, extra = {}) => ({ lat, lng, ...extra });
const pt = (id, lat, lng, volumeKg = 100, extra = {}) => ({
  id, lat, lng, volumeKg, ward: 'W1', createdAt: new Date(NOW - 3600000).toISOString(), machine: 'mini_tipper', ...extra,
});

// Haversine: 0.01 degree latitude is about 1112 m.
assert.ok(Math.abs(haversineM(at(23, 86), at(23.01, 86)) - 1112) < 3);
assert.equal(haversineM(at(23, 86), at(23, 86)), 0);

// DBSCAN: two tight groups 3 km apart plus one far outlier.
{
  const pts = [
    at(23.000, 86.000), at(23.002, 86.000), at(23.001, 86.002),
    at(23.030, 86.030), at(23.031, 86.030),
    at(23.100, 86.100),
  ];
  const labels = dbscan(pts, 800, 2);
  assert.equal(labels[0], labels[1]);
  assert.equal(labels[0], labels[2]);
  assert.equal(labels[3], labels[4]);
  assert.notEqual(labels[0], labels[3]);
  assert.equal(labels[5], -1);
}

// Dedupe: 30 m and 12 h. Same spot within window -> child. Same spot after 12 h -> new master. 50 m away -> new master.
{
  const base = at(23.0, 86.0);
  const r = (id, dLat, hoursAgo) => ({ id, lat: base.lat + dLat, lng: base.lng, createdAt: new Date(NOW - hoursAgo * 3600000).toISOString() });
  const out = dedupe([
    r('a', 0, 10),
    r('b', 0.0001, 9),       // ~11 m, inside window -> child of a
    r('c', 0.0005, 8),       // ~55 m -> master
    r('d', 0, 1),            // same spot as a, 1 h later -> child of a
    r('e', 0, 30),           // same spot 30 h ago vs a... ordered after, but earlier than window of a? -> master (outside 12 h)
  ]);
  assert.deepEqual(out.children, [{ id: 'b', masterId: 'a' }, { id: 'd', masterId: 'a' }]);
  assert.deepEqual(out.masters.map((m) => m.id), ['a', 'c', 'e']);
}

// splitByCapacity: every stop once, no run over capacity, no stop lost.
{
  const members = Array.from({ length: 12 }, (_, i) => pt(`p${i}`, 23 + i * 0.0005, 86, 150 + i * 10));
  const runs = splitByCapacity(members, 500);
  const ids = runs.flat().map((p) => p.id).sort();
  assert.deepEqual(ids, members.map((p) => p.id).sort());
  for (const run of runs) assert.ok(run.reduce((s, p) => s + p.volumeKg, 0) <= 500);
}

// buildRuns: never crosses wards; noise becomes solo runs.
{
  const pickups = [
    pt('a1', 23.000, 86.000, 50, { ward: 'W1' }),
    pt('a2', 23.001, 86.000, 50, { ward: 'W1' }),
    pt('b1', 23.0005, 86.0005, 50, { ward: 'W2' }), // same spot, other ward
    pt('n1', 23.100, 86.100, 50, { ward: 'W1' }),   // noise
  ];
  const runs = buildRuns(pickups, { now: NOW });
  for (const run of runs) {
    const wards = new Set(run.stops.map((s) => s.ward));
    assert.equal(wards.size, 1);
  }
  const solo = runs.filter((r) => r.solo);
  // b1 is alone in W2 (other ward cannot join W1's cluster), so it is solo too.
  assert.deepEqual(solo.map((r) => r.stops[0].id).sort(), ['b1', 'n1']);
  assert.ok(runs.every((r) => r.machine === 'mini_tipper'));
}

// routeRun: all stops once; 2-opt result no longer than nearest-neighbour order.
{
  const start = at(23.0, 86.0);
  const end = at(23.05, 86.05);
  const stops = [pt('s1', 23.01, 86.00), pt('s2', 23.00, 86.02), pt('s3', 23.02, 86.03), pt('s4', 23.03, 86.01)];
  const r = routeRun(start, stops, end);
  assert.deepEqual(r.order.map((s) => s.id).sort(), ['s1', 's2', 's3', 's4']);
  const nn = [];
  let last = start;
  const left = [...stops];
  while (left.length) {
    left.sort((a, b) => haversineM(last, a) - haversineM(last, b));
    last = left.shift();
    nn.push(last);
  }
  const len = (seq) => [start, ...seq, end].reduce((s, p, i, arr) => (i ? s + haversineM(arr[i - 1], p) : 0), 0);
  assert.ok(len(r.order) <= len(nn) + 1e-6);
  assert.ok(Math.abs(r.km * 1000 - len(r.order)) < 1);
}

// scoreWorker: nearer and better-fitting vehicle scores lower.
{
  const run = { centroid: at(23, 86), oldestHours: 10, volumeKg: 400 };
  const near = { position: at(23.001, 86), capacityKg: 600, backlogKg: 0 };
  const far = { position: at(23.04, 86), capacityKg: 600, backlogKg: 0 };
  assert.ok(scoreWorker(near, run) < scoreWorker(far, run));
  const huge = { position: at(23.001, 86), capacityKg: 3000, backlogKg: 0 };
  assert.ok(scoreWorker(near, run) < scoreWorker(huge, run));
  assert.equal(Object.values(WEIGHTS).reduce((a, b) => a + b, 0).toFixed(2), '1.00');
}

// assignRuns: gates. Untriaged -> needs_triage; wrong type skipped; deadhead vehicle skipped; capacity respected.
{
  const w1 = { id: 'W-a', type: 'mini_tipper', position: at(23, 86), capacityKg: 500, backlogKg: 0, availableAt: 0 };
  const w2 = { id: 'W-b', type: 'manual_loader', position: at(23, 86), capacityKg: 500, backlogKg: 0, availableAt: 0 };
  const w3 = { id: 'W-c', type: 'mini_tipper', position: at(23, 86), capacityKg: 500, backlogKg: 0, availableAt: NOW + 3600000 };
  const runs = [
    { id: 'r-untriaged', centroid: at(23, 86), oldestHours: 5, volumeKg: 100, machine: null },
    { id: 'r-1', centroid: at(23, 86), oldestHours: 5, volumeKg: 300, machine: 'mini_tipper' },
    { id: 'r-2', centroid: at(23, 86), oldestHours: 4, volumeKg: 300, machine: 'mini_tipper' },
    { id: 'r-3', centroid: at(23, 86), oldestHours: 3, volumeKg: 300, machine: 'manual_loader' },
  ];
  const out = assignRuns(runs, [w1, w2, w3], { now: NOW });
  const byRun = Object.fromEntries(out.assigned.map((a) => [a.run.id, a.worker]));
  assert.equal(byRun['r-1'], 'W-a');
  assert.equal(byRun['r-3'], 'W-b');
  assert.equal(byRun['r-2'], undefined); // W-a full (300 + 300 > 500), W-c on deadhead
  assert.deepEqual(out.unassigned.map((u) => [u.run.id, u.reason]), [['r-untriaged', 'needs_triage'], ['r-2', 'no_free_vehicle']]);
}

// plan: on synthetic data every pickup is in exactly one run, every route covers its run, deterministic.
{
  const d = synthetic({ seed: 7, pickups: 60, workers: 5 });
  const a = plan(d.pickups, d.workers, d.transferSite, { now: d.now });
  const b = plan(synthetic({ seed: 7, pickups: 60, workers: 5 }).pickups, synthetic({ seed: 7, pickups: 60, workers: 5 }).workers, d.transferSite, { now: d.now });
  assert.deepEqual(a, b);
  const assignedStops = a.routes.flatMap((r) => r.stopIds);
  assert.equal(new Set(assignedStops).size, assignedStops.length);
  for (const r of a.routes) assert.ok(r.volumeKg <= d.workers.find((w) => w.id === r.worker).capacityKg);
  const perWorker = new Map();
  for (const r of a.routes) perWorker.set(r.worker, (perWorker.get(r.worker) ?? 0) + 1);
  for (const [, n] of perWorker) assert.ok(n >= 1);
}

console.log('dispatch tests passed');
