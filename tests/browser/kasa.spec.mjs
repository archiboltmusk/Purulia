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
