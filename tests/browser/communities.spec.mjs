import { test, expect } from './fixtures.mjs';

const LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const LIST = [
  { id: 'c1', name: 'Saheb Bandh Friends', tagline: 'Sunday cleanups around Saheb Bandh', description: null, all_district: false,
    wards: [5], blocks: ['Jhalda I'], logo: LOGO, listed_at: '2026-09-27T00:00:00Z',
    links: { whatsapp: 'https://chat.whatsapp.com/abc', instagram: 'https://www.instagram.com/sahebbandh' } },
  { id: 'c2', name: 'Purulia Green Riders', tagline: 'Tree planting across the district', description: 'Join us on weekends.', all_district: true,
    wards: [], blocks: [], logo: LOGO, listed_at: '2026-09-26T00:00:00Z', links: { x: 'https://x.com/greenriders' } },
  { id: 'c3', name: 'Two District Crew', tagline: 'Plogging', description: null, all_district: true, districts: ['bankura', 'purulia'],
    wards: [], blocks: [], logo: LOGO, listed_at: '2026-09-25T00:00:00Z',
    links: { instagram: 'https://www.instagram.com/crew', phone: '9876543210', email: 'hi@crew.org' } }
];
const ok = (body) => route => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });

test('communities list shows cards with logo, place and link chips, and filters by place', async ({ page, backend }) => {
  await page.route('**/rest/v1/kasa_public_communities*', ok(LIST));
  await page.goto('communities.html');
  await expect(page.locator('.cm-card')).toHaveCount(3);
  await expect(page.locator('#c-c3 .cm-where')).toContainText('Works across Bankura and Purulia districts');
  await expect(page.locator('#c-c3 a.cm-chip[href="tel:+919876543210"]')).toBeVisible();
  await expect(page.locator('#c-c3 a.cm-chip[href="mailto:hi@crew.org"]')).toBeVisible();
  await page.locator('#cm-where').selectOption('d:bankura');
  await expect(page.locator('.cm-card')).toHaveCount(1);
  await page.locator('#cm-where').selectOption('');
  const first = page.locator('#c-c1');
  await expect(first.locator('.cm-where')).toContainText('Ward 5, Jhalda I block');
  await expect(first.locator('a.cm-chip[href="https://www.instagram.com/sahebbandh"]')).toContainText('sahebbandh');
  await expect(first.locator('img.cm-logo')).toHaveAttribute('src', /^data:image\/png/);
  await expect(page.locator('#c-c2 .cm-where')).toContainText('Works across Purulia district');

  await page.locator('#cm-where').selectOption('w7');
  await expect(page.locator('.cm-card')).toHaveCount(2); // the district-wide ones
  await page.locator('#cm-where').selectOption('b:Jhalda I');
  await expect(page.locator('.cm-card')).toHaveCount(3);

  await page.locator('.cm-lang [data-lang="bn"]').click();
  await expect(page.locator('#cm-open')).toContainText('নিজের দল যুক্ত করুন');
});

test('registering a community needs a link and a logo, and sends the private contact separately', async ({ page, backend }) => {
  await page.route('**/rest/v1/kasa_public_communities*', ok([]));
  await page.goto('communities.html?ward=5');
  await expect(page.locator('.cm-empty')).toBeVisible();
  await page.locator('#cm-open').click();
  await page.locator('#cm-name').fill('Station Road Cleaners');
  await page.locator('#cm-tag').fill('Weekly cleanups near the station');
  await expect(page.locator('#cm-picked')).toContainText('Ward 5');
  await page.locator('#cm-areaq').fill('jhal');
  await page.locator('#cm-areas [data-add="b:Jhalda II"]').click();
  await page.locator('#cm-cname').fill('Test Person');
  await page.locator('#cm-cphone').fill('+91 98765 43210');
  await page.locator('#cm-adult').check();

  await page.locator('#cm-submit').click();
  await expect(page.locator('#cm-msg')).toContainText('at least one link');

  await page.locator('[data-net="instagram"]').fill('@stationroad');
  await page.locator('[data-net-add="website"]').click();
  await page.locator('[data-net="website"]').fill('stationroad.org');
  await page.locator('#cm-submit').click();
  await expect(page.locator('#cm-msg')).toContainText('logo');
  expect(backend.calls.find(c => c.name === 'kasa_register_community')).toBeUndefined();

  await page.locator('#cm-logo').setInputFiles({ name: 'logo.png', mimeType: 'image/png',
    buffer: Buffer.from(LOGO.split(',')[1], 'base64') });
  await expect(page.locator('#cm-logobox img')).toBeVisible();
  await page.locator('#cm-submit').click();
  await expect(page.locator('#cm-msg')).toContainText('Parishkar team will check');
  const call = backend.calls.find(c => c.name === 'kasa_register_community');
  expect(call.body).toMatchObject({
    p_name: 'Station Road Cleaners', p_all_district: false, p_wards: [5], p_blocks: ['Jhalda II'],
    p_links: { instagram: 'https://www.instagram.com/stationroad', website: 'https://stationroad.org' },
    p_contact_name: 'Test Person', p_contact_phone: '9876543210', p_adult: true });
  expect(call.body.p_logo).toMatch(/^data:image\/jpeg;base64,/);
});
