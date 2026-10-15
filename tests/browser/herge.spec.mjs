import { test, expect } from './fixtures.mjs';

const SHOTS = process.env.SHOTS;

const reply = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
const ago = h => new Date(Date.now() - h * 3600000).toISOString();

test('ward page tells the story in four chapters and draws the ward with report dots', async ({ page, backend }) => {
  // Two reports inside ward 5's outline: one waiting (seen again by a neighbour), one fixed.
  await page.route('**/rest/v1/kasa_public_reports*', route => reply(route, [
    { id: 101, created_at: ago(300), lat: 23.327, lng: 86.355, ward_no: 5, category: 'garbage', status: 'open', landmark: 'Bus stand', sla_days: 7, seen_on_site: 2, area_kind: 'town' },
    { id: 104, created_at: ago(200), lat: 23.325, lng: 86.352, ward_no: 5, category: 'garbage', status: 'resolved', landmark: 'Market', sla_days: 7, resolved_at: ago(20), seen_on_site: 0, area_kind: 'town' }
  ]));
  await page.goto('ward.html?ward=5');
  await expect(page.locator('#wd-chapters li')).toHaveCount(4);
  await expect(page.locator('#wd-chapters li').first()).toContainText('2 of 2');
  await expect(page.locator('#wd-endpaper svg path').first()).toBeVisible();
  await expect(page.locator('#wd-endpaper a[href="case.html?id=101"]')).toHaveCount(1);
  if (SHOTS) await page.locator('#wd-grid').screenshot({ path: SHOTS + '/ward.png' });
});

test('empty ward page shows the guide', async ({ page, backend }) => {
  await page.goto('ward.html?block=Arsha');
  await expect(page.locator('#wd-empty .mitu-guide')).toBeVisible();
  if (SHOTS) await page.locator('#wd-empty').screenshot({ path: SHOTS + '/ward-empty.png' });
});

test('case file saves an album cover', async ({ page, backend }) => {
  await page.goto('case.html?id=101');
  await expect(page.locator('#cf-cover')).toBeVisible();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#cf-cover').click()]);
  expect(dl.suggestedFilename()).toBe('parishkar-case-101.png');
  if (SHOTS) await dl.saveAs(SHOTS + '/cover.png');
});
