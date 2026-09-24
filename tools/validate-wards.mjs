// Checks a ward-boundary GeoJSON before it replaces purulia_wards.geojson.
//
//   node tools/validate-wards.mjs path/to/official_wards.geojson
//
// The Kasa page uses these polygons to pick a report's ward automatically, so
// a wrong boundary sends a report (and its accountability) to the wrong
// councillor. Use boundaries published by Purulia Municipality or the West
// Bengal State Election Commission for the current delimitation.

import fs from 'node:fs';

const WARDS = 23;
const BOX = { minLat: 23.20, maxLat: 23.46, minLng: 86.22, maxLng: 86.52 }; // Purulia town, as in the database rules
const file = process.argv[2] || 'purulia_wards.geojson';
const problems = [];
const notes = [];

const gj = JSON.parse(fs.readFileSync(file, 'utf8'));
const features = gj.type === 'FeatureCollection' ? gj.features : [];
if (!features.length) problems.push('Not a FeatureCollection with features.');

const wardOf = (f) => {
  const p = f.properties || {};
  const raw = p.ward ?? p.ward_no ?? p.WARD ?? p.Ward;
  const n = parseInt(String(raw ?? '').replace(/\D/g, ''), 10);
  return Number.isFinite(n) ? n : null;
};

const rings = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);
const ringArea = (r) => {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
  return a / 2;
};
const inRing = ([x, y], r) => {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const inGeom = (pt, g) => rings(g).some((poly) => inRing(pt, poly[0]) && !poly.slice(1).some((h) => inRing(pt, h)));

const seen = new Map();
let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
for (const [i, f] of features.entries()) {
  const n = wardOf(f);
  if (!n) { problems.push(`Feature ${i} has no ward number (expected a "ward" property).`); continue; }
  if (n < 1 || n > WARDS) problems.push(`Feature ${i} has ward ${n}, outside 1–${WARDS}.`);
  if (seen.has(n)) problems.push(`Ward ${n} appears more than once (features ${seen.get(n)} and ${i}).`);
  seen.set(n, i);
  if (!f.geometry || !['Polygon', 'MultiPolygon'].includes(f.geometry.type)) { problems.push(`Ward ${n}: geometry must be a Polygon or MultiPolygon.`); continue; }
  for (const poly of rings(f.geometry)) {
    for (const r of poly) {
      if (r.length < 4) problems.push(`Ward ${n}: a ring has fewer than 4 points.`);
      const [a, b] = [r[0], r[r.length - 1]];
      if (a[0] !== b[0] || a[1] !== b[1]) problems.push(`Ward ${n}: a ring is not closed.`);
      for (const [lng, lat] of r) {
        minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat); minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng);
        if (lat < BOX.minLat || lat > BOX.maxLat || lng < BOX.minLng || lng > BOX.maxLng) {
          problems.push(`Ward ${n}: point ${lat},${lng} is outside the Purulia town area (are coordinates [lng, lat]?).`);
          break;
        }
      }
    }
    const m2 = Math.abs(ringArea(poly[0])) * 111320 * 111320 * Math.cos((23.33 * Math.PI) / 180);
    if (m2 < 1) problems.push(`Ward ${n}: a polygon has zero area.`);
    else if (m2 < 500) notes.push(`Ward ${n}: tiny ${Math.round(m2)} m² sliver polygon (probably a tracing artefact; harmless).`);
  }
}
const missing = Array.from({ length: WARDS }, (_, i) => i + 1).filter((n) => !seen.has(n));
if (missing.length) problems.push(`Missing ward(s): ${missing.join(', ')}.`);

// Overlaps and gaps, sampled on a ~100 m grid across the covered area.
if (features.length) {
  let overlaps = 0, samples = 0;
  const overlapPairs = new Set();
  for (let lat = minLat; lat <= maxLat; lat += 0.0009) {
    for (let lng = minLng; lng <= maxLng; lng += 0.00098) {
      const hits = features.filter((f) => f.geometry && inGeom([lng, lat], f.geometry)).map(wardOf);
      if (hits.length) samples++;
      if (hits.length > 1) { overlaps++; overlapPairs.add(hits.sort((a, b) => a - b).join('+')); }
    }
  }
  if (overlaps) problems.push(`${overlaps} sample points (~100 m apart) fall in more than one ward: ${[...overlapPairs].slice(0, 10).join(', ')}.`);
  notes.push(`${samples} sample points inside wards; bounding box ${minLat.toFixed(4)}–${maxLat.toFixed(4)} N, ${minLng.toFixed(4)}–${maxLng.toFixed(4)} E.`);
}

console.log(`${file}: ${features.length} features, wards found: ${[...seen.keys()].sort((a, b) => a - b).join(', ') || 'none'}`);
for (const n of notes) console.log('  ' + n);
if (problems.length) {
  console.log(`\n${problems.length} problem(s):`);
  for (const p of problems) console.log('  ✗ ' + p);
  process.exit(1);
}
console.log('\n✓ Looks consistent. Still compare it against the official map before publishing.');
