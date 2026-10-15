import { test, expect, REPORTS } from './fixtures.mjs';

test('a fixed report shows the same spot then and now on one slider', async ({ page, backend }) => {
  const rows = REPORTS.map(r => r.id === 103 ? { ...r, photo_url: 'https://example.org/then.jpg', resolved_photo_url: 'https://example.org/now.jpg' } : r);
  await page.route('**/rest/v1/kasa_public_reports**', route => route.fulfill({ status: 200, contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(rows) }));
  await page.route('https://example.org/**', route => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="3"/>' }));
  await page.goto('kasa.html?report=103');
  const s = page.locator('.k-ba-slider');
  await expect(s).toBeVisible();
  await expect(s.locator('img')).toHaveCount(2);
  await s.locator('input').fill('20');
  await expect(s).toHaveAttribute('style', /--cut:\s*20%/);
});
