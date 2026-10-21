import { test, expect } from './fixtures.mjs';

test.use({ viewport: { width: 390, height: 844 } });

const stubGeo = page => page.addInitScript(() => {
  window.__geoCalls = 0;
  const count = () => { window.__geoCalls++; };
  navigator.geolocation.getCurrentPosition = count;
  navigator.geolocation.watchPosition = count;
});

test('first visit with no location decided: asks for GPS on load, no card, no tour, join line or nearby card', async ({ page, backend, context }) => {
  await context.clearPermissions();
  await stubGeo(page);
  await page.goto('kasa.html');
  await expect.poll(() => backend.calls.some(c => c.name === 'kasa_place_visit')).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__geoCalls)).toBe(1);
  await expect(page.locator('#k-loc-ask')).toHaveCount(0);
  await expect(page.locator('#k-tip')).toHaveCount(0);
  await expect(page.locator('#k-join')).toHaveCount(0);
  await expect(page.locator('#k-still')).toBeHidden();
  await expect(page.locator('#k-near')).toBeHidden();
  await expect(page.locator('.k-map-report-btn')).toBeVisible();
});

test('first visit with location allowed: map goes to the visitor without a second question', async ({ page, backend }) => {
  await stubGeo(page);
  await page.goto('kasa.html');
  await expect.poll(() => backend.calls.some(c => c.name === 'kasa_place_visit')).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__geoCalls)).toBe(1);
  await expect(page.locator('#k-loc-ask')).toHaveCount(0);
  await expect(page.locator('.k-map-report-btn')).toBeVisible();
});
