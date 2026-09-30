/* One page per ward: ward.html?ward=7 (Purulia town) · ward.html?block=Arsha (villages in a block).
   Only that area's reports, who answers for them, and numbers counted from the public record. */
(async function(){
  const COLUMNS = 'id,created_at,ward_no,category,severity,status,landmark,resolved_at,resolution_method,sla_days,is_duplicate,area_kind,block_name';
  const DAY = 86400000;
  const cfg = window.KASA_CONFIG || {}, city = window.KASA_CITY || {};
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const L = (window.KASA_I18N && window.KASA_I18N.en) || {};
  const cat = k => L['cat_' + k] || k;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = id => document.getElementById(id);
  const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  const fmt = d => new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' });
  const link = r => `kasa.html?report=${encodeURIComponent(r.id)}`;
  const days = n => n < 1 ? 'under a day' : n === 1 ? '1 day' : n + ' days';

  const q = new URLSearchParams(location.search);
  const blocks = [...new Set([...(city.constituencies || []).flatMap(c => c.blocks || []), ...Object.keys(city.splitBlocks || {})])].sort();
  let area = q.get('block') ? { kind: 'block', id: q.get('block') } : { kind: 'ward', id: Number(q.get('ward')) || 1 };

  const [rep, wardRes, replyRes] = await Promise.all([
    sb.from('kasa_public_reports').select(COLUMNS).order('created_at', { ascending: false }).limit(5000),
    sb.from('wards').select('ward_no,councillor_name,party').order('ward_no'),
    sb.from('kasa_public_replies').select('report_id,created_at').limit(5000)
  ]);
  if (rep.error){ set('an-updated', 'Could not load the data. Please try again later.'); return; }
  const all = (rep.data || []).filter(r => !r.is_duplicate);
  const wards = wardRes.data || [];
  // First public reply per report (right of reply: an official answering on the record).
  const firstReply = new Map();
  for (const x of replyRes.data || []){
    const k = String(x.report_id), t = Date.parse(x.created_at);
    if (!firstReply.has(k) || t < firstReply.get(k)) firstReply.set(k, t);
  }
  if (area.kind === 'ward' && wards.length && !wards.some(w => w.ward_no === area.id)) area.id = wards[0].ward_no;
  if (area.kind === 'block'){
    const b = blocks.find(x => x.toLowerCase() === area.id.toLowerCase());
    area = b ? { kind: 'block', id: b } : { kind: 'ward', id: 1 };
  }

  const sel = $('wd-area');
  sel.innerHTML = '<optgroup label="Purulia town">' + wards.map(x => `<option value="ward:${x.ward_no}">Ward ${x.ward_no}${x.councillor_name ? ' · ' + esc(x.councillor_name) : ''}</option>`).join('')
    + '</optgroup><optgroup label="Villages, by block">' + blocks.map(b => `<option value="block:${esc(b)}">${esc(b)} block</option>`).join('') + '</optgroup>';

  const inArea = r => area.kind === 'ward'
    ? r.area_kind !== 'rural' && Number(r.ward_no) === area.id
    : r.area_kind === 'rural' && (r.block_name || '').toLowerCase() === area.id.toLowerCase();
  const age = r => (Date.now() - Date.parse(r.created_at)) / DAY;
  const overdue = r => r.status !== 'resolved' && age(r) > (r.sla_days || 7);

  function render(){
    const mine = all.filter(inArea);
    const open = mine.filter(r => r.status !== 'resolved');
    const fixed = mine.filter(r => r.status === 'resolved');
    const late = open.filter(overdue);
    const timed = fixed.filter(r => r.resolved_at);
    const avgFix = timed.length ? Math.round(timed.reduce((n, r) => n + (Date.parse(r.resolved_at) - Date.parse(r.created_at)) / DAY, 0) / timed.length) : null;
    const replied = mine.filter(r => firstReply.has(String(r.id)));
    const place = area.kind === 'ward' ? `Ward ${area.id}` : `${area.id} block`;

    document.title = `${place}, on the record — Parishkar Purulia`;
    set('wd-place', place);
    set('an-updated', 'Updated ' + new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }));

    if (area.kind === 'ward'){
      const w = wards.find(x => x.ward_no === area.id) || {};
      set('wd-rep-l', 'Councillor, ' + place);
      set('wd-rep-n', w.councillor_name || 'No councillor on record');
      $('wd-rep-s').innerHTML = (w.party ? esc(w.party) + ' · ' : '') + 'Purulia Municipality · <a href="municipality.html">Who runs the municipality</a>';
    } else {
      const c = (city.constituencies || []).find(x => (x.blocks || []).includes(area.id));
      set('wd-rep-l', 'Who answers here');
      set('wd-rep-n', 'The gram panchayat, then the block office');
      $('wd-rep-s').innerHTML = c ? `MLA: ${esc(c.mla.name)} (${esc(c.mla.party)}), ${esc(c.name)}` : '';
    }
    set('wd-replied', mine.length ? `${replied.length} of ${mine.length}` : '—');
    const replyDays = replied.map(r => Math.max(0, (firstReply.get(String(r.id)) - Date.parse(r.created_at)) / DAY));
    set('wd-replied-s', replied.length
      ? `reports answered on the record, first reply after ${days(Math.round(replyDays.reduce((a, b) => a + b, 0) / replyDays.length))} on average`
      : 'reports answered on the record');

    set('t-total', mine.length); set('t-open', open.length); set('t-overdue', late.length);
    set('t-rate', mine.length ? Math.round(fixed.length / mine.length * 100) + '%' : '—');
    set('t-rate-s', `${fixed.length} of ${mine.length} reports`);
    set('t-days', avgFix == null ? '—' : avgFix);

    const list = (id, rows, line, empty) => { $(id).innerHTML = rows.length
      ? rows.map(r => `<li><a href="${link(r)}">${esc(cat(r.category))}${r.landmark ? ' · ' + esc(r.landmark) : ''}</a>${line(r)}</li>`).join('')
      : `<li><small>${esc(empty)}</small></li>`; };
    list('wd-waiting', [...open].sort((a, b) => overdue(b) - overdue(a) || Date.parse(a.created_at) - Date.parse(b.created_at)),
      r => `<small${overdue(r) ? ' class="wd-late"' : ''}>${days(Math.floor(age(r)))} waiting${overdue(r) ? ' · overdue' : ''}</small>`,
      `Nothing waiting in ${place}.`);
    list('wd-fixed', [...fixed].sort((a, b) => Date.parse(b.resolved_at || 0) - Date.parse(a.resolved_at || 0)).slice(0, 20),
      r => `<small>${r.resolved_at ? 'fixed in ' + days(Math.round((Date.parse(r.resolved_at) - Date.parse(r.created_at)) / DAY)) + ' · ' + fmt(r.resolved_at) : 'fixed'}</small>`,
      'Nothing fixed here yet.');

    // No reports yet: one line and the report button, not a page of zeros.
    $('wd-empty').hidden = !!mine.length;
    $('wd-tiles').hidden = $('wd-grid').hidden = !mine.length;
    if (!mine.length) $('wd-empty').innerHTML = `Nothing has been reported in ${esc(place)} yet. See a problem there? <a href="kasa.html?report=new">Report it: no login, about 30 seconds.</a>`;

    const p = new URLSearchParams({ [area.kind]: area.id });
    $('wd-links').innerHTML = [
      [`kasa.html?${area.kind === 'ward' ? 'ward=' + area.id : ''}`, 'See it on the map'],
      [`digest.html?${p}`, 'This week in ' + place],
      area.kind === 'ward' && [`communities.html?ward=${area.id}`, 'Volunteer groups here'],
      area.kind === 'ward' && ['municipality.html', 'Where the money goes'],
      area.kind === 'ward' && [`add-town.html?fix=purulia&ward=${area.id}`, 'Border wrong? Suggest a fix'],
      [`poster.html?${p}`, 'Print a poster for ' + place]
    ].filter(Boolean).map(([h, l]) => `<a href="${esc(h)}">${esc(l)} →</a>`).join('');
    sel.value = `${area.kind}:${area.id}`;
    history.replaceState(null, '', '?' + p);
    render.summary = `${place}, Purulia: ${open.length} unresolved (${late.length} overdue), ${fixed.length} of ${mine.length} fixed. See every report, or report one:`;
  }

  sel.addEventListener('change', () => { const [k, ...v] = sel.value.split(':'); area = { kind: k, id: k === 'ward' ? Number(v[0]) : v.join(':') }; render(); });
  $('wd-share').addEventListener('click', async () => {
    const url = location.href;
    if (navigator.share){ navigator.share({ title: 'Parishkar Purulia', text: render.summary, url }).catch(() => {}); return; }
    try { await navigator.clipboard.writeText(`${render.summary} ${url}`); set('wd-share', 'Copied ✓'); setTimeout(() => set('wd-share', 'Share this page'), 2000); }
    catch (e) { prompt('Copy this link:', url); }
  });

  render();
})();
