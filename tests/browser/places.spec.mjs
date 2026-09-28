import { test, expect } from './fixtures.mjs';

const wordmark = page => page.locator('.k-nav-logo .k-wordmark-second');

test('the page is Parishkar Purulia in Purulia', async ({ page, backend }) => {
  await page.goto('kasa.html');
  await expect(wordmark(page)).toHaveText('Purulia');
  await expect.poll(() => backend.calls.some(c => c.name === 'kasa_place_visit' && c.body?.p_place === 'purulia')).toBe(true);
});

test('on Kolkata the page becomes Parishkar Kolkata, and Purulia pages read only Purulia reports', async ({ page, backend }) => {
  await page.goto('kasa.html?place=kolkata');
  await expect(wordmark(page)).toHaveText('Kolkata');
  await expect(page).toHaveTitle(/Parishkar Kolkata/);
  await expect.poll(() => backend.calls.some(c => c.name === 'kasa_place_visit' && c.body?.p_place === 'kolkata')).toBe(true);
  expect(backend.calls.some(c => c.kind === 'table' && c.name === 'kasa_public_place_reports')).toBe(true);
  // Moving back to Purulia names the page after Purulia again.
  await page.evaluate(() => mainMap.jumpTo({ center: [86.3654, 23.332], zoom: 13 }));
  await expect(wordmark(page)).toHaveText('Purulia');
});

test('a spot in a Kolkata ward is placed there, one outside every ward is refused', async ({ page }) => {
  await page.goto('kasa.html?place=kolkata');
  await page.evaluate(() => KasaPlaces.load('kolkata'));
  const esplanade = await page.evaluate(() => KasaPlaces.at(22.5646, 88.3510));
  expect(esplanade).toMatchObject({ kind: 'place', place: 'kolkata', ward: 46 });
  const howrah = await page.evaluate(() => KasaPlaces.at(22.5839, 88.3426));
  expect(howrah.kind).toBe('place_unmapped');
});

test('"Put your town on the map" asks for the ward map and who cleans', async ({ page }) => {
  await page.goto('suggest-feature.html#add-town');
  await expect(page.locator('#add-town')).toBeVisible();
  await expect(page.locator('#sg-title')).toHaveValue(/^Add my town to the map/);
  await expect(page.locator('#sg-description')).toHaveValue(/Ward map link[\s\S]*in charge of cleaning/);
});
