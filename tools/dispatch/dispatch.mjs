// Offline prototype: cluster open pickups into runs, route each run, assign to a worker.
// Pure functions, no deps, no network, no site wiring. Synthetic data only (see synthetic()).
//   node tools/dispatch/dispatch.mjs            # prints a demo plan on synthetic data
//   node tests/dispatch.test.mjs                # tests

const EARTH_M = 6371000;
const toRad = (d) => (d * Math.PI) / 180;

export function haversineM(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

// DBSCAN over points {lat,lng}. Returns labels: cluster index >= 0, or -1 for noise.
// Brute-force neighbour search: fine for a ward (hundreds of points). Use a grid/H3 index before city-wide runs.
export function dbscan(points, epsM = 800, minPts = 2) {
  const n = points.length;
  const labels = new Array(n).fill(undefined);
  const neighbours = (i) => {
    const out = [];
    for (let j = 0; j < n; j++) if (haversineM(points[i], points[j]) <= epsM) out.push(j);
    return out;
  };
  let cluster = 0;
  for (let i = 0; i < n; i++) {
    if (labels[i] !== undefined) continue;
    const seed = neighbours(i);
    if (seed.length < minPts) { labels[i] = -1; continue; }
    labels[i] = cluster;
    const queue = seed.filter((j) => j !== i);
    while (queue.length) {
      const j = queue.shift();
      if (labels[j] === -1) labels[j] = cluster; // border point, reached from a core point
      if (labels[j] !== undefined) continue;
      labels[j] = cluster;
      const nb = neighbours(j);
      if (nb.length >= minPts) for (const k of nb) if (labels[k] === undefined || labels[k] === -1) queue.push(k);
    }
    cluster++;
  }
  return labels.map((l) => (l === undefined ? -1 : l));
}

// Pickups {id,lat,lng,volumeKg,createdAt,ward} -> runs. Clusters per ward (never across wards), then splits by capacity.
// Noise points become solo runs flagged `solo: true` (low priority, cart sweeper).
export function buildRuns(pickups, { epsM = 800, minPts = 2, capacityKg = 1000, now = Date.now() } = {}) {
  const byWard = new Map();
  for (const p of pickups) {
    if (!byWard.has(p.ward)) byWard.set(p.ward, []);
    byWard.get(p.ward).push(p);
  }
  const runs = [];
  for (const [ward, pts] of byWard) {
    const labels = dbscan(pts, epsM, minPts);
    const groups = new Map();
    pts.forEach((p, i) => {
      const key = labels[i] === -1 ? `solo:${p.id}` : `c:${labels[i]}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    });
    for (const [key, members] of groups) {
      for (const stops of splitByCapacity(members, capacityKg)) {
        runs.push(makeRun(ward, stops, key.startsWith('solo:'), now));
      }
    }
  }
  return runs.sort((a, b) => b.oldestHours - a.oldestHours || a.id.localeCompare(b.id));
}

// Greedy fill: take the stop nearest the group centroid first, then nearest-to-last, until the next stop would exceed capacity.
export function splitByCapacity(members, capacityKg) {
  const oversized = members.filter((m) => m.volumeKg > capacityKg);
  const rest = members.filter((m) => m.volumeKg <= capacityKg);
  const out = oversized.map((m) => [m]); // cannot fit any vehicle here: own run, flagged by makeRun
  const left = [...rest];
  const c = centroid(rest);
  while (left.length) {
    let last = c;
    const run = [];
    let load = 0;
    for (;;) {
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < left.length; i++) {
        if (load + left[i].volumeKg > capacityKg) continue;
        const d = haversineM(last, left[i]);
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best < 0) break;
      const [s] = left.splice(best, 1);
      run.push(s);
      load += s.volumeKg;
      last = s;
    }
    if (!run.length) break; // unreachable: every rest stop fits capacity alone
    out.push(run);
  }
  return out;
}

function centroid(pts) {
  if (!pts.length) return { lat: 0, lng: 0 };
  return {
    lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length,
    lng: pts.reduce((s, p) => s + p.lng, 0) / pts.length,
  };
}

function makeRun(ward, stops, solo, now) {
  const c = centroid(stops);
  const volumeKg = stops.reduce((s, p) => s + p.volumeKg, 0);
  const oldestHours = Math.max(...stops.map((p) => (now - Date.parse(p.createdAt)) / 3600000));
  const id = `${ward}:${stops.map((p) => p.id).sort()[0]}`;
  // Machine comes from the supervisor's triage on each stop; a run with mixed picks stays untriaged (null).
  const picks = new Set(stops.map((p) => p.machine));
  const machine = picks.size === 1 && stops[0].machine ? stops[0].machine : null;
  return { id, ward, stops, centroid: c, volumeKg, oldestHours, solo, machine };
}

// Spatial dedupe: a report within radiusM and windowH of an open master becomes its child, not a new pickup.
// reports: [{id,lat,lng,createdAt}] in arrival order. Returns { masters: [report], children: [{id, masterId}] }.
export function dedupe(reports, { radiusM = 30, windowH = 12 } = {}) {
  const masters = [];
  const children = [];
  for (const r of reports) {
    const t = Date.parse(r.createdAt);
    const m = masters.find((x) => Math.abs(Date.parse(x.createdAt) - t) <= windowH * 3600000 && haversineM(x, r) <= radiusM);
    if (m) children.push({ id: r.id, masterId: m.id });
    else masters.push(r);
  }
  return { masters, children };
}

// Open-path route: start -> all stops -> end (transfer site). Nearest neighbour, then 2-opt on the stop order.
export function routeRun(start, stops, end) {
  if (!stops.length) return { order: [], km: legKm(start, end) };
  const left = [...stops];
  const order = [];
  let last = start;
  while (left.length) {
    let bi = 0;
    for (let i = 1; i < left.length; i++) if (haversineM(last, left[i]) < haversineM(last, left[bi])) bi = i;
    last = left[bi];
    order.push(left.splice(bi, 1)[0]);
  }
  const pathKm = (seq) => {
    let km = legKm(start, seq[0]);
    for (let i = 1; i < seq.length; i++) km += legKm(seq[i - 1], seq[i]);
    return km + legKm(seq[seq.length - 1], end);
  };
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < order.length - 1; i++) {
      for (let k = i + 1; k < order.length; k++) {
        const cand = [...order.slice(0, i), ...order.slice(i, k + 1).reverse(), ...order.slice(k + 1)];
        if (pathKm(cand) + 1e-9 < pathKm(order)) { order.splice(0, order.length, ...cand); improved = true; }
      }
    }
  }
  return { order, km: pathKm(order) };
}

const legKm = (a, b) => haversineM(a, b) / 1000;

// Score a worker for a run; LOWER is better. Blueprint weights 0.35 distance, 0.30 age, 0.20 vehicle fit, 0.15 load.
// Each term is normalised to 0..1 so the weights mean something. Age is the same for every worker on one run,
// so it orders runs, not workers; it stays in the score so one function serves both uses.
export const WEIGHTS = { distance: 0.35, age: 0.3, vehicle: 0.2, load: 0.15 };
export function scoreWorker(worker, run, { maxKm = 5, maxAgeH = 72 } = {}) {
  const km = haversineM(worker.position, run.centroid) / 1000;
  const distance = Math.min(km, maxKm) / maxKm;
  const age = 1 - Math.min(run.oldestHours, maxAgeH) / maxAgeH; // older run -> lower cost
  // Vehicle fit: a run that barely fills the vehicle is ideal; a 5x oversized vehicle is wasteful.
  const ratio = worker.capacityKg / run.volumeKg;
  const vehicle = ratio < 1 ? 1 : Math.min(1, Math.max(0, (ratio - 1) / 4));
  const load = Math.min(1, worker.backlogKg / worker.capacityKg);
  return WEIGHTS.distance * distance + WEIGHTS.age * age + WEIGHTS.vehicle * vehicle + WEIGHTS.load * load;
}

// Greedy: runs in priority order (oldest first); each takes the lowest-score worker that has room.
// Returns { assigned: [{run, worker, score}], unassigned: [{run, reason}] }. A run is never split across workers here.
// Hard gates (not scores): run must be triaged (run.machine = supervisor's pick), vehicle type must match it,
// vehicle must be free (availableAt <= now: a full vehicle is at the dump site until then) and have room.
export function assignRuns(runs, workers, opts = {}) {
  const now = opts.now ?? Date.now();
  const left = new Map(workers.map((w) => [w.id, { ...w, backlogKg: w.backlogKg ?? 0 }]));
  const assigned = [];
  const unassigned = [];
  for (const run of runs) {
    if (!run.machine) { unassigned.push({ run, reason: 'needs_triage' }); continue; }
    let best = null;
    for (const w of left.values()) {
      if (w.type !== run.machine) continue;
      if ((w.availableAt ?? 0) > now) continue;
      if (w.backlogKg + run.volumeKg > w.capacityKg) continue;
      const score = scoreWorker(w, run, opts);
      if (!best || score < best.score || (score === best.score && w.id < best.worker.id)) best = { worker: w, score };
    }
    if (!best) { unassigned.push({ run, reason: 'no_free_vehicle' }); continue; }
    best.worker.backlogKg += run.volumeKg;
    assigned.push({ run, worker: best.worker.id, score: best.score });
  }
  return { assigned, unassigned };
}

// Full plan: runs -> assignment -> ordered route per assigned run.
export function plan(pickups, workers, transferSite, opts = {}) {
  const runs = buildRuns(pickups, opts);
  const { assigned, unassigned } = assignRuns(runs, workers, opts);
  const routes = assigned.map((a) => {
    const w = workers.find((x) => x.id === a.worker);
    const r = routeRun(w.position, a.run.stops, transferSite);
    return { runId: a.run.id, worker: a.worker, score: a.score, volumeKg: a.run.volumeKg, km: r.km, stopIds: r.order.map((s) => s.id) };
  });
  return { runs: runs.length, routes, unassigned: unassigned.map((u) => ({ runId: u.run.id, reason: u.reason })) };
}

// SYNTHETIC test data only. Seeded PRNG so output is repeatable. Never load into the live site.
export function synthetic({ seed = 1, pickups = 40, workers = 4, ward = 'SYN-W1' } = {}) {
  let s = seed >>> 0;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const base = { lat: 23.2, lng: 86.4 }; // arbitrary point near Purulia; synthetic, not a real site
  const now = Date.parse('2026-10-16T12:00:00Z');
  const hubs = Array.from({ length: 5 }, () => ({ lat: base.lat + (rnd() - 0.5) * 0.04, lng: base.lng + (rnd() - 0.5) * 0.04 }));
  const pts = Array.from({ length: pickups }, (_, i) => {
    const h = hubs[Math.floor(rnd() * hubs.length)];
    const noise = rnd() < 0.2; // some scattered single pickups
    return {
      id: `SYN-${String(i + 1).padStart(3, '0')}`,
      ward,
      lat: noise ? base.lat + (rnd() - 0.5) * 0.04 : h.lat + (rnd() - 0.5) * 0.004,
      lng: noise ? base.lng + (rnd() - 0.5) * 0.04 : h.lng + (rnd() - 0.5) * 0.004,
      volumeKg: 20 + Math.round(rnd() * 180),
      machine: 'mini_tipper', // stands in for the supervisor's triage pick
      createdAt: new Date(now - rnd() * 96 * 3600000).toISOString(),
    };
  });
  const crew = Array.from({ length: workers }, (_, i) => ({
    id: `SYN-W${i + 1}`,
    type: 'mini_tipper',
    position: { lat: base.lat + (rnd() - 0.5) * 0.03, lng: base.lng + (rnd() - 0.5) * 0.03 },
    capacityKg: i % 2 ? 1200 : 600,
    backlogKg: 0,
    availableAt: 0,
  }));
  return { pickups: pts, workers: crew, transferSite: { lat: base.lat - 0.02, lng: base.lng + 0.02 }, now };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const d = synthetic();
  const out = plan(d.pickups, d.workers, d.transferSite, { now: d.now });
  console.log('SYNTHETIC DATA. Not real reports.');
  console.log(JSON.stringify(out, null, 2));
}
