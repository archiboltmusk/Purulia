import { test, expect } from './fixtures.mjs';

const DATA = {
  promises: [
    { id: 'a1', who: 'Test Minister', role: 'Minister', promise: 'Piped water to every home in the district', area: 'District',
      made_on: '2026-08-17', source_url: 'https://example.com/said', source_name: 'Example News', status: 'delivered',
      status_source_url: 'https://example.com/done', status_date: '2026-09-01' },
    { id: 'a2', who: 'Other Person', role: 'MLA', promise: 'A new bridge over the river by next year',
      made_on: '2026-07-01', source_url: 'https://example.com/bridge', status: 'promised' }
  ],
  news: [{ id: 1, url: 'https://example.com/n1', title: 'Test Minister opens water works in Purulia', source: 'Example', published_at: '2026-09-20T00:00:00Z', who: 'Test Minister' }],
  news_checked_at: '2026-09-27T01:15:00Z'
};

test('promises.html lists promises with sources, filters and news', async ({ page, backend }) => {
  await page.route('**/rest/v1/rpc/kasa_promises', route => route.fulfill({
    status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(DATA) }));
  await page.goto('promises.html');
  await expect(page.locator('#pr-n-all')).toHaveText('2');
  await expect(page.locator('#pr-n-delivered')).toHaveText('1');
  await expect(page.locator('.pr-item')).toHaveCount(2);
  await expect(page.locator('.pr-item').first().locator('a[href="https://example.com/said"]')).toBeVisible();
  await expect(page.locator('#pr-feed li')).toHaveCount(1);

  await page.locator('#pr-status-chips [data-status="promised"]').click();
  await expect(page.locator('.pr-item')).toHaveCount(1);
  await expect(page.locator('.pr-item .pr-who')).toHaveText('Other Person');

  await page.locator('.pr-lang [data-lang="bn"]').click();
  await expect(page.locator('#pr-news h2')).toHaveText('সাম্প্রতিক খবর');
});

test('suggesting an update sends it for review', async ({ page, backend }) => {
  await page.route('**/rest/v1/rpc/kasa_promises', route => route.fulfill({
    status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(DATA) }));
  await page.goto('promises.html');
  await page.locator('[data-upd="a2"]').click();
  const f = page.locator('#pr-form');
  await f.locator('[name="status"]').selectOption('in_progress');
  await f.locator('[name="status_source_url"]').fill('https://example.com/work-started');
  await f.locator('[name="status_date"]').fill('2026-09-10');
  await page.locator('#pr-submit').click();
  await expect(page.locator('#pr-msg')).toContainText('moderator');
  const call = backend.calls.find(c => c.name === 'kasa_promise_suggest');
  expect(call.body).toMatchObject({ p_update_of: 'a2', p_status: 'in_progress', p_status_source_url: 'https://example.com/work-started' });
});

test('each MP and MLA shows their promises or "No promise on record"', async ({ page }) => {
  const data = { ...DATA, promises: [...DATA.promises, { id: 'a3', who: 'Sudip Kumar Mukherjee', role: 'MLA', promise: 'A new drain along the main road',
    made_on: '2026-07-01', source_url: 'https://example.com/drain', status: 'promised' }] };
  await page.route('**/rest/v1/rpc/kasa_promises', route => route.fulfill({
    status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(data) }));
  await page.goto('promises.html');
  const reps = page.locator('#pr-reps li');
  await expect(reps).toHaveCount(10);
  await expect(reps.filter({ hasText: 'Mamoni Bauri' })).toContainText('No promise on record');
  await reps.filter({ hasText: 'Sudip Kumar Mukherjee' }).getByRole('button', { name: '1 on record' }).click();
  await expect(page.locator('.pr-item')).toHaveCount(1);
  await expect(page.locator('.pr-item .pr-who')).toHaveText('Sudip Kumar Mukherjee');
});
