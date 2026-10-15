import { test, expect } from './fixtures.mjs';

// White is the default on every page; dark stays a choice that is remembered per device.
const PAGES = ['index.html', 'schools.html', 'promises.html', 'kasa.html'];

for (const p of PAGES) {
  test(`${p} opens white by default`, async ({ page, backend }) => {
    await page.goto(p);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });
}

test('a dark choice is remembered on the device for other pages', async ({ page, backend }) => {
  await page.goto('kasa.html');
  await page.evaluate(() => localStorage.setItem('parishkar_theme', 'dark'));
  await page.goto('schools.html');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.evaluate(() => localStorage.removeItem('parishkar_theme'));
  await page.goto('schools.html');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});
