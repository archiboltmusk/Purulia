// Tests for rti.js (RTI due-date and appeal logic).
//   node tests/rti.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
// Loaded as a classic script, the way the page loads it (no #rti-app here, so no DOM is touched).
vm.runInThisContext(fs.readFileSync(new URL('../rti.js', import.meta.url), 'utf8'));
const { addDays, dates, CHECKS } = globalThis.RTI;

assert.equal(addDays('2026-01-15', 30), '2026-02-14');
assert.equal(addDays('2026-01-31', 30), '2026-03-02');   // non-leap February
assert.equal(addDays('2028-01-31', 30), '2028-03-01');   // leap February

const filed = { filed: '2026-10-01', status: 'waiting', decided: '' };
let d = dates(filed, '2026-10-20');
assert.equal(d.phase, 'waiting');
assert.equal(d.replyDue, '2026-10-31');
assert.equal(d.left, 11);

d = dates(filed, '2026-11-05');
assert.equal(d.phase, 'overdue');
assert.equal(d.appealBy, '2026-11-30');

d = dates(filed, '2026-12-01');
assert.equal(d.phase, 'appeal_closed');

d = dates({ ...filed, status: 'refused', decided: '2026-10-15' }, '2026-11-10');
assert.equal(d.phase, 'appeal_open');
assert.equal(d.appealBy, '2026-11-14');

d = dates({ ...filed, status: 'refused' }, '2026-10-20');
assert.equal(d.phase, 'need_date');

d = dates({ ...filed, status: 'answered' }, '2026-12-20');
assert.equal(d.phase, 'answered');
assert.equal(d.appealBy, null);

assert.ok(CHECKS.length >= 10);
for (const c of CHECKS) assert.ok(c.id && c.when && c.act && c.cite, c.id);
console.log('rti tests passed');
