import { test, expect } from './fixtures.mjs';

const DEMANDS = [
  { id: 'd1', leader_role: 'mla', leader_name: 'Test MLA', leader_area: 'Purulia', title: 'A footbridge over the canal at ward 5',
    details: 'Children walk two kilometres around the canal to reach school every day.', place: 'Ward 5', supports: 12,
    created_at: '2026-09-20T00:00:00Z', published_at: '2026-09-21T00:00:00Z',
    promise: { id: 'p1', status: 'in_progress', promise: 'Footbridge by March', who: 'Test MLA' },
    replies: [{ reply: 'Work will start after the monsoon.', said_on: '2026-09-25', source_url: 'https://example.com/reply', source_name: 'Example News' }] },
  { id: 'd2', leader_role: 'chairman', leader_name: 'Test Chairman', leader_area: 'Purulia Municipality', title: 'Streetlights on Ranchi Road',
    details: 'The road is dark after seven and people coming back from the station are afraid.', place: null, supports: 3,
    created_at: '2026-09-26T00:00:00Z', published_at: '2026-09-26T00:00:00Z', promise: null, replies: [] }
];

const serve = (page, extra = {}) => page.route('**/rest/v1/rpc/kasa_demands', route => route.fulfill({
  status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(DEMANDS), ...extra }));

test('noticeboard lists demands with replies, promise links, filters and +1', async ({ page, backend }) => {
  await serve(page);
  await page.route('**/rest/v1/rpc/kasa_demand_support', route => route.fulfill({
    status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ counted: true, supports: 4 }) }));
  await page.goto('noticeboard.html');
  await expect(page.locator('#nb-n-all')).toHaveText('2');
  await expect(page.locator('#nb-n-supports')).toHaveText('15');
  await expect(page.locator('.nb-item')).toHaveCount(2);
  await expect(page.locator('.nb-item').first().locator('.nb-title')).toHaveText('A footbridge over the canal at ward 5');
  await expect(page.locator('#d-d1 a[href="https://example.com/reply"]')).toBeVisible();
  await expect(page.locator('#d-d1 a[href="promises.html#p-p1"]')).toBeVisible();

  await page.locator('#nb-role-chips [data-role="chairman"]').click();
  await expect(page.locator('.nb-item')).toHaveCount(1);
  await page.locator('[data-support="d2"]').click();
  await expect(page.locator('#d-d2 .nb-count')).toContainText('4');
  await expect(page.locator('[data-support="d2"]')).toBeDisabled();

  await page.locator('.pr-lang [data-lang="hi"]').click();
  await expect(page.locator('#nb-demands h2')).toHaveText('माँगें');
});

test('posting a demand needs the community tick and goes for review', async ({ page, backend }) => {
  await serve(page);
  await page.goto('noticeboard.html');
  const f = page.locator('#nb-form');
  await f.locator('[name="leader"]').selectOption('councillor');
  await f.locator('[name="ward"]').selectOption('5');
  await f.locator('[name="title"]').fill('A new drain on Station Road');
  await f.locator('[name="details"]').fill('Every monsoon the road floods and shops along it close for days.');
  await page.locator('#nb-submit').click();
  await expect(page.locator('#nb-msg')).toHaveClass(/err/);
  expect(backend.calls.find(c => c.name === 'kasa_demand_submit')).toBeUndefined();

  await f.locator('[name="community"]').check();
  await page.locator('#nb-submit').click();
  await expect(page.locator('#nb-msg')).toContainText('moderator');
  const call = backend.calls.find(c => c.name === 'kasa_demand_submit');
  expect(call.body).toMatchObject({ p_leader_role: 'councillor', p_leader_name: 'Test Councillor', p_leader_area: 'Ward 5', p_for_community: true });
});

test('adding a leader reply sends it with its link', async ({ page, backend }) => {
  await serve(page);
  await page.goto('noticeboard.html');
  await page.locator('[data-reply="d2"]').click();
  const f = page.locator('#nb-reply-form');
  await f.locator('[name="reply"]').fill('Lights will be installed this month.');
  await f.locator('[name="said_on"]').fill('2026-09-26');
  await f.locator('[name="source_url"]').fill('https://example.com/chairman-post');
  await page.locator('#nb-reply-submit').click();
  await expect(page.locator('#nb-reply-msg')).toContainText('moderator');
  const call = backend.calls.find(c => c.name === 'kasa_demand_reply_suggest');
  expect(call.body).toMatchObject({ p_demand: 'd2', p_source_url: 'https://example.com/chairman-post' });
});
