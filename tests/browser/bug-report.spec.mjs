import { test, expect } from './fixtures.mjs';

test('any page can send a bug report with the page, device and recent errors', async ({ page, backend }) => {
  await page.goto('promises.html');
  await page.evaluate(() => console.error('Test error from the page'));
  const fab = page.locator('.br-fab');
  await expect(fab).toBeVisible();
  await fab.click();
  await page.locator('#br-what').fill('Hi');
  await page.locator('.br-send').click();
  await expect(page.locator('.br-msg')).toHaveClass(/br-err/);
  await page.locator('#br-what').fill('The filter chips do nothing');
  await page.locator('.br-send').click();
  await expect(page.locator('#br-title')).toHaveText('Thank you! We will look into it.');
  const call = backend.calls.find(c => c.kind === 'rpc' && c.name === 'kasa_bug_submit');
  expect(call).toBeTruthy();
  const body = typeof call.body === 'string' ? JSON.parse(call.body) : call.body;
  expect(body.p_what).toBe('The filter chips do nothing');
  expect(body.p_page_url).toContain('promises.html');
  expect(body.p_device.viewport).toMatch(/^\d+x\d+$/);
  expect(body.p_errors.some(e => e.includes('Test error from the page'))).toBe(true);
});

test('the map opens the bug form from its menu, with no extra floating button', async ({ page, backend }) => {
  await page.goto('kasa.html');
  await expect(page.locator('.br-fab')).toHaveCount(0);
  await page.evaluate(() => document.querySelector('.k-drawer [data-bug-report]').click());
  await expect(page.locator('.br-box')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.br-box')).toHaveCount(0);
});
