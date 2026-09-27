import { test as base, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const modules = path.join(here, 'node_modules');
const SUPABASE = 'https://cnmikcyvyamplbldiivp.supabase.co';

const iso = (hoursAgo) => new Date(Date.now() - hoursAgo * 3600000).toISOString();

// Three reports near the town centre: one open, one with a clean-up claim waiting for
// confirmations, one recently resolved (drives the "✓ n fixed" chip next to the count pill).
export const REPORTS = [
  { id: 101, created_at: iso(30), lat: 23.3320, lng: 86.3654, ward_no: 5, category: 'garbage', severity: 'severe',
    status: 'open', description: 'Garbage pile near the bus stand', landmark: 'Bus stand', upvotes: 4, sla_days: 7 },
  { id: 102, created_at: iso(80), lat: 23.3322, lng: 86.3656, ward_no: 5, category: 'garbage', severity: 'minor',
    status: 'pending_verification', description: 'Overflowing bin', landmark: 'Station road', upvotes: 2, sla_days: 7,
    claim_id: 9001, claim_created_at: iso(3), claim_verify_count: 1, claim_dispute_count: 0, claim_distance_m: 12 },
  { id: 103, created_at: iso(200), lat: 23.3400, lng: 86.3700, ward_no: 7, category: 'garbage', severity: 'minor',
    status: 'resolved', description: 'Dumped waste', landmark: 'Market', upvotes: 6, sla_days: 7,
    resolved_at: iso(20), resolution_method: 'community' }
];

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const USER = { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated',
  is_anonymous: true, app_metadata: {}, user_metadata: {}, created_at: iso(0) };
const ACCESS_TOKEN = [b64url({ alg: 'HS256', typ: 'JWT' }),
  b64url({ sub: USER.id, role: 'authenticated', aud: 'authenticated', is_anonymous: true, exp: Math.floor(Date.now() / 1000) + 3600 }),
  'sig'].join('.');

const RPC = {
  kasa_rules: {},
  kasa_fast_claims: [],
  kasa_report_addresses: {},
  kasa_finalize_due: 0,
  kasa_people_count: 7,
  kasa_issue_capture_token: 'test-capture-token',
  kasa_photo_meta: null,
  kasa_create_report: 555,
  kasa_vote_claim: { verify_count: 2, dispute_count: 0, claim_status: 'pending', verify_needed: 3 }
};

const TABLES = {
  kasa_public_reports: REPORTS,
  wards: [{ ward_no: 5, councillor_name: 'Test Councillor' }, { ward_no: 7, councillor_name: 'Other Councillor' }],
  kasa_public_communities: []
};

// Minimal map style: a background only, so the map loads without OpenFreeMap. Glyphs point at a
// stub (empty) so the cluster-count symbol layer is accepted.
const MAP_STYLE = {
  version: 8,
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#0a0805' } }]
};

const json = (route, body, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });

async function serveModule(route, file){
  try {
    route.fulfill({ status: 200, contentType: 'application/javascript', body: await readFile(path.join(modules, file)) });
  } catch (e){
    route.fulfill({ status: 404, body: '' });
  }
}

/**
 * Stubs every outside call kasa.html makes. Returns `calls`, a list of { kind, name, body }
 * for Supabase REST/RPC/storage/function requests, so tests can assert what the page sent.
 */
export async function stubBackend(page, overrides = {}){
  const rpc = { ...RPC, ...(overrides.rpc || {}) };
  const tables = { ...TABLES, ...(overrides.tables || {}) };
  const calls = [];

  // CDN libraries come from this package's node_modules (same versions kasa.html pins).
  await page.route(/^https:\/\/(unpkg\.com|cdn\.jsdelivr\.net\/npm)\//, route => {
    const url = new URL(route.request().url());
    const m = url.pathname.replace(/^\/npm\//, '/').match(/^\/((?:@[^/]+\/)?[^@/]+)@[^/]+\/(.+)$/);
    if (!m) return route.fulfill({ status: 404, body: '' });
    const [, pkg, file] = m;
    if (file.endsWith('.css')) return readFile(path.join(modules, pkg, file))
      .then(body => route.fulfill({ status: 200, contentType: 'text/css', body }), () => route.fulfill({ status: 404, body: '' }));
    // jsdelivr minifies on the fly; npm only ships the unminified UMD build.
    return serveModule(route, path.join(pkg, file.replace('supabase.min.js', 'supabase.js')));
  });

  await page.route(/^https:\/\/tiles\.openfreemap\.org\//, route => {
    if (route.request().url().includes('/styles/')) return json(route, MAP_STYLE);
    return route.fulfill({ status: 200, contentType: 'application/x-protobuf', body: Buffer.alloc(0) });
  });
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route(/^https:\/\/(photon\.komoot\.io|challenges\.cloudflare\.com)\//, route => route.abort());

  await page.route(`${SUPABASE}/**`, async route => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    if (req.method() === 'OPTIONS'){
      return route.fulfill({ status: 204, headers: {
        'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    }
    let body = null;
    try { body = req.postDataJSON(); } catch (e) {}

    if (p.startsWith('/rest/v1/rpc/')){
      const name = p.slice('/rest/v1/rpc/'.length);
      calls.push({ kind: 'rpc', name, body });
      return json(route, name in rpc ? rpc[name] : null);
    }
    if (p.startsWith('/rest/v1/')){
      const name = p.slice('/rest/v1/'.length);
      calls.push({ kind: 'table', name, method: req.method(), body });
      return json(route, tables[name] || []);
    }
    if (p.startsWith('/auth/v1/signup') || p.startsWith('/auth/v1/token')){
      calls.push({ kind: 'auth', name: p });
      return json(route, { access_token: ACCESS_TOKEN, token_type: 'bearer', expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'refresh', user: USER });
    }
    if (p.startsWith('/auth/v1/user')) return json(route, USER);
    if (p.startsWith('/storage/v1/object/')){
      const key = p.replace('/storage/v1/object/', '');
      calls.push({ kind: 'storage', name: key });
      return json(route, { Key: key, Id: 'obj-1' });
    }
    if (p.startsWith('/functions/v1/')){
      const name = p.slice('/functions/v1/'.length);
      calls.push({ kind: 'function', name, body });
      return json(route, { ok: true });
    }
    return json(route, {}, 404);
  });

  return calls;
}

export const test = base.extend({
  backend: async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    // Skip first-visit tips, the location question and the join banner so they don't cover
    // the controls under test.
    await page.addInitScript(() => {
      try { for (const k of ['kasa_tips_done', 'kasa_loc_asked', 'kasa_join_closed']) localStorage.setItem(k, '1'); } catch (e) {}
    });
    const calls = await stubBackend(page);
    await use({ calls, errors });
    expect(errors, 'uncaught errors on the page').toEqual([]);
  }
});

export { expect };
