// RTI tracker (rti.html). Stored only in this browser (localStorage parishkar_rti_tracker); nothing is sent to a server.
// Dates: RTI Act 2005 s.7(1) = 30 calendar days from receipt. Public holidays are NOT yet taken out (no official calendar linked).
// First appeal: s.19(1), within 30 days of the end of the period or of receipt of the decision.
(function () {
  var KEY = 'parishkar_rti_tracker';
  var STATUSES = ['waiting', 'answered', 'refused', 'appealed', 'no_reply'];

  function addDays(iso, n) {
    var p = iso.split('-').map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10);
  }
  function daysBetween(a, b) { return Math.round((Date.parse(b) - Date.parse(a)) / 86400000); }
  function today() { return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); }

  // Phase + deadlines for one application. now = 'YYYY-MM-DD'.
  function dates(app, now) {
    var replyDue = addDays(app.filed, 30), out = { replyDue: replyDue, appealBy: null, phase: '', left: daysBetween(now, replyDue) };
    if (app.status === 'answered') { out.phase = 'answered'; return out; }
    if (app.status === 'appealed') { out.phase = 'appealed'; return out; }
    if (app.status === 'refused') {
      if (!app.decided) { out.phase = 'need_date'; return out; }
      out.appealBy = addDays(app.decided, 30);
      out.phase = now <= out.appealBy ? 'appeal_open' : 'appeal_closed';
      out.left = daysBetween(now, out.appealBy);
      return out;
    }
    // waiting or no_reply
    if (now <= replyDue) { out.phase = 'waiting'; return out; }
    out.appealBy = addDays(replyDue, 30);
    out.phase = now <= out.appealBy ? 'overdue' : 'appeal_closed';
    out.left = daysBetween(now, out.appealBy);
    return out;
  }

  // Refusal checklist. Each item: what happened, what to do, the RTI Act section it rests on.
  var CHECKS = [
    { id: 'no_reply', when: 'No reply by the due date', act: 'File a first appeal with the First Appellate Authority (the officer above the PIO) within 30 days after the due date.', cite: 'RTI Act s.7(1), s.19(1)' },
    { id: 'no_details', when: 'Refused, with no reasons, no appeal period or no appellate authority named', act: 'Ask in writing for all three. The PIO must give them with any rejection.', cite: 's.7(8)' },
    { id: 'reason', when: 'Asked why you want the information', act: 'Say no reason is needed. The applicant does not have to give one.', cite: 's.6(2)' },
    { id: 'transfer', when: 'Sent to another office without a decision', act: 'The transfer must happen within 5 days and you must be told in writing.', cite: 's.6(3)' },
    { id: 'personal', when: 'Refused as "personal information"', act: 'Ask for a public-interest override: information can be given where public interest outweighs the harm. Say why it matters (public money, a public work).', cite: 's.8(1)(j), s.8(2)' },
    { id: 'trade', when: 'Refused as trade secret or commercial confidence', act: 'Ask whether a third party was consulted, and ask for the decision in writing. The public-interest override applies here too.', cite: 's.8(1)(d), s.11' },
    { id: 'investigation', when: 'Refused as likely to impede an investigation or prosecution', act: 'Ask the PIO to say how release would impede it. A bare claim is not enough.', cite: 's.8(1)(h)' },
    { id: 'security', when: 'Refused on security, sovereignty or foreign-relations grounds', act: 'Ask for the specific ground and the reasons in writing, then appeal if none are given.', cite: 's.8(1)(a)' },
    { id: 'copyright', when: 'Refused on copyright held by someone other than the State', act: 'Ask which copyright is claimed and whose. The ground covers only copyright held by a person other than the State.', cite: 's.9' },
    { id: 'form', when: 'Part of the information given, or not in the form you asked for', act: 'Ask for it in the form requested, unless that would divert the office\'s resources. Ask for the rest in writing.', cite: 's.7(9)' },
    { id: 'life', when: 'Life or liberty at risk and the reply came after 48 hours', act: 'Note the filing and reply dates. The Act sets 48 hours for these requests.', cite: 's.7(1), proviso' },
    { id: 'first_refused', when: 'First appeal decided against you', act: 'Second appeal to the Information Commission within 90 days.', cite: 's.19(3)' },
    { id: 'penalty', when: 'No reply at all, or delay without reason, after appeal', act: 'Complain to the Information Commission. It can fine the PIO Rs 250 for each day of delay, up to Rs 25,000.', cite: 's.18, s.20(1)' }
  ];

  function load() { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; } }
  function save(list) { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) {} }

  var root = typeof window !== 'undefined' ? window : globalThis;
  root.RTI = { addDays: addDays, daysBetween: daysBetween, dates: dates, CHECKS: CHECKS, STATUSES: STATUSES };

  var app = typeof document !== 'undefined' && document.getElementById('rti-app');
  if (!app) return;

  var LABEL = {
    waiting: 'Waiting for reply', answered: 'Reply received', refused: 'Refused', appealed: 'First appeal filed', no_reply: 'No reply'
  };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmt(iso) { var p = iso.split('-'); return p[2] + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][p[1] - 1] + ' ' + p[0]; }

  function dueLine(d) {
    switch (d.phase) {
      case 'waiting': return 'Reply due ' + fmt(d.replyDue) + ' (' + d.left + ' days left)';
      case 'overdue': return 'Reply overdue since ' + fmt(d.replyDue) + '. First appeal by ' + fmt(d.appealBy) + ' (' + d.left + ' days left)';
      case 'appeal_open': return 'First appeal by ' + fmt(d.appealBy) + ' (' + d.left + ' days left)';
      case 'appeal_closed': return 'First appeal window closed on ' + fmt(d.appealBy) + '. Complaint to the Information Commission still possible.';
      case 'need_date': return 'Add the date of the refusal to get the appeal deadline.';
      case 'answered': return 'Reply received. Check it against the checklist below.';
      case 'appealed': return 'First appeal filed. Second appeal to the Information Commission within 90 days of the appeal decision (s.19(3)).';
    }
    return '';
  }

  function render() {
    var list = load(), now = today();
    var el = document.getElementById('rti-list');
    if (!list.length) { el.innerHTML = '<p class="rti-empty">No applications yet.</p>'; return; }
    // keep open checklists open across the re-render
    var open = [].map.call(el.querySelectorAll('details[open]'), function (d) { return d.closest('.rti-card').dataset.id; });
    el.innerHTML = list.map(function (a) {
      var d = dates(a, now);
      return '<article class="rti-card" data-id="' + esc(a.id) + '">' +
        '<h3>' + esc(a.authority) + '</h3>' +
        (a.subject ? '<p>' + esc(a.subject) + '</p>' : '') +
        '<p class="rti-meta">Filed ' + esc(fmt(a.filed)) + (a.ref ? ' · Ref ' + esc(a.ref) : '') + '</p>' +
        '<p class="rti-due rti-' + d.phase + '">' + esc(dueLine(d)) + '</p>' +
        '<div class="rti-row">' +
          '<label>Status <select data-k="status">' + STATUSES.map(function (s) {
            return '<option value="' + s + '"' + (s === a.status ? ' selected' : '') + '>' + LABEL[s] + '</option>';
          }).join('') + '</select></label>' +
          '<label>Date of reply or refusal <input type="date" data-k="decided" max="' + now + '" value="' + esc(a.decided || '') + '"></label>' +
        '</div>' +
        '<details><summary>Refusal checklist (tick what the reply says)</summary><ul class="rti-checks">' +
          CHECKS.map(function (c) {
            return '<li><label><input type="checkbox" data-check="' + c.id + '"' + ((a.checks || []).indexOf(c.id) >= 0 ? ' checked' : '') + '> <b>' + esc(c.when) + '.</b> ' +
              esc(c.act) + ' <small>RTI Act ' + esc(c.cite) + '</small></label></li>';
          }).join('') +
        '</ul></details>' +
        '<button type="button" class="rti-del" data-del="' + esc(a.id) + '">Remove</button>' +
      '</article>';
    }).join('');
    el.querySelectorAll('.rti-card').forEach(function (c) {
      if (open.indexOf(c.dataset.id) >= 0) c.querySelector('details').open = true;
    });
  }

  function update(id, fn) {
    var list = load(), a = list.filter(function (x) { return x.id === id; })[0];
    if (!a) return;
    fn(a); save(list); render();
  }

  document.getElementById('rti-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target, now = today();
    var filed = f.filed.value;
    if (!filed || filed > now) { f.filed.setCustomValidity('Enter the date you filed it, not a future date.'); f.filed.reportValidity(); return; }
    f.filed.setCustomValidity('');
    var list = load();
    list.unshift({ id: String(Date.now()), authority: f.authority.value.trim(), subject: f.subject.value.trim(), ref: f.ref.value.trim(), filed: filed, status: 'waiting', decided: '', checks: [] });
    save(list); f.reset(); render();
  });

  app.addEventListener('change', function (e) {
    var t = e.target, card = t.closest('.rti-card');
    if (!card) return;
    var id = card.dataset.id;
    if (t.dataset.k === 'status') update(id, function (a) { a.status = t.value; });
    else if (t.dataset.k === 'decided') update(id, function (a) { a.decided = t.value; });
    else if (t.dataset.check) update(id, function (a) {
      var set = a.checks || [], i = set.indexOf(t.dataset.check);
      if (t.checked && i < 0) set.push(t.dataset.check); else if (!t.checked && i >= 0) set.splice(i, 1);
      a.checks = set;
    });
  });
  app.addEventListener('click', function (e) {
    var b = e.target.closest('[data-del]'); if (!b) return;
    if (!confirm('Remove this application from this browser?')) return;
    save(load().filter(function (x) { return x.id !== b.dataset.del; })); render();
  });

  document.getElementById('rti-form').filed.max = today();
  render();
})();
