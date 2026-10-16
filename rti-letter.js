// RTI letter maker (rti-letter.html). Builds the MPLADS / MLALADS-BEUP / DISHA RTI letter from what the person types.
// Nothing is stored or sent: no localStorage, no request. The letter stays English, as it is sent to the office.
// Blank fields print as a line to fill in by hand.
(function () {
  var FIELDS = ['name', 'address', 'pin', 'mobile', 'email', 'district', 'state', 'ls', 'ac', 'from', 'place', 'date'];

  function val(f, k) { return (f && f[k] ? String(f[k]) : '').trim(); }
  function blank(x) { return x || '________________'; }
  function fmtDate(iso) {
    if (!iso) return '___/___/_____';
    var p = iso.split('-');
    return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : iso;
  }

  // Blocks: {c: 'p' | 'h' | 'item' | 'sub', t: text}. 'item' = numbered particular, 'sub' = indented line.
  function blocks(input) {
    var f = {};
    FIELDS.forEach(function (k) { f[k] = val(input, k); });
    var from = blank(f.from), ls = blank(f.ls), ac = blank(f.ac);
    return [
      { c: 'p', t: 'To,' },
      { c: 'p', t: 'The State Public Information Officer / Central Public Information Officer' },
      { c: 'p', t: 'Office of the District Magistrate & District Collector' },
      { c: 'p', t: 'District: ' + blank(f.district) },
      { c: 'p', t: 'State: ' + blank(f.state) },
      { c: 'p', t: 'PIN: ' + blank(f.pin) },
      { c: 'p', t: '1. Full name of the applicant: ' + blank(f.name) },
      { c: 'p', t: '2. Complete postal address: ' + blank(f.address) },
      { c: 'p', t: '3. Contact details: Mobile: ' + blank(f.mobile) + ' | Email: ' + blank(f.email) },
      { c: 'p', t: '4. Citizenship: Indian' },
      { c: 'p', t: 'Subject: Seeking information under Section 6(1) of the Right to Information Act, 2005 regarding MPLADS, MLALADS or BEUP development funds, project completion records, and DISHA committee minutes.' },
      { c: 'p', t: 'Period to which information relates: from ' + from + ' to date.' },
      { c: 'h', t: 'Particulars of information sought:' },
      { c: 'h', t: 'Part A: Development fund sanctions and execution' },
      { c: 'item', t: '1. Certified copies of the comprehensive master list of all project recommendations submitted by the MP of ' + ls + ' under MPLADS, and the MLA of ' + ac + ' under MLALADS or BEUP scheme, from ' + from + ' to date.' },
      { c: 'item', t: '2. For each recommended project:' },
      { c: 'sub', t: '* Project title, sanctioned location, block or ward, and estimated cost.' },
      { c: 'sub', t: '* Administrative sanction order number, sanction date, and releasing authority.' },
      { c: 'sub', t: '* Name and designation of the designated executing agency or contractor.' },
      { c: 'sub', t: '* Financial status: total funds disbursed, total expenditure incurred, and unspent balance.' },
      { c: 'sub', t: '* Physical status: whether marked as ongoing, stalled, cancelled, or completed.' },
      { c: 'item', t: '3. For all projects classified as completed, certified copies of the physical completion certificates and asset handover records issued by the competent engineering authority.' },
      { c: 'h', t: 'Part B: DISHA meeting proceedings and accountability' },
      { c: 'item', t: '4. The exact number and dates of all District Development Coordination and Monitoring Committee DISHA meetings held under the chairmanship of the local MP from ' + from + ' to date.' },
      { c: 'item', t: '5. Certified copies of the approved minutes of all DISHA meetings conducted during this period.' },
      { c: 'item', t: '6. Certified copies of all Action Taken Reports submitted by the district administration, District Magistrate, or line departments in response to matters flagged in the aforesaid DISHA meetings.' },
      { c: 'h', t: 'Application fee:' },
      { c: 'p', t: 'An application fee of ₹10 (the central rate under the RTI Rules, 2012) is enclosed herewith via:' },
      { c: 'sub', t: '[  ] Indian Postal Order number: ____________ dated ____________' },
      { c: 'sub', t: '[  ] Court Fee Stamp affixed on the application' },
      { c: 'sub', t: '[  ] Treasury challan or cash receipt number: ____________' },
      { c: 'p', t: '(If below poverty line, strike out the fee line and attach an attested copy of your BPL ration card under Section 7(5) of the RTI Act).' },
      { c: 'h', t: 'Format of records:' },
      { c: 'p', t: 'I request that certified hard copies of the records be provided by registered or speed post to my address stated above. In case any part of the requested information pertains to another public authority, kindly transfer the application under Section 6(3) of the RTI Act, 2005 within 5 days with intimation to me.' },
      { c: 'p', t: 'Place: ' + blank(f.place) + '    Date: ' + fmtDate(f.date) },
      { c: 'p', t: '(Signature of Applicant)' },
      { c: 'p', t: blank(f.name) }
    ];
  }

  var api = { blocks: blocks, FIELDS: FIELDS };
  if (typeof globalThis !== 'undefined') globalThis.RTI_LETTER = api;

  if (typeof document === 'undefined') return;
  var form = document.getElementById('rl-form');
  var out = document.getElementById('rl-letter');
  if (!form || !out) return;

  function read() {
    var o = {};
    FIELDS.forEach(function (k) { var el = form.elements[k]; o[k] = el ? el.value : ''; });
    return o;
  }

  function render() {
    out.textContent = '';
    blocks(read()).forEach(function (b) {
      var el = document.createElement(b.c === 'h' ? 'h3' : 'p');
      el.className = 'rl-' + b.c;
      el.textContent = b.t;
      out.appendChild(el);
    });
  }

  form.addEventListener('input', render);
  var printBtn = document.getElementById('rl-print');
  if (printBtn) printBtn.addEventListener('click', function () { window.print(); });
  render();
})();
