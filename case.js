/* Case file: one report traced end to end. The report and its photos, the record of what
   happened, who answers for the spot (bodies, MLA, MP, their promises and replies), any tender
   linked to the spot and its money, and where it stands now. Every panel names its source;
   a panel with nothing on record says so and how to add it. */
(async function(){
  const cfg = window.KASA_CONFIG || {};
  const CITY = window.KASA_CITY || {};
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  const I = window.KASA_I18N || {};
  let lang = 'en';
  try { lang = localStorage.getItem('kasa_lang') || 'en'; } catch (e) {}
  const t = k => (I[lang] && I[lang][k]) || (I.en && I.en[k]) || k;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safe = u => /^https?:\/\//i.test(String(u || '')) ? String(u) : '';
  const fmt = d => d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const rupees = n => n == null ? '' : '₹' + Number(n).toLocaleString('en-IN');
  const $ = id => document.getElementById(id);
  const src = (label, href) => `<p class="cf-src">Source: ${href ? `<a href="${esc(href)}"${/^https?:/.test(href) ? ' target="_blank" rel="noopener"' : ''}>${esc(label)}</a>` : esc(label)}</p>`;
  const none = html => `<p class="cf-none">${html}</p>`;
  const rpc = async (name, args) => { const { data, error } = await sb.rpc(name, args); return error ? null : data; };
  const getJSON = async url => { try { const r = await fetch(url); return r.ok ? await r.json() : null; } catch (e) { return null; } };

  /* Reporter mode: follow cases on this device only (nothing is sent anywhere), and see
     on return how long each has been open and what happened since you last looked. */
  const FOLLOW_KEY = 'parishkar_follow';
  const followed = () => { try { return JSON.parse(localStorage.getItem(FOLLOW_KEY) || '{}') || {}; } catch (e) { return {}; } };
  const saveFollowed = f => { try { localStorage.setItem(FOLLOW_KEY, JSON.stringify(f)); } catch (e) {} };

  // Moving to another phone: case.html?follow=1,2,3 adds those cases to this device's list.
  const take = new URLSearchParams(location.search).get('follow');
  if (take){
    const f = followed();
    take.split(',').filter(x => /^\d{1,12}$/.test(x)).slice(0, 200).forEach(k => { if (!f[k]) f[k] = { at: Date.now(), seen: new Date().toISOString() }; });
    saveFollowed(f);
    history.replaceState(null, '', 'case.html');
  }

  const id = new URLSearchParams(location.search).get('id');
  const main = $('cf-main');
  const COLS = 'id,created_at,lat,lng,ward_no,category,severity,status,description,landmark,photo_url,upvotes,seen_on_site,resolved_at,resolved_photo_url,resolution_method,sla_days,gps_verified,claim_photo_url,reply_count,area_kind,block_name,local_body,waste_type';
  if (!id || !/^\d+$/.test(id)){
    const f = followed(), ids = Object.keys(f).filter(x => /^\d+$/.test(x));
    document.title = 'Cases you follow — Parishkar';
    $('cf-no').textContent = 'Reporter mode';
    $('cf-title').textContent = 'Cases you follow';
    $('cf-counter').hidden = true;
    $('cf-state').hidden = true;
    $('cf-map').textContent = 'Find a report on the map →';
    if (!ids.length){
      main.innerHTML = none('Follow a complaint from start to finish. Open any report on the <a href="kasa.html">map</a>, tap "Case file", then "Follow this case". It stays on this device only.');
      return;
    }
    $('cf-where').textContent = `${ids.length} on this device. New events since you last opened each one are counted.`;
    const rows = [];
    for (const view of ['kasa_public_reports', 'kasa_public_place_reports']){
      const { data } = await sb.from(view).select('id,created_at,category,status,resolved_at,sla_days,landmark,ward_no,block_name').in('id', ids);
      (data || []).forEach(x => rows.push(x));
    }
    const { data: evs } = await sb.from('kasa_public_events').select('report_id,created_at').in('report_id', ids);
    const byId = new Map(rows.map(x => [String(x.id), x]));
    main.innerHTML = `<ul class="cf-follow">${ids.sort((a, b) => b - a).map(k => {
      const x = byId.get(k);
      if (!x) return `<li><b>Report #${esc(k)}</b> <span class="cf-none">no longer on the public record</span> <button type="button" class="cf-unfollow" data-id="${esc(k)}">Stop following</button></li>`;
      const st = x.status === 'pending_verification' ? 'claimed' : x.status;
      const end = st === 'resolved' && x.resolved_at ? new Date(x.resolved_at) : new Date();
      const d = Math.floor(Math.max(0, end - new Date(x.created_at)) / 86400000);
      const fresh = (evs || []).filter(e => String(e.report_id) === k && new Date(e.created_at) > new Date(f[k].seen || 0)).length;
      const where = [x.landmark, x.ward_no ? `Ward ${x.ward_no}` : '', x.block_name].filter(Boolean).join(', ');
      return `<li${d > Number(x.sla_days || 7) && st !== 'resolved' ? ' class="cf-over"' : ''}>
        <a class="cf-follow-days" href="case.html?id=${esc(k)}"><b>${d}</b><small>${st === 'resolved' ? 'days to fix' : 'days open'}</small></a>
        <div><a href="case.html?id=${esc(k)}"><b>${esc(t('cat_' + x.category))}</b></a> <span class="cf-state cf-state-${esc(st)}">${esc(st === 'claimed' ? 'cleanup claimed' : st)}</span>
          <div class="cf-none">${esc(where)}${fresh ? ` · <b>${fresh} new since you last looked</b>` : ''}</div></div>
        <button type="button" class="cf-unfollow" data-id="${esc(k)}">Stop following</button></li>`;
    }).join('')}</ul>`;
    const moveUrl = `${location.origin}${location.pathname}?follow=${ids.join(',')}`;
    main.insertAdjacentHTML('beforeend', `<p class="cf-move">On another phone? Open this link there to follow the same cases:
      <button type="button" class="cf-follow-btn" id="cf-move">Copy link</button></p>`);
    $('cf-move').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(moveUrl); $('cf-move').textContent = 'Copied'; }
      catch (e) { prompt('Copy this link:', moveUrl); }
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
    $('cf-title').textContent = `Report #${id} is not on the public record`;
    main.innerHTML = none('It may have been removed by a moderator, merged into another report, or the link is wrong. See the <a href="kasa.html">map</a>.');
    return;
  }

  const r = row;
  const status = r.status === 'pending_verification' ? 'claimed' : r.status;
  const catName = t('cat_' + r.category);
  const where = [r.landmark, r.ward_no ? `Ward ${r.ward_no}` : '', r.block_name ? `${r.block_name} block` : '', r.local_body, r.district].filter(Boolean).join(', ');
  document.title = `Case file #${r.id}: ${catName} — Parishkar`;
  $('cf-title').innerHTML = `${esc(catName)}${r.waste_type && t('waste_' + r.waste_type) !== 'waste_' + r.waste_type ? ' · ' + esc(t('waste_' + r.waste_type)) : ''}`;
  $('cf-where').textContent = where || `${Number(r.lat).toFixed(5)}, ${Number(r.lng).toFixed(5)}`;
  $('cf-no').textContent = `Case file · report #${r.id} · filed ${fmt(r.created_at)}`;

  /* The counter: days open (ticking), or days it took to fix. */
  const sla = Number(r.sla_days || 7);
  function tick(){
    const end = status === 'resolved' && r.resolved_at ? new Date(r.resolved_at) : new Date();
    const ms = Math.max(0, end - new Date(r.created_at));
    const d = Math.floor(ms / 86400000), h = Math.floor(ms % 86400000 / 3600000);
    $('cf-days').textContent = d;
    $('cf-hours').textContent = status === 'resolved' ? '' : `${h} h`;
    $('cf-days-l').textContent = status === 'resolved' ? 'days to fix' : 'days open';
    const over = d > sla;
    $('cf-sla').textContent = status === 'resolved'
      ? (over ? `Fixed ${d - sla} days after its ${sla}-day target` : `Fixed within its ${sla}-day target`)
      : (over ? `${d - sla} days past its ${sla}-day target` : `${sla - d} days left of its ${sla}-day target`);
    $('cf-counter').classList.toggle('cf-over', over && status !== 'resolved');
  }
  tick(); setInterval(tick, 60000);
  const STATE = { open: 'Open', claimed: 'Cleanup claimed, waiting for neighbours to confirm', resolved: 'Fixed, confirmed on the spot' };
  $('cf-state').textContent = STATE[status] || 'Open';
  $('cf-state').className = 'cf-state cf-state-' + (STATE[status] ? status : 'open');
  $('cf-map').href = `kasa.html?report=${encodeURIComponent(r.id)}`;
  const fb = $('cf-follow');
  const showFollow = () => { const on = !!followed()[r.id]; fb.textContent = on ? 'Following ✓' : 'Follow this case'; fb.setAttribute('aria-pressed', String(on)); };
  fb.hidden = false; showFollow();
  fb.addEventListener('click', () => { const g = followed(); if (g[r.id]) delete g[r.id]; else g[r.id] = { at: Date.now(), seen: new Date().toISOString() }; saveFollowed(g); showFollow(); });
  // Opening a followed case marks its events as seen.
  if (followed()[r.id]){ const g = followed(); g[r.id].seen = new Date().toISOString(); saveFollowed(g); }

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
  const loading = '<p class="cf-none">Loading…</p>';

  /* 1. The report */
  const reportBody = () => `
    ${safe(r.photo_url) ? `<a href="${esc(safe(r.photo_url))}" target="_blank" rel="noopener"><img class="cf-photo" src="${esc(safe(r.photo_url))}" alt="Photo of the problem, taken on the spot"></a>` : ''}
    ${r.description ? `<p class="cf-quote">“${esc(r.description)}”</p>` : ''}
    <dl class="cf-facts">
      <div><dt>Filed</dt><dd>${esc(fmt(r.created_at))}</dd></div>
      <div><dt>How serious</dt><dd>${esc(t('sev_' + r.severity))}</dd></div>
      <div><dt>Located</dt><dd>${r.gps_verified ? 'By the phone\'s GPS at the spot' : 'Pinned on the map'}</dd></div>
      <div><dt>People who saw it</dt><dd>${Number(r.upvotes || 0)}${r.seen_on_site ? ` (${Number(r.seen_on_site)} on the spot)` : ''}</dd></div>
    </dl>
    ${src(`Report #${r.id}, live camera photo and GPS, on the Parishkar map`, `kasa.html?report=${encodeURIComponent(r.id)}`)}`;
  panels.report = ['The report', reportBody()];
  panels.record = ['What happened since', loading];
  panels.who = ['Who answers for this spot', loading];
  panels.tender = ['Any work or tender on this spot', loading];
  panels.money = ['The money', loading];
  panels.now = ['Where it stands', loading];
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
        <img src="${esc(safe(r.photo_url))}" alt="When reported">
        <img class="cf-after" src="${esc(after)}" alt="${status === 'resolved' ? 'After the fix' : 'Cleanup photo'}">
        <input type="range" min="0" max="100" value="50" aria-label="Slide between the photo when reported and the later photo">
        <span class="cf-tag cf-tag-l">${esc(fmt(r.created_at))}</span><span class="cf-tag cf-tag-r">${status === 'resolved' ? esc(fmt(r.resolved_at)) : 'Cleanup photo'}</span>
      </div>` : '';
    panels.report[1] = reportBody().replace('<dl', `${thenNow}${extra.length ? `<div class="cf-thumbs">${extra.map(u => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="More photos from the spot" loading="lazy"></a>`).join('')}</div>` : ''}<dl`);
  }

  /* 2. The record of events */
  panels.record[1] = events.length ? `
    <ol class="cf-tl">${events.map(e => {
      const p = safe(e.photo_url);
      const label = e.kind === 'resolved' && e.detail?.by === 'photo_check' ? t('ev_resolved_photo') : e.kind === 'resolved' && e.detail?.by === 'moderator' ? t('ev_resolved_mod') : t('ev_' + e.kind);
      return `<li><time>${esc(fmt(e.created_at))}</time><span>${esc(label === 'ev_' + e.kind ? e.kind.replace(/_/g, ' ') : label)}${e.distance_m != null ? ` · ${Number(e.distance_m)} m from the spot` : ''}</span>${p && e.kind !== 'reported' ? `<a href="${esc(p)}" target="_blank" rel="noopener">photo</a>` : ''}</li>`;
    }).join('')}</ol>
    ${src('Public event log of this report (every claim, confirmation, flag and moderator action is written there by the server)', `kasa.html?report=${encodeURIComponent(r.id)}`)}`
    : none('Nothing has happened on this report since it was filed.');

  /* 3. Who answers: bodies on record for the point, the MLA and MP whose seats cover it,
     what they promised on record, and what they said, each with its link. */
  const pt = [Number(r.lng), Number(r.lat)];
  const inRing = (p, ring) => { let x = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++){ const [xi, yi] = ring[i], [xj, yj] = ring[j]; if (((yi > p[1]) !== (yj > p[1])) && (p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi)) x = !x; } return x; };
  const inGeom = (p, g) => (g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates]).some(poly => inRing(p, poly[0]) && !poly.slice(1).some(h => inRing(p, h)));
  const seat = assembly && (assembly.features || []).find(f => f.geometry && inGeom(pt, f.geometry));
  const ac = seat?.properties.ac, pc = seat?.properties.pc;
  const mla = ac && leaders?.ac?.[ac], mp = pc && leaders?.pc?.[pc];
  const acKey = n => (CITY.constituencies || []).some(c => c.no === +n) ? 'mla:' + n : 'ac:' + n;
  const pcKey = n => { const nm = leaders?.pc?.[n]?.name, ls = Object.keys(CITY.lokSabha || {}).find(s => s.toLowerCase() === String(nm).toLowerCase()); return ls ? 'mp:' + ls : 'pc:' + n; };
  const people = [mla && { key: acKey(ac), role: `MLA, ${mla.name} (seat ${ac})`, ...mla, source: leaders.sources.mla },
                  mp && !mp.vacant && { key: pcKey(pc), role: `MP, ${mp.name} (Lok Sabha)`, ...mp, source: leaders.sources.mp }].filter(Boolean);
  const said = await Promise.all(people.map(p => rpc('kasa_rep_replies', { p_rep_key: p.key })));
  const promises = (promisesRes?.promises || []).filter(p => people.some(x => String(p.who).trim().toLowerCase() === String(x.person).trim().toLowerCase()));
  const bodies = Array.isArray(juris) ? juris : [];
  panels.who[1] = `
    ${bodies.length ? `<h3>Bodies responsible here</h3><ul class="cf-list">${bodies.map(b => `<li><b>${esc(b.body)}</b>${b.department ? ` · ${esc(b.department)}` : ''}${safe(b.source_url) ? ` <a href="${esc(safe(b.source_url))}" target="_blank" rel="noopener">source</a>` : ''}</li>`).join('')}</ul>` : ''}
    ${people.length ? `<h3>Elected for this spot</h3><ul class="cf-list">${people.map((p, i) => `<li><b>${esc(p.person)}</b> · ${esc(p.party)} · ${esc(p.role)} <a href="kasa.html?rep=${encodeURIComponent(p.key)}">profile</a> <a href="${esc(safe(p.source))}" target="_blank" rel="noopener">source</a>
      ${(said[i] || []).slice(0, 2).map(x => `<blockquote>“${esc(x.reply)}” <small>${esc(fmt(x.said_on))}, <a href="${esc(safe(x.source_url))}" target="_blank" rel="noopener">where they said it</a></small></blockquote>`).join('')}</li>`).join('')}</ul>` : ''}
    ${promises.length ? `<h3>Their promises on record</h3><ul class="cf-list">${promises.slice(0, 6).map(p => `<li>“${esc(p.promise)}” <small>${esc(p.who)}, ${esc(fmt(p.made_on))} · ${esc(p.status.replace('_', ' '))} · <a href="${esc(safe(p.source_url))}" target="_blank" rel="noopener">source</a></small></li>`).join('')}</ul>
      <p class="cf-src">These promises are about their area in general, not this report. <a href="promises.html">All promises</a></p>` : ''}
    ${!bodies.length && !people.length ? none('No body or elected seat is on record for this point yet. The report page lists who to contact for the ward or panchayat: <a href="kasa.html?report=' + encodeURIComponent(r.id) + '">open it</a>.') : ''}
    ${people.length ? src('Seat outlines: Election Commission delimitation via places/wb_assembly.geojson; members: Wikipedia election results; replies: checked by a moderator against the link given', 'methodology.html#leaders') : ''}`;

  /* 4. Tender and 5. money: a work linked to the mapped asset under the report (confirmed by a
     moderator, or the nearest one within the report's GPS accuracy, labelled as such), and any
     works board photographed within range. */
  const works = asset?.asset?.id ? await rpc('kasa_asset_works', { p_asset_id: asset.asset.id }) : null;
  const ws = works?.works || [];
  const a = asset?.asset;
  const tenderParts = [];
  if (a) tenderParts.push(`<p>${asset.match === 'confirmed' ? 'This report is about' : `Nearest mapped asset, ${Number(asset.distance_m)} m away (a suggestion, not checked)`}: <b>${esc(a.name || a.kind)}</b>${a.owner ? `, owned by ${esc(a.owner.body)}` : ''}. ${safe(a.source_url) ? `<a href="${esc(safe(a.source_url))}" target="_blank" rel="noopener">${esc(a.source || 'source')}</a>` : ''}</p>`);
  ws.forEach(w => tenderParts.push(`
    <article class="cf-work">
      <b>${esc(w.title)}</b>
      <dl class="cf-facts">
        ${w.tender_ref ? `<div><dt>Tender</dt><dd>${esc(w.tender_ref)}${w.portal ? ' · ' + esc(w.portal) : ''}</dd></div>` : ''}
        ${w.work_order_ref ? `<div><dt>Work order</dt><dd>${esc(w.work_order_ref)}</dd></div>` : ''}
        ${w.issued_by || w.department ? `<div><dt>Issued by</dt><dd>${esc(w.issued_by || w.department)}</dd></div>` : ''}
        ${w.contractor ? `<div><dt>Contractor</dt><dd>${esc(w.contractor.firm_name)}${w.contractor.gstin ? ' · GSTIN ' + esc(w.contractor.gstin) : ''}</dd></div>` : ''}
        <div><dt>Status</dt><dd>${esc(w.status)}${w.completed_on ? ', completed ' + esc(fmt(w.completed_on)) : ''}</dd></div>
        ${w.dlp_ends_on ? `<div><dt>Defect liability</dt><dd>${w.is_under_dlp ? 'Running until ' : 'Ended '}${esc(fmt(w.dlp_ends_on))}${safe(w.dlp_source_url) ? ` <a href="${esc(safe(w.dlp_source_url))}" target="_blank" rel="noopener">clause</a>` : ''}</dd></div>` : ''}
      </dl>
      ${safe(w.source_url) ? src('Tender record', safe(w.source_url)) : ''}
    </article>`));
  if (warranty) tenderParts.push(`<p>A works board ${Number(warranty.distance_m)} m away: <b>${esc(warranty.work_name)}</b> by ${esc(warranty.agency)}${warranty.contractor ? `, contractor ${esc(warranty.contractor)} (as on the board)` : ''}, under the contractor's defect liability until ${esc(fmt(warranty.warranty_until))}. <a href="works.html#work-${esc(warranty.id)}">The board's photo</a></p>`);
  panels.tender[1] = tenderParts.length ? tenderParts.join('') + (ws.length ? '<p class="cf-src">A tender linked to a spot does not mean anyone did anything wrong; it says who was paid to build it and who must repair defects.</p>' : '')
    : none(`No tender or works board is linked to this spot yet. Standing at a site board nearby? <a href="kasa.html?work=1">Record it</a>.`);

  const moneyParts = ws.filter(w => w.sanctioned_amount != null || w.awarded_amount != null).map(w => `
    <p><b>${esc(w.title)}</b>: ${w.sanctioned_amount != null ? `sanctioned ${esc(rupees(w.sanctioned_amount))}` : ''}${w.sanctioned_amount != null && w.awarded_amount != null ? ', ' : ''}${w.awarded_amount != null ? `awarded ${esc(rupees(w.awarded_amount))}${w.awarded_on ? ' on ' + esc(fmt(w.awarded_on)) : ''}` : ''}. ${safe(w.source_url) ? `<a href="${esc(safe(w.source_url))}" target="_blank" rel="noopener">tender record</a>` : ''}</p>`);
  const m = pc && mplads?.pc?.[pc];
  if (m && mp) moneyParts.push(`<p>MP fund (MPLADS) of ${esc(mp.person)}: ${esc(rupees(m.allocated))} allocated this term, ${esc(rupees(m.spent))} spent, ${Number(m.worksCompleted)} of ${Number(m.worksRecommended)} recommended works completed. <a href="${esc(safe(m.url))}" target="_blank" rel="noopener">Empowered Indian (from MoSPI)</a> · <a href="money.html">state budget and audit</a></p>`);
  panels.money[1] = moneyParts.length ? moneyParts.join('') : none('No amount is on record for work at this spot. See the <a href="money.html">state budget and audit page</a> for the wider picture.');

  /* 6. Where it stands */
  const nowParts = [];
  nowParts.push(`<p class="cf-big">${esc(STATE[status] || 'Open')}${status === 'resolved' && r.resolved_at ? `, on ${esc(fmt(r.resolved_at))}` : ''}.</p>`);
  (replies || []).forEach(x => nowParts.push(`<blockquote>“${esc(x.body)}” <small>${esc(x.responder_name)}, ${esc(x.responder_role)}, ${esc(fmt(x.created_at))}${x.verified_note ? ' · ✓ ' + esc(x.verified_note) : ''}</small></blockquote>`));
  if ((dockets || []).length) nowParts.push(`<h3>Filed officially</h3><ul class="cf-list">${dockets.map(d => `<li>${esc({ cpgrams: 'CPGRAMS', state: 'State grievance portal', rti: 'RTI', other: 'Other' }[d.portal] || d.portal)}: <code>${esc(d.number)}</code> <small>added ${esc(fmt(d.added))}</small></li>`).join('')}</ul>`);
  else nowParts.push(`<p>No official complaint number added yet. Filed it with a portal? Add the number on the <a href="kasa.html?report=${encodeURIComponent(r.id)}">report</a> so the next person can follow it up.</p>`);
  nowParts.push(src('Report status is set only by photo confirmations on the spot or a moderator (see How it works)', 'methodology.html'));
  panels.now[1] = nowParts.join('');
  draw();
})();
