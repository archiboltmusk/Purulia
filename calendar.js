/* Civic calendar: the dates already on record for the chosen district (place-facts.js), on one
   month grid. Report fix targets (filed + sla_days), works warranty ends (kasa_public_works),
   promise deadlines (kasa_promises due_by) and the Swachh Pandal window (kasa_pandals).
   Nothing here is a new figure: each date comes from a row on another page, which it links to. */
(async function(){
  const cfg = window.KASA_CONFIG || {};
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  const I = window.KASA_I18N || {};
  let lang = 'en';
  try { lang = localStorage.getItem('kasa_lang') || 'en'; } catch (e) {}
  const catName = k => (I[lang] && I[lang]['cat_' + k]) || (I.en && I.en['cat_' + k]) || k;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = id => document.getElementById(id);
  const DAY = 86400000;
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const parse = s => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
  const fmt = d => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

  const KINDS = {
    fix:      { label: 'Report fix targets', dot: '#e07a5f' },
    warranty: { label: 'Works warranty ends', dot: '#7fbf7f' },
    promise:  { label: 'Promise deadlines', dot: '#d4a72a' },
    puja:     { label: 'Swachh Pandal window', dot: '#8fb3d9' }
  };

  const PF = window.PlaceFacts;
  let slug = 'purulia', D = null;
  if (PF){ await PF.load().catch(() => null); if (PF.data){ slug = PF.current(); D = PF.data.districts[slug]; } }
  const NAME = D ? D.name : 'Purulia';
  $('cl-place').textContent = NAME;
  if (PF && PF.data) PF.picker($('cl-pick'), slug, () => location.reload());
  else $('cl-pick').hidden = true;
  const inPlace = PF && PF.data ? await PF.reportFilter(slug) : () => true;

  const COLS = 'id,created_at,category,status,sla_days,landmark,ward_no,block_name,place,is_duplicate';
  const [a, b, works, prom, pandals] = await Promise.all([
    sb.from('kasa_public_reports').select(COLS).neq('status', 'resolved').order('created_at', { ascending: false }).limit(3000),
    sb.from('kasa_public_place_reports').select(COLS).neq('status', 'resolved').order('created_at', { ascending: false }).limit(3000),
    sb.rpc('kasa_public_works'),
    sb.rpc('kasa_promises'),
    sb.rpc('kasa_pandals')
  ]);

  const items = [];
  const seenIds = new Set();
  [...(a.data || []), ...(b.data || [])].forEach(r => {
    if (r.is_duplicate || seenIds.has(r.id) || !inPlace(r)) return;
    seenIds.add(r.id);
    const due = new Date(parse(r.created_at).getTime() + Number(r.sla_days || 7) * DAY);
    const where = [r.landmark, r.ward_no ? `Ward ${r.ward_no}` : '', r.block_name].filter(Boolean).join(', ');
    items.push({ kind: 'fix', date: due, title: `Fix target: ${catName(r.category)}`, sub: where, href: `case.html?id=${r.id}` });
  });
  (works.data || []).filter(inPlace).forEach(w => {
    if (!w.warranty_until) return;
    items.push({ kind: 'warranty', date: parse(w.warranty_until), title: `Warranty ends: ${w.work_name}`,
      sub: w.agency || '', href: `works.html#work-${w.id}` });
  });
  let keepPromise = () => true;
  if (PF && PF.data){
    const reps = slug === 'purulia' ? [] : await PF.reps(slug);
    const about = await PF.textFilter(slug), mine = new Set(reps.map(r => r.name.trim().toLowerCase()));
    keepPromise = p => { const txt = [p.area, p.role].filter(Boolean).join(' ');
      return PF.statewide(txt) || mine.has((p.who || '').trim().toLowerCase()) || about(txt); };
  }
  ((prom.data && prom.data.promises) || []).filter(p => p.due_by && p.status !== 'delivered' && keepPromise(p)).forEach(p => {
    items.push({ kind: 'promise', date: parse(p.due_by), title: `${p.who} promised: ${p.promise.slice(0, 120)}${p.promise.length > 120 ? '…' : ''}`,
      sub: p.source_name || '', href: 'promises.html' });
  });
  const win = pandals.data && pandals.data.window;
  if (win && win.start && win.end){
    for (let d = parse(win.start); d <= parse(win.end); d = new Date(d.getTime() + DAY))
      items.push({ kind: 'puja', date: d, title: 'Swachh Pandal: reports near pandals count today', sub: '', href: 'pandals.html' });
  }

  const failed = [a, b, works, prom, pandals].filter(x => x.error).length;
  $('cl-updated').textContent = failed ? 'Some lists could not be loaded. Please try again later.'
    : 'Updated ' + new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

  const on = new Set(Object.keys(KINDS));
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let month = new Date(today.getFullYear(), today.getMonth(), 1), picked = iso(today);
  const byDay = () => {
    const m = new Map();
    items.filter(x => on.has(x.kind)).forEach(x => { const k = iso(x.date); (m.get(k) || m.set(k, []).get(k)).push(x); });
    return m;
  };
  const inMonth = x => x.date.getFullYear() === month.getFullYear() && x.date.getMonth() === month.getMonth();

  function render(){
    $('cl-month').textContent = month.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    $('cl-pills').innerHTML = Object.entries(KINDS).map(([k, v]) => {
      const n = items.filter(x => x.kind === k && inMonth(x)).length;
      return `<button type="button" class="cl-pill" data-kind="${k}" aria-pressed="${on.has(k)}"><i style="background:${v.dot}"></i>${esc(v.label)} <b>${n}</b></button>`;
    }).join('');
    const days = byDay(), first = (month.getDay() + 6) % 7, len = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    let cells = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<div class="cl-dow">${d}</div>`).join('');
    for (let i = 0; i < first; i++) cells += '<div class="cl-cell cl-blank"></div>';
    for (let d = 1; d <= len; d++){
      const k = iso(new Date(month.getFullYear(), month.getMonth(), d)), list = days.get(k) || [];
      const counts = Object.keys(KINDS).map(kind => [kind, list.filter(x => x.kind === kind).length]).filter(x => x[1]);
      cells += `<button type="button" class="cl-cell${k === iso(today) ? ' cl-today' : ''}${k === picked ? ' cl-picked' : ''}" data-day="${k}">
        <span class="cl-n">${d}</span><span class="cl-dots">${counts.map(([kind, n]) =>
          `<span><i style="background:${KINDS[kind].dot}"></i>${n > 1 ? n : ''}</span>`).join('')}</span></button>`;
    }
    $('cl-grid').innerHTML = cells;
    const list = days.get(picked) || [], pd = parse(picked);
    $('cl-day-h').textContent = fmt(pd);
    $('cl-day').innerHTML = list.length ? `<ul class="cl-list">${list.map(x => `<li><i style="background:${KINDS[x.kind].dot}"></i>
        <div><a href="${esc(x.href)}">${esc(x.title)}</a>${x.sub ? `<small>${esc(x.sub)}</small>` : ''}
        ${x.kind === 'fix' && pd < today ? '<small class="cl-late">Past its fix target and still open</small>' : ''}</div></li>`).join('')}</ul>`
      : '<p class="an-empty">Nothing on record for this day.</p>';
  }

  // Add the month's dates to a phone calendar: one all-day event each, linking back here.
  function ics(){
    const base = location.href.replace(/[^/]*$/, '');
    const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
    const line = s => s.replace(/[\\,;]/g, m => '\\' + m).replace(/\n/g, ' ');
    const ev = items.filter(x => on.has(x.kind) && inMonth(x)).map((x, i) => {
      const d = iso(x.date).replace(/-/g, ''), e = iso(new Date(x.date.getTime() + DAY)).replace(/-/g, '');
      return ['BEGIN:VEVENT', `UID:${d}-${x.kind}-${i}@parishkar`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${e}`,
        `SUMMARY:${line(x.title)}`, `URL:${base}${x.href}`, 'END:VEVENT'].join('\r\n');
    });
    if (!ev.length) return alert('Nothing to add for this month with the kinds chosen.');
    const blob = new Blob([['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Parishkar//Civic calendar//EN', ...ev, 'END:VCALENDAR'].join('\r\n')], { type: 'text/calendar' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `parishkar-${slug}-${iso(month).slice(0, 7)}.ics`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  $('cl-pills').addEventListener('click', e => {
    const p = e.target.closest('[data-kind]'); if (!p) return;
    on.has(p.dataset.kind) ? on.delete(p.dataset.kind) : on.add(p.dataset.kind); render();
  });
  $('cl-grid').addEventListener('click', e => { const c = e.target.closest('[data-day]'); if (c){ picked = c.dataset.day; render(); } });
  $('cl-prev').addEventListener('click', () => { month = new Date(month.getFullYear(), month.getMonth() - 1, 1); render(); });
  $('cl-next').addEventListener('click', () => { month = new Date(month.getFullYear(), month.getMonth() + 1, 1); render(); });
  $('cl-ics').addEventListener('click', ics);
  render();
})();
