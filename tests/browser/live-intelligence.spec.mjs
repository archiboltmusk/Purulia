import { expect, test } from '@playwright/test';

test('renders the map, searches districts and reports independent feed failures', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('https://tiles.openfreemap.org/**', (route) => route.fulfill({
    json: { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#172530' } }] }
  }));
  await page.route('**/rest/v1/rpc/india_earthquake_snapshot?*', (route) => route.fulfill({
    json: { type: 'FeatureCollection', features: [], last_success: new Date().toISOString() },
    headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'apikey' }
  }));
  await page.route('**/rest/v1/rpc/internet_speed_cells', (route) => route.fulfill({
    status: 503, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'apikey' }
  }));
  await page.goto('/live-intelligence.html');
  await expect(page.locator('#map canvas')).toBeVisible();
  const earthquake = page.locator('label').filter({ hasText: 'USGS earthquakes' });
  await expect(earthquake).toContainText('0 mapped · Source checked');
  await expect(page.locator('label').filter({ hasText: 'Community internet speeds' })).toContainText('Refresh failed');
  await earthquake.getByRole('checkbox').uncheck();
  const request = page.waitForRequest('**/india_earthquake_snapshot?p_days=7');
  await page.locator('#period').selectOption('7');
  await request;
  await page.locator('#district').fill('Purulia');
  await page.locator('#district').press('Tab');
  await expect(page.locator('#district-status')).toContainText('Local Government Directory');
  await page.getByText('Source coverage and access').click();
  await expect(page.locator('#registry')).toContainText('commercial traffic tile', { ignoreCase: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('keeps district search and layers usable without WebGL2', async ({ page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return type.startsWith('webgl') ? null : getContext.call(this, type, ...args);
    };
  });
  await page.route('**/rest/v1/rpc/**', (route) => route.abort());
  await page.goto('/live-intelligence.html');
  await expect(page.getByRole('img', { name: 'India and regional observations' })).toBeVisible();
  await expect(page.locator('#map svg path').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reset map view' })).toBeVisible();
  await expect(page.getByText('USGS earthquakes')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Find a district or state' })).toBeEnabled();
});
