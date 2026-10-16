/* Hostel sanitation (hostel.html): daily floor checks. Live camera and GPS only; the public
   list shows facts only, each entry labelled Verified or Unverified with its dates and source. */
(async function(){
  const cfg = window.KASA_CONFIG || {};
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ITEMS = { washroom: 'Washroom mopped', dustbin: 'Dustbin cleared', corridor: 'Corridor swept' };
  const MAX_ACC = 50;
  const IST = 'Asia/Kolkata';
  const phone = matchMedia('(pointer: coarse)').matches || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  const when = iso => iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: IST }) : '';
  const dayOf = d => new Date(d + 'T00:00:00+05:30').toLocaleDateString('en-IN', { dateStyle: 'medium', timeZone: IST });
  const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: IST });
  let sites = [], cap = null;

  function randomName(n){
    const b = crypto.getRandomValues(new Uint8Array(n));
    return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '').slice(0, n);
  }
  async function ensureSession(){
    const { data: { session } } = await sb.auth.getSession();
    if (session) return;
    const { error } = await sb.auth.signInAnonymously();
    if (error) throw new Error('Could not start a session. Try again later.');
  }

  /* ---------- sites, checklist and public record ---------- */
  async function loadSites(){
    const { data, error } = await sb.rpc('kasa_hostel_sites');
    if (error){ $('hs-sites').innerHTML = '<p class="hs-msg bad">Could not load. Try again later.</p>'; return; }
    sites = data || [];
    const exp = $('hs-exp-site');
    exp.innerHTML = sites.map(s => `<option value="${s.id}">${esc(s.name)}, ${esc(s.place)}</option>`).join('');
    $('hs-exp-month').value = todayIST().slice(0, 7);
    await renderSites();
  }

  async function renderSites(){
    if (!sites.length){
      $('hs-sites').innerHTML = '<p class="hs-msg">No hostel is on the list yet. A moderator adds one once its source is checked.</p>';
      $('hs-facts').innerHTML = '<p class="hs-msg">No hostel on the list yet.</p>';
      return;
    }
    const today = todayIST();
    const blocks = await Promise.all(sites.map(async s => {
      const { data } = await sb.rpc('kasa_hostel_checks', { p_site_id: s.id });
      const rows = data || [];
      const floors = s.floors.map(f => `
        <div class="hs-item"><strong>${esc(f.label)}</strong></div>
        ${Object.keys(ITEMS).map(item => {
          const r = rows.find(x => x.floor === f.label && x.item === item && x.check_date === today);
          let status;
          if (r && r.status === 'verified') status = '<span class="hs-tag hs-ok">Verified</span>';
          else if (r && r.status === 'flagged') status = '<span class="hs-tag hs-flag">Unverified · flagged by floor representative</span>';
          else if (r) status = '<span class="hs-tag hs-no">Unverified</span>';
          else status = `<button class="hs-btn primary" type="button" data-site="${s.id}" data-floor="${f.id}" data-item="${item}">Submit check</button>`;
          return `<div class="hs-item"><span>${ITEMS[item]}</span>${status}</div>`;
        }).join('')}`).join('');
      const owner = s.source_kind === 'owner_supplied';
      const sourceLine = owner
        ? `<span class="hs-tag hs-no">Unverified · floor list supplied by the owner, no document yet</span>
           <button class="hs-btn" type="button" data-source-fix data-what="Floor list for ${esc(s.name)}, ${esc(s.place)}">Help verify</button>`
        : `Source: <a href="${esc(s.source_url)}" rel="noopener">${esc(s.district || 'source')}</a>`;
      return `<h2>${esc(s.name)}, ${esc(s.place)}</h2>
        <p class="hs-note">Today’s checks (${dayOf(today)}). ${sourceLine}</p>${floors}`;
    }));
    $('hs-sites').innerHTML = blocks.join('<hr style="border:0;border-top:1px solid var(--border);margin:1.2rem 0">');
    renderFacts();
  }

  async function renderFacts(){
    const s = sites[0];
    if (!s) return;
    const { data, error } = await sb.rpc('kasa_hostel_checks', { p_site_id: s.id });
    if (error){ $('hs-facts').innerHTML = '<p class="hs-msg bad">Could not load.</p>'; return; }
    const rows = data || [];
    if (!rows.length){ $('hs-facts').innerHTML = `<p class="hs-msg">No checks for ${esc(s.name)} in the last 31 days.</p>`; return; }
    const source = r => {
      if (r.status === 'verified') return `Submitted ${when(r.submitted_at)} with live photos and GPS. Verified by floor representative ${when(r.verified_at)}.`;
      if (r.status === 'flagged') return `Submitted ${when(r.submitted_at)} with live photos and GPS. Flagged by floor representative ${when(r.verified_at)}.`;
      return `Submitted ${when(r.submitted_at)} with live photos and GPS. Not yet verified by a floor representative.`;
    };
    $('hs-facts').innerHTML = `<table class="hs-table"><thead><tr><th>Date</th><th>Floor</th><th>Item</th><th>Status</th><th>Source</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td>${dayOf(r.check_date)}</td><td>${esc(r.floor)}</td><td>${ITEMS[r.item] || esc(r.item)}</td>
        <td>${r.status === 'verified' ? '<span class="hs-ok">Verified</span>' : 'Unverified'}</td><td>${esc(source(r))}</td></tr>`).join('')}
      </tbody></table>`;
  }

  /* ---------- supervisor: submit a check with live photos and GPS ---------- */
  function capMsg(text, bad){ const m = $('hs-cap-msg'); m.textContent = text; m.className = 'hs-msg' + (bad ? ' bad' : ''); }
  function updateButtons(){
    const n = (cap?.before ? 1 : 0) + (cap?.after ? 1 : 0);
    $('hs-shoot').textContent = n === 0 ? 'Take before photo' : 'Take after photo';
    $('hs-shoot').disabled = !cap || !cap.stream || n >= 2;
    $('hs-submit').disabled = !cap || !cap.pos || n < 2;
  }
  function startGps(){
    cap.watch = navigator.geolocation.watchPosition(p => {
      const acc = p.coords.accuracy;
      if (acc <= MAX_ACC && cap){
        cap.pos = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: acc };
        navigator.geolocation.clearWatch(cap.watch);
        $('hs-cap-loc').textContent = `GPS fixed, ±${Math.round(acc)} m`;
        updateButtons();
      } else if (cap) $('hs-cap-loc').textContent = `Waiting for a better GPS fix (±${Math.round(acc)} m)…`;
    }, err => {
      if (cap) $('hs-cap-loc').textContent = err.code === 1 ? 'Location permission is needed.' : 'No GPS fix yet. Step into open space.';
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
  }
  async function startCamera(){
    try {
      cap.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    } catch (e){ capMsg('Camera permission is needed to take the photos.', true); return; }
    const v = $('hs-video');
    v.srcObject = cap.stream; v.hidden = false;
    await v.play().catch(() => {});
    updateButtons();
  }
  function grabFrame(){
    const v = $('hs-video'), c = $('hs-canvas');
    if (!v.videoWidth) return Promise.reject(new Error('The camera is not ready. Try again.'));
    const w = Math.min(v.videoWidth, 1280), h = Math.round(w * v.videoHeight / v.videoWidth);
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(v, 0, 0, w, h);
    return new Promise((ok, fail) => c.toBlob(b => b ? ok(b) : fail(new Error('Photo failed. Try again.')), 'image/jpeg', 0.85));
  }
  async function shoot(){
    const key = cap.before ? 'after' : 'before';
    $('hs-shoot').disabled = true;
    try {
      const blob = await grabFrame();
      const { data: token } = await sb.rpc('kasa_issue_capture_token');
      cap[key] = { blob, token: token || null, url: URL.createObjectURL(blob) };
      $('hs-thumbs').insertAdjacentHTML('beforeend', `<figure style="margin:0"><img src="${cap[key].url}" alt="${key} photo"><figcaption class="hs-note">${key}</figcaption></figure>`);
      capMsg('');
    } catch (e){ capMsg(e.message || 'Photo failed. Try again.', true); }
    updateButtons();
  }
  async function uploadPhoto(blob){
    const path = `reports/${randomName(24)}.jpg`;
    const { error } = await sb.storage.from('kasa-photos').upload(path, blob, { contentType: 'image/jpeg', upsert: false, cacheControl: '31536000' });
    if (error) throw new Error('Photo upload failed. Check the connection and try again.');
    return path;
  }
  async function submit(){
    if (!cap?.pos || !cap.before || !cap.after) return;
    $('hs-submit').disabled = true;
    capMsg('Sending…');
    try {
      await ensureSession();
      for (const k of ['before', 'after']){
        cap[k].path = await uploadPhoto(cap[k].blob);
        const { error } = await sb.rpc('kasa_photo_meta', { p_path: cap[k].path, p_meta: { capture: 'live', capture_token: cap[k].token || undefined } });
        if (error && error.code !== 'PGRST202') throw error;
      }
      const { error } = await sb.rpc('kasa_hostel_submit_check', {
        p_floor_id: cap.floorId, p_item: cap.item, p_before: cap.before.path, p_after: cap.after.path,
        p_lat: cap.pos.lat, p_lng: cap.pos.lng, p_accuracy: cap.pos.accuracy });
      if (error) throw error;
      closeCapture();
      await renderSites();
    } catch (e){
      capMsg(e.message || 'Could not submit. Try again.', true);
      updateButtons();
    }
  }
  function closeCapture(){
    if (cap){
      cap.stream?.getTracks().forEach(t => t.stop());
      if (cap.watch != null) navigator.geolocation.clearWatch(cap.watch);
      cap.before && URL.revokeObjectURL(cap.before.url);
      cap.after && URL.revokeObjectURL(cap.after.url);
    }
    cap = null;
    $('hs-video').srcObject = null; $('hs-video').hidden = true;
    $('hs-capture').hidden = true;
    $('hs-thumbs').innerHTML = '';
    capMsg('');
  }
  function openCapture(floorId, item, floorLabel){
    closeCapture();
    cap = { floorId, item };
    $('hs-capture').hidden = false;
    $('hs-cap-title').textContent = `${floorLabel} · ${ITEMS[item]}`;
    $('hs-cap-loc').textContent = 'Waiting for GPS…';
    $('hs-capture').scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (!phone){ capMsg('Open this page on the phone at the floor. The camera and GPS must be the phone’s own.', true); return; }
    if (!navigator.mediaDevices?.getUserMedia){ capMsg('This browser has no camera access.', true); return; }
    updateButtons();
    startGps();
    startCamera();
  }

  /* ---------- floor representative ---------- */
  async function claim(){
    const code = $('hs-code').value.trim();
    if (!code) return;
    $('hs-claim').disabled = true;
    try {
      await ensureSession();
      const { error } = await sb.rpc('kasa_hostel_rep_claim', { p_code: code });
      if (error) throw error;
      $('hs-code').value = '';
      $('hs-rep-msg').textContent = 'Floor claimed.';
      $('hs-rep-msg').className = 'hs-msg';
      await renderPending();
    } catch (e){
      $('hs-rep-msg').textContent = e.message || 'Could not claim the floor.';
      $('hs-rep-msg').className = 'hs-msg bad';
    }
    $('hs-claim').disabled = false;
  }
  async function renderPending(){
    const { data, error } = await sb.rpc('kasa_hostel_my_floors_checks');
    const box = $('hs-pending');
    if (error || !data){ box.innerHTML = ''; return; }
    if (!data.length){ box.innerHTML = '<p class="hs-note">No checks waiting from the last 14 days on your floor.</p>'; return; }
    box.innerHTML = data.map(r => `
      <div class="hs-item" style="display:block">
        <div><strong>${esc(r.floor)}</strong> · ${ITEMS[r.item] || esc(r.item)} · ${dayOf(r.check_date)} · <span class="${r.status === 'verified' ? 'hs-ok' : r.status === 'flagged' ? 'hs-flag' : 'hs-no'}">${r.status === 'verified' ? 'Verified' : r.status === 'flagged' ? 'Flagged' : 'Unverified'}</span></div>
        <div class="hs-thumbs"><a href="${esc(r.before_url)}" target="_blank" rel="noopener"><img src="${esc(r.before_url)}" alt="before"></a><a href="${esc(r.after_url)}" target="_blank" rel="noopener"><img src="${esc(r.after_url)}" alt="after"></a></div>
        ${r.mine ? '<p class="hs-note">You submitted this check. Another floor representative verifies it.</p>' : `
        <div class="hs-row"><input class="hs-input" data-note="${r.id}" placeholder="Note (optional)" maxlength="300" aria-label="Note">
          <button class="hs-btn primary" type="button" data-verify="${r.id}" data-decision="verified">Verified</button>
          <button class="hs-btn" type="button" data-verify="${r.id}" data-decision="flagged">Flag</button></div>`}
      </div>`).join('');
  }
  async function verify(id, decision){
    const note = document.querySelector(`[data-note="${id}"]`)?.value || '';
    try {
      const { error } = await sb.rpc('kasa_hostel_verify', { p_check_id: Number(id), p_decision: decision, p_note: note });
      if (error) throw error;
      await renderPending();
      await renderSites();
    } catch (e){
      $('hs-rep-msg').textContent = e.message || 'Could not save.';
      $('hs-rep-msg').className = 'hs-msg bad';
    }
  }

  /* ---------- moderators: monthly export ---------- */
  async function exportMonth(){
    const site = $('hs-exp-site').value, month = $('hs-exp-month').value;
    const msg = $('hs-exp-msg');
    if (!site || !month) return;
    msg.className = 'hs-msg'; msg.textContent = 'Preparing…';
    const { data, error } = await sb.rpc('kasa_admin_hostel_export', { p_site_id: Number(site), p_month: month + '-01' });
    if (error){ msg.className = 'hs-msg bad'; msg.textContent = error.message || 'Moderators only.'; return; }
    const cols = ['floor', 'item', 'check_date', 'status', 'submitted_at', 'verified_at', 'lat', 'lng', 'accuracy_m'];
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [cols.join(','), ...(data || []).map(r => cols.map(c => q(r[c])).join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `hostel-sanitation-${month}.csv`;
    a.click();
    msg.textContent = `${(data || []).length} rows.`;
  }

  /* ---------- wiring ---------- */
  $('hs-sites').addEventListener('click', e => {
    const b = e.target.closest('[data-item]');
    if (!b) return;
    const floor = sites.flatMap(s => s.floors).find(f => String(f.id) === b.dataset.floor);
    openCapture(Number(b.dataset.floor), b.dataset.item, floor ? floor.label : '');
  });
  $('hs-pending').addEventListener('click', e => {
    const b = e.target.closest('[data-verify]');
    if (b) verify(b.dataset.verify, b.dataset.decision);
  });
  $('hs-shoot').onclick = shoot;
  $('hs-submit').onclick = submit;
  $('hs-cancel').onclick = closeCapture;
  $('hs-claim').onclick = claim;
  $('hs-export').onclick = exportMonth;

  await loadSites();
  await renderPending();
})();
