import { test, expect } from './fixtures.mjs';

const bn = async (page) => page.addInitScript(() => { try { localStorage.setItem('kasa_lang', 'bn'); } catch (e) {} });

test('Bengali only: the toggle sits in the map menu and sends a better line for the tapped text', async ({ page, backend }) => {
  await page.goto('kasa.html');
  await expect(page.locator('.tf-toggle')).toHaveCount(1);
  await expect(page.locator('.tf-toggle')).toBeHidden();
  await page.evaluate(() => document.querySelector('.k-drawer .k-lang-btn[data-lang="bn"]').click());
  await expect(page.locator('.tf-toggle')).toHaveText('✎ অনুবাদ ঠিক করুন');
  await page.evaluate(() => document.querySelector('.tf-toggle').click());
  await expect(page.locator('.tf-bar')).toBeVisible();
  const line = page.locator('button [data-i18n]:visible, button[data-i18n]:visible').first();
  const key = await line.getAttribute('data-i18n');
  const now = await page.evaluate(k => window.KASA_I18N.bn[k], key);
  const en = await page.evaluate(k => window.KASA_I18N.en[k], key);
  await line.click();
  await expect(page.locator('.tf-box')).toBeVisible();
  await expect(page.locator('.tf-box')).toContainText(en);
  await page.locator('#tf-new').fill('এখনই জানান');
  await page.locator('.tf-send').click();
  await expect(page.locator('#tf-title')).toHaveText('ধন্যবাদ! একজন মডারেটর দেখে নিলে সাইটে দেখাবে।');
  const call = backend.calls.find(c => c.kind === 'rpc' && c.name === 'kasa_suggest_translation');
  const body = typeof call.body === 'string' ? JSON.parse(call.body) : call.body;
  expect(body).toMatchObject({ p_ns: 'kasa', p_key: key, p_current: now, p_suggested: 'এখনই জানান' });
  await page.locator('.tf-box button').click();
  await page.locator('.tf-bar button').click();
  await expect(page.locator('.tf-bar')).toHaveCount(0);
});

test('approved wording replaces the built-in line on a static page', async ({ page, backend }) => {
  await bn(page);
  await page.route('**/rest/v1/rpc/kasa_translations', route => route.fulfill({
    status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify({ ward: { w4: ', সবার সামনে খতিয়ান' } }) }));
  await page.goto('ward.html');
  await expect(page.locator('[data-t="w4"]')).toHaveText(', সবার সামনে খতিয়ান');
  await expect(page.locator('.pl-lang + .tf-toggle')).toBeVisible();
});
