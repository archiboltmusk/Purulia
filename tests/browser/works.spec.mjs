import { test, expect } from './fixtures.mjs';

test('works page lists the clues still missing for each work and opens the correction form for one', async ({ page, backend }) => {
  await page.route('**/rest/v1/rpc/kasa_public_works', route => route.fulfill({ status: 200, contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify([{ id: 4, work_name: 'Drain at Station Road', agency: 'Purulia Municipality',
      contractor: null, work_order: 'WO/12', cost: null, completed_on: '2025-03-01', dlp_years: null, warranty_until: null, under_warranty: false,
      lat: 23.33, lng: 86.36, photo_url: 'https://example.org/b.jpg', ward_no: 5 }]) }));
  await page.goto('works.html');
  const row = page.locator('#wk-clues tbody tr');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Contractor, Cost, Defect liability period');
  await row.locator('[data-source-fix]').click();
  await expect(page.locator('#sf-what')).toHaveValue(/Works board #4, Drain at Station Road/);
});
