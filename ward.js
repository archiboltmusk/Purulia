/* One page per ward: ward.html?ward=7 (Purulia town) · ward.html?block=Arsha (villages in a block).
   Only that area's reports, who answers for them, and numbers counted from the public record. */
(async function(){
  const COLUMNS = 'id,created_at,lat,lng,seen_on_site,ward_no,category,severity,status,landmark,resolved_at,resolution_method,sla_days,is_duplicate,area_kind,block_name';
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

  // Outlines for the endpaper map: the same boundary files the report map draws.
  const shapes = {};
  await Promise.all([['ward', city.wardsGeojson], ['block', city.blocksGeojson]].map(async ([k, f]) => {
    try { const r = f && await fetch(f); shapes[k] = r && r.ok ? (await r.json()).features || [] : []; } catch (e) { shapes[k] = []; }
  }));
  // Border fixes approved by a moderator replace the shipped outline; the change is noted under the links.
  let borderHistory = [];
  if (area.kind === 'ward') {
    BoundaryLive.apply({ features: shapes.ward }, await BoundaryLive.rows('purulia', sb));
    borderHistory = await BoundaryLive.history('purulia', sb);
  }
  const borderLine = () => BoundaryLive.note(borderHistory, area.kind === 'ward' ? area.id : null);

  /* Endpaper: the area drawn ligne claire (flat paper, one ink line) with every report as a dot,
     like the map pages inside an album cover. Projection: plain lng/lat scaled by cos(latitude). */
  function endpaper(place, rows){
    const f = (shapes[area.kind] || []).find(x => area.kind === 'ward'
      ? Number(x.properties.ward) === area.id
      : String(x.properties.block || '').toLowerCase() === area.id.toLowerCase());
    if (!f) return `<p>No outline on file for ${esc(place)}.</p>`;
    const g = f.geometry, polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    const pts = polys.flat(2);
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    pts.forEach(([x, y]) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); });
    const k = Math.cos((y0 + y1) / 2 * Math.PI / 180), W = 400, H = 300, pad = 28;
    const s = Math.min((W - 2 * pad) / ((x1 - x0) * k || 1), (H - 2 * pad - 24) / ((y1 - y0) || 1));
    const ox = (W - (x1 - x0) * k * s) / 2, oy = 24 + (H - 24 - (y1 - y0) * s) / 2;
    const P = ([x, y]) => [(ox + (x - x0) * k * s).toFixed(1), (oy + (y1 - y) * s).toFixed(1)];
    const d = polys.map(poly => poly.map(ring => 'M' + ring.map(c => P(c).join(' ')).join('L') + 'Z').join('')).join('');
    const colour = r => r.status === 'resolved' ? '#5a9e5a' : overdue(r) ? '#d9534f' : '#e0a14a';
    const dots = rows.filter(r => r.lat != null && r.lng != null && r.lng >= x0 && r.lng <= x1 && r.lat >= y0 && r.lat <= y1)
      .sort((a, b) => (a.status === 'resolved') - (b.status === 'resolved'))
      .map(r => { const [cx, cy] = P([r.lng, r.lat]); return `<a href="case.html?id=${encodeURIComponent(r.id)}"><title>${esc(cat(r.category))}${r.landmark ? ', ' + esc(r.landmark) : ''}</title><circle cx="${cx}" cy="${cy}" r="5.5" fill="${colour(r)}"/></a>`; }).join('');
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Map of ${esc(place)} with ${rows.length} reports"><g stroke="#1a1410" stroke-width="2" stroke-linejoin="round">
      <rect x="1" y="1" width="${W - 2}" height="${H - 2}" fill="#f3ead6"/><rect x="8" y="8" width="${W - 16}" height="${H - 16}" fill="none" stroke-width="1" stroke-dasharray="4 3"/>
      <path d="${d}" fill="#fbf7ee" fill-rule="evenodd"/>
      <rect x="16" y="16" width="${Math.min(220, 18 + place.length * 9)}" height="26" fill="#fbf7ee"/>
      <g transform="translate(${W - 30} 34)"><path d="M0 -14L6 6L0 2L-6 6Z" fill="#1a1410"/></g>${dots}</g>
      <text x="26" y="34" font-family="Georgia,serif" font-size="15" font-weight="700" fill="#1a1410">${esc(place)}</text>
      <text x="${W - 30}" y="${58}" text-anchor="middle" font-family="Georgia,serif" font-size="11" font-weight="700" fill="#1a1410">N</text></svg>
      <div class="wd-key"><span><i style="background:#e0a14a"></i>waiting</span><span><i style="background:#d9534f"></i>overdue</span><span><i style="background:#5a9e5a"></i>fixed</span></div>
      <p>Outline: ${esc(area.kind === 'ward' ? city.wardsGeojson : city.blocksGeojson)}, the boundary the report map uses. <a href="add-town.html?fix=purulia${area.kind === 'ward' ? '&amp;ward=' + encodeURIComponent(area.id) : ''}">Border wrong?</a></p>`;
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

    document.title = `${place}, on the record — Parishkar Bengal`;
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

    // Four chapters every report goes through; each count is from the public record.
    const seen = mine.filter(r => Number(r.seen_on_site) > 0);
    $('wd-chapters').innerHTML = [
      ['I', 'Spotted', mine.length, 'reported with a live photo and GPS'],
      ['II', 'Seen again', seen.length, 'confirmed by someone standing at the spot'],
      ['III', 'Answered', replied.length, 'answered on the record by an office or leader'],
      ['IV', 'Fixed', fixed.length, 'passed the fix checks']
    ].map(([n, t, c, s]) => `<li><span class="wd-chap-n">${n}</span><div><b>${t}</b><small>${s}</small></div><span class="wd-chap-c">${c} of ${mine.length}</span>
      <span class="wd-chap-bar" aria-hidden="true"><i style="width:${mine.length ? Math.round(c / mine.length * 100) : 0}%"></i></span></li>`).join('');
    $('wd-endpaper').innerHTML = endpaper(place, mine);

    // No reports yet: one line and the report button, not a page of zeros.
    $('wd-empty').hidden = !!mine.length;
    $('wd-tiles').hidden = $('wd-grid').hidden = !mine.length;
    if (!mine.length){
      const say = `No case files in ${esc(place)} yet. Bhulu and I are waiting for the first clue. See a problem there? <a href="kasa.html?report=new">Report it: no login, about 30 seconds.</a>`;
      $('wd-empty').innerHTML = window.MITU ? window.MITU.guide(say) : say;
    }

    const p = new URLSearchParams({ [area.kind]: area.id });
    $('wd-links').innerHTML = [
      [`kasa.html?${area.kind === 'ward' ? 'ward=' + area.id : ''}`, 'See it on the map'],
      [`digest.html?${p}`, 'This week in ' + place],
      area.kind === 'ward' && [`communities.html?ward=${area.id}`, 'Volunteer groups here'],
      area.kind === 'ward' && ['municipality.html', 'Where the money goes'],
      area.kind === 'ward' && [`add-town.html?fix=purulia&ward=${area.id}`, 'Border wrong? Suggest a fix'],
      [`poster.html?${p}`, 'Print a poster for ' + place]
    ].filter(Boolean).map(([h, l]) => `<a href="${esc(h)}">${esc(l)} →</a>`).join('');
    $('wd-border').innerHTML = borderLine();
    sel.value = `${area.kind}:${area.id}`;
    history.replaceState(null, '', '?' + p);
    loadPriorities();
    render.summary = `${place}, Purulia: ${open.length} unresolved (${late.length} overdue), ${fixed.length} of ${mine.length} fixed. See every report, or report one:`;
  }

  // What should be fixed first (idea from Decidim's participatory budgets): up to three problems,
  // one vote per signed-in phone (the report map's anonymous session), counts public.
  const PRIO = ['garbage', 'dumpsite', 'toilet', 'drain', 'road', 'streetlight', 'water', 'missing',
                'encroachment', 'illegal_construction', 'illegal_mining', 'illegal_other'];
  let authed = null;
  const authClient = () => authed || (authed = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY,
    { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } }));
  function captcha(){
    if (!cfg.TURNSTILE_SITE_KEY) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      const go = () => {
        const box = $('wd-prio-captcha'); box.hidden = false; box.innerHTML = '';
        window.turnstile.render(box, { sitekey: cfg.TURNSTILE_SITE_KEY, action: 'kasa', appearance: 'interaction-only',
          callback: tok => { box.hidden = true; resolve(tok); }, 'error-callback': () => { box.hidden = true; reject(new Error('check failed')); } });
      };
      if (window.turnstile) return go();
      const sc = document.createElement('script');
      sc.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      sc.onload = go; sc.onerror = () => reject(new Error('check failed'));
      document.head.appendChild(sc);
    });
  }
  const areaKey = () => `${area.kind}:${area.id}`;
  function drawPriorities(d){
    const max = Math.max(1, ...Object.values(d.counts || {})), mine = new Set(d.mine || []);
    $('wd-prio-list').innerHTML = PRIO.map(k => { const n = (d.counts || {})[k] || 0; return `<label>
      <i style="width:${Math.round(n / max * 100)}%"></i><input type="checkbox" value="${k}"${mine.has(k) ? ' checked' : ''}>
      <span>${esc(cat(k))}</span><small>${n}</small></label>`; }).join('');
    set('wd-prio-msg', d.voters ? `${d.voters} ${d.voters === 1 ? 'person has' : 'people have'} voted` : 'No votes yet');
  }
  async function loadPriorities(){
    const key = areaKey();
    let c = sb;
    try { const a = authClient(); const { data: { session } } = await a.auth.getSession(); if (session) c = a; } catch (e) {}
    const { data, error } = await c.rpc('kasa_ward_priorities', { p_area: key });
    if (key === areaKey()) drawPriorities(error ? { voters: 0, counts: {} } : data);
  }
  $('wd-prio-list').addEventListener('change', e => {
    const boxes = [...$('wd-prio-list').querySelectorAll('input:checked')];
    if (boxes.length > 3){ e.target.checked = false; set('wd-prio-msg', 'Three at most.'); }
  });
  $('wd-prio-form').addEventListener('submit', async e => {
    e.preventDefault();
    const picks = [...$('wd-prio-list').querySelectorAll('input:checked')].map(b => b.value);
    if (!picks.length){ set('wd-prio-msg', 'Pick at least one.'); return; }
    $('wd-prio-save').disabled = true;
    try {
      const a = authClient();
      const { data: { session } } = await a.auth.getSession();
      if (!session){
        const tok = await captcha();
        const { error } = await a.auth.signInAnonymously(tok ? { options: { captchaToken: tok } } : undefined);
        if (error) throw error;
      }
      const { data, error } = await a.rpc('kasa_ward_priority_vote', { p_area: areaKey(), p_picks: picks });
      if (error) throw error;
      drawPriorities(data);
      set('wd-prio-msg', 'Saved. Thank you.');
    } catch (err){ set('wd-prio-msg', 'Could not save: ' + (err.details || err.message || err)); }
    $('wd-prio-save').disabled = false;
  });

  sel.addEventListener('change', () => { const [k, ...v] = sel.value.split(':'); area = { kind: k, id: k === 'ward' ? Number(v[0]) : v.join(':') }; render(); });
  $('wd-share').addEventListener('click', async () => {
    const url = location.href;
    if (navigator.share){ navigator.share({ title: 'Parishkar Bengal', text: render.summary, url }).catch(() => {}); return; }
    try { await navigator.clipboard.writeText(`${render.summary} ${url}`); set('wd-share', 'Copied ✓'); setTimeout(() => set('wd-share', 'Share this page'), 2000); }
    catch (e) { prompt('Copy this link:', url); }
  });

  render();
})();
