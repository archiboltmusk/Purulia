import { test, expect } from './fixtures.mjs';

test('map filters open data and evidence in place and preserve reporting', async ({ page, backend }) => {
  await page.goto('/kasa.html?d=purulia');
  await page.locator('#k-filter-toggle').click();
  await page.getByRole('button', { name: 'Data & evidence', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Map data & evidence' });
  await expect(panel).toBeVisible();
  await panel.getByText('District data & public records', { exact: true }).click();
  await expect(panel.getByText('Homes with tap water', { exact: false })).toBeVisible();
  await panel.getByText('Spending records missing from Parishkar', { exact: false }).click();
  await expect(panel.getByText('Municipality money:', { exact: false })).toBeVisible();
  await panel.getByRole('button', { name: 'Back to map' }).click();
  await expect(panel).toBeHidden();
  await expect(page).toHaveURL(/kasa\.html\?d=purulia$/);
  await expect(page.locator('#k-map')).toBeVisible();
  await expect(page.getByText('Report a problem', { exact: true }).first()).toBeVisible();
  expect(backend.calls.some((call) => call.name === 'kasa_create_report')).toBe(false);
});

test('old map links open the core map and a feed can be selected in place', async ({ page, backend }) => {
  await page.route('**/rest/v1/rpc/india_earthquake_snapshot?*', (route) => route.fulfill({
    json: { type: 'FeatureCollection', features: [], last_success: new Date().toISOString() },
    headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'apikey' }
  }));
  await page.goto('/live-intelligence.html?d=purulia');
  await expect(page).toHaveURL(/kasa\.html\?intelligence=layers&d=purulia$/);
  const panel = page.getByRole('dialog', { name: 'Map data & evidence' });
  await panel.getByLabel('Overlay', { exact: true }).selectOption('quake');
  await expect(panel.getByText('0 mapped · Source checked', { exact: false })).toBeVisible();
  await expect(panel.getByLabel('Earthquake history')).toBeVisible();
});
