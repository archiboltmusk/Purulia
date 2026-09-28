import { test, expect } from '@playwright/test';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Every page must fit a 375px phone screen: no sideways scrolling. og-card.html is a fixed
// 1200px share image and isn't published.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pages = readdirSync(root).filter(f => f.endsWith('.html') && f !== 'og-card.html');

test.use({ viewport: { width: 375, height: 812 } });

for (const file of pages) {
  test(`${file} has no sideways scroll at 375px`, async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'phone width only');
    // No network beyond the local server, so a slow CDN can't hide or cause an overflow.
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => route.abort());
    await page.goto(file, { waitUntil: 'load' });
    await page.waitForTimeout(300);
    const { scroll, client } = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth
    }));
    expect(scroll, `${file} is ${scroll}px wide on a ${client}px screen`).toBeLessThanOrEqual(client);
  });
}
