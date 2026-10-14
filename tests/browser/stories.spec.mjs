import { test, expect } from './fixtures.mjs';

const reply = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });

test('data.html shows published stories beside the figures, and sends a new one with consent and link', async ({ page, backend }) => {
  await page.route('**/rest/v1/rpc/kasa_stories', route => reply(route, [{ id: 1, stat_label: 'Rural Jobs Guarantee',
    story: 'He went to Kerala in 2023 after the job cards stopped paying, and sends money home each month.', place: 'Jhalda',
    source_url: 'https://example.org/published-story' }]));
  await page.goto('data.html');
  await expect(page.locator('.st-item')).toHaveCount(1);
  await expect(page.locator('.st-item a')).toHaveAttribute('href', 'https://example.org/published-story');
  await page.locator('.st-add summary').click();
  await expect(page.locator('#st-stat option')).not.toHaveCount(1);
  await page.locator('#st-stat').selectOption({ index: 1 });
  await page.locator('#st-form [name="story"]').fill('A mother in our village told the district paper she waited three days for an ambulance to the block hospital.');
  await page.locator('#st-form [name="source"]').fill('https://example.org/paper');
  await page.locator('#st-form [name="consent"]').check();
  await page.locator('#st-form button[type="submit"]').click();
  await expect(page.locator('#st-msg')).toContainText('A moderator will open the link');
  const sent = backend.calls.find(c => c.name === 'kasa_submit_story');
  expect(sent.body.p_consent).toBe(true);
  expect(sent.body.p_source_url).toBe('https://example.org/paper');
});
