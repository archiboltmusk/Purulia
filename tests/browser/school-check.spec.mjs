import { test, expect } from './fixtures.mjs';

const SCHOOL = { udise_code: '19141300203', name: 'ACHKODA PRY.', block_name: 'NETURIA', panchayat: 'RAIBANDH', village: 'Achkoda', lat: null, seen_lat: null };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });

// Calls answered by these stubs, which the shared backend stub never sees.
async function stubSchools(page, seen = {}){
  // One school: a single-row lookup by code gets the object, a block listing gets an array.
  await page.route('**/rest/v1/schools?*', route =>
    json(route, route.request().url().includes('udise_code=eq') ? SCHOOL : [SCHOOL]));
  await page.route('**/rest/v1/rpc/kasa_school_blocks', route => json(route, [{ block: 'NETURIA', schools: 1 }]));
  await page.route('**/rest/v1/rpc/kasa_school_check', route => {
    seen.check = route.request().postDataJSON();
    return json(route, { id: 'a1', moderation_status: 'approved', school: SCHOOL.name });
  });
  await page.route('**/rest/v1/rpc/kasa_submit_report_card', route => {
    seen.card = route.request().postDataJSON();
    return json(route, { id: 'c1', status: 'pending' });
  });
  await page.route('**/rest/v1/rpc/kasa_suggest_school', route => {
    seen.suggest = route.request().postDataJSON();
    return json(route, { id: 's1', status: 'pending' });
  });
  return seen;
}

async function shoot(page){
  await expect(page.locator('#k-cam-shutter')).toBeEnabled();
  await page.locator('#k-cam-shutter').click();
  await page.locator('#k-cam-use').click();
}

test('a report card is sent with its picture and the copied figures', async ({ page, backend }) => {
  const seen = await stubSchools(page);
  await page.goto('kasa.html?card=19141300203');
  await expect(page.locator('#k-rc-modal')).toHaveAttribute('aria-hidden', 'false');
  await expect(page.locator('#k-rc-how code')).toHaveText('19141300203');
  const submit = page.locator('#k-rc-submit');
  await expect(submit).toBeDisabled();
  await page.locator('#k-rc-file').setInputFiles({ name: 'card.png', mimeType: 'image/png', buffer: PNG });
  await page.locator('[data-rcnum="teachers"]').fill('3');
  await page.locator('[data-rcfact="girls_toilet"] [data-v="no"]').click();
  await page.locator('[data-rcfact="library"] [data-v="skip"]').click();
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect.poll(() => seen.card)
    .toMatchObject({ p_udise_code: '19141300203', p_year: '2024-25', p_figures: { teachers: 3, girls_toilet: false } });
  expect('library' in seen.card.p_figures).toBe(false);
  expect(backend.calls.some(c => c.kind === 'storage')).toBe(true);
});

test('a photo of a problem found in a school check goes on the report map', async ({ page, backend }) => {
  const seen = await stubSchools(page);
  await page.goto('kasa.html?school=19141300203');
  await expect(page.locator('#k-sc-picked')).toContainText('ACHKODA PRY.');
  const answer = (q, v) => page.locator(`#k-sc-qs [data-scq="${q}"] [data-v="${v}"]`).click();
  for (const q of ['water', 'boundary', 'electricity', 'mdm', 'meal_today']) await answer(q, 'yes');
  await answer('girls_toilet', 'unknown');
  await answer('building', 'good');
  await expect(page.locator('[data-probcam="toilets"]')).toBeHidden();
  await answer('toilets', 'no');
  await expect(page.locator('[data-probcam="toilets"]')).toBeVisible();
  await page.locator('[data-probcam="toilets"]').click();
  await shoot(page);
  await expect(page.locator('[data-probcam="toilets"]')).toHaveClass(/done/);
  await page.locator('#k-sc-cam-btn').click();
  await shoot(page);
  const submit = page.locator('#k-sc-submit');
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect.poll(() => backend.calls.find(c => c.kind === 'rpc' && c.name === 'kasa_create_report')?.body)
    .toMatchObject({ p_category: 'school', p_severity: 'severe', p_landmark: 'ACHKODA PRY.' });
  const report = backend.calls.find(c => c.name === 'kasa_create_report').body;
  expect(report.p_description).toContain('toilets not usable');
  expect(report.p_description).toContain('19141300203');
  expect(seen.check.p_toilets_ok).toBe(false);
  expect(seen.check.p_girls_toilet_ok).toBe(null);
});

test('a school missing from the list is sent with a gate photo for checking', async ({ page, backend }) => {
  const seen = await stubSchools(page);
  await page.goto('kasa.html?school=19141300203');
  await expect(page.locator('#k-sc-picked')).toContainText('ACHKODA PRY.');
  await page.locator('#k-sc-missing').click();
  await expect(page.locator('#k-ns-modal')).toHaveAttribute('aria-hidden', 'false');
  const submit = page.locator('#k-ns-submit');
  await page.locator('#k-ns-name').fill('Gopalpur New Primary School');
  await page.locator('#k-ns-block').selectOption('NETURIA');
  await expect(submit).toBeDisabled();
  await page.locator('#k-ns-cam-btn').click();
  await shoot(page);
  await page.locator('#k-ns-udise').fill('123');
  await expect(submit).toBeDisabled();
  await page.locator('#k-ns-udise').fill('');
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect.poll(() => seen.suggest)
    .toMatchObject({ p_name: 'Gopalpur New Primary School', p_block: 'NETURIA', p_udise_hint: null });
  expect(seen.suggest.p_photo_path).toMatch(/^reports\//);
  expect(typeof seen.suggest.p_lat).toBe('number');
});
