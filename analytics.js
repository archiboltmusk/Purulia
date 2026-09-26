/* Public analytics for Parishkar Purulia: computed in the browser from the public view. */
(async function(){
  const COLUMNS = 'id,created_at,ward_no,category,status,landmark,resolved_at,resolution_method,sla_days,is_duplicate,recurrence_count,rejected_claims,area_kind,block_name';
  const DAY = 86400000;
  const cfg = window.KASA_CONFIG || {};
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const L = (window.KASA_I18N && window.KASA_I18N.en) || {};
  const cat = k => L['cat_' + k] || k;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  const dayKey = d => new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const median = xs => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const fixDays = r => Math.max(0, (new Date(r.resolved_at) - new Date(r.created_at)) / DAY);
  const reportLink = r => `kasa.html?report=${encodeURIComponent(r.id)}`;

  const [rep, wardRes] = await Promise.all([
    sb.from('kasa_public_reports').select(COLUMNS).order('created_at', { ascending: false }).limit(5000),
    sb.from('wards').select('ward_no,councillor_name').order('ward_no'),
  ]);
  if (rep.error){ set('an-updated', 'Could not load the data. Please try again later.'); return; }
  const all = (rep.data || []).filter(r => !r.is_duplicate);
  const wards = {}; (wardRes.data || []).forEach(w => { wards[w.ward_no] = w; });
  const now = Date.now();
  const open = all.filter(r => r.status !== 'resolved');
  const fixed = all.filter(r => r.status === 'resolved' && r.resolution_method === 'community' && r.resolved_at);
  const overdue = open.filter(r => (now - new Date(r.created_at)) / DAY > (r.sla_days || 7));

  // Headline numbers
  set('an-updated', 'Updated ' + new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }));
  set('t-reports', all.length);
  set('t-open', open.length);
  set('t-overdue', overdue.length ? `${overdue.length} overdue (over 7 days)` : 'none overdue');
  set('t-fixed', fixed.length);
  const med = median(fixed.map(fixDays));
  set('t-median', med == null ? '—' : med < 1 ? '< 1' : String(Math.round(med)));
  set('t-fake', all.reduce((n, r) => n + (r.rejected_claims || 0), 0));
  const fixDaysSet = new Set(fixed.map(r => dayKey(r.resolved_at)));
  // A streak still counts today if the last fix was yesterday.
  let streak = 0;
  for (let d = fixDaysSet.has(dayKey(now)) ? now : now - DAY; fixDaysSet.has(dayKey(d)); d -= DAY) streak++;
  set('t-streak', streak);

  // Reports per day, last 30 days
  const days = [];
  for (let i = 29; i >= 0; i--){ const d = now - i * DAY; days.push({ key: dayKey(d), date: new Date(d), n: 0 }); }
  const byKey = Object.fromEntries(days.map(d => [d.key, d]));
  all.forEach(r => { const d = byKey[dayKey(r.created_at)]; if (d) d.n++; });
  const fmt = d => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  document.getElementById('an-chart-table').innerHTML = `<table class="an-table"><thead><tr><th>Day</th><th class="n">Reports</th></tr></thead><tbody>${
    days.map(d => `<tr><td>${fmt(d.date)}</td><td class="n">${d.n}</td></tr>`).join('')}</tbody></table>`;

  const chart = document.getElementById('an-chart');
  const tip = document.getElementById('an-tip');
  function drawChart(){
    chart.querySelector('svg')?.remove();
    const W = chart.clientWidth, H = chart.clientHeight, padL = 28, padB = 22, padT = 6;
    const max = Math.max(1, ...days.map(d => d.n));
    const step = max <= 4 ? 1 : Math.ceil(max / 4);
    const top = Math.ceil(max / step) * step;
    const iw = W - padL, ih = H - padB - padT, slot = iw / days.length, bw = Math.max(2, slot - 2);
    const y = v => padT + ih - (v / top) * ih;
    let g = '';
    for (let v = 0; v <= top; v += step){
      g += `<line x1="${padL}" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="rgba(240,230,208,${v ? .07 : .22})" stroke-width="1"/>`
         + `<text x="${padL - 6}" y="${y(v) + 3.5}" text-anchor="end" font-family="DM Mono,monospace" font-size="10" fill="rgba(240,230,208,.46)">${v}</text>`;
    }
    days.forEach((d, i) => {
      const x = padL + i * slot + 1, h = ih * d.n / top, yt = padT + ih - h, r = Math.min(4, bw / 2, h);
      if (d.n) g += `<path d="M${x},${padT + ih} V${yt + r} Q${x},${yt} ${x + r},${yt} H${x + bw - r} Q${x + bw},${yt} ${x + bw},${yt + r} V${padT + ih} Z" fill="#d4882a"/>`;
      g += `<rect class="an-hit" data-i="${i}" x="${padL + i * slot}" y="${padT}" width="${slot}" height="${ih}" fill="transparent"/>`;
    });
    [0, 14, 29].forEach(i => {
      g += `<text x="${padL + i * slot + slot / 2}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === 29 ? 'end' : 'middle'}" font-family="DM Mono,monospace" font-size="10" fill="rgba(240,230,208,.46)">${fmt(days[i].date)}</text>`;
    });
    chart.insertAdjacentHTML('afterbegin', `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Reports filed per day over the last 30 days">${g}</svg>`);
    chart.querySelectorAll('.an-hit').forEach(el => {
      el.addEventListener('mouseenter', () => {
        const d = days[+el.dataset.i];
        tip.textContent = `${fmt(d.date)} · ${d.n} report${d.n === 1 ? '' : 's'}`;
        tip.style.left = (padL + (+el.dataset.i) * slot + slot / 2) + 'px';
        tip.style.top = y(d.n) + 'px';
        tip.style.opacity = 1;
      });
      el.addEventListener('mouseleave', () => { tip.style.opacity = 0; });
    });
  }
  drawChart();
  new ResizeObserver(drawChart).observe(chart);

  const table = (head, rows, empty) => rows.length
    ? `<table class="an-table"><thead><tr>${head}</tr></thead><tbody>${rows.join('')}</tbody></table>`
    : `<div class="an-empty">${esc(empty)}</div>`;
  const place = r => esc(r.landmark || (r.ward_no ? 'Ward ' + r.ward_no : r.block_name ? r.block_name + ' block' : ''));

  // Fastest fixes this week
  const week = fixed.filter(r => now - new Date(r.resolved_at) < 7 * DAY).sort((a, b) => fixDays(a) - fixDays(b)).slice(0, 10);
  document.getElementById('an-fast').innerHTML = table('<th>Problem</th><th>Where</th><th class="n">Fixed in</th>',
    week.map(r => { const d = fixDays(r); return `<tr><td><a href="${reportLink(r)}">${esc(cat(r.category))}</a></td><td>${place(r)}</td><td class="n">${d < 1 ? 'same day' : Math.round(d) + ' days'}</td></tr>`; }),
    'No verified fixes in the last 7 days.');

  // Repeat hot spots
  const repeat = all.filter(r => r.recurrence_count > 0).sort((a, b) => b.recurrence_count - a.recurrence_count).slice(0, 10);
  document.getElementById('an-repeat').innerHTML = table('<th>Problem</th><th>Where</th><th class="n">Came back</th><th>Now</th>',
    repeat.map(r => `<tr><td><a href="${reportLink(r)}">${esc(cat(r.category))}</a></td><td>${place(r)}</td><td class="n">${r.recurrence_count}×</td><td>${r.status === 'resolved' ? 'fixed' : 'unresolved'}</td></tr>`),
    'No problem has come back after being fixed yet.');

  // Every ward
  const stats = {};
  for (let w = 1; w <= 23; w++) stats[w] = { ward: w, open: 0, overdue: 0, fixed: 0, fake: 0, days: [] };
  all.forEach(r => {
    const s = stats[r.ward_no]; if (!s) return;
    if (r.status !== 'resolved'){ s.open++; if ((now - new Date(r.created_at)) / DAY > (r.sla_days || 7)) s.overdue++; }
    s.fake += r.rejected_claims || 0;
  });
  fixed.forEach(r => { const s = stats[r.ward_no]; if (s){ s.fixed++; s.days.push(fixDays(r)); } });
  const rows = Object.values(stats).sort((a, b) => b.open - a.open || b.overdue - a.overdue || a.ward - b.ward);
  document.getElementById('an-wards').innerHTML = table(
    '<th>Ward</th><th>Councillor</th><th class="n">Unresolved</th><th class="n">Overdue</th><th class="n">Verified fixed</th><th class="n">Typical days to fix</th><th class="n">Fake cleanups caught</th>',
    rows.map(s => { const m = median(s.days); return `<tr><td><a href="kasa.html?ward=${s.ward}">Ward ${s.ward}</a></td><td>${esc(wards[s.ward]?.councillor_name || '—')}</td>
      <td class="n">${s.open}</td><td class="n">${s.overdue}</td><td class="n">${s.fixed}</td><td class="n">${m == null ? '—' : m < 1 ? '< 1' : Math.round(m)}</td><td class="n">${s.fake}</td></tr>`; }),
    'No wards yet.');

  // Every block (reports outside Purulia town)
  const bstats = {};
  all.forEach(r => {
    if (r.area_kind !== 'rural' || !r.block_name) return;
    const s = bstats[r.block_name] ||= { block: r.block_name, open: 0, overdue: 0, fixed: 0, fake: 0, days: [] };
    if (r.status !== 'resolved'){ s.open++; if ((now - new Date(r.created_at)) / DAY > (r.sla_days || 7)) s.overdue++; }
    s.fake += r.rejected_claims || 0;
  });
  fixed.forEach(r => { const s = bstats[r.block_name]; if (s && r.area_kind === 'rural'){ s.fixed++; s.days.push(fixDays(r)); } });
  const brows = Object.values(bstats).sort((a, b) => b.open - a.open || b.overdue - a.overdue || a.block.localeCompare(b.block));
  document.getElementById('an-blocks').innerHTML = table(
    '<th>Block</th><th class="n">Unresolved</th><th class="n">Overdue</th><th class="n">Verified fixed</th><th class="n">Typical days to fix</th><th class="n">Fake cleanups caught</th>',
    brows.map(s => { const m = median(s.days); return `<tr><td>${esc(s.block)}</td>
      <td class="n">${s.open}</td><td class="n">${s.overdue}</td><td class="n">${s.fixed}</td><td class="n">${m == null ? '—' : m < 1 ? '< 1' : Math.round(m)}</td><td class="n">${s.fake}</td></tr>`; }),
    'No village reports yet. Parishkar now takes reports from all 20 blocks of the district.');

  // Moderation in public: monthly counts only, no IDs (kasa_public_transparency).
  const { data: tr, error: trErr } = await sb.rpc('kasa_public_transparency');
  if (trErr || !tr){ document.getElementById('an-mod').innerHTML = '<div class="an-empty">Could not load moderation counts.</div>'; return; }
  const n = tr.now || {};
  set('an-mod-now', `Right now: ${n.waiting_review ?? 0} waiting for a moderator · ${n.hidden ?? 0} hidden · team of ${n.admins ?? 0} admin${n.admins === 1 ? '' : 's'} and ${n.moderators ?? 0} moderator${n.moderators === 1 ? '' : 's'}. Reasons are shown on each report's own evidence trail.`);
  const MOD_COLS = [['reported', 'Reports'], ['flagged', 'Flags'], ['hidden', 'Hidden'], ['kept', 'Kept after review'],
    ['recategorized', 'Category fixed by moderator'], ['auto_recategorized', 'Category fixed automatically'],
    ['claims_rejected', 'Fake cleanups thrown out'], ['claims_expired', 'Cleanup claims expired'],
    ['votes_voided', 'Confirmations voided'], ['official_replies', 'Official replies']];
  const months = (tr.months || []).filter(m => MOD_COLS.some(([k]) => m[k]));
  document.getElementById('an-mod').innerHTML = table(
    '<th>Month</th>' + MOD_COLS.map(([, l]) => `<th class="n">${esc(l)}</th>`).join(''),
    months.map(m => `<tr><td>${esc(new Date(m.month + '-01').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }))}</td>`
      + MOD_COLS.map(([k]) => `<td class="n">${m[k] || 0}</td>`).join('') + '</tr>'),
    'Nothing yet in the last 12 months.');
})();
