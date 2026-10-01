import { test, expect } from '@playwright/test';
import { stubBackend } from './fixtures.mjs';

const DRIVE = { id: 'd1', title: 'Test cleanup drive', place: 'purulia', starts_at: new Date(Date.now() + 20 * 3600e3).toISOString(),
  meet_point: 'Bus stand gate', end_point: 'Market temple', organisers: [{ name: 'Test group', url: 'https://example.com/g' }],
  provided: 'Gloves and masks', notes: null, route: [[86.3640, 23.3315], [86.3654, 23.3321], [86.3670, 23.3330]], hidden: false, going: 3 };

test('a cleanup drive shows one banner, and its card lists the open reports on the route', async ({ page }) => {
  await page.addInitScript(() => { try { for (const k of ['kasa_tips_done', 'kasa_loc_asked']) localStorage.setItem(k, '1'); } catch (e) {} });
  const calls = await stubBackend(page, { rpc: { kasa_drives: [DRIVE], kasa_drive_going: { going: 4 } } });
  await page.goto('kasa.html');
  const banner = page.locator('#k-drive-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('Bus stand gate');
  await expect(page.locator('#k-join')).toBeHidden();
  await banner.locator('button').click();
  const card = page.locator('#k-drive-card');
  await expect(card).toContainText('Test cleanup drive');
  await expect(card).toContainText('Market temple');
  await expect(card).toContainText('2 unresolved reports on the route');
  await expect.poll(() => page.evaluate(() => mainMap.getSource('drive-pins')?.serialize().data.features.length)).toBe(2);
  await card.locator('[data-drive-going]').click();
  await expect(card).toContainText('4 people said they’re coming');
  expect(calls.some(c => c.name === 'kasa_drive_going' && c.body.p_id === 'd1')).toBe(true);
  await page.screenshot({ path: 'test-results/drive-card.png' });
});
