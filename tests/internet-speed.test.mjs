import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measure, transfer, shareable, median, speedColour, colourRegions, randomPayload } from '../internet-speed-core.mjs';
test('median, exact threshold colours, and freshness', () => {
  assert.equal(median([7, 1, 3]), 3); assert.equal(median([7, 1]), 4);
  assert.equal(speedColour(9.99), '#df554b'); assert.equal(speedColour(10), '#e9b44c');
  assert.equal(speedColour(50), '#36ba84'); assert.equal(speedColour(NaN), '#8893a0');
  const r = { connection_type: 'mobile', measured_at: 1000 };
  assert.ok(shareable(r, 'mobile', 2000)); assert.ok(!shareable(r, 'fixed', 2000));
  assert.ok(!shareable(r, 'mobile', 301000)); assert.ok(!shareable(r, 'mobile', 999));
});
test('all upload blocks contain random bytes, including final block', () => {
  const p = randomPayload(150001);
  assert.ok(p.subarray(65536, 131072).some(v => v !== 0));
  assert.ok(p.subarray(131072).some(v => v !== 0));
});
test('timing includes response body; incomplete payload is rejected', async () => {
  let time = 0;
  const r = await transfer('down', 10, { now: () => time, fetchImpl: async () => {
    time = 10; return { ok: true, arrayBuffer: async () => { time = 1000; return new ArrayBuffer(10); } };
  } });
  assert.equal(r.ms, 1000); assert.equal(r.bytes, 10);
  await assert.rejects(transfer('down', 10, { fetchImpl: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(9) }) }), /Incomplete/);
});
test('timeout remains active after headers, while body stalls', async () => {
  await assert.rejects(transfer('down', 10, { timeout: 10, fetchImpl: async (_url, opts) => ({ ok: true,
    arrayBuffer: () => new Promise((_resolve, reject) => opts.signal.addEventListener('abort', () => reject(Error('body aborted'))))
  }) }), /body aborted/);
});
test('measurement uses warmup, five latency probes, adaptive sizes and median transfers', async () => {
  const calls = [], counts = {};
  const r = await measure('fixed', { clock: () => 42, io: async (dir, bytes) => {
    calls.push([dir, bytes]); const key = dir + ':' + bytes; counts[key] = (counts[key] || 0) + 1;
    const ms = bytes === 0 ? [90, 20, 30, 40, 80][counts[key] - 1] : bytes < 5000000 ? 200 : 600;
    return { bytes, ms, mbps: bytes * 8 / ms / 1000 };
  } });
  assert.equal(calls[0][1], 1000); assert.equal(counts['down:0'], 5);
  assert.equal(counts['down:5000000'], 3); assert.equal(counts['up:5000000'], 3);
  assert.equal(r.latency_ms, 40); assert.equal(r.connection_type, 'fixed'); assert.equal(r.measured_at, 42);
});
test('short or failed measurements cannot produce shareable values', async () => {
  await assert.rejects(measure('mobile', { io: async (_d, bytes) => ({ ms: 50, mbps: bytes * 8 / 50 / 1000 }) }), /too short/);
  await assert.rejects(measure('mobile', { io: async () => { throw Error('Network failed'); } }), /Network failed/);
});
test('choropleth keeps missing regions grey and separates mobile/fixed', () => {
  const g = { features: ['a', 'b'].map(slug => ({ properties: { slug }, geometry: { type: 'Polygon', coordinates: [] } })) };
  const data = [{ region: 'a', connection_type: 'mobile', download_mbps: 52, contributors: 5 }, { region: 'b', connection_type: 'fixed', download_mbps: 1, contributors: 5 }];
  const out = colourRegions(g, data, 'mobile');
  assert.equal(out.features[0].properties.colour, '#36ba84'); assert.equal(out.features[1].properties.colour, '#8893a0');
  assert.equal(g.features[0].properties.colour, undefined);
});
