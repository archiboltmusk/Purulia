import { test, expect, stubBackend } from './fixtures.mjs';

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
  await expect.poll(() => backend.calls.some(c => c.kind === 'table' && c.name === 'kasa_public_place_reports')).toBe(true);
  // Moving back to Purulia names the page after Purulia again.
  await page.evaluate(() => mainMap.jumpTo({ center: [86.3654, 23.332], zoom: 13 }));
  await expect(wordmark(page)).toHaveText('Purulia');
});

test('without a location the page opens as Parishkar Bengal; the picker moves the map and is remembered', async ({ browser }) => {
  const ctx = await browser.newContext({ permissions: [] });
  const page = await ctx.newPage();
  await stubBackend(page);
  await page.addInitScript(() => { try { localStorage.setItem('kasa_tips_done', '1'); localStorage.setItem('kasa_loc_asked', '1'); } catch (e) {} });
  await page.goto('kasa.html');
  await expect(wordmark(page)).toHaveText('Bengal');
  await expect(page).toHaveTitle(/Parishkar Bengal/);
  await page.click('#k-place-pick');
  await page.click('#k-place-list [data-place="district:bankura"]');
  await expect(wordmark(page)).toHaveText('Bankura');
  expect(await page.evaluate(() => localStorage.getItem('parishkar_place'))).toBe('district:bankura');
  await page.reload();
  await expect(wordmark(page)).toHaveText('Bankura');
  await ctx.close();
});

test('a spot in a Kolkata ward is placed there; one in no ward is filed under its district', async ({ page }) => {
  await page.goto('kasa.html?place=kolkata');
  await page.evaluate(() => KasaPlaces.load('kolkata'));
  const esplanade = await page.evaluate(() => KasaPlaces.at(22.5646, 88.3510));
  expect(esplanade).toMatchObject({ kind: 'place', place: 'kolkata', ward: 46 });
  await page.evaluate(() => KasaPlaces.at(22.5839, 88.3426));
  await expect.poll(() => page.evaluate(() => KasaPlaces.at(22.5839, 88.3426)))
    .toMatchObject({ kind: 'place', place: 'district:howrah', name: 'Howrah', isDistrict: true });
  expect(await page.evaluate(() => KasaPlaces.at(28.61, 77.21))).toBeNull();
});

test('on a district with no town map the page becomes Parishkar Bankura', async ({ page, backend }) => {
  await page.goto('kasa.html');
  await page.evaluate(() => { userMovedMap = true; mainMap.jumpTo({ center: [87.07, 23.23], zoom: 11 }); });
  await expect(wordmark(page)).toHaveText('Bankura');
  await expect.poll(() => backend.calls.some(c => c.name === 'kasa_place_visit' && c.body?.p_place === 'district:bankura')).toBe(true);
  // Counts are Bankura's (none yet), not Purulia's.
  await expect(page.locator('#k-pill-total')).toHaveText('0');
});

const TOWN = {
  slug: 'bankura', name: 'Bankura', body: 'Bankura Municipality', body_type: 'municipality', district: 'Bankura',
  status: 'provisional', community: true, incharge: 'Sanitary Inspector', incharge_source: 'Notice board',
  wards_mapped: 1, source: 'Drawn on Parishkar', licence: 'Community-drawn on Parishkar', updated_at: '2026-09-28T10:00:00Z',
  bbox: { min_lat: 23.22, max_lat: 23.25, min_lng: 87.05, max_lng: 87.08 }
};
const TOWN_WARDS = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { ward: 1 },
  geometry: { type: 'MultiPolygon', coordinates: [[[[87.05, 23.22], [87.08, 23.22], [87.08, 23.25], [87.05, 23.25], [87.05, 23.22]]]] } }] };

test('a town approved by moderators comes from the server, with provisional borders', async ({ page }) => {
  await stubBackend(page, { rpc: { kasa_places: [TOWN], kasa_place_wards: TOWN_WARDS } });
  await page.goto('kasa.html?place=bankura');
  await expect(wordmark(page)).toHaveText('Bankura');
  await expect.poll(() => page.evaluate(() => KasaPlaces.at(23.235, 87.065)))
    .toMatchObject({ kind: 'place', place: 'bankura', ward: 1, provisional: true });
  await expect.poll(() => page.evaluate(() => mainMap.getPaintProperty('place-bankura-line', 'line-dasharray'))).toEqual([3, 2]);
});

test('Put your town on the map: upload a ward GeoJSON and send it for review', async ({ page }) => {
  const calls = await stubBackend(page, { rpc: { kasa_submit_place: { ok: true, status: 'pending' } } });
  await page.goto('add-town.html?district=Bankura');
  await expect(page.locator('#at-district')).toHaveValue('Bankura');
  await page.fill('#at-town', 'Bankura');
  await page.fill('#at-body', 'Bankura Municipality');
  await page.fill('#at-incharge', 'Sanitary Inspector');
  const fc = { type: 'FeatureCollection', features: [
    { type: 'Feature', properties: { WARD: '1' }, geometry: { type: 'Polygon', coordinates: [[[87.05, 23.22], [87.07, 23.22], [87.07, 23.25], [87.05, 23.22]]] } },
    { type: 'Feature', properties: { ward_no: 2 }, geometry: { type: 'Polygon', coordinates: [[[87.07, 23.22], [87.09, 23.22], [87.09, 23.25], [87.07, 23.22]]] } }] };
  await page.setInputFiles('#at-file', { name: 'wards.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(JSON.stringify(fc)) });
  await expect(page.locator('#at-wards button')).toHaveCount(2);
  await page.click('#at-send');
  await expect(page.locator('#at-msg')).toHaveText(/where you found who is in charge/);
  await page.fill('#at-incharge-src', 'Notice board, Bankura Municipality office');
  await page.fill('#at-source', 'https://example.org/bankura-wards');
  await page.click('#at-send');
  await expect(page.locator('#at-msg')).toHaveClass(/ok/);
  const sent = calls.find(c => c.name === 'kasa_submit_place').body;
  expect(sent).toMatchObject({ p_town: 'Bankura', p_district: 'Bankura', p_body_type: 'municipality', p_drawn: false, p_fix_of: null });
  expect(sent.p_geojson.features.map(f => f.properties.ward).sort()).toEqual([1, 2]);
});

test('Put your town on the map: draw a ward on the map', async ({ page }) => {
  const calls = await stubBackend(page, { rpc: { kasa_submit_place: { ok: true, status: 'pending' } } });
  await page.goto('add-town.html');
  await page.fill('#at-town', 'Bishnupur');
  await page.selectOption('#at-district', 'Bankura');
  await page.fill('#at-body', 'Bishnupur Municipality');
  await page.click('[data-mode="draw"]');
  await expect(page.locator('#at-source')).toHaveValue(/Drawn on Parishkar/);
  await page.fill('#at-wardno', '7');
  await page.waitForFunction(() => document.querySelector('#at-map canvas'));
  await page.click('#at-start');
  const map = page.locator('#at-map');
  const box = await map.boundingBox();
  for (const [dx, dy] of [[0.4, 0.4], [0.6, 0.4], [0.5, 0.6]]){
    await map.click({ position: { x: box.width * dx, y: box.height * dy } });
    await page.waitForTimeout(350);
  }
  await expect(page.locator('#at-status')).toHaveText(/Ward 7: 3 points/);
  await page.click('#at-finish');
  await expect(page.locator('#at-wards button')).toHaveText(['7 ✕']);
  await page.click('#at-send');
  await expect(page.locator('#at-msg')).toHaveClass(/ok/);
  const sent = calls.find(c => c.name === 'kasa_submit_place').body;
  expect(sent.p_drawn).toBe(true);
  expect(sent.p_geojson.features[0].geometry.coordinates[0]).toHaveLength(4);
});

test('old "add my town" links open the new page', async ({ page }) => {
  await page.goto('suggest-feature.html#add-town');
  await expect(page).toHaveURL(/add-town\.html$/);
});
