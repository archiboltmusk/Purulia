// Browser estimates of the route to Cloudflare; no claim of server attestation.
export const ENDPOINT = 'https://speed.cloudflare.com';
export const RESULT_TTL_MS = 5 * 60 * 1000;
export const median = values => {
  const a = [...values].sort((a, b) => a - b), i = Math.floor(a.length / 2);
  return a.length % 2 ? a[i] : (a[i - 1] + a[i]) / 2;
};
export function speedColour(value) {
  return !Number.isFinite(value) ? '#8893a0' : value < 10 ? '#df554b' : value < 50 ? '#e9b44c' : '#36ba84';
}
export function randomPayload(size) {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i += 65536) crypto.getRandomValues(bytes.subarray(i, Math.min(i + 65536, size)));
  return bytes;
}
export function shareable(result, kind, now = Date.now()) {
  return !!result && result.connection_type === kind && now >= result.measured_at && now - result.measured_at < RESULT_TTL_MS;
}
export async function transfer(direction, size, { signal, fetchImpl = fetch, now = () => performance.now(), timeout = 20000 } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  // Random generation is outside the timed interval, and covers the entire upload.
  const payload = direction === 'up' ? randomPayload(size) : undefined;
  const timer = setTimeout(abort, timeout), start = now();
  try {
    const response = await fetchImpl(`${ENDPOINT}/__${direction}?bytes=${direction === 'down' ? size : 0}&r=${crypto.randomUUID()}`, {
      method: direction === 'up' ? 'POST' : 'GET', body: payload,
      signal: controller.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer'
    });
    if (!response.ok || response.type === 'opaque') throw Error('Test server unavailable');
    // Keep the timeout active until the body finishes, not just until headers arrive.
    const body = await response.arrayBuffer();
    const ms = now() - start;
    if (direction === 'down' && body.byteLength !== size) throw Error('Incomplete download');
    if (!Number.isFinite(ms) || ms <= 0) throw Error('Invalid transfer timing');
    return { bytes: size, ms, mbps: size * 8 / ms / 1000 };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
export async function measure(kind, { signal, progress = () => {}, io = transfer, clock = Date.now } = {}) {
  if (!['mobile', 'fixed'].includes(kind)) throw Error('Choose a connection type');
  progress('Warming up the connection…');
  await io('down', 1000, { signal });
  const latency = [];
  progress('Measuring HTTP round-trip latency…');
  for (let i = 0; i < 5; i++) latency.push((await io('down', 0, { signal })).ms);
  const estimates = {};
  for (const direction of ['down', 'up']) {
    progress(direction === 'down' ? 'Measuring download…' : 'Measuring upload…');
    const sizes = direction === 'down' ? [1000000, 5000000, 20000000] : [250000, 1000000, 5000000];
    let sample, size;
    for (size of sizes) {
      sample = await io(direction, size, { signal });
      if (sample.ms >= 500) break;
    }
    const samples = [sample];
    for (let i = 0; i < 2; i++) samples.push(await io(direction, size, { signal }));
    if (samples.some(s => s.ms < 100 || !Number.isFinite(s.mbps) || s.mbps < 0.01 || s.mbps > 10000)) {
      throw Error('Transfers were too short or outside the supported range for a reliable estimate');
    }
    estimates[direction] = +median(samples.map(s => s.mbps)).toFixed(2);
  }
  if (signal?.aborted) throw Error('Test interrupted');
  return { download_mbps: estimates.down, upload_mbps: estimates.up, latency_ms: Math.round(median(latency)), connection_type: kind, measured_at: clock() };
}
export function colourRegions(boundaries, rows, kind) {
  const lookup = new Map(rows.filter(r => r.connection_type === kind).map(r => [r.region, r]));
  return { type: 'FeatureCollection', features: boundaries.features.map(f => {
    const row = lookup.get(f.properties.slug);
    return { ...f, properties: { ...f.properties, ...(row || {}), colour: speedColour(row ? Number(row.download_mbps) : NaN) } };
  }) };
}
