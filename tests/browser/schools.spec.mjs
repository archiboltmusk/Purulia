import { test, expect } from './fixtures.mjs';

const base = { lat: null, lng: null, panchayat: 'Test GP', management: null, category: null, located: null,
  photo_url: null, official: null, official_year: null, teachers_seen: null, girls_toilet_ok: null, meal_today_ok: null };
const SCHOOLS = [
  { ...base, udise_code: '19141300203', name: 'Good School', block_name: 'NETURIA', village: 'A', audits: 1,
    last_audit_at: '2026-09-27T10:00:00Z', water_ok: true, toilets_ok: true, boundary_ok: true, electricity_ok: true, mdm_ok: true,
    girls_toilet_ok: true, meal_today_ok: true, building_condition: 'good', score: 8, score_of: 8, teachers_seen: 4 },
  { ...base, udise_code: '19141300204', name: 'Poor School', block_name: 'NETURIA', village: 'B', audits: 1,
    last_audit_at: '2026-09-27T10:00:00Z', water_ok: false, toilets_ok: false, boundary_ok: false, electricity_ok: false, mdm_ok: true,
    girls_toilet_ok: false, meal_today_ok: null, building_condition: 'needs_repair', score: 1, score_of: 7, teachers_seen: 1,
    official: { enrolment: 120, teachers: 4, drinking_water: true, girls_toilet: true, electricity: false }, official_year: '2024-25' },
  { ...base, udise_code: '19141300205', name: 'Unchecked School', block_name: 'PARA', village: 'C', audits: 0, last_audit_at: null,
    water_ok: null, toilets_ok: null, boundary_ok: null, electricity_ok: null, mdm_ok: null, building_condition: null, score: null, score_of: null }
];

test('schools.html compares Purulia with West Bengal and India, and shows official records beside checks', async ({ page, backend }) => {
  await page.route('**/rest/v1/rpc/kasa_school_coverage*', route => route.fulfill({
    status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(SCHOOLS) }));
  await page.goto('schools.html');
  await expect(page.locator('#sc-t-listed')).toHaveText('3');

  const cmp = page.locator('#sc-compare table');
  await expect(cmp).toBeVisible();
  const water = cmp.locator('tr', { hasText: 'Working drinking water' });
  await expect(water).toContainText('50.0%');   // residents: 1 of 2 checked schools
  await expect(water).toContainText('99.9%');   // West Bengal, UDISE+ 2024-25
  await expect(water).toContainText('Meghalaya');
  await expect(page.locator('#sc-compare a[href*="udiseplus.gov.in"]')).toHaveCount(1);

  await expect(page.locator('#sc-bestworst')).toContainText('Best checked: Good School');
  await expect(page.locator('.sc-row').first()).toContainText('Poor School');   // worst first
  const poor = page.locator('#s-19141300204');
  await expect(poor.locator('.sc-off')).toContainText('120 pupils');
  await expect(poor.locator('.sc-gap')).toContainText("drinking water, girls' toilet, teachers (1 of 4 seen)");
  await expect(poor.locator('.sc-bench')).toContainText('Across West Bengal, 99.9% of schools report working drinking water');
});
