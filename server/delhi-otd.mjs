// Server-only. The private key is sent solely to the fixed, documented OTD host.
import Bindings from 'gtfs-realtime-bindings';

export const SOURCE_URL = 'https://otd.delhi.gov.in/documentation/';
const UPSTREAM = 'https://otd.delhi.gov.in/api/realtime/VehiclePositions.pb';
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_ENTITIES = 20000;
const MAX_AGE_MS = 90000;
const own = (x, k) => x != null && Object.prototype.hasOwnProperty.call(x, k);
const id = x => typeof x === 'string' && x.trim().length > 0 && x.length <= 200;
const epoch = value => {
  const n = Number(value?.toString());
  return Number.isSafeInteger(n) && n > 0 && n < 8640000000000 ? n * 1000 : NaN;
};
const fresh = (time, now) => Number.isFinite(time) && time <= now && now - time <= MAX_AGE_MS;
const date = value => {
  if (!/^\d{8}$/.test(value || '')) return null;
  const s = value.slice(0, 4) + '-' + value.slice(4, 6) + '-' + value.slice(6);
  const time = Date.parse(s + 'T00:00:00Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === s ? value : null;
};

export class FeedError extends Error {
  constructor(code) { super(code); this.code = code; }
}

export function decodePositions(bytes, now = Date.now()) {
  let feed;
  try { feed = Bindings.transit_realtime.FeedMessage.decode(bytes); }
  catch (_) { throw new FeedError('invalid_feed'); }
  if (!feed.header || !['1.0', '2.0'].includes(feed.header.gtfsRealtimeVersion) || feed.header.incrementality !== 0) throw new FeedError('unsupported_feed');
  if (!own(feed.header, 'timestamp') || !fresh(epoch(feed.header.timestamp), now)) throw new FeedError('stale_feed');
  if (feed.entity.length > MAX_ENTITIES) throw new FeedError('oversized_feed');
  const positions = [], rejected = { invalid: 0, stale: 0, duplicate: 0, deleted: 0 };
  const entities = new Set(), vehicles = new Set();
  for (const entity of feed.entity) {
    if (entity.isDeleted) { rejected.deleted++; continue; }
    const v = entity.vehicle;
    if (!id(entity.id) || !v || !v.position || !own(v.position, 'latitude') || !own(v.position, 'longitude') || !own(v, 'timestamp') || !id(v.vehicle?.id)) { rejected.invalid++; continue; }
    const { latitude: lat, longitude: lon } = v.position;
    const observed = epoch(v.timestamp);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180 || (lat === 0 && lon === 0)) { rejected.invalid++; continue; }
    // Do not substitute feed time or ingestion time for a vehicle observation time.
    if (!fresh(observed, now) || observed > epoch(feed.header.timestamp)) { rejected.stale++; continue; }
    // A canceled/replacement/unscheduled trip must not look like a scheduled service.
    if (v.trip && v.trip.scheduleRelationship !== 0) { rejected.invalid++; continue; }
    if (entities.has(entity.id) || vehicles.has(v.vehicle.id)) { rejected.duplicate++; continue; }
    entities.add(entity.id); vehicles.add(v.vehicle.id);
    const startDate = date(v.trip?.startDate);
    const nativeTripId = id(v.trip?.tripId) ? v.trip.tripId : null;
    positions.push({ vehicle_id: v.vehicle.id, route_id: id(v.trip?.routeId) ? v.trip.routeId : null, native_trip_id: nativeTripId, service_date: startDate,
      // Null is intentional: never guess a service date from the current calendar day.
      trip_id: nativeTripId && startDate ? 'delhi-otd:' + nativeTripId + ':' + startDate : null,
      observed_at: new Date(observed).toISOString(), lat, lon });
  }
  return { schema_version: 1, source_id: 'delhi-otd', source_url: SOURCE_URL, fetched_at: new Date(now).toISOString(), feed_observed_at: new Date(epoch(feed.header.timestamp)).toISOString(), positions, rejected };
}

async function readLimited(response) {
  if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new FeedError('oversized_feed');
  if (!response.body) throw new FeedError('invalid_feed');
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); throw new FeedError('oversized_feed'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const out = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
  return out;
}

const json = (data, status) => new Response(JSON.stringify(data), { status, headers: {
  'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
  'CDN-Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer'
} });
const failure = (code, status = 503) => json({ schema_version: 1, status: code, positions: [] }, status);

// A short per-instance cache/coalescer limits fan-out without retaining failed/stale feeds.
// This is not a global quota; configure a platform rate-limit rule before public rollout.
export function createDelhiHandler({ fetchImpl = fetch, clock = Date.now, timeoutMs = 10000 } = {}) {
  let cached = null, pending = null, lastKey = null, failureUntil = 0, failureCode = null;
  return async function handle(request, env = {}) {
    if (request.method !== 'GET') return failure('method_not_allowed', 405);
    if (new URL(request.url).search) return failure('unsupported_query', 400);
    const key = env.DELHI_OTD_API_KEY;
    if (typeof key !== 'string' || !key.trim()) return failure('not_configured');
    // Rotated credentials invalidate the instance cache; they never leave this closure.
    if (key !== lastKey) { cached = null; pending = null; lastKey = key; failureUntil = 0; failureCode = null; }
    const now = clock();
    if (now < failureUntil) return failure(failureCode);
    if (cached && now - cached.at < 15000 && now >= cached.at && fresh(Date.parse(cached.data.feed_observed_at), now)) {
      return json({ ...cached.data, positions: cached.data.positions.filter(p => fresh(Date.parse(p.observed_at), now)) }, 200);
    }
    if (!pending) {
      const activeKey = key;
      const task = (async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const url = new URL(UPSTREAM); url.searchParams.set('key', activeKey);
          const response = await fetchImpl(url, { redirect: 'error', signal: controller.signal, headers: { Accept: 'application/x-protobuf, application/octet-stream' }, cache: 'no-store' });
          // Never include response text, statusText, request URL, or exception messages in output/logs.
          if (response.status === 401 || response.status === 403) throw new FeedError('access_denied');
          if (response.status === 429) throw new FeedError('rate_limited');
          if (!response.ok) throw new FeedError('upstream_unavailable');
          const data = decodePositions(await readLimited(response), clock());
          if (lastKey === activeKey) cached = { at: clock(), data };
          return data;
        } catch (e) {
          if (e instanceof FeedError) throw e;
          throw new FeedError('upstream_unavailable');
        } finally { clearTimeout(timer); }
      })();
      pending = task;
      task.finally(() => { if (pending === task) pending = null; }).catch(() => {});
    }
    try {
      const data = await pending;
      const current = clock();
      if (!fresh(Date.parse(data.feed_observed_at), current)) return failure('stale_feed');
      return json({ ...data, positions: data.positions.filter(p => fresh(Date.parse(p.observed_at), current)) }, 200);
    } catch (e) {
      cached = null; failureCode = e instanceof FeedError ? e.code : 'upstream_unavailable';
      failureUntil = clock() + 30000; return failure(failureCode);
    }
  };
}
