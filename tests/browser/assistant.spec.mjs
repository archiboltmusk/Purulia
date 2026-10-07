import { test, expect } from './fixtures.mjs';

const fn = (status, body) => route => route.fulfill({ status, contentType: 'application/json',
  headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });

test('assistant sends the question with the chosen language and links page names in the answer', async ({ page, backend }) => {
  let sent = null;
  await page.route('**/functions/v1/kasa-assistant', route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } });
    sent = route.request().postDataJSON();
    return fn(200, { ok: true, answer: 'Open kasa.html and take a live photo <b>here</b>.' })(route);
  });
  await page.goto('assistant.html');
  await page.locator('.cm-lang [data-lang="bn"]').click();
  await expect(page.locator('#as-send')).toHaveText('জিজ্ঞাসা');
  await page.locator('#as-starters button').first().click();
  await expect(page.locator('.as-msg.bot a[href="kasa.html"]')).toBeVisible();
  await expect(page.locator('.as-msg.bot b')).toHaveCount(0); // model text is escaped
  expect(sent.lang).toBe('bn');
  expect(sent.messages.at(-1).role).toBe('user');
});

test('assistant explains the daily limit', async ({ page, backend }) => {
  await page.route('**/functions/v1/kasa-assistant', fn(429, { error: 'daily_limit' }));
  await page.goto('assistant.html');
  await page.locator('#as-input').fill('Who fixes streetlights?');
  await page.locator('#as-send').click();
  await expect(page.locator('.as-msg.err')).toContainText("today's question limit");
});
