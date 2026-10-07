import { test, expect } from './fixtures.mjs';

test('routes.html records a route, keeps it on the phone and opens a shared link', async ({ page, context }) => {
  await page.addInitScript(() => { navigator.share = async (d) => { window.__shared = d.url; }; });
  await context.setGeolocation({ latitude: 23.3321, longitude: 86.3655, accuracy: 5 });
  await page.goto('routes.html');
  await page.locator('[data-mode="cycle"]').click();
  await page.locator('#rt-go').click();
  await expect(page.locator('#rt-gps')).toContainText('GPS');
  // ~680 m north in 15 m steps, a fix every 400 ms (fast cycling, under the glitch limit).
  for (let i = 1; i <= 45; i++){
    await context.setGeolocation({ latitude: 23.3321 + i * 0.000135, longitude: 86.3655, accuracy: 5 });
    await page.waitForTimeout(400);
  }
  await expect.poll(async () => parseFloat(await page.locator('#rt-dist').textContent())).toBeGreaterThan(0.4);
  await page.locator('#rt-go').click();
  await expect(page.locator('.rt-item')).toHaveCount(1);
  await expect(page.locator('.rt-item')).toContainText('🚲 Cycle');

  await page.reload();
  await expect(page.locator('.rt-item')).toHaveCount(1);
  await page.locator('[data-act="share"]').click();
  const url = await page.evaluate(() => window.__shared);
  expect(url).toContain('routes.html?m=cycle');
  await page.goto(url);
  await expect(page.locator('#rt-shared')).toBeVisible();
  // First and last 200 m are hidden by default.
  const km = parseFloat((await page.locator('#rt-shared').textContent()).match(/([\d.]+) km/)[1]);
  expect(km).toBeGreaterThan(0.15);
  expect(km).toBeLessThan(0.5);
});
