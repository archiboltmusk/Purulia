import { test, expect } from './fixtures.mjs';

const reply = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });

test('case file traces one report with a days-open counter and sourced panels', async ({ page, backend }) => {
  await page.route('**/rest/v1/rpc/kasa_report_asset', route => reply(route, {
    match: 'confirmed', asset: { id: 7, kind: 'road', name: 'Station Road', source: 'OpenStreetMap', source_url: 'https://www.openstreetmap.org/way/1' } }));
  await page.route('**/rest/v1/rpc/kasa_asset_works', route => reply(route, { works: [{
    id: 1, title: 'Resurfacing of Station Road', tender_ref: 'WBMAD/2025/1', portal: 'wbtenders', status: 'completed',
    completed_on: '2026-01-10', awarded_amount: 1250000, contractor: { firm_name: 'Test Builders' },
    source_url: 'https://wbtenders.gov.in/x' }] }));
  await page.goto('case.html?id=101');
  await expect(page.locator('#cf-days')).toHaveText('1');
  await expect(page.locator('#cf-days-l')).toHaveText('days open');
  await expect(page.locator('.cf-panel')).toHaveCount(6);
  await expect(page.locator('#cf-tender')).toContainText('Test Builders');
  await expect(page.locator('#cf-tender a[href="https://wbtenders.gov.in/x"]')).toBeVisible();
  await expect(page.locator('#cf-money')).toContainText('₹12,50,000');
  await expect(page.locator('#cf-report .cf-src a')).toHaveAttribute('href', 'kasa.html?report=101');
});

test('case file exports the server-composed public dossier', async ({ page, backend }) => {
  await page.goto('case.html?id=101');
  const download = page.waitForEvent('download');
  await page.locator('#cf-export').click();
  await expect(page.locator('#cf-export')).toHaveText('Downloaded');
  await expect(await download).toHaveSuggestedFilename('parishkar-case-101-record.json');
  expect(backend.calls.some(x => x.kind === 'rpc' && x.name === 'kasa_case_dossier' && x.body.p_report_id === '101')).toBe(true);
});

test('reporter mode: follow a case and see it with its days-open count', async ({ page, backend }) => {
  await page.goto('case.html');
  await expect(page.locator('#cf-title')).toHaveText('Cases you follow');
  await expect(page.locator('#cf-main')).toContainText('Follow this case');
  await page.goto('case.html?id=101');
  await page.locator('#cf-follow').click();
  await expect(page.locator('#cf-follow')).toHaveAttribute('aria-pressed', 'true');
  await page.goto('case.html');
  await expect(page.locator('.cf-follow li')).toHaveCount(1);
  await expect(page.locator('.cf-follow-days b')).toHaveText('1');
  await page.locator('.cf-unfollow').click();
  await expect(page.locator('.cf-follow li')).toHaveCount(0);
});

test('a case file opens from a real report id (a UUID), in Bengali when chosen', async ({ page, backend }) => {
  const uid = 'a7795355-b2a3-4995-9f5b-133f7c5868df';
  const row = { id: uid, created_at: new Date(Date.now() - 2 * 86400000).toISOString(), lat: 23.332, lng: 86.3654, ward_no: 5,
    category: 'garbage', severity: 'severe', status: 'open', upvotes: 0, sla_days: 7, gps_verified: true, reply_count: 0 };
  await page.route(/\/rest\/v1\/kasa_public_(place_)?reports\?.*/, route => reply(route, route.request().url().includes(uid) ? [row] : []));
  await page.route('**/rest/v1/rpc/kasa_report_dockets', route => reply(route, [{ id: 1, portal: 'rti', number: 'WBRTI/1', added: '2026-10-01',
    filed_on: '2026-09-01', reply_due: '2026-10-01', appeal_by: '2026-10-31', status: 'waiting' }]));
  await page.addInitScript(() => localStorage.setItem('kasa_lang', 'bn'));
  await page.goto(`case.html?id=${uid}`);
  await expect(page.locator('#cf-days')).toHaveText('2');
  await expect(page.locator('#cf-days-l')).toHaveText('দিন খোলা');
  await expect(page.locator('#cf-now')).toContainText('WBRTI/1');
  await expect(page.locator('#cf-now')).toContainText('দিন দেরি');
});
