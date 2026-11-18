import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const server = 'https://cnmikcyvyamplbldiivp.supabase.co';
const signedUser = { id: '00000000-0000-4000-8000-000000000901', aud: 'authenticated', role: 'authenticated', is_anonymous: false, email: 'synthetic@example.invalid', email_confirmed_at: new Date().toISOString() };
async function setup(page, { signedIn = true, failDownload = false, rows = [], failMap = false, failPublish = false } = {}) {
  const calls = [];
  await page.route('https://cdn.jsdelivr.net/**', async route => route.fulfill({ contentType: 'application/javascript', body: await readFile(new URL('node_modules/@supabase/supabase-js/dist/umd/supabase.js', import.meta.url), 'utf8') }));
  await page.route('https://tiles.openfreemap.org/**', route => route.fulfill({ json: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#172530' } }] } }));
  await page.addInitScript(({ signedIn, signedUser }) => {
    const payload = btoa(JSON.stringify({ sub: signedUser.id, aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 }));
    if (signedIn) localStorage.setItem('parishkar-internet-speed-auth', JSON.stringify({ access_token: 'e30.' + payload + '.test', refresh_token: 'test-refresh', token_type: 'bearer', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user: signedUser }));
  }, { signedIn, signedUser });
  await page.route(server + '/**', async route => {
    const req = route.request(), url = new URL(req.url());
    let body; try { body = req.postDataJSON(); } catch { body = req.postData(); }
    calls.push({ path: url.pathname, body });
    if (url.pathname.endsWith('/user')) return route.fulfill({ json: signedIn ? signedUser : { error: 'No user' }, status: signedIn ? 200 : 401 });
    if (url.pathname.endsWith('/otp')) return route.fulfill({ json: {} });
    if (url.pathname.endsWith('/verify')) { signedIn = true; return route.fulfill({ json: { access_token: 'e30.e30.test', refresh_token: 'test', expires_in: 3600, user: signedUser } }); }
    if (url.pathname.endsWith('/internet_speed_regions')) return route.fulfill({ status: failMap ? 503 : 200, json: failMap ? { message: 'Unavailable' } : rows });
    if (url.pathname.endsWith('/submit_internet_speed') && failPublish) return route.fulfill({ status: 400, json: { message: 'Wait 15 minutes between contributions' } });
    return route.fulfill({ contentType: 'application/json', body: 'null' });
  });
  await page.route('https://speed.cloudflare.com/**', async route => {
    const url = new URL(route.request().url()), bytes = Number(url.searchParams.get('bytes'));
    await new Promise(resolve => setTimeout(resolve, bytes ? 550 : 20));
    if (failDownload && bytes > 1000) return route.fulfill({ status: 503, body: 'unavailable' });
    return route.fulfill({ contentType: 'application/octet-stream', body: Buffer.alloc(url.pathname.endsWith('__down') ? bytes : 0) });
  });
  return calls;
}
test('private test, consent, coarse contribution and deletion', async ({ page }) => {
  const calls = await setup(page); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/internet-speed.html');
  await expect(page.locator('#regions tr')).toHaveCount(36); await expect(page.locator('#map canvas')).toBeVisible();
  await expect(page.locator('#map-status')).toContainText('No regions');
  await page.locator('#run').click(); await expect(page.locator('#status')).toContainText('Test complete');
  await expect(page.locator('#publish')).toBeDisabled(); expect(calls.some(c => c.path.endsWith('/submit_internet_speed'))).toBe(false);
  await page.locator('#consent').check(); await page.locator('#publish').click();
  await expect(page.locator('#status')).toContainText('Contribution saved');
  const sent = calls.find(c => c.path.endsWith('/submit_internet_speed')).body;
  expect(sent.p_lat).toBe(23.3); expect(sent.p_lng).toBe(86.4); expect(sent.p_kind).toBe('mobile');
  await expect(page.locator('#publish')).toBeDisabled();
  await page.locator('#delete').click(); await expect(page.locator('#status')).toContainText('deleted');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); expect(errors).toEqual([]);
});
test('regions colour correctly and connection filter updates accessible table', async ({ page }) => {
  await setup(page, { rows: [{ region: 'west-bengal', connection_type: 'mobile', download_mbps: 55, upload_mbps: 10, latency_ms: 12, contributors: 5 }] });
  await page.goto('/internet-speed.html'); const wb = page.locator('#regions tr').filter({ hasText: 'West Bengal' });
  await expect(wb).toContainText('55'); await page.locator('#map-kind').selectOption('fixed'); await expect(wb).toContainText('Insufficient data');
});
test('download failure clears result; cancel is recoverable', async ({ page }) => {
  await setup(page, { failDownload: true }); await page.goto('/internet-speed.html');
  await page.locator('#run').click(); await expect(page.locator('#status')).toContainText('Test failed');
  await expect(page.locator('#down')).toHaveText('—'); await expect(page.locator('#publish')).toBeDisabled();
  await page.locator('#run').click(); await page.locator('#cancel').click();
  await expect(page.locator('#status')).toContainText('cancelled'); await expect(page.locator('#run')).toBeEnabled();
});
test('signed-out test requires sign-in and offers email sign-in', async ({ page }) => {
  const calls = await setup(page, { signedIn: false }); await page.goto('/internet-speed.html');
  await page.locator('#run').click(); await expect(page.locator('#status')).toContainText('Test complete');
  await page.locator('#consent').check(); await expect(page.locator('#publish')).toBeDisabled();
  await page.locator('#email').fill('synthetic@example.invalid'); await page.locator('#login').click();
  await expect(page.locator('#auth-status')).toContainText('Check your email');
  expect(calls.find(c => c.path.endsWith('/otp')).body.email).toBe('synthetic@example.invalid');
});
test('map error and denied GPS do not submit or trap controls', async ({ page, context }) => {
  const calls = await setup(page, { failMap: true }); await context.clearPermissions();
  await page.goto('/internet-speed.html'); await expect(page.locator('#map-status')).toContainText('unavailable');
  await page.locator('#run').click(); await expect(page.locator('#status')).toContainText('Test complete');
  await page.locator('#consent').check(); await page.locator('#publish').click();
  await expect(page.locator('#status')).toContainText('Could not share'); expect(calls.some(c => c.path.endsWith('/submit_internet_speed'))).toBe(false);
  await expect(page.locator('#run')).toBeEnabled();
});
test('connection change invalidates result; server interval rejection is visible', async ({ page }) => {
  await setup(page, { failPublish: true }); await page.goto('/internet-speed.html');
  await page.locator('#run').click(); await expect(page.locator('#status')).toContainText('Test complete');
  await page.locator('#kind').selectOption('fixed'); await page.locator('#consent').check(); await expect(page.locator('#publish')).toBeDisabled();
  await page.locator('#run').click(); await expect(page.locator('#status')).toContainText('Test complete');
  await page.locator('#publish').click(); await expect(page.locator('#status')).toContainText('Wait 15 minutes'); await expect(page.locator('#publish')).toBeEnabled();
});
