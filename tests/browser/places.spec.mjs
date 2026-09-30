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

test('tapping a Kolkata ward opens its card, like a Purulia ward; a shared ward link opens it too', async ({ page, backend }) => {
  await page.goto('kasa.html?place=kolkata');
  await expect.poll(() => page.evaluate(() => !!mainMap?.getLayer('wb-districts-line'))).toBe(true);
  await page.evaluate(() => KasaPlaces.load('kolkata'));
  await expect.poll(() => page.evaluate(() => !!mainMap.getLayer('place-kolkata-fill'))).toBe(true);
  await page.evaluate(() => { userMovedMap = true; mainMap.jumpTo({ center: [88.3510, 22.5646], zoom: 15 }); });
  await page.waitForTimeout(800);
  const box = await page.locator('#k-map').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const card = page.locator('#k-ward-card');
  await expect(card).toBeVisible();
  await expect(card.locator('.k-ward-title')).toHaveText(/Kolkata · Ward 46/);
  await expect(card.locator('.k-ward-sub')).toHaveText(/Priyanka Saha/);
  await expect(card).toContainText('Borough VI office');
  await card.locator('[data-ward-filter]').click();
  expect(await page.evaluate(() => [state.filters.place, state.filters.ward])).toEqual(['kolkata', 46]);
  await page.goto('kasa.html?place=kolkata&ward=12');
  await expect(page.locator('#k-ward-card .k-ward-title')).toHaveText(/Kolkata · Ward 12/);
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
  await expect(page.locator('#at-wards button')).toHaveText(['7']);
  await page.click('#at-send');
  await expect(page.locator('#at-msg')).toHaveClass(/ok/);
  const sent = calls.find(c => c.name === 'kasa_submit_place').body;
  expect(sent.p_drawn).toBe(true);
  expect(sent.p_geojson.features[0].geometry.coordinates[0]).toHaveLength(4);
});

test('Put your town on the map: name a ward, reshape it and download GeoJSON', async ({ page }) => {
  await stubBackend(page);
  await page.goto('add-town.html?district=Bankura');
  await page.fill('#at-town', 'Bankura');
  const fc = { type: 'FeatureCollection', features: [
    { type: 'Feature', properties: { ward: 1, name: 'Lalbazar' }, geometry: { type: 'Polygon', coordinates: [[[87.05, 23.22], [87.0712345678, 23.22], [87.07, 23.25], [87.05, 23.22]]] } }] };
  await page.setInputFiles('#at-file', { name: 'wards.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(JSON.stringify(fc)) });
  await expect(page.locator('#at-wards button')).toHaveText(['1 · Lalbazar']);
  await page.click('#at-wards button');
  await expect(page.locator('#at-edit')).toBeVisible();
  await expect(page.locator('#at-e-name')).toHaveValue('Lalbazar');
  await page.fill('#at-e-note', 'Border follows the canal');
  await page.fill('#at-e-ward', '4');
  await page.locator('#at-e-ward').dispatchEvent('change');
  await page.click('#at-e-shape');
  await expect(page.locator('.at-vx:not(.mid)')).toHaveCount(3);
  await expect(page.locator('.at-vx.mid')).toHaveCount(3);
  // Dragging an orange mid-point adds a corner there.
  const mid = await page.locator('.at-vx.mid').first().boundingBox();
  await page.mouse.move(mid.x + mid.width / 2, mid.y + mid.height / 2);
  await page.mouse.down();
  await page.mouse.move(mid.x + 20, mid.y + 30, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('.at-vx:not(.mid)')).toHaveCount(4);
  await page.locator('.at-vx:not(.mid)').nth(1).click();
  await page.click('#at-e-delpt');
  await expect(page.locator('.at-vx:not(.mid)')).toHaveCount(3);
  await page.locator('.at-vx:not(.mid)').first().click();
  await page.click('#at-e-delpt');
  await expect(page.locator('#at-msg')).toHaveText(/at least 3 corners/);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#at-export')]);
  expect(dl.suggestedFilename()).toBe('bankura.geojson');
  const got = JSON.parse(await (await import('node:fs/promises')).readFile(await dl.path(), 'utf8'));
  expect(got.bbox).toEqual([87.05, 23.22, 87.071235, 23.25]);
  expect(got.features[0].properties).toEqual({ ward: 4, name: 'Lalbazar', note: 'Border follows the canal' });
  expect(got.features[0].bbox).toEqual(got.bbox);
  expect(got.features[0].geometry.coordinates[0][1]).toEqual([87.071235, 23.22]);
});

test('Put your town on the map: a background picture can be placed and removed', async ({ page }) => {
  await stubBackend(page);
  await page.goto('add-town.html');
  await page.waitForFunction(() => document.querySelector('#at-map canvas'));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8DwnwEJMDGgAQA/3wIBcOjU2wAAAABJRU5ErkJggg==', 'base64');
  await page.setInputFiles('#at-img', { name: 'ward-map.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('.at-corner')).toHaveCount(5);
  await expect(page.locator('#at-opacity')).toBeEnabled();
  await page.click('#at-img-lock');
  await expect(page.locator('.at-corner')).toHaveCount(0);
  await expect(page.locator('#at-img-lock')).toHaveText('Move picture');
  await page.click('#at-img-clear');
  await expect(page.locator('#at-opacity')).toBeDisabled();
});

test('Fix a town: send just a note and a pinned spot for the moderator', async ({ page }) => {
  const wards = { type: 'FeatureCollection', features: [
    { type: 'Feature', properties: { ward: 1 }, geometry: { type: 'MultiPolygon', coordinates: [[[[87.05, 23.22], [87.07, 23.22], [87.07, 23.25], [87.05, 23.22]]]] } }] };
  const calls = await stubBackend(page, { rpc: {
    kasa_places: [{ slug: 'bankura', name: 'Bankura', body: 'Bankura Municipality', body_type: 'municipality', district: 'Bankura' }],
    kasa_place_wards: wards, kasa_submit_place: { ok: true, status: 'pending' } } });
  await page.goto('add-town.html?fix=bankura');
  await expect(page.locator('#at-town')).toHaveValue('Bankura');
  await expect(page.locator('[data-t="f_note"]')).toHaveText(/What needs fixing/);
  await page.click('#at-send');
  await expect(page.locator('#at-msg')).toHaveText(/say what needs fixing/);
  await page.fill('#at-note', 'Ward 1 should end at the canal');
  await page.waitForFunction(() => document.querySelector('#at-map canvas'));
  await page.click('#at-pin');
  await expect(page.locator('#at-status')).toHaveText(/Tap the map where/);
  const map = page.locator('#at-map');
  const box = await map.boundingBox();
  await map.click({ position: { x: box.width * .2, y: box.height * .2 } });
  await expect(page.locator('#at-pin-at')).toHaveText(/Pinned at/);
  await expect(page.locator('#at-pin')).toHaveText('Remove pin');
  await page.click('#at-send');
  await expect(page.locator('#at-msg')).toHaveClass(/ok/);
  const sent = calls.find(c => c.name === 'kasa_submit_place').body;
  expect(sent).toMatchObject({ p_fix_of: 'bankura', p_note: 'Ward 1 should end at the canal', p_geojson: null });
  expect(sent.p_pin).toHaveLength(2);
});

test('Fix a town: tap a ward on the map to copy it for editing', async ({ page }) => {
  const wards = { type: 'FeatureCollection', features: [
    { type: 'Feature', properties: { ward: 3 }, geometry: { type: 'MultiPolygon', coordinates: [[[[87.05, 23.22], [87.07, 23.22], [87.07, 23.25], [87.05, 23.25], [87.05, 23.22]]]] } }] };
  await stubBackend(page, { rpc: {
    kasa_places: [{ slug: 'bankura', name: 'Bankura', body: 'Bankura Municipality', body_type: 'municipality', district: 'Bankura' }],
    kasa_place_wards: wards } });
  await page.goto('add-town.html?fix=bankura');
  await page.waitForFunction(() => document.querySelector('#at-map canvas'));
  await page.waitForTimeout(1200);
  const map = page.locator('#at-map');
  const box = await map.boundingBox();
  await map.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await expect(page.locator('#at-wards button')).toHaveText(['3']);
  await expect(page.locator('#at-edit')).toBeVisible();
  await page.click('#at-e-shape');
  await expect(page.locator('.at-vx:not(.mid)')).toHaveCount(4);
});

test("Fix a Purulia ward from its card: the ward opens ready to edit", async ({ page }) => {
  const calls = await stubBackend(page, { rpc: { kasa_submit_place: { ok: true, status: 'pending' } } });
  await page.goto('add-town.html?fix=purulia&ward=5');
  await expect(page.locator('#at-town')).toHaveValue('Purulia');
  await expect(page.locator('#at-district')).toHaveValue('Purulia');
  await expect(page.locator('#at-wards button')).toHaveText(['5']);
  await expect(page.locator('#at-e-ward')).toHaveValue('5');
  await page.fill('#at-note', 'The border should follow the railway line');
  await page.fill('#at-source', 'Ward map at the municipality office');
  await page.click('#at-send');
  await expect(page.locator('#at-msg')).toHaveClass(/ok/);
  const sent = calls.find(c => c.name === 'kasa_submit_place').body;
  expect(sent).toMatchObject({ p_fix_of: 'purulia', p_district: 'Purulia', p_town: 'Purulia' });
  expect(sent.p_geojson.features.map(f => f.properties.ward)).toEqual([5]);
});

test('Fix a gram panchayat border from its place card', async ({ page }) => {
  const calls = await stubBackend(page, { rpc: { kasa_submit_place: { ok: true, status: 'pending' } } });
  await page.goto('add-town.html?fix=area&level=gp&district=purulia&block=Arsha&gp=Arsha');
  await expect(page.locator('#at-title')).toHaveText(/Fix the border of Arsha/);
  await expect(page.locator('#at-wards button')).toHaveText(['1 · Arsha']);
  await page.fill('#at-note', 'The border cuts through the village');
  await page.fill('#at-source', 'Seen on the ground');
  await page.click('#at-send');
  await expect(page.locator('#at-msg')).toHaveClass(/ok/);
  expect(calls.find(c => c.name === 'kasa_submit_place').body).toMatchObject({ p_fix_of: 'area:gp:purulia:Arsha:Arsha', p_district: 'Purulia' });
});

test('old "add my town" links open the new page', async ({ page }) => {
  await page.goto('suggest-feature.html#add-town');
  await expect(page).toHaveURL(/add-town\.html$/);
});

test('district outlines show statewide; a district\'s blocks and panchayats load only once it is in view', async ({ page, backend }) => {
  const fetched = [];
  page.on('request', r => { const m = r.url().match(/places\/wb\/([a-z0-9-]+)\.geojson/); if (m) fetched.push(m[1]); });
  await page.goto('kasa.html');
  await expect.poll(() => page.evaluate(() => !!mainMap?.getLayer('wb-districts-line'))).toBe(true);
  await page.evaluate(() => { userMovedMap = true; mainMap.jumpTo({ center: [87.07, 23.23], zoom: 10 }); });
  await expect.poll(() => page.evaluate(() => !!mainMap.getSource('wb-bankura'))).toBe(true);
  expect(fetched).not.toContain('malda');
  const kinds = await page.evaluate(() => [...new Set(mainMap.getSource('wb-bankura')._data.features.map(f => f.properties.kind))].sort());
  expect(kinds).toEqual(['block', 'gp']);
});

test('tapping a gram panchayat opens its card with the MLA and MP for that spot; crumbs switch to block and district', async ({ page, backend }) => {
  await page.goto('kasa.html');
  await expect.poll(() => page.evaluate(() => !!mainMap?.getLayer('wb-districts-line'))).toBe(true);
  await page.evaluate(() => { userMovedMap = true; mainMap.jumpTo({ center: [87.5539, 23.1122], zoom: 11 }); });
  await page.evaluate(() => openArea(23.1122, 87.5539));
  const card = page.locator('#k-area-card');
  await expect(card).toBeVisible();
  await expect(card.locator('.k-ward-title')).toHaveText('Amrul');
  await expect(card.locator('.k-ward-sub')).toContainText('Gram panchayat · Indus block · Bankura');
  await expect(card.locator('.k-area-role').first()).toContainText('MLA');
  await expect(card).toContainText('drinking water');
  await expect(card).toContainText('Bankura');
  await expect(card.locator('a', { hasText: 'Suggest a fix' })).toHaveAttribute('href', 'add-town.html?fix=area&level=gp&district=bankura&block=Indus&gp=Amrul');
  await card.locator('[data-area-level="district"]').click();
  await expect(card.locator('.k-ward-title')).toHaveText('Bankura');
  await expect(card.locator('.k-area-role').first()).toContainText('MLAs (12 seats)');
  await expect(card).toContainText('District Magistrate');
  await expect(card.locator('a', { hasText: 'district website' })).toHaveAttribute('href', 'https://bankura.gov.in/');
  await card.locator('[data-area-close]').click();
  await expect(card).toBeHidden();
});

test('a gram panchayat card names its BDO with the office phone from the district website', async ({ page, backend }) => {
  await page.goto('kasa.html');
  await expect.poll(() => page.evaluate(() => !!mainMap?.getLayer('wb-districts-line'))).toBe(true);
  await page.evaluate(() => { userMovedMap = true; mainMap.jumpTo({ center: [88.0163, 22.6129], zoom: 11 }); });
  await page.evaluate(() => openArea(22.6129, 88.0163));
  const card = page.locator('#k-area-card');
  await expect(card.locator('.k-ward-title')).toHaveText('Khosalpur');
  const bdo = card.locator('.k-area-row', { hasText: 'BDO · Amta-I' });
  await expect(bdo).toContainText('Adrita Samaddar');
  await expect(bdo.locator('a[href^="tel:"]')).toHaveAttribute('href', 'tel:03214260022');
});

test("where nobody is on record, anyone can add who's responsible with a source; approved names show with it", async ({ page, backend }) => {
  const calls = await stubBackend(page, { rpc: {
    kasa_submit_official: { ok: true, status: 'pending' },
    kasa_officials: [{ level: 'block', block: 'Indus', gp: null, role: 'bdo', name: 'Shri B. Officer', phone: '03244 000000',
                       source_url: 'https://bankura.gov.in/bdo-list.pdf', checked: '2026-09-30' }] } });
  await page.goto('kasa.html');
  await expect.poll(() => page.evaluate(() => !!mainMap?.getLayer('wb-districts-line'))).toBe(true);
  await page.evaluate(() => { userMovedMap = true; mainMap.jumpTo({ center: [87.5539, 23.1122], zoom: 11 }); });
  await page.evaluate(() => openArea(23.1122, 87.5539));
  const card = page.locator('#k-area-card');
  await expect(card.locator('.k-ward-title')).toHaveText('Amrul');
  const bdo = card.locator('.k-area-row', { hasText: 'BDO · Indus' });
  await expect(bdo).toContainText('Shri B. Officer');
  await expect(bdo.locator('a', { hasText: 'added by a reader' })).toHaveAttribute('href', 'https://bankura.gov.in/bdo-list.pdf');
  await card.locator('.k-area-row', { hasText: 'Pradhan' }).locator('[data-area-add]').click();
  const form = card.locator('.k-area-add');
  await expect(form.locator('select option')).toHaveText(['Pradhan']);
  await form.locator('[name=name]').fill('Smt. A. Pradhan');
  await form.locator('[name=src]').fill('https://bankurazp.org/pradhans.pdf');
  await form.locator('button[type=submit]').click();
  await expect(form).toBeHidden();
  const sent = calls.find(c => c.name === 'kasa_submit_official')?.body;
  expect(sent).toMatchObject({ p_level: 'gp', p_district: 'bankura', p_block: 'Indus', p_gp: 'Amrul', p_role: 'pradhan',
                               p_name: 'Smt. A. Pradhan', p_source_url: 'https://bankurazp.org/pradhans.pdf' });
});

test('every district shows its blocks and their names from the state view, like Purulia', async ({ page, backend }) => {
  await page.goto('kasa.html');
  await expect.poll(() => page.evaluate(() => !!mainMap?.getLayer('wb-blocks-label'))).toBe(true);
  await page.evaluate(() => { userMovedMap = true; mainMap.jumpTo({ center: [87.9, 23.6], zoom: 7 }); });
  await expect.poll(() => page.evaluate(() => mainMap.querySourceFeatures('wb-blocks').length), { timeout: 15000 }).toBeGreaterThan(100);
  const style = await page.evaluate(() => [mainMap.getPaintProperty('wb-blocks-line', 'line-color'), mainMap.getPaintProperty('blocks-line', 'line-color')]);
  expect(style[0]).toBe(style[1]);
});

test('a spot inside a Kolkata ward is Kolkata, not the neighbouring district or block, even where old outlines overlap', async ({ page, backend }) => {
  await page.goto('kasa.html');
  await expect.poll(() => page.evaluate(() => !!mainMap?.getLayer('wb-districts-line'))).toBe(true);
  const a = await page.evaluate(async () => { const x = await areasAt(22.50903, 88.30179); return [x.district.properties.slug, !!x.block, !!x.gp]; });
  expect(a).toEqual(['kolkata', false, false]);
});
