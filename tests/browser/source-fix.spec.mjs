import { test, expect } from './fixtures.mjs';

test('a data page offers "Suggest a correction" and the email, and sends the figure with its source', async ({ page, backend }) => {
  await page.goto('data.html');
  const note = page.locator('.sf-note');
  await expect(note).toContainText('thelosthillproject@gmail.com');
  await note.locator('[data-source-fix]').click();
  await page.locator('#sf-what').fill('38 per 1,000 infant mortality');
  await page.locator('#sf-fix').fill('The district page now says 35');
  await page.locator('#sf-src').fill('not a link');
  await page.locator('.sf-box .br-send').click();
  await expect(page.locator('.sf-box .br-msg')).toHaveClass(/br-err/);
  await page.locator('#sf-src').fill('https://purulia.gov.in/health/');
  await page.locator('.sf-box .br-send').click();
  await expect(page.locator('#sf-title')).toContainText('Thank you');
  const call = backend.calls.find(c => c.kind === 'rpc' && c.name === 'kasa_suggest_data_fix');
  expect(call).toBeTruthy();
  const body = typeof call.body === 'string' ? JSON.parse(call.body) : call.body;
  expect(body.p_what).toBe('38 per 1,000 infant mortality');
  expect(body.p_source_url).toBe('https://purulia.gov.in/health/');
  expect(body.p_page).toContain('data.html');
});

test('a figure without a linked source gets a "source?" mark that prefills the form', async ({ page }) => {
  await page.goto('data.html');
  const chip = page.locator('.sf-chip').first();
  await expect(chip).toHaveText('source?');
  await chip.click();
  await expect(page.locator('#sf-what')).not.toHaveValue('');
});

test('the report map adds no correction line of its own', async ({ page }) => {
  await page.goto('kasa.html');
  await page.waitForFunction(() => window.SourceFix);
  await expect(page.locator('.sf-note')).toHaveCount(0);
});
