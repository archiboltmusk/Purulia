import { test, expect } from './fixtures.mjs';

// Every page that loads MapLibre GL JS (ESM build via maplibre-global.mjs) gets a live map.
const pages = ['schools.html', 'toilets.html', 'waste.html', 'money.html', 'routes.html', 'add-town.html'];

for (const p of pages){
  test(`${p} loads MapLibre and creates a map without errors`, async ({ page, backend }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(p);
    await expect.poll(() => page.evaluate(() => typeof window.maplibregl?.Map)).toBe('function');
    await expect.poll(() => page.locator('.maplibregl-canvas').count(), { timeout: 15_000 }).toBeGreaterThan(0);
    expect(errors.filter(e => !/supabase|fetch|Failed to fetch/i.test(e))).toEqual([]);
  });
}
