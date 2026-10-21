/* Case file: one report traced end to end. The report and its photos, the record of what
   happened, who answers for the spot (bodies, MLA, MP, their promises and replies), any tender
   linked to the spot and its money, and where it stands now. Every panel names its source;
   a panel with nothing on record says so and how to add it. Wording: cf_* in kasa-i18n.js. */
(async function(){
  const cfg = window.KASA_CONFIG || {};
  const CITY = window.KASA_CITY || {};
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  const I = window.KASA_I18N || {};
  let lang = 'en';
  try { lang = localStorage.getItem('kasa_lang') || 'en'; } catch (e) {}
  if (!I[lang]) lang = 'en';
  document.documentElement.lang = lang;
  const t = (k, v) => String((I[lang] && I[lang][k]) || (I.en && I.en[k]) || k).replace(/\{(\w+)\}/g, (m, x) => v && v[x] != null ? v[x] : m);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safe = u => /^https?:\/\//i.test(String(u || '')) ? String(u) : '';
  const locale = lang === 'en' ? 'en-IN' : lang + '-IN';
  const fmt = d => d ? new Date(d).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const rupees = n => n == null ? '' : '₹' + Number(n).toLocaleString('en-IN');
  const $ = id => document.getElementById(id);
  const src = (label, href) => `<p class="cf-src">${esc(t('cf_source'))}: ${href ? `<a href="${esc(href)}"${/^https?:/.test(href) ? ' target="_blank" rel="noopener"' : ''}>${esc(label)}</a>` : esc(label)}</p>`;
  const none = html => `<p class="cf-none">${html}</p>`;
  const guide = html => window.MITU ? window.MITU.guide(html) : none(html);
  const link = (href, label) => `<a href="${esc(href)}">${esc(label)}</a>`;
  const rpc = async (name, args) => { const { data, error } = await sb.rpc(name, args); return error ? null : data; };
  const getJSON = async url => { try { const r = await fetch(url); return r.ok ? await r.json() : null; } catch (e) { return null; } };
  // Report ids are UUIDs (older test data used numbers); a short form reads better on screen.
  const isId = x => /^[0-9a-f-]{1,64}$/i.test(String(x || ''));
  const short = x => String(x).split('-')[0];

  // Static text in case.html carries data-t keys.
  document.querySelectorAll('[data-t]').forEach(el => { el.textContent = t(el.dataset.t); });
  document.querySelectorAll('[data-t-html]').forEach(el => {
    el.innerHTML = esc(t(el.dataset.tHtml)) + ' <a href="methodology.html">' + esc(t('cf_how')) + '</a>';
  });

  /* Reporter mode: follow cases on this device only (nothing is sent anywhere), and see
     on return how long each has been open and what happened since you last looked. */
  const FOLLOW_KEY = 'parishkar_follow';
  const followed = () => { try { return JSON.parse(localStorage.getItem(FOLLOW_KEY) || '{}') || {}; } catch (e) { return {}; } };
  const saveFollowed = f => { try { localStorage.setItem(FOLLOW_KEY, JSON.stringify(f)); } catch (e) {} };

  // Moving to another phone: case.html?follow=a,b,c adds those cases to this device's list.
  const take = new URLSearchParams(location.search).get('follow');
  if (take){
    const f = followed();
    take.split(',').filter(isId).slice(0, 200).forEach(k => { if (!f[k]) f[k] = { at: Date.now(), seen: new Date().toISOString() }; });
    saveFollowed(f);
    history.replaceState(null, '', 'case.html');
  }

  const id = new URLSearchParams(location.search).get('id');
  const main = $('cf-main');
  const COLS = 'id,created_at,lat,lng,ward_no,category,severity,status,description,landmark,photo_url,upvotes,seen_on_site,resolved_at,resolved_photo_url,resolution_method,sla_days,gps_verified,claim_photo_url,reply_count,area_kind,block_name,local_body,waste_type';
  const stateWord = st => t(st === 'resolved' ? 'cf_st_resolved_s' : st === 'claimed' ? 'cf_st_claimed_s' : 'cf_st_open_s');
  if (!id || !isId(id)){
    const f = followed(), ids = Object.keys(f).filter(isId);
    document.title = `${t('cf_follow_title')} — Parishkar`;
    $('cf-no').textContent = t('cf_reporter_mode');
    $('cf-title').textContent = t('cf_follow_title');
    $('cf-counter').hidden = true;
    $('cf-state').hidden = true;
    $('cf-map').textContent = t('cf_find_map');
    if (!ids.length){
      main.innerHTML = guide(esc(t('cf_follow_empty')) + ' ' + link('kasa.html', t('cf_open_map')));
      return;
    }
    $('cf-where').textContent = t('cf_follow_count', { n: ids.length });
    const rows = [];
    for (const view of ['kasa_public_reports', 'kasa_public_place_reports']){
      const { data } = await sb.from(view).select('id,created_at,category,status,resolved_at,sla_days,landmark,ward_no,block_name').in('id', ids);
      (data || []).forEach(x => rows.push(x));
    }
    const { data: evs } = await sb.from('kasa_public_events').select('report_id,created_at').in('report_id', ids);
    const byId = new Map(rows.map(x => [String(x.id), x]));
    const when = k => byId.get(k) ? Date.parse(byId.get(k).created_at) : 0;
    main.innerHTML = `<ul class="cf-follow">${ids.sort((a, b) => when(b) - when(a)).map(k => {
      const x = byId.get(k);
      const stop = `<button type="button" class="cf-unfollow" data-id="${esc(k)}">${esc(t('cf_unfollow'))}</button>`;
      if (!x) return `<li><b>${esc(t('cf_report_no', { n: short(k) }))}</b> <span class="cf-none">${esc(t('cf_gone_short'))}</span> ${stop}</li>`;
      const st = x.status === 'pending_verification' ? 'claimed' : x.status;
      const end = st === 'resolved' && x.resolved_at ? new Date(x.resolved_at) : new Date();
      const d = Math.floor(Math.max(0, end - new Date(x.created_at)) / 86400000);
      const fresh = (evs || []).filter(e => String(e.report_id) === k && new Date(e.created_at) > new Date(f[k].seen || 0)).length;
      const where = [x.landmark, x.ward_no ? t('cf_ward', { n: x.ward_no }) : '', x.block_name].filter(Boolean).join(', ');
      return `<li${d > Number(x.sla_days || 7) && st !== 'resolved' ? ' class="cf-over"' : ''}>
        <a class="cf-follow-days" href="case.html?id=${esc(k)}"><b>${d}</b><small>${esc(t(st === 'resolved' ? 'cf_days_fix' : 'cf_days_open'))}</small></a>
        <div><a href="case.html?id=${esc(k)}"><b>${esc(t('cat_' + x.category))}</b></a> <span class="cf-state cf-state-${esc(st)}">${esc(stateWord(st))}</span>
          <div class="cf-none">${esc(where)}${fresh ? ` · <b>${esc(t('cf_fresh', { n: fresh }))}</b>` : ''}</div></div>
        ${stop}</li>`;
    }).join('')}</ul>`;
    const moveUrl = `${location.origin}${location.pathname}?follow=${ids.join(',')}`;
    main.insertAdjacentHTML('beforeend', `<p class="cf-move">${esc(t('cf_move'))}
      <button type="button" class="cf-follow-btn" id="cf-move">${esc(t('cf_copy'))}</button></p>`);
    $('cf-move').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(moveUrl); $('cf-move').textContent = t('cf_copied'); }
      catch (e) { prompt(t('cf_copy'), moveUrl); }
    });
    main.addEventListener('click', e => {
      const b = e.target.closest('.cf-unfollow'); if (!b) return;
      const g = followed(); delete g[b.dataset.id]; saveFollowed(g); b.closest('li').remove();
    });
    return;
  }

  let row = null;
  // Place reports carry district/state only once the India migration is live.
  for (const [view, extra] of [['kasa_public_reports', ''], ['kasa_public_place_reports', ',place,district,state'], ['kasa_public_place_reports', ',place']]){
    const { data } = await sb.from(view).select(COLS + extra).eq('id', id).limit(1);
    if (data && data.length){ row = data[0]; break; }
  }
  if (!row){
    $('cf-title').textContent = t('cf_gone_title', { n: short(id) });
    main.innerHTML = guide(esc(t('cf_gone')) + ' ' + link('kasa.html', t('cf_open_map')));
    return;
  }

  const r = row;
  const status = r.status === 'pending_verification' ? 'claimed' : r.status;
  const catName = t('cat_' + r.category);
  const where = [r.landmark, r.ward_no ? t('cf_ward', { n: r.ward_no }) : '', r.block_name ? t('cf_block', { b: r.block_name }) : '', r.local_body, r.district].filter(Boolean).join(', ');
  document.title = `${t('cf_case_file')} ${short(r.id)}: ${catName} — Parishkar`;
  $('cf-title').innerHTML = `${esc(catName)}${r.waste_type && t('waste_' + r.waste_type) !== 'waste_' + r.waste_type ? ' · ' + esc(t('waste_' + r.waste_type)) : ''}`;
  $('cf-where').textContent = where || `${Number(r.lat).toFixed(5)}, ${Number(r.lng).toFixed(5)}`;
  $('cf-no').textContent = t('cf_no', { n: short(r.id), d: fmt(r.created_at) });

  /* The counter: days open (ticking), or days it took to fix. */
  const sla = Number(r.sla_days || 7);
  function tick(){
    const end = status === 'resolved' && r.resolved_at ? new Date(r.resolved_at) : new Date();
    const ms = Math.max(0, end - new Date(r.created_at));
    const d = Math.floor(ms / 86400000), h = Math.floor(ms % 86400000 / 3600000);
    $('cf-days').textContent = d;
    $('cf-hours').textContent = status === 'resolved' ? '' : t('cf_hours', { n: h });
    $('cf-days-l').textContent = t(status === 'resolved' ? 'cf_days_fix' : 'cf_days_open');
    const over = d > sla;
    $('cf-sla').textContent = status === 'resolved'
      ? (over ? t('cf_sla_fixed_late', { n: d - sla, s: sla }) : t('cf_sla_fixed_ok', { s: sla }))
      : (over ? t('cf_sla_over', { n: d - sla, s: sla }) : t('cf_sla_left', { n: sla - d, s: sla }));
    $('cf-counter').classList.toggle('cf-over', over && status !== 'resolved');
  }
  tick(); setInterval(tick, 60000);
  const STATE = { open: t('cf_st_open'), claimed: t('cf_st_claimed'), resolved: t('cf_st_resolved') };
  $('cf-state').textContent = STATE[status] || STATE.open;
  $('cf-state').className = 'cf-state cf-state-' + (STATE[status] ? status : 'open');
  $('cf-map').href = `kasa.html?report=${encodeURIComponent(r.id)}`;
  const fb = $('cf-follow');
  const showFollow = () => { const on = !!followed()[r.id]; fb.textContent = t(on ? 'cf_following' : 'cf_follow'); fb.setAttribute('aria-pressed', String(on)); };
  fb.hidden = false; showFollow();
  fb.addEventListener('click', () => { const g = followed(); if (g[r.id]) delete g[r.id]; else g[r.id] = { at: Date.now(), seen: new Date().toISOString() }; saveFollowed(g); showFollow(); });
  // Opening a followed case marks its events as seen.
  if (followed()[r.id]){ const g = followed(); g[r.id].seen = new Date().toISOString(); saveFollowed(g); }

  /* A portable research record of the same reviewed facts shown below. The
     server composes it, so a browser export cannot include raw report,
     moderator, or reporter fields. */
  const xb = $('cf-export');
  xb.hidden = false;
  xb.addEventListener('click', async () => {
    xb.disabled = true; xb.textContent = t('cf_export_working');
    try {
      const dossier = await rpc('kasa_case_dossier', { p_report_id: String(r.id) });
      if (!dossier) throw new Error('not found');
      const blob = new Blob([JSON.stringify(dossier, null, 2) + '\n'], { type: 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob); link.download = `parishkar-case-${r.id}-record.json`; link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 4000);
      xb.textContent = t('cf_export_done');
    } catch (e) { xb.textContent = t('cf_export_failed'); }
    finally { xb.disabled = false; setTimeout(() => { xb.textContent = t('cf_export'); }, 2500); }
  });

  /* The cover: one picture of this case like an album front, made on the phone from what is
     on this page (the live photo, the place, days open). Nothing is uploaded. */
  const cb = $('cf-cover');
  cb.hidden = false;
  cb.addEventListener('click', async () => {
    cb.disabled = true; cb.textContent = 'Drawing…';
    const W = 1080, H = 1350, ink = '#1a1410', paper = '#f3ead6';
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    const load = (src, cors) => new Promise(res => { const i = new Image(); if (cors) i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
    const fit = (txt, font, max) => { x.font = font; let t = String(txt); while (t.length > 1 && x.measureText(t).width > max) t = t.slice(0, -2); return t === String(txt) ? t : t + '…'; };
    const end = status === 'resolved' && r.resolved_at ? new Date(r.resolved_at) : new Date();
    const d = Math.floor(Math.max(0, end - new Date(r.created_at)) / 86400000);
    const draw = photo => {
      x.fillStyle = paper; x.fillRect(0, 0, W, H);
      x.strokeStyle = ink; x.lineWidth = 6; x.strokeRect(30, 30, W - 60, H - 60);
      x.fillStyle = ink; x.textBaseline = 'alphabetic';
      x.font = '500 28px "JetBrains Mono", monospace'; x.fillText(`PARISHKAR · CASE FILE #${r.id}`, 70, 100);
      x.fillText(fit(where || '', '500 28px "JetBrains Mono", monospace', 940), 70, 330);
      x.fillText(fit(catName, '700 92px "Plus Jakarta Sans", Georgia, serif', 940), 70, 210);
      x.font = 'italic 400 40px "Plus Jakarta Sans", Georgia, serif'; x.fillText(`filed ${fmt(r.created_at)}`, 70, 270);
      const px = 70, py = 370, pw = W - 140, ph = 680;
      x.fillStyle = '#fbf7ee'; x.fillRect(px, py, pw, ph);
      if (photo){
        const s = Math.max(pw / photo.width, ph / photo.height), sw = pw / s, sh = ph / s;
        x.drawImage(photo, (photo.width - sw) / 2, (photo.height - sh) / 2, sw, sh, px, py, pw, ph);
      }
      x.lineWidth = 6; x.strokeRect(px, py, pw, ph);
      x.fillStyle = ink; x.font = '700 120px "Plus Jakarta Sans", Georgia, serif'; x.fillText(String(d), 70, 1210);
      const nw = x.measureText(String(d)).width;
      x.font = '500 30px "JetBrains Mono", monospace';
      x.fillText(`${d === 1 ? 'DAY' : 'DAYS'} ${status === 'resolved' ? 'TO FIX' : 'OPEN'}`, 90 + nw, 1160);
      x.fillText(status === 'resolved' ? 'FIXED, CONFIRMED ON THE SPOT' : status === 'claimed' ? 'CLEANUP CLAIMED' : `FIX TARGET ${sla} DAYS`, 90 + nw, 1205);
      x.font = '500 24px "JetBrains Mono", monospace'; x.textAlign = 'right';
      x.fillText(location.host + location.pathname.replace(/[^/]*$/, '') + 'case.html?id=' + r.id, W - 70, 1270);
      x.textAlign = 'left';
    };
    const mitu = await load('data:image/svg+xml;charset=utf-8,' + encodeURIComponent((window.MITU && window.MITU.svg || '').replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="140" height="120" ')));
    let blob = null;
    for (const src of [safe(r.photo_url), '']){
      const img = src ? await load(src, true) : null;
      draw(img);
      if (!img && mitu) x.drawImage(mitu, (W - 420) / 2, 370 + (680 - 360) / 2, 420, 360);
      try { blob = await new Promise(res => c.toBlob(res, 'image/png')); } catch (e) { blob = null; }
      if (blob) break; // a photo the browser may not copy taints the canvas: draw again without it
    }
    cb.disabled = false; cb.textContent = 'Save the cover';
    if (!blob) return;
    const file = new File([blob], `parishkar-case-${r.id}.png`, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })){ navigator.share({ files: [file], title: `Case file #${r.id}` }).catch(() => {}); return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  });

  const panel = (n, key, title, body) => `
    <section class="cf-panel" id="${key}">
      <div class="cf-panel-n">${n}</div>
      <div class="cf-panel-body"><h2>${esc(title)}</h2>${body}</div>
    </section>`;
  const panels = {};
  const draw = () => {
    main.innerHTML = ['report', 'record', 'who', 'tender', 'money', 'now'].map((k, i) => panels[k] ? panel(i + 1, 'cf-' + k, panels[k][0], panels[k][1]) : '').join('');
    const s = document.querySelector('.cf-slider');
    if (s) s.querySelector('input').addEventListener('input', e => s.style.setProperty('--cut', e.target.value + '%'));
  };
  const loading = `<p class="cf-none">${esc(t('cf_loading'))}</p>`;
  const reportHref = `kasa.html?report=${encodeURIComponent(r.id)}`;

  /* 1. The report */
  const reportBody = () => `
    ${safe(r.photo_url) ? `<a href="${esc(safe(r.photo_url))}" target="_blank" rel="noopener"><img class="cf-photo" src="${esc(safe(r.photo_url))}" alt="${esc(t('cf_photo_alt'))}"></a>` : ''}
    ${r.description ? `<p class="cf-quote">“${esc(r.description)}”</p>` : ''}
    <dl class="cf-facts">
      <div><dt>${esc(t('cf_filed'))}</dt><dd>${esc(fmt(r.created_at))}</dd></div>
      <div><dt>${esc(t('cf_serious'))}</dt><dd>${esc(t('sev_' + r.severity))}</dd></div>
      <div><dt>${esc(t('cf_located'))}</dt><dd>${esc(t(r.gps_verified ? 'cf_loc_gps' : 'cf_loc_pin'))}</dd></div>
      <div><dt>${esc(t('cf_saw'))}</dt><dd>${Number(r.upvotes || 0)}${r.seen_on_site ? ` ${esc(t('cf_on_spot', { n: Number(r.seen_on_site) }))}` : ''}</dd></div>
    </dl>
    ${src(t('cf_src_report', { n: short(r.id) }), reportHref)}`;
  panels.report = [t('cf_p_report'), reportBody()];
  panels.record = [t('cf_p_record'), loading];
  panels.who = [t('cf_p_who'), loading];
  panels.tender = [t('cf_p_tender'), loading];
  panels.money = [t('cf_p_money'), loading];
  panels.now = [t('cf_p_now'), loading];
  draw();

  const [photos, events, juris, asset, warranty, dockets, replies, leaders, assembly, mplads, promisesRes] = await Promise.all([
    rpc('kasa_report_photos', { p_report_id: String(r.id) }),
    sb.from('kasa_public_events').select('id,kind,photo_url,distance_m,detail,created_at').eq('report_id', r.id).order('created_at').order('id').then(x => x.data || [], () => []),
    rpc('kasa_jurisdictions_at', { p_lat: Number(r.lat), p_lng: Number(r.lng) }),
    rpc('kasa_report_asset', { p_report_id: String(r.id) }),
    rpc('kasa_report_warranty', { p_report_id: String(r.id) }),
    rpc('kasa_report_dockets', { p_report_id: String(r.id) }),
    r.reply_count ? sb.from('kasa_public_replies').select('responder_name,responder_role,body,verified_note,created_at').eq('report_id', r.id).order('created_at').then(x => x.data || [], () => []) : [],
    getJSON('places/wb_leaders.json'),
    getJSON('places/wb_assembly.geojson'),
    getJSON('places/wb_mplads.json'),
    rpc('kasa_promises')
  ]);

  /* 1b. Extra photos and then/now */
  const extra = (photos || []).map(p => safe(p.photo_url)).filter(Boolean);
  const after = safe(r.resolved_photo_url) || safe(r.claim_photo_url);
  if (extra.length || after){
    const thenNow = after && safe(r.photo_url) ? `
      <div class="cf-slider" style="--cut:50%">
        <img src="${esc(safe(r.photo_url))}" alt="${esc(t('cf_when_reported'))}">
        <img class="cf-after" src="${esc(after)}" alt="${esc(t(status === 'resolved' ? 'cf_after_fix' : 'cf_cleanup_photo'))}">
        <input type="range" min="0" max="100" value="50" aria-label="${esc(t('cf_slide'))}">
        <span class="cf-tag cf-tag-l">${esc(fmt(r.created_at))}</span><span class="cf-tag cf-tag-r">${status === 'resolved' ? esc(fmt(r.resolved_at)) : esc(t('cf_cleanup_photo'))}</span>
      </div>` : '';
    panels.report[1] = reportBody().replace('<dl', `${thenNow}${extra.length ? `<div class="cf-thumbs">${extra.map(u => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="${esc(t('cf_more_photos'))}" loading="lazy"></a>`).join('')}</div>` : ''}<dl`);
  }

  /* 2. The record of events */
  panels.record[1] = events.length ? `
    <ol class="cf-tl">${events.map(e => {
      const p = safe(e.photo_url);
      const label = e.kind === 'resolved' && e.detail?.by === 'photo_check' ? t('ev_resolved_photo') : e.kind === 'resolved' && e.detail?.by === 'moderator' ? t('ev_resolved_mod') : t('ev_' + e.kind);
      return `<li><time>${esc(fmt(e.created_at))}</time><span>${esc(label === 'ev_' + e.kind ? e.kind.replace(/_/g, ' ') : label)}${e.distance_m != null ? ` · ${esc(t('cf_m_from', { n: Number(e.distance_m) }))}` : ''}</span>${p && e.kind !== 'reported' ? `<a href="${esc(p)}" target="_blank" rel="noopener">${esc(t('cf_photo'))}</a>` : ''}</li>`;
    }).join('')}</ol>
    ${src(t('cf_src_events'), reportHref)}`
    : none(esc(t('cf_no_events')));

  /* 3. Who answers: bodies on record for the point (listed ones, then those from the map's own
     outlines), the MLA and MP whose seats cover it, what they promised on record, and what they
     said, each with its link. */
  const pt = [Number(r.lng), Number(r.lat)];
  const inRing = (p, ring) => { let x = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++){ const [xi, yi] = ring[i], [xj, yj] = ring[j]; if (((yi > p[1]) !== (yj > p[1])) && (p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi)) x = !x; } return x; };
  const inGeom = (p, g) => (g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates]).some(poly => inRing(p, poly[0]) && !poly.slice(1).some(h => inRing(p, h)));
  const seat = assembly && (assembly.features || []).find(f => f.geometry && inGeom(pt, f.geometry));
  const ac = seat?.properties.ac, pc = seat?.properties.pc;
  const mla = ac && leaders?.ac?.[ac], mp = pc && leaders?.pc?.[pc];
  const acKey = n => (CITY.constituencies || []).some(c => c.no === +n) ? 'mla:' + n : 'ac:' + n;
  const pcKey = n => { const nm = leaders?.pc?.[n]?.name, ls = Object.keys(CITY.lokSabha || {}).find(s => s.toLowerCase() === String(nm).toLowerCase()); return ls ? 'mp:' + ls : 'pc:' + n; };
  const people = [mla && { key: acKey(ac), role: t('cf_mla', { s: mla.name, n: ac }), ...mla, source: leaders.sources.mla },
                  mp && !mp.vacant && { key: pcKey(pc), role: t('cf_mp', { s: mp.name }), ...mp, source: leaders.sources.mp }].filter(Boolean);
  const said = await Promise.all(people.map(p => rpc('kasa_rep_replies', { p_rep_key: p.key })));
  const promises = (promisesRes?.promises || []).filter(p => people.some(x => String(p.who).trim().toLowerCase() === String(x.person).trim().toLowerCase()));
  const bodies = Array.isArray(juris) ? juris : [];
  panels.who[1] = `
    ${bodies.length ? `<h3>${esc(t('cf_bodies'))}</h3><ul class="cf-list">${bodies.map(b => `<li><b>${esc(b.body)}</b>${b.department ? ` · ${esc(b.department)}` : ''}${safe(b.source_url) ? ` <a href="${esc(safe(b.source_url))}" target="_blank" rel="noopener">${esc(t('cf_src_link'))}</a>` : ''}${b.note ? `<br><small>${esc(b.note)}</small>` : ''}</li>`).join('')}</ul>` : ''}
    ${people.length ? `<h3>${esc(t('cf_elected'))}</h3><ul class="cf-list">${people.map((p, i) => `<li><b>${esc(p.person)}</b> · ${esc(p.party)} · ${esc(p.role)} <a href="kasa.html?rep=${encodeURIComponent(p.key)}">${esc(t('cf_profile'))}</a> <a href="${esc(safe(p.source))}" target="_blank" rel="noopener">${esc(t('cf_src_link'))}</a>
      ${(said[i] || []).slice(0, 2).map(x => `<blockquote>“${esc(x.reply)}” <small>${esc(fmt(x.said_on))}, <a href="${esc(safe(x.source_url))}" target="_blank" rel="noopener">${esc(t('cf_where_said'))}</a></small></blockquote>`).join('')}</li>`).join('')}</ul>` : ''}
    ${promises.length ? `<h3>${esc(t('cf_promises'))}</h3><ul class="cf-list">${promises.slice(0, 6).map(p => `<li>“${esc(p.promise)}” <small>${esc(p.who)}, ${esc(fmt(p.made_on))} · ${esc(String(p.status || '').replace('_', ' '))} · <a href="${esc(safe(p.source_url))}" target="_blank" rel="noopener">${esc(t('cf_src_link'))}</a></small></li>`).join('')}</ul>
      <p class="cf-src">${esc(t('cf_promises_note'))} ${link('promises.html', t('cf_all_promises'))}</p>` : ''}
    ${!bodies.length && !people.length ? none(esc(t('cf_no_bodies')) + ' ' + link(reportHref, t('cf_open_report'))) : ''}
    ${people.length ? src(t('cf_src_seats'), 'methodology.html#leaders') : ''}`;

  /* 4. Tender and 5. money: a work linked to the mapped asset under the report (confirmed by a
     moderator, or the nearest one within the report's GPS accuracy, labelled as such), and any
     works board photographed within range. */
  const works = asset?.asset?.id ? await rpc('kasa_asset_works', { p_asset_id: asset.asset.id }) : null;
  const ws = works?.works || [];
  const a = asset?.asset;
  const tenderParts = [];
  if (a) tenderParts.push(`<p>${esc(asset.match === 'confirmed' ? t('cf_asset_is') : t('cf_asset_near', { n: Number(asset.distance_m) }))}: <b>${esc(a.name || a.kind)}</b>${a.owner ? `, ${esc(t('cf_owned_by', { b: a.owner.body }))}` : ''}. ${safe(a.source_url) ? `<a href="${esc(safe(a.source_url))}" target="_blank" rel="noopener">${esc(a.source || t('cf_src_link'))}</a>` : ''}</p>`);
  ws.forEach(w => tenderParts.push(`
    <article class="cf-work">
      <b>${esc(w.title)}</b>
      <dl class="cf-facts">
        ${w.tender_ref ? `<div><dt>${esc(t('cf_tender'))}</dt><dd>${esc(w.tender_ref)}${w.portal ? ' · ' + esc(w.portal) : ''}</dd></div>` : ''}
        ${w.work_order_ref ? `<div><dt>${esc(t('cf_work_order'))}</dt><dd>${esc(w.work_order_ref)}</dd></div>` : ''}
        ${w.issued_by || w.department ? `<div><dt>${esc(t('cf_issued_by'))}</dt><dd>${esc(w.issued_by || w.department)}</dd></div>` : ''}
        ${w.contractor ? `<div><dt>${esc(t('cf_contractor'))}</dt><dd>${esc(w.contractor.firm_name)}${w.contractor.gstin ? ' · GSTIN ' + esc(w.contractor.gstin) : ''}</dd></div>` : ''}
        <div><dt>${esc(t('cf_status'))}</dt><dd>${esc(w.status)}${w.completed_on ? ', ' + esc(t('cf_completed', { d: fmt(w.completed_on) })) : ''}</dd></div>
        ${w.dlp_ends_on ? `<div><dt>${esc(t('cf_dlp'))}</dt><dd>${esc(t(w.is_under_dlp ? 'cf_dlp_until' : 'cf_dlp_ended', { d: fmt(w.dlp_ends_on) }))}${safe(w.dlp_source_url) ? ` <a href="${esc(safe(w.dlp_source_url))}" target="_blank" rel="noopener">${esc(t('cf_clause'))}</a>` : ''}</dd></div>` : ''}
      </dl>
      ${safe(w.source_url) ? src(t('cf_tender_record'), safe(w.source_url)) : ''}
    </article>`));
  if (warranty) tenderParts.push(`<p>${esc(t('cf_board', { n: Number(warranty.distance_m), w: warranty.work_name, a: warranty.agency, d: fmt(warranty.warranty_until) }))}${warranty.contractor ? ' ' + esc(t('cf_board_contractor', { c: warranty.contractor })) : ''} <a href="works.html#work-${esc(warranty.id)}">${esc(t('cf_board_photo'))}</a></p>`);
  panels.tender[1] = tenderParts.length ? tenderParts.join('') + (ws.length ? `<p class="cf-src">${esc(t('cf_tender_note'))}</p>` : '')
    : none(esc(t('cf_no_tender')) + ' ' + link('kasa.html?work=1', t('cf_record_board')));

  const moneyParts = ws.filter(w => w.sanctioned_amount != null || w.awarded_amount != null).map(w => `
    <p><b>${esc(w.title)}</b>: ${w.sanctioned_amount != null ? esc(t('cf_sanctioned', { r: rupees(w.sanctioned_amount) })) : ''}${w.sanctioned_amount != null && w.awarded_amount != null ? ', ' : ''}${w.awarded_amount != null ? esc(t('cf_awarded', { r: rupees(w.awarded_amount) })) + (w.awarded_on ? ' ' + esc(fmt(w.awarded_on)) : '') : ''}. ${safe(w.source_url) ? `<a href="${esc(safe(w.source_url))}" target="_blank" rel="noopener">${esc(t('cf_tender_record'))}</a>` : ''}</p>`);
  const m = pc && mplads?.pc?.[pc];
  if (m && mp) moneyParts.push(`<p>${esc(t('cf_mplads', { p: mp.person, a: rupees(m.allocated), s: rupees(m.spent), c: Number(m.worksCompleted), r: Number(m.worksRecommended) }))} <a href="${esc(safe(m.url))}" target="_blank" rel="noopener">Empowered Indian (MoSPI)</a> · ${link('money.html', t('cf_budget'))}</p>`);
  panels.money[1] = moneyParts.length ? moneyParts.join('') : none(esc(t('cf_no_money')) + ' ' + link('money.html', t('cf_budget')));

  /* 6. Where it stands */
  const nowParts = [];
  nowParts.push(`<p class="cf-big">${esc(STATE[status] || STATE.open)}${status === 'resolved' && r.resolved_at ? `, ${esc(fmt(r.resolved_at))}` : ''}.</p>`);
  (replies || []).forEach(x => nowParts.push(`<blockquote>“${esc(x.body)}” <small>${esc(x.responder_name)}, ${esc(x.responder_role)}, ${esc(fmt(x.created_at))}${x.verified_note ? ' · ✓ ' + esc(x.verified_note) : ''}</small></blockquote>`));
  const today = new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }));
  const days = d => Math.round((new Date(d) - today) / 86400000);
  if ((dockets || []).length) nowParts.push(`<h3>${esc(t('dk_title'))}</h3><ul class="cf-list">${dockets.map(d => {
    let clock = '';
    if (d.filed_on){
      const left = days(d.reply_due), appealLeft = days(d.appeal_by);
      clock = d.status === 'waiting' || d.status === 'no_reply'
        ? (left >= 0 ? t('rti_due', { d: fmt(d.reply_due), n: left }) : appealLeft >= 0 ? t('rti_late', { n: -left, d: fmt(d.appeal_by) }) : t('rti_late_appeal', { n: -left }))
        : t('rti_st_' + d.status) + (d.status_at ? ' · ' + fmt(d.status_at) : '');
    }
    return `<li>${esc(t('dk_' + d.portal))}: <code>${esc(d.number)}</code> <small>${esc(d.filed_on ? t('rti_filed', { d: fmt(d.filed_on) }) : t('dk_added', { d: fmt(d.added) }))}</small>${clock ? `<br><small>${esc(clock)}</small>` : ''}</li>`;
  }).join('')}</ul>${dockets.some(d => d.filed_on) ? src(t('cf_src_rti'), 'methodology.html#rti') : ''}`);
  else nowParts.push(`<p>${esc(t('cf_no_docket'))} ${link(reportHref, t('cf_add_on_report'))}</p>`);
  nowParts.push(src(t('cf_src_status'), 'methodology.html'));
  panels.now[1] = nowParts.join('');
  draw();
})();
