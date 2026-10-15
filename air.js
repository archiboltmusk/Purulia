// Air in each district: reads places/air/openaq.json (built by tools/build-openaq.py).
// The page never calls OpenAQ, so no key or third-party request happens in the browser.
(function () {
  'use strict';
  var state = document.getElementById('air-state');
  var table = document.getElementById('air-table');
  var rows = document.getElementById('air-rows');

  function cell(text, cls) {
    var td = document.createElement('td');
    if (cls) td.className = cls;
    td.textContent = text;
    return td;
  }

  function render(data) {
    var who = Number(data.who_pm25_24h) || 15;
    var list = (data.districts || []).slice().sort(function (a, b) {
      var av = a.pm25 ? a.pm25.value : -1, bv = b.pm25 ? b.pm25.value : -1;
      return bv - av || a.name.localeCompare(b.name);
    });
    list.forEach(function (d) {
      var tr = document.createElement('tr');
      tr.appendChild(cell(d.name));
      if (d.pm25) {
        var over = d.pm25.value > who;
        var pm = cell(Math.round(d.pm25.value) + ' µg/m³', 'num' + (over ? ' air-over' : ''));
        var when = document.createElement('small');
        when.textContent = (over ? 'above' : 'within') + ' WHO 24-h guideline · ' +
          new Date(d.pm25.utc).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
        pm.appendChild(when);
        tr.appendChild(pm);
      } else {
        tr.appendChild(cell('no reading', 'air-state'));
      }
      if (d.station) {
        var td = document.createElement('td');
        var a = document.createElement('a');
        a.href = d.station.url;
        a.rel = 'noopener';
        a.textContent = d.station.name || 'Station ' + d.station.id;
        td.appendChild(a);
        var s = document.createElement('small');
        s.textContent = d.station.provider + ' · ' + d.station.km + ' km away';
        td.appendChild(s);
        tr.appendChild(td);
      } else {
        tr.appendChild(cell('none within 25 km', 'air-state'));
      }
      rows.appendChild(tr);
    });
    table.hidden = false;
    state.textContent = 'Read ' + (data.generated || 'recently') + ' from OpenAQ.';
  }

  fetch('places/air/openaq.json', { cache: 'no-cache' })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (data) {
      if (!data.districts || !data.districts.length) throw new Error('empty');
      render(data);
    })
    .catch(function () {
      state.textContent = 'Air readings are not on yet. The first refresh has not run.';
    });
})();
