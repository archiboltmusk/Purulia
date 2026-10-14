import { test, expect } from './fixtures.mjs';

const reply = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
const DOC = { id: 1, url: 'https://example.gov.in/wo-12.pdf', title: 'Work order 12/2026', class: 'official_primary', published_on: '2026-03-01',
  retrieved_at: '2026-10-14', sha256: 'a'.repeat(64), archive_url: null, status: 'live', publisher: 'Example Municipality', source_url: 'https://example.gov.in/', source_state: 'approved' };

test('the record shows a harm with supporting and contrary documents, case history, money kinds and an unchecked fix', async ({ page, backend }) => {
  await page.route('**/rest/v1/rpc/kasa_ev_harm', route => reply(route, {
    id: 'H-1', title: 'Ward 5 road broke within warranty', description: 'Potholes on a road completed in March.', domain: 'infrastructure',
    state: 'West Bengal', district: 'purulia', local_body: 'Example Municipality', status: 'active', updated: '2026-10-14',
    unknown: 'Whether the contractor was told of the defect.', history: [], reports: ['42'],
    assertions: [{ id: 'A-1', headline: 'Road completed March 2026', body: 'The work order records completion on 1 March 2026.', evidence_state: 'disputed',
      as_of: '2026-10-14', history: [{ value: 'source_checked', as_of: '2026-10-01' }, { value: 'disputed', as_of: '2026-10-14' }], reply: 'requested',
      evidence: [{ role: 'supports', locator: 'p. 2', excerpt: 'Date of completion: 01.03.2026', document: DOC },
                 { role: 'contradicts', locator: 'p. 3', excerpt: 'Handover pending', document: DOC }],
      entities: [], proceedings: [{ id: 'P-1', kind: 'rti', ref_no: 'RTI/2026/77', stage: 'decision', as_of: '2026-10-01', document: DOC,
        history: [{ value: 'complaint', as_of: '2026-09-01' }, { value: 'decision', as_of: '2026-10-01' }] }] }],
    money: [{ basis: 'contract', amount: 1200000, as_of: '2026-03-01', locator: 'p. 1', document: DOC },
            { basis: 'reported_paid', amount: 1100000, as_of: '2026-04-01', locator: 'p. 4', document: DOC }],
    responses: [], corrections: [{ what: 'assertion', note: 'Second copy found.', at: '2026-10-14' }],
    remedies: [{ id: 'R-1', requested: 'Repair under the defect liability period', stage: 'referred', action_status: 'claimed_complete',
      unresolved: false, recurred: false, history: [], outcomes: [] }]
  }));
  await page.route('**/rest/v1/rpc/kasa_ev_submit', async route => {
    backend.calls.push({ name: 'kasa_ev_submit', body: route.request().postDataJSON() });
    return reply(route, { ok: true, ref_no: 'S-AB12CD34', key: 'k', status: 'received' });
  });
  await page.goto('record.html?h=H-1');
  await expect(page.locator('h2').first()).toHaveText('Ward 5 road broke within warranty');
  await expect(page.locator('.rc-unknown')).toContainText('contractor was told');
  await expect(page.locator('.rc-ev.supports')).toContainText('Date of completion');
  await expect(page.locator('.rc-ev.contradicts')).toContainText('Handover pending');
  await expect(page.locator('.rc-hist').first()).toContainText('source checked');
  await expect(page.getByRole('cell', { name: 'Contract value' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Reported as paid' })).toBeVisible();
  await expect(page.getByText('Not counted as fixed until someone checks it on the ground')).toBeVisible();
  await expect(page.locator('.rc-steps span.on')).toHaveCount(3);
  await expect(page.locator('a[href="case.html?id=42"]')).toBeVisible();
  await page.locator('#rc-send [name="body"]').fill('The completion date is wrong; the board at the site says April 2026.');
  await page.locator('#rc-send button[type="submit"]').click();
  await expect(page.locator('#rc-send-msg')).toContainText('Your reference is');
  const sent = backend.calls.find(c => c.name === 'kasa_ev_submit');
  expect(sent.body.p_kind).toBe('correction');
  expect(sent.body.p_target_id).toBe('H-1');
});

test('the record home lists sources as not yet checked and says when nothing is published', async ({ page }) => {
  await page.route('**/rest/v1/rpc/kasa_ev_stats', route => reply(route, { sources: { candidate: 27 }, documents: 0, harms: {}, assertions: {}, remedies: {},
    remedies_unresolved: 0, corrections: 0, submissions: {}, legal_gate_open: false }));
  await page.route('**/rest/v1/rpc/kasa_ev_sources', route => reply(route, [{ id: 1, url: 'https://cag.gov.in/', title: 'CAG reports', publisher: 'CAG',
    jurisdiction: 'India', type: 'audit', state: 'candidate', documents: 0 }]));
  await page.route('**/rest/v1/rpc/kasa_ev_harms', route => reply(route, []));
  await page.goto('record.html');
  await expect(page.getByText('No records are published yet')).toBeVisible();
  await expect(page.locator('.an-table')).toContainText('Not yet checked');
});
