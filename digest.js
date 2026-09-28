/* Weekly ward digest: one ward's (or block's) Monday–Sunday week, from the public view.
   digest.html?ward=5 · digest.html?block=Arsha · digest.html?all=district|town|villages (the default
   is all of Purulia) · add &week=YYYY-MM-DD (a Monday) for an earlier week, or &month=YYYY-MM for a
   whole calendar month (the monthly "State of Purulia"). */
(async function(){
  const COLUMNS = 'id,created_at,ward_no,category,status,landmark,resolved_at,resolution_method,sla_days,is_duplicate,rejected_claims,area_kind,block_name,parent_report_id';
  const DAY = 86400000, IST = 330 * 60000;

  // Fixes that didn't last: a new report at the spot (a recurrence) within fixMustLastDays of the fix.
  // Times are public to the hour, so allow an hour of slack.
  const LAST_DAYS = (window.KASA_CITY && window.KASA_CITY.fixMustLastDays) || 14;
  function relapsedIds(rows){
    const byId = new Map(rows.map(r => [String(r.id), r])), out = new Set();
    for (const c of rows){
      const p = c.parent_report_id != null && !c.is_duplicate && byId.get(String(c.parent_report_id));
      if (!p || p.status !== 'resolved' || !p.resolved_at) continue;
      const gap = Date.parse(c.created_at) - Date.parse(p.resolved_at);
      if (gap >= -3600000 && gap <= LAST_DAYS * DAY) out.add(String(p.id));
    }
    return out;
  }
  const cfg = window.KASA_CONFIG || {}, city = window.KASA_CITY || {};
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const L = (window.KASA_I18N && window.KASA_I18N.en) || {};
  const cat = k => L['cat_' + k] || k;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  const fmt = (d, o) => new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', ...o });
  const link = r => `kasa.html?report=${encodeURIComponent(r.id)}`;

  // Monday 00:00 IST of the week containing t.
  const mondayOf = t => { const ist = new Date(t + IST); const dow = (ist.getUTCDay() + 6) % 7;
    return Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() - dow) - IST; };
  const thisWeek = mondayOf(Date.now()), lastFullWeek = thisWeek - 7 * DAY;

  const q = new URLSearchParams(location.search);
  const blocks = [...new Set([...(city.constituencies || []).flatMap(c => c.blocks || []), ...Object.keys(city.splitBlocks || {})])].sort();
  const ALL = { district: 'All of Purulia', town: 'All of Purulia town', villages: 'All villages' };
  let area = q.get('block') ? { kind: 'block', id: q.get('block') }
    : q.get('ward') ? { kind: 'ward', id: Number(q.get('ward')) || 1 }
    : { kind: 'all', id: ALL[q.get('all')] ? q.get('all') : 'district' };
  const w = q.get('week') && Date.parse(q.get('week') + 'T00:00:00+05:30');
  let start = Number.isFinite(w) ? mondayOf(w) : lastFullWeek;
  // Month mode: 00:00 IST on the 1st. Default is the last full month.
  const monthStart = (y, m) => Date.UTC(y, m, 1) - IST;
  const nowIst = new Date(Date.now() + IST), thisMonth = monthStart(nowIst.getUTCFullYear(), nowIst.getUTCMonth());
  const addMonths = (t, n) => { const d = new Date(t + IST); return monthStart(d.getUTCFullYear(), d.getUTCMonth() + n); };
  const mq = /^(\d{4})-(\d{2})$/.exec(q.get('month') || '');
  let monthly = q.has('month');
  if (monthly) start = mq ? Math.min(monthStart(+mq[1], +mq[2] - 1), thisMonth) : addMonths(thisMonth, -1);
  const unit = () => monthly ? 'month' : 'week';
  const periodEnd = () => monthly ? addMonths(start, 1) : start + 7 * DAY;

  const [rep, wardRes, promRes] = await Promise.all([
    sb.from('kasa_public_reports').select(COLUMNS).order('created_at', { ascending: false }).limit(5000),
    sb.from('wards').select('ward_no,councillor_name,party').order('ward_no'),
    sb.rpc('kasa_promises')
  ]);
  const promises = promRes.error ? null : ((promRes.data && promRes.data.promises) || []);
  if (rep.error){ set('an-updated', 'Could not load the data. Please try again later.'); return; }
  const relapsed = relapsedIds(rep.data || []);
  const all = (rep.data || []).filter(r => !r.is_duplicate);
  const wards = wardRes.data || [];

  const sel = document.getElementById('dg-area');
  sel.innerHTML = '<optgroup label="Everything">' + Object.entries(ALL).map(([k, v]) => `<option value="all:${k}">${v}</option>`).join('') + '</optgroup>'
    + '<optgroup label="Purulia town">' + wards.map(x => `<option value="ward:${x.ward_no}">Ward ${x.ward_no}</option>`).join('')
    + '</optgroup><optgroup label="Villages, by block">' + blocks.map(b => `<option value="block:${esc(b)}">${esc(b)} block</option>`).join('') + '</optgroup>';

  const inArea = r => area.kind === 'all'
    ? area.id === 'district' || (area.id === 'town' ? r.area_kind !== 'rural' : r.area_kind === 'rural')
    : area.kind === 'ward'
    ? r.area_kind !== 'rural' && Number(r.ward_no) === area.id
    : r.area_kind === 'rural' && (r.block_name || '').toLowerCase() === area.id.toLowerCase();
  const isFix = r => r.status === 'resolved' && ['community', 'photo_check'].includes(r.resolution_method) && r.resolved_at && !relapsed.has(String(r.id));

  function render(){
    const end = periodEnd(), soFar = end > Date.now(), cut = Math.min(end, Date.now());
    const mine = all.filter(inArea);
    const opened = mine.filter(r => { const c = Date.parse(r.created_at); return c >= start && c < end; });
    const fixed = mine.filter(r => isFix(r) && Date.parse(r.resolved_at) >= start && Date.parse(r.resolved_at) < end);
    const openAtEnd = mine.filter(r => Date.parse(r.created_at) < end && !(r.status === 'resolved' && (!r.resolved_at || Date.parse(r.resolved_at) < end)));
    const overdue = openAtEnd.filter(r => (cut - Date.parse(r.created_at)) / DAY > (r.sla_days || 7));
    const ward = area.kind === 'ward' && wards.find(x => x.ward_no === area.id);
    const place = area.kind === 'all' ? ALL[area.id] : area.kind === 'ward' ? `Ward ${area.id}` : `${area.id} block`;
    const week = (monthly ? fmt(start, { month: 'long', year: 'numeric' })
      : `${fmt(start, { day: 'numeric', month: 'short' })} – ${fmt(end - 1, { day: 'numeric', month: 'short', year: 'numeric' })}`) + (soFar ? ' (so far)' : '');
    const U = unit();
    document.querySelectorAll('[data-unit]').forEach(el => { el.textContent = U; });
    document.getElementById('dg-mode').textContent = monthly ? 'Weekly view' : 'Monthly view';
    document.getElementById('dg-prev').setAttribute('aria-label', 'Previous ' + U);
    document.getElementById('dg-next').setAttribute('aria-label', 'Next ' + U);

    set('dg-place', place); set('dg-week', week);
    set('dg-sub', (ward ? `Councillor: ${ward.councillor_name}${ward.party ? ' (' + ward.party + ')' : ''}. ` : '')
      + (monthly ? 'The whole month, from the public record.' : 'A new digest every Monday, from the public record.') + ' A problem counts as fixed only when neighbours confirm it on the spot.');
    set('an-updated', 'Updated ' + new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }));
    set('t-open-when', soFar ? 'right now' : 'at the end of the ' + U);
    set('t-new', opened.length); set('t-fixed', fixed.length); set('t-open', openAtEnd.length);
    set('t-overdue', overdue.length); set('t-fake', mine.reduce((n, r) => n + (r.rejected_claims || 0), 0));

    const list = (id, rows, line, empty) => { document.getElementById(id).innerHTML = rows.length
      ? rows.map(r => `<li><a href="${link(r)}">${esc(cat(r.category))}${r.landmark ? ' · ' + esc(r.landmark) : ''}</a><small>${line(r)}</small></li>`).join('')
      : `<li><small>${esc(empty)}</small></li>`; };
    list('dg-new', opened, r => fmt(r.created_at, { weekday: 'short', day: 'numeric', month: 'short' }), `No new reports this ${U}.`);
    list('dg-fixed', fixed, r => { const d = Math.round((Date.parse(r.resolved_at) - Date.parse(r.created_at)) / DAY); return d < 1 ? 'fixed same day' : `fixed in ${d} days`; }, `Nothing verified fixed this ${U}.`);
    list('dg-oldest', [...openAtEnd].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)).slice(0, area.kind === 'all' ? 15 : 8),
      r => { const d = Math.floor((cut - Date.parse(r.created_at)) / DAY); return `${d < 1 ? 'today' : d === 1 ? '1 day' : d + ' days'}${(cut - Date.parse(r.created_at)) / DAY > (r.sla_days || 7) ? ' · overdue' : ''}`; },
      'Nothing waiting. 🎉');

    // A quiet week is one line and an invitation, not a page of zeros.
    const quiet = !opened.length && !fixed.length && !openAtEnd.length;
    document.getElementById('dg-empty').hidden = !quiet;
    document.getElementById('dg-tiles').hidden = quiet;
    document.getElementById('dg-grid').hidden = quiet;
    if (quiet) document.getElementById('dg-empty').innerHTML =
      `Nothing was reported in ${esc(place)} this ${U}. See a problem there? <a href="kasa.html">Report it — it takes 30 seconds.</a>`;

    document.getElementById('dg-next').disabled = start >= (monthly ? thisMonth : thisWeek);
    // Promises (whole district; they belong to named leaders, not a ward). Month view only.
    const pc = document.getElementById('dg-promises');
    pc.hidden = !monthly || !promises;
    if (monthly && promises){
      const n = s => promises.filter(x => x.status === s).length;
      const moved = promises.filter(x => x.status !== 'promised' && x.status_date && Date.parse(x.status_date + 'T00:00:00+05:30') >= start && Date.parse(x.status_date + 'T00:00:00+05:30') < end);
      document.getElementById('dg-prom').innerHTML = `<li><small>${promises.length} tracked: ${n('promised')} still only promised, ${n('in_progress')} in progress, ${n('delivered')} delivered, ${n('broken')} broken.</small></li>`
        + (moved.length ? moved.map(x => `<li><a href="promises.html">${esc((x.who ? x.who + ': ' : '') + (x.promise || 'Promise'))}</a><small>${esc(x.status.replace('_', ' '))}${x.status_source_url ? ` · <a href="${esc(x.status_source_url)}" rel="noopener">source</a>` : ''}</small></li>`).join('')
          : `<li><small>No promise changed status this ${U}.</small></li>`);
    }
    sel.value = `${area.kind}:${area.id}`;
    const p = new URLSearchParams({ [area.kind]: area.id });
    if (monthly) p.set('month', new Date(start + IST).toISOString().slice(0, 7));
    else if (start !== lastFullWeek) p.set('week', new Date(start + IST).toISOString().slice(0, 10));
    history.replaceState(null, '', '?' + p);
    const fastest = fixed.map(r => ({ r, d: Math.max(0, Math.round((Date.parse(r.resolved_at) - Date.parse(r.created_at)) / DAY)) }))
      .sort((a, b) => a.d - b.d)[0];
    render.card = { kind: monthly ? 'MONTHLY DIGEST' : 'WEEKLY DIGEST', place, week, opened: opened.length, fixed: fixed.length, open: openAtEnd.length, overdue: overdue.length,
      fastest: fastest && `${cat(fastest.r.category)}${fastest.r.landmark ? ' · ' + fastest.r.landmark : ''}, ${fastest.d < 1 ? 'fixed same day' : 'fixed in ' + fastest.d + (fastest.d === 1 ? ' day' : ' days')}` };
    render.summary = `${place}, ${week} — ${opened.length} new, ${fixed.length} verified fixed, ${openAtEnd.length} still unresolved (${overdue.length} overdue). Parishkar Purulia:`;
  }

  sel.addEventListener('change', () => { const [k, ...v] = sel.value.split(':'); area = { kind: k, id: k === 'ward' ? Number(v[0]) : v.join(':') }; render(); });
  document.getElementById('dg-prev').addEventListener('click', () => { start = monthly ? addMonths(start, -1) : start - 7 * DAY; render(); });
  document.getElementById('dg-next').addEventListener('click', () => { start = monthly ? addMonths(start, 1) : start + 7 * DAY; render(); });
  document.getElementById('dg-mode').addEventListener('click', () => {
    monthly = !monthly;
    start = monthly ? addMonths(thisMonth, -1) : lastFullWeek;
    render();
  });
  document.getElementById('dg-share').addEventListener('click', async () => {
    const url = location.href;
    if (navigator.share){ navigator.share({ title: 'Parishkar Purulia — weekly digest', text: render.summary, url }).catch(() => {}); return; }
    try { await navigator.clipboard.writeText(`${render.summary} ${url}`); set('dg-share', 'Copied ✓'); setTimeout(() => set('dg-share', 'Share this digest'), 2000); }
    catch (e) { prompt('Copy this link:', url); }
  });
  document.getElementById('dg-card').addEventListener('click', async () => {
    const blob = await weekCard(render.card);
    const file = new File([blob], 'parishkar-week.png', { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })){
      try { await navigator.share({ files: [file], title: 'Parishkar Purulia — weekly digest', text: `${render.summary} ${location.href}` }); } catch (e) {}
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  /* 1080×1350 picture of the week, for WhatsApp status and Instagram: four numbers, the fastest fix, the link. */
  async function weekCard(d){
    const W = 1080, H = 1350, PAD = 72;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    await document.fonts?.ready;
    const serif = '"EB Garamond", Georgia, serif', mono = '"DM Mono", ui-monospace, monospace';
    g.fillStyle = '#0a0805'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#e8a34a'; g.font = `500 30px ${mono}`;
    g.fillText(d.kind, PAD, 130);
    g.fillStyle = '#f0e6d0'; g.font = `700 84px ${serif}`;
    g.fillText(d.place, PAD, 230, W - 2 * PAD);
    g.fillStyle = 'rgba(240,230,208,.72)'; g.font = `italic 400 44px ${serif}`;
    g.fillText(d.week, PAD, 295, W - 2 * PAD);
    const tiles = [['New reports', d.opened, '#f0e6d0'], ['Verified fixed', d.fixed, '#7fb069'],
                   ['Still unresolved', d.open, '#e8a34a'], ['Overdue', d.overdue, '#d9534f']];
    const tw = (W - 2 * PAD - 40) / 2, th = 250;
    tiles.forEach(([label, n, color], i) => {
      const x = PAD + (i % 2) * (tw + 40), y = 370 + Math.floor(i / 2) * (th + 40);
      g.fillStyle = 'rgba(240,230,208,.06)'; g.fillRect(x, y, tw, th);
      g.fillStyle = color; g.font = `700 130px ${serif}`; g.fillText(String(n), x + 36, y + 150);
      g.fillStyle = 'rgba(240,230,208,.8)'; g.font = `500 32px ${mono}`; g.fillText(label, x + 36, y + 210);
    });
    if (d.fastest){
      g.fillStyle = '#e8a34a'; g.font = `500 30px ${mono}`; g.fillText('FASTEST FIX', PAD, 1010);
      g.fillStyle = '#f0e6d0'; g.font = `400 44px ${serif}`; g.fillText(d.fastest, PAD, 1070, W - 2 * PAD);
    }
    g.fillStyle = 'rgba(240,230,208,.6)'; g.font = `400 30px ${serif}`;
    g.fillText('Fixed means neighbours confirmed it on the spot.', PAD, 1150, W - 2 * PAD);
    g.fillStyle = '#d4882a'; g.fillRect(0, H - 120, W, 120);
    g.fillStyle = '#0a0805'; g.font = `700 40px ${serif}`; g.fillText('Parishkar Purulia', PAD, H - 68);
    g.font = `500 28px ${mono}`; g.fillText('Report a problem in 30 seconds · archiboltmusk.github.io/Purulia', PAD, H - 28, W - 2 * PAD);
    return new Promise((resolve, reject) => c.toBlob(b => (b ? resolve(b) : reject(new Error('card'))), 'image/png'));
  }

  render();
})();
