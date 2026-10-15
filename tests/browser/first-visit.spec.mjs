import { test, expect } from './fixtures.mjs';

test.use({ viewport: { width: 390, height: 844 } });

test('first visit: map shows at once with no location prompt, tour, join line or nearby card', async ({ page, backend }) => {
  await page.addInitScript(() => {
    window.__geoCalls = 0;
    const count = () => { window.__geoCalls++; };
    navigator.geolocation.getCurrentPosition = count;
    navigator.geolocation.watchPosition = count;
  });
  await page.goto('kasa.html');
  await expect.poll(() => backend.calls.some(c => c.name === 'kasa_place_visit')).toBe(true);
  await page.waitForTimeout(6000);
  expect(await page.evaluate(() => window.__geoCalls)).toBe(0);
  await expect(page.locator('#k-tip')).toHaveCount(0);
  await expect(page.locator('#k-join')).toHaveCount(0);
  await expect(page.locator('#k-still')).toBeHidden();
  await expect(page.locator('#k-near')).toBeHidden();
  await expect(page.locator('.k-map-report-btn')).toBeVisible();
});
