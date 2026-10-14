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
