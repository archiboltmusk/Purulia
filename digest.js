/* Weekly ward digest: one ward's (or block's) Monday–Sunday week, from the public view.
   digest.html?ward=5 · digest.html?block=Arsha · add &week=YYYY-MM-DD (a Monday) for an earlier week. */
(async function(){
  const COLUMNS = 'id,created_at,ward_no,category,status,landmark,resolved_at,resolution_method,sla_days,is_duplicate,rejected_claims,area_kind,block_name';
  const DAY = 86400000, IST = 330 * 60000;
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
  let area = q.get('block') ? { kind: 'block', id: q.get('block') } : { kind: 'ward', id: Number(q.get('ward')) || 1 };
  const w = q.get('week') && Date.parse(q.get('week') + 'T00:00:00+05:30');
  let start = Number.isFinite(w) ? mondayOf(w) : lastFullWeek;

  const [rep, wardRes] = await Promise.all([
    sb.from('kasa_public_reports').select(COLUMNS).order('created_at', { ascending: false }).limit(5000),
    sb.from('wards').select('ward_no,councillor_name,party').order('ward_no')
  ]);
  if (rep.error){ set('an-updated', 'Could not load the data. Please try again later.'); return; }
  const all = (rep.data || []).filter(r => !r.is_duplicate);
  const wards = wardRes.data || [];

  const sel = document.getElementById('dg-area');
  sel.innerHTML = '<optgroup label="Purulia town">' + wards.map(x => `<option value="ward:${x.ward_no}">Ward ${x.ward_no}</option>`).join('')
    + '</optgroup><optgroup label="Villages, by block">' + blocks.map(b => `<option value="block:${esc(b)}">${esc(b)} block</option>`).join('') + '</optgroup>';

  const inArea = r => area.kind === 'ward'
    ? r.area_kind !== 'rural' && Number(r.ward_no) === area.id
    : r.area_kind === 'rural' && (r.block_name || '').toLowerCase() === area.id.toLowerCase();
  const isFix = r => r.status === 'resolved' && ['community', 'photo_check'].includes(r.resolution_method) && r.resolved_at;

  function render(){
    const end = start + 7 * DAY, soFar = end > Date.now(), cut = Math.min(end, Date.now());
    const mine = all.filter(inArea);
    const opened = mine.filter(r => { const c = Date.parse(r.created_at); return c >= start && c < end; });
    const fixed = mine.filter(r => isFix(r) && Date.parse(r.resolved_at) >= start && Date.parse(r.resolved_at) < end);
    const openAtEnd = mine.filter(r => Date.parse(r.created_at) < end && !(r.status === 'resolved' && (!r.resolved_at || Date.parse(r.resolved_at) < end)));
    const overdue = openAtEnd.filter(r => (cut - Date.parse(r.created_at)) / DAY > (r.sla_days || 7));
    const ward = area.kind === 'ward' && wards.find(x => x.ward_no === area.id);
    const place = area.kind === 'ward' ? `Ward ${area.id}` : `${area.id} block`;
    const week = `${fmt(start, { day: 'numeric', month: 'short' })} – ${fmt(end - 1, { day: 'numeric', month: 'short', year: 'numeric' })}${soFar ? ' (so far)' : ''}`;

    set('dg-place', place); set('dg-week', week);
    set('dg-sub', (ward ? `Councillor: ${ward.councillor_name}${ward.party ? ' (' + ward.party + ')' : ''}. ` : '')
      + 'A new digest every Monday, from the public record. A problem counts as fixed only when neighbours confirm it on the spot.');
    set('an-updated', 'Updated ' + new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }));
    set('t-open-when', soFar ? 'right now' : 'at the end of the week');
    set('t-new', opened.length); set('t-fixed', fixed.length); set('t-open', openAtEnd.length);
    set('t-overdue', overdue.length); set('t-fake', mine.reduce((n, r) => n + (r.rejected_claims || 0), 0));

    const list = (id, rows, line, empty) => { document.getElementById(id).innerHTML = rows.length
      ? rows.map(r => `<li><a href="${link(r)}">${esc(cat(r.category))}${r.landmark ? ' · ' + esc(r.landmark) : ''}</a><small>${line(r)}</small></li>`).join('')
      : `<li><small>${esc(empty)}</small></li>`; };
    list('dg-new', opened, r => fmt(r.created_at, { weekday: 'short', day: 'numeric', month: 'short' }), 'No new reports this week.');
    list('dg-fixed', fixed, r => { const d = Math.round((Date.parse(r.resolved_at) - Date.parse(r.created_at)) / DAY); return d < 1 ? 'fixed same day' : `fixed in ${d} days`; }, 'Nothing verified fixed this week.');
    list('dg-oldest', [...openAtEnd].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)).slice(0, 8),
      r => { const d = Math.floor((cut - Date.parse(r.created_at)) / DAY); return `${d < 1 ? 'today' : d === 1 ? '1 day' : d + ' days'}${(cut - Date.parse(r.created_at)) / DAY > (r.sla_days || 7) ? ' · overdue' : ''}`; },
      'Nothing waiting. 🎉');

    document.getElementById('dg-next').disabled = start >= thisWeek;
    sel.value = `${area.kind}:${area.id}`;
    const p = new URLSearchParams({ [area.kind]: area.id });
    if (start !== lastFullWeek) p.set('week', new Date(start + IST).toISOString().slice(0, 10));
    history.replaceState(null, '', '?' + p);
    render.summary = `${place}, ${week} — ${opened.length} new, ${fixed.length} verified fixed, ${openAtEnd.length} still unresolved (${overdue.length} overdue). Parishkar Purulia:`;
  }

  sel.addEventListener('change', () => { const [k, ...v] = sel.value.split(':'); area = { kind: k, id: k === 'ward' ? Number(v[0]) : v.join(':') }; render(); });
  document.getElementById('dg-prev').addEventListener('click', () => { start -= 7 * DAY; render(); });
  document.getElementById('dg-next').addEventListener('click', () => { start += 7 * DAY; render(); });
  document.getElementById('dg-share').addEventListener('click', async () => {
    const url = location.href;
    if (navigator.share){ navigator.share({ title: 'Parishkar Purulia — weekly digest', text: render.summary, url }).catch(() => {}); return; }
    try { await navigator.clipboard.writeText(`${render.summary} ${url}`); set('dg-share', 'Copied ✓'); setTimeout(() => set('dg-share', 'Share this digest'), 2000); }
    catch (e) { prompt('Copy this link:', url); }
  });
  render();
})();
