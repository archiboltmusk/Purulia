import { test, expect, REPORTS } from './fixtures.mjs';

const mapReportIds = (page) => page.evaluate(() => {
  const src = typeof mainMap !== 'undefined' && mainMap && mainMap.getSource('reports');
  return src ? src.serialize().data.features.map(f => String(f.properties.id)).sort() : null;
});

test('kasa.html loads and shows report counts', async ({ page, backend }) => {
  await page.goto('kasa.html');
  await expect(page.locator('#k-pill-total')).toHaveText(String(REPORTS.length));
  await expect(page.locator('#k-pill-active')).toHaveText('2');
  expect(backend.calls.some(c => c.kind === 'table' && c.name === 'kasa_public_reports')).toBe(true);
});

test('map renders with the reports', async ({ page, backend }) => {
  await page.goto('kasa.html');
  await expect(page.locator('#k-map canvas.maplibregl-canvas')).toBeVisible();
  await expect.poll(() => mapReportIds(page)).toEqual(REPORTS.map(r => String(r.id)).sort());
});

test('map controls do not overlap each other', async ({ page, backend }) => {
  await page.goto('kasa.html');
  await expect(page.locator('#k-pill-total')).toHaveText(String(REPORTS.length));
  await expect(page.locator('#k-fixed-chip')).toBeVisible();
  // Every floating control on the map screen, including ones added later (the Resolved button
  // that landed on the count pill in #117 was a new button nobody checked).
  const boxes = await page.evaluate(() => {
    const els = document.querySelectorAll('.k-nav, .k-map-topbar > :not(.k-filter-bar), .k-map-section > button, .k-map-pill, .k-map-legend');
    const out = {};
    for (const el of els){
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden') continue;
      out[el.id ? '#' + el.id : '.' + [...el.classList].join('.')] = { x: r.x, y: r.y, width: r.width, height: r.height };
    }
    return out;
  });
  const hit = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  const names = Object.keys(boxes);
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++){
    expect(hit(boxes[names[i]], boxes[names[j]]), `${names[i]} overlaps ${names[j]}`).toBe(false);
  }
});

test('report form opens with the camera', async ({ page, backend }) => {
  await page.goto('kasa.html');
  await expect(page.locator('#k-pill-total')).toHaveText(String(REPORTS.length));
  await page.locator('.k-map-report-btn').click();
  await expect(page.locator('#k-modal')).toHaveClass(/\bopen\b/);
  const shutter = page.locator('#k-cam-shutter');
  await expect(shutter).toBeEnabled();
  await shutter.click();
  await page.locator('#k-cam-use').click();
  await expect(page.locator('#k-photo-preview img')).toBeVisible();
});

test('camera preview is the square that gets saved, with nothing on top of it', async ({ page, backend }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('kasa.html');
  await expect(page.locator('#k-pill-total')).toHaveText(String(REPORTS.length));
  await page.locator('.k-map-report-btn').click();
  await expect(page.locator('#k-cam-shutter')).toBeEnabled();
  await expect(page.locator('#k-cam .k-cam-hint')).toBeVisible();
  const box = sel => page.locator(sel).boundingBox();
  const stage = await box('#k-cam .k-cam-stage');
  expect(Math.abs(stage.width - stage.height)).toBeLessThan(2);
  const hit = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  for (const sel of ['#k-cam-close', '#k-cam-shutter', '#k-cam-tools', '#k-cam .k-cam-head']){
    const b = await box(sel);
    expect(b.y + b.height, `${sel} fits on screen`).toBeLessThanOrEqual(844);
    expect(hit(stage, b), `${sel} overlaps the preview`).toBe(false);
  }
});

test('confirm flow sends a verify vote for the claim', async ({ page, backend }) => {
  await page.goto('kasa.html?report=102');
  await expect(page.locator('#k-sheet')).toHaveClass(/\bopen\b/);
  await page.locator('[data-evidence="verify:102"]').click();
  await expect(page.locator('#k-ev-modal')).toHaveClass(/\bopen\b/);
  await expect(page.locator('#k-ev-loc-status')).toHaveClass(/k-ev-ok/);
  await page.locator('#k-ev-cam-btn').click();
  await expect(page.locator('#k-cam-shutter')).toBeEnabled();
  await page.locator('#k-cam-shutter').click();
  await page.locator('#k-cam-use').click();
  const submit = page.locator('#k-ev-submit');
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.locator('#k-toast')).toContainText('2');
  const vote = backend.calls.find(c => c.kind === 'rpc' && c.name === 'kasa_vote_claim');
  expect(vote?.body).toMatchObject({ p_claim_id: 9001, p_vote: 'verify' });
});

test('Santali shows the page in Ol Chiki', async ({ page, backend }) => {
  await page.addInitScript(() => localStorage.setItem('kasa_lang', 'sat'));
  await page.goto('kasa.html');
  await expect(page.locator('html')).toHaveAttribute('lang', 'sat');
  await expect(page.locator('[data-i18n="step3_submit"]').first()).toHaveText(/[᱐-᱿]/);
  // Strings not yet translated fall back to English rather than showing the raw key.
  await expect(page.locator('[data-i18n="footer_privacy"]').first()).not.toHaveText('footer_privacy');
});

test('report form sends the picked severity and waste type', async ({ page, backend }) => {
  await page.goto('kasa.html');
  await expect(page.locator('#k-pill-total')).toHaveText(String(REPORTS.length));
  await page.locator('.k-map-report-btn').click();
  await expect(page.locator('#k-cam-shutter')).toBeEnabled();
  await page.locator('#k-cam-shutter').click();
  await page.locator('#k-cam-use').click();
  // Defaults: Minor picked, no waste type.
  await expect(page.locator('#k-severity [data-sev="minor"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#k-waste [aria-checked="true"]')).toHaveCount(0);
  await page.locator('#k-severity [data-sev="severe"]').click();
  await page.locator('#k-waste [data-waste="construction"]').click();
  await expect(page.locator('#k-waste [data-waste="construction"]')).toHaveAttribute('aria-checked', 'true');
  const submit = page.locator('#k-submit');
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect.poll(() => backend.calls.find(c => c.kind === 'rpc' && c.name === 'kasa_create_report')?.body)
    .toMatchObject({ p_severity: 'severe', p_waste_type: 'construction' });
});

test.describe('inside the Instagram app on an iPhone', () => {
  test.use({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 340.0.0.22.109 (iPhone15,2; iOS 17_5; en_IN; en; scale=3.00; 1179x2556; 612345678)' });

  test('offers Safari, and sends people there instead of a hand-placed pin when GPS fails', async ({ page, backend }) => {
    await page.addInitScript(() => {
      const fail = (ok, err) => setTimeout(() => err({ code: 2, message: 'unavailable' }), 10);
      navigator.geolocation.getCurrentPosition = fail;
      navigator.geolocation.watchPosition = (ok, err) => { fail(ok, err); return 1; };
      navigator.geolocation.clearWatch = () => {};
    });
    await page.goto('kasa.html');
    await expect(page.locator('#k-pill-total')).toHaveText(String(REPORTS.length));
    await expect(page.locator('#k-iab')).toBeVisible();
    await expect(page.locator('#k-iab-open')).toHaveAttribute('href', /^instagram:\/\/extbrowser\/\?url=https?%3A%2F%2F.+kasa\.html/);
    await expect(page.locator('#k-iab-hint')).toBeVisible();
    await expect(page.locator('#k-iab [data-iab-copy]')).toBeVisible();
    await page.locator('#k-iab-close').click();
    await expect(page.locator('#k-iab')).toBeHidden();
    await page.locator('.k-map-report-btn').click();
    await expect(page.locator('#k-modal')).toHaveClass(/\bopen\b/);
    await expect(page.locator('#k-iab-report')).toHaveAttribute('href', /^instagram:\/\/extbrowser\//);
    await expect(page.locator('#k-iab-report-copy')).not.toHaveAttribute('hidden', '');
    await expect(page.locator('#k-iab-report')).not.toHaveAttribute('hidden', '');
    await expect(page.locator('#k-iab-report-note')).not.toHaveAttribute('hidden', '');
    await expect(page.locator('#k-mini-map')).toHaveAttribute('hidden', '');
  });
});

test('ordinary browsers see no in-app bar', async ({ page, backend }) => {
  await page.goto('kasa.html');
  await expect(page.locator('#k-pill-total')).toHaveText(String(REPORTS.length));
  await expect(page.locator('#k-iab')).toBeHidden();
});

test('the bell opens one sheet for all alerts', async ({ page, backend }) => {
  await page.goto('kasa.html');
  await expect(page.locator('#k-pill-total')).toHaveText(String(REPORTS.length));
  await page.locator('.k-nav .k-bell').click();
  const sheet = page.locator('#k-nt-modal');
  await expect(sheet).toHaveClass(/open/);
  await expect(sheet.locator('#k-nt-title')).toHaveText('Alerts');
  await expect(sheet.locator('[data-digest-open]')).toBeVisible();
  await sheet.locator('.k-modal-close').click();
  await expect(sheet).not.toHaveClass(/open/);
});

test('the version badge opens that version on the What\'s new page', async ({ page, backend }) => {
  await page.goto('kasa.html');
  const badge = page.locator('#k-version');
  await expect(badge).toBeVisible();
  const text = await badge.textContent();
  expect(text).toMatch(/^v1\.\d+\.\d+$/);
  await badge.click();
  await expect(page).toHaveURL(new RegExp('changelog\\.html#' + text.replace(/\./g, '\\.') + '$'));
  await expect(page.locator(`h2[id="${text}"]`)).toBeVisible();
  await expect(page.locator('#curVersion')).toHaveText(text);
});

test('the report map knows gram panchayats and the other towns', async ({ page, backend }) => {
  await page.goto('kasa.html');
  await expect.poll(() => page.evaluate(() => typeof mainMap !== 'undefined' && !!mainMap?.getSource('gps'))).toBe(true);
  const places = await page.evaluate(async () => {
    await Promise.all([loadBlockGeo(), loadLocalGeo()]);
    return [placeOf(23.365, 85.975), placeOf(23.545, 86.672), placeOf(23.28, 86.20)];
  });
  expect(places[0]).toMatchObject({ kind: 'rural', body: 'Jhalda Municipality', bodyType: 'municipality' });
  expect(places[1]).toMatchObject({ kind: 'rural', body: 'Raghunathpur Municipality', bodyType: 'municipality' });
  expect(places[2]).toMatchObject({ kind: 'rural', block: 'Arsha', body: 'Sirkabad', bodyType: 'gram_panchayat' });
  const labels = await page.evaluate(() => [
    placeLabel({ area: 'rural', block: 'Jhalda I', body: 'Jhalda Municipality', bodyType: 'municipality' }),
    placeLabel({ area: 'rural', block: 'Arsha', body: 'Sirkabad', bodyType: 'gram_panchayat' }),
    chainFor({ area: 'rural', category: 'garbage', body: 'Jhalda Municipality', bodyType: 'municipality' }).agency,
    chainFor({ area: 'rural', category: 'garbage', body: 'Sirkabad', bodyType: 'gram_panchayat' }).agency
  ]);
  expect(labels).toEqual(['Jhalda Municipality', 'Sirkabad gram panchayat, Arsha block', 'agency_municipality', 'agency_panchayat']);
});
