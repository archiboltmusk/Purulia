// MP profile page: reads places/mp/<state>.json (tools/build-mp-profiles.py). Every figure is sourced;
// a missing source is shown as "not on record yet", never a placeholder number.
(function () {
  'use strict';
  var NR = 'Not on record yet';
  var q = new URLSearchParams(location.search);
  var msg = document.getElementById('mp-msg'), body = document.getElementById('mp-body');

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]; }); }
  function inr(n) {
    if (n == null) return NR;
    if (Math.abs(n) >= 1e7) return '₹' + (n / 1e7).toFixed(2) + ' cr';
    if (Math.abs(n) >= 1e5) return '₹' + (n / 1e5).toFixed(1) + ' lakh';
    return '₹' + Math.round(n).toLocaleString('en-IN');
  }
  function num(n, suffix) { return n == null ? NR : n + (suffix || ''); }
  function initials(name) { return (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase(); }
  function fail(text) { msg.textContent = text; msg.hidden = false; body.hidden = true; }

  var state = q.get('state'), seatKey = q.get('seat');
  if (!/^[a-z0-9-]+$/.test(state || '') || !/^[a-z0-9-]+$/.test(seatKey || '')) { fail('Pick an MP from the map to see their record.'); return; }

  fetch('places/mp/' + state + '.json').then(function (r) {
    if (!r.ok) throw new Error('no data');
    return r.json();
  }).then(function (d) {
    var s = d.seats[seatKey];
    if (!s) throw new Error('no seat');
    render(d, s);
    msg.hidden = true; body.hidden = false;
    document.title = (s.mp && s.mp.name ? s.mp.name + ' — ' : '') + 'MP profile — Parishkar';
  }).catch(function () {
    fail('No record for this seat yet.');
  });

  function row(label, value, sub) {
    return '<div class="mp-row"><div>' + esc(label) + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</div><div class="mp-val">' + value + '</div></div>';
  }
  function more(id, n, label) {
    return n > 0 ? '<button class="mp-more" data-more="' + id + '">▶ All ' + n + ' ' + esc(label) + '</button>' : '';
  }
  function worksList(arr, limit, id) {
    if (!arr || !arr.length) return '<p class="mp-nr">' + NR + '</p>';
    var li = function (w) {
      return '<li>' + esc(w.w) + '<small>' + inr(w.rs) + (w.paid != null ? ' · paid ' + inr(w.paid) : '') + ' · ' + esc(w.on || 'date ' + NR) + (w.at ? ' · ' + esc(w.at) : '') + '</small></li>';
    };
    return '<ul class="mp-list">' + arr.slice(0, limit).map(li).join('') + '</ul>' +
      '<ul class="mp-list" id="' + id + '" hidden>' + arr.slice(limit).map(li).join('') + '</ul>' +
      (arr.length > limit ? '<button class="mp-more" data-more="' + id + '">▶ All ' + arr.length + '</button>' : '');
  }

  function render(d, s) {
    var mp = s.mp || {}, m = s.mplads, w = s.works, p = s.prs, a = s.affidavit;
    var h = '';
    h += '<div class="mp-head"><div class="mp-av">' + esc(initials(mp.name)) + '</div><div>' +
      '<h1 class="mp-name">' + esc(s.vacant ? 'Seat vacant' : (mp.name || NR)) + '</h1>' +
      '<div class="mp-sub">' + (s.vacant ? 'Vacant since ' + esc(s.vacant) : 'MP · ' + esc(s.name) + ' (Lok Sabha) · ' + esc(mp.party || NR)) + '</div></div></div>';
    h += '<div class="mp-h">Assembly seats in this constituency</div><div class="mp-chips">' +
      (s.assembly || []).map(function (x) { return '<span class="mp-chip">' + esc(x.name) + ' · ' + esc(x.mla || NR) + '</span>'; }).join('') + '</div>';
    var center = s.center || [];
    h += '<div class="mp-links">' +
      (center.length ? '<a href="kasa.html?at=' + center[0] + ',' + center[1] + ',9">Show seat on map →</a>' : '') +
      '<a href="#" id="mp-share">Share this profile →</a></div>';
    h += '<div class="mp-h">Reports in this seat</div><div class="mp-stats">' +
      '<div class="mp-stat"><b>—</b><span>Unresolved</span></div>' +
      '<div class="mp-stat"><b>—</b><span>Verified fixed</span></div>' +
      '<div class="mp-stat"><b>—</b><span>Places affected</span></div></div>' +
      '<p class="mp-text">' + NR + ' for this seat. Report counts are not linked to MPs yet.</p>';
    h += '<div class="mp-h">Response rate</div><p class="mp-nr">' + NR + '</p>';
    h += '<div class="mp-h">MP’s local area fund (this term)</div><div class="mp-box">' +
      (m ? '<div class="mp-trio"><div><b>' + inr(m.allocated) + '</b><span>Allocated</span></div>' +
        '<div><b>' + inr(m.spent) + '</b><span>Spent</span></div>' +
        '<div><b>' + num(m.worksCompleted) + '/' + num(m.worksCompleted + m.worksRecommended) + '</b><span>Works done</span></div></div>' +
        '<p class="mp-text">Works worth ' + inr(m.recommended) + ' recommended. Official MPLADS figures, via ' +
        '<a href="' + d.sources.mplads + '" style="color:var(--red)">Empowered Indian</a>.</p>'
        : '<p class="mp-nr">' + NR + ' for this MP.</p>') + '</div>';
    if (w) {
      h += '<div class="mp-h">Works finished (' + w.completed.length + ')</div>' + worksList(w.completed, 4, 'mp-done');
      h += '<div class="mp-h">Works recommended (' + w.recommended.length + ')</div>' + worksList(w.recommended, 3, 'mp-rec');
    }
    h += '<div class="mp-h">Work in the Lok Sabha</div>';
    if (p) {
      var avg = p.avg || {}, nat = avg.national || {}, st = avg.state || {};
      h += '<div class="mp-box"><div class="mp-trio">' +
        '<div><b>' + num(p.attendance, '%') + '</b><span>Attendance</span></div>' +
        '<div><b>' + num(p.debates) + '</b><span>Debates</span></div>' +
        '<div><b>' + num(p.questions) + '</b><span>Questions</span></div></div>' +
        '<div class="mp-trio" style="margin-top:.8rem"><div><b>' + num(p.bills) + '</b><span>Private bills</span></div></div></div>' +
        '<p class="mp-text">Attendance: MPs from this state average ' + num(st.attendance, '%') + ', India ' + num(nat.attendance, '%') +
        '. Period ' + esc(p.from || '?') + ' to ' + esc(p.to || '?') + '. Figures from <a href="' + esc(p.url) + '" style="color:var(--red)">PRS Legislative Research</a>.</p>';
    } else h += '<p class="mp-nr">' + NR + ' on PRS for this MP.</p>';
    h += '<div class="mp-h">Sworn affidavit (ADR / MyNeta)</div>';
    if (a) {
      h += '<div class="mp-box"><div class="mp-trio">' +
        '<div><b>' + inr(a.assets) + '</b><span>Assets</span></div>' +
        '<div><b>' + inr(a.liab) + '</b><span>Liabilities</span></div>' +
        '<div><b>' + num(a.cases) + '</b><span>Criminal cases</span></div></div></div>' +
        '<p class="mp-text">' + (a.serious ? 'Includes charges ADR classes as serious. ' : '') +
        (a.edu ? 'Education: ' + esc(a.edu) + '. ' : '') +
        (a.prevAssets != null ? 'Change in assets since the ' + esc(a.prevElection || 'previous') + ' affidavit: ' + inr(a.assets - a.prevAssets) + '. ' : '') +
        'Self-declared in the 2024 Lok Sabha election affidavit. Cases are pending, not convictions. ' +
        '<a href="' + esc(a.url) + '" style="color:var(--red)">MyNeta</a>.</p>';
    } else h += '<p class="mp-nr">' + NR + ' on MyNeta for this MP.</p>';
    h += '<div class="mp-h">Updates</div><div class="mp-box">' +
      row('Promises', '<span class="mp-nr">' + NR + '</span>') +
      row('Asked by residents', '<span class="mp-nr">' + NR + '</span>') + '</div>';
    h += '<div class="mp-h">Reply from this leader</div><p class="mp-nr">' + NR + '.</p>';
    h += '<div class="mp-src">Sources: <a href="' + esc(d.sources.seats) + '">seat outline</a> · ' +
      '<a href="' + esc(d.sources.mplads) + '">MPLADS</a> · <a href="' + esc(d.sources.prs) + '">PRS</a> · ' +
      '<a href="' + esc(d.sources.affidavit) + '">MyNeta</a> · checked ' + esc(d.checked) + '</div>';
    body.innerHTML = h;
    body.addEventListener('click', function (e) {
      var b = e.target.closest('[data-more]');
      if (b) { var el = document.getElementById(b.getAttribute('data-more')); if (el) { el.hidden = false; b.remove(); } }
    });
    var share = document.getElementById('mp-share');
    share.addEventListener('click', function (e) {
      e.preventDefault();
      var url = location.href;
      if (navigator.share) navigator.share({ title: mp.name || 'MP profile', url: url }).catch(function () {});
      else if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { share.textContent = 'Link copied'; }).catch(function () {});
    });
  }
})();
