// Tests for rti-letter.js (RTI letter builder).
//   node tests/rti-letter.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
// Loaded as a classic script, the way the page loads it (no #rl-form here, so no DOM is touched).
vm.runInThisContext(fs.readFileSync(new URL('../rti-letter.js', import.meta.url), 'utf8'));
const { blocks } = globalThis.RTI_LETTER;

const text = (b) => b.map((x) => x.t).join('\n');

// Empty form: nothing personal printed, blanks shown as lines.
const empty = text(blocks({}));
assert.match(empty, /1\. Full name of the applicant: _+/);
assert.match(empty, /MP of _+ under MPLADS/);

// Filled form: typed values land in the right places.
const full = text(blocks({ name: 'Asha Devi', address: 'Village X, PO Y', pin: '723101', district: 'Purulia', state: 'West Bengal', ls: 'Purulia', ac: 'Jhalda', from: '2021-22', place: 'Purulia', date: '2026-10-16', mobile: '9999999999', email: 'a@example.com' }));
assert.match(full, /1\. Full name of the applicant: Asha Devi/);
assert.match(full, /MP of Purulia under MPLADS, and the MLA of Jhalda/);
assert.match(full, /from 2021-22 to date/);
assert.match(full, /Date: 16\/10\/2026/);

// Template fixes: section numbers written with brackets, no stray "6 1", no duplicate 5 or 6 numbering.
assert.match(full, /Section 6\(1\)/);
assert.match(full, /Section 7\(5\)/);
assert.match(full, /Section 6\(3\)/);
assert.doesNotMatch(full, /Section 6 1|Section 7 5|Section 6 3/);
const numbered = full.split('\n').map((l) => l.match(/^(\d+)\. /)).filter(Boolean).map((m) => m[1]);
// Applicant fields 1-4, then particulars 1-6; no other numbering.
assert.deepEqual(numbered, ['1', '2', '3', '4', '1', '2', '3', '4', '5', '6']);
assert.equal(full.split('\n').filter((l) => /^5\. /.test(l)).length, 1);
assert.equal(full.split('\n').filter((l) => /^6\. /.test(l)).length, 1);

// Fee: ₹10 marked as central rule; BPL and transfer lines kept.
assert.match(full, /₹10 \(the central rate under the RTI Rules, 2012\)/);
assert.match(full, /below poverty line, strike out the fee line/);
assert.match(full, /transfer the application under Section 6\(3\) of the RTI Act, 2005 within 5 days/);
assert.doesNotMatch(full, /^\d+\. Application fee/m);

console.log('rti-letter tests passed');
