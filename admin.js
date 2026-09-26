/* ══════════════════════════════════════════════════════════
   PURULIA KASA — Admin Analytics
   ══════════════════════════════════════════════════════════ */

const SUPABASE_URL = (window.KASA_CONFIG && window.KASA_CONFIG.SUPABASE_URL) || '';
const SUPABASE_ANON_KEY = (window.KASA_CONFIG && window.KASA_CONFIG.SUPABASE_ANON_KEY) || '';

// If config.js or the Supabase library failed to load, fail loudly here rather than
// throwing a cryptic error later — the page-wide error banner (admin.html) shows this.
if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !window.supabase){
  throw new Error('config.js or the Supabase library did not load — reload the page.');
}

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

document.getElementById('adLoginForm').addEventListener('submit', (e) => { e.preventDefault(); tryLogin(); });

/* Two steps, nothing else: sign in, then ask the database (not a client-side table read)
   whether this account is an admin — the same kasa_private.is_admin() every other admin
   action already trusts. Whatever happens, the button always ends up usable again and
   something is always shown — never a silent hang. */
async function tryLogin(){
  const errEl = document.getElementById('adError');
  errEl.textContent = '';
  const email = document.getElementById('adEmail').value.trim();
  const password = document.getElementById('adPassword').value;
  if (!email || !password){
    errEl.textContent = 'Email and password required.';
    return;
  }
  const btn = document.getElementById('adLoginBtn');
  btn.disabled = true; btn.textContent = 'Signing in…';
  try {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error){
      errEl.textContent = error.message;
      return;
    }
    if (!data?.user){
      errEl.textContent = 'Sign-in did not return an account. Please try again.';
      return;
    }
    const { data: isAdmin, error: adminErr } = await sb.rpc('kasa_is_admin');
    if (adminErr){
      errEl.textContent = 'Could not confirm admin access: ' + (adminErr.message || 'unknown error');
      return;
    }
    if (!isAdmin){
      await sb.auth.signOut();
      errEl.textContent = 'Not an admin account.';
      return;
    }
    showDashboard();
  } catch (e){
    errEl.textContent = 'Something went wrong (' + (e?.message || String(e)) + '). Check your connection and try again.';
  } finally {
    btn.disabled = false; btn.textContent = 'Continue →';
  }
}

document.getElementById('adSignout').addEventListener('click', async () => {
  await sb.auth.signOut();
  location.reload();
});

document.getElementById('adRefreshBtn').addEventListener('click', loadAll);

(async () => {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return;
  const { data: isAdmin } = await sb.rpc('kasa_is_admin');
  if (isAdmin) showDashboard();
})();

let myRole = null; // 'admin' or 'moderator' — the server enforces it; this only hides what would fail
const isSuper = () => myRole === 'admin';

async function showDashboard(){
  const { data: role } = await sb.rpc('kasa_my_role');
  myRole = role;
  document.getElementById('adTeamSection').hidden = !isSuper();
  document.getElementById('adSignupsSection').hidden = !isSuper();
  document.getElementById('adLogin').classList.add('hidden');
  document.getElementById('adDash').classList.remove('hidden');
  loadAll();
}

async function loadAll(){
  document.getElementById('adTimestamp').textContent =
    'Updated ' + new Date().toLocaleString('en-IN', { dateStyle:'medium', timeStyle:'short' });
  await Promise.all([
    loadOverview(), loadDaily(), loadWards(), loadSla(),
    loadResolutions(), loadAutomation(), loadCommunities(), loadSchoolChecks(), loadRepeatPhotos(), loadAdoptions(), loadLatest(),
    ...(isSuper() ? [loadSignups(), loadTeam()] : [])
  ]);
}

async function loadOverview(){
  const el = document.getElementById('adOverview');
  try {
    const { data: all } = await sb.from('reports').select('*');
    const total = all?.length || 0;
    const resolved = all?.filter(r => r.status === 'resolved').length || 0;
    const open = total - resolved;
    const overdue = all?.filter(r => {
      if (r.status === 'resolved') return false;
      const days = (Date.now() - new Date(r.created_at).getTime()) / 86400000;
      return days > (r.sla_days || 7);
    }).length || 0;
    const wardsActive = new Set(all?.map(r => r.ward_no).filter(Boolean)).size;
    const last24 = all?.filter(r => Date.now() - new Date(r.created_at).getTime() < 86400000).length || 0;
    el.innerHTML = `
      <div class="ad-card"><div class="ad-card-label">Total reports</div><div class="ad-card-value">${total}</div><div class="ad-card-sub">${last24} in last 24h</div></div>
      <div class="ad-card"><div class="ad-card-label">Open</div><div class="ad-card-value">${open}</div><div class="ad-card-sub">${overdue} overdue</div></div>
      <div class="ad-card"><div class="ad-card-label">Resolved</div><div class="ad-card-value">${resolved}</div><div class="ad-card-sub">${total ? Math.round(resolved/total*100) : 0}% rate</div></div>
      <div class="ad-card"><div class="ad-card-label">Wards active</div><div class="ad-card-value">${wardsActive} <span style="font-size:1rem;color:var(--text-lo);">/ 23</span></div><div class="ad-card-sub">${wardsActive < 23 ? (23 - wardsActive) + ' silent' : 'All covered'}</div></div>
    `;
  } catch(e){ el.innerHTML = '<div class="ad-empty">Could not load.</div>'; }
}

async function loadDaily(){
  const el = document.getElementById('adDaily');
  try {
    const since = new Date(Date.now() - 14 * 86400000).toISOString();
    const { data } = await sb.from('reports').select('created_at').gte('created_at', since);
    if (!data?.length){ el.innerHTML = '<div class="ad-empty">No reports in last 14 days.</div>'; return; }
    const byDay = {};
    data.forEach(r => {
      const d = new Date(r.created_at).toISOString().slice(0, 10);
      byDay[d] = (byDay[d] || 0) + 1;
    });
    const days = Object.entries(byDay).sort();
    const max = Math.max(...days.map(d => d[1]), 1);
    el.innerHTML = days.map(([day, count]) => `
      <div class="ad-bar-row">
        <div class="ad-bar-label">${new Date(day).toLocaleDateString('en-IN', { day:'numeric', month:'short' })}</div>
        <div class="ad-bar-track"><div class="ad-bar-fill" style="width:${(count/max*100).toFixed(1)}%"></div></div>
        <div class="ad-bar-value">${count}</div>
      </div>
    `).join('');
  } catch(e){ el.innerHTML = '<div class="ad-empty">Could not load.</div>'; }
}

async function loadWards(){
  const el = document.getElementById('adWards');
  try {
    const { data: reports } = await sb.from('reports').select('ward_no, status, created_at, resolved_at');
    const { data: wards } = await sb.from('wards').select('*');
    const wardMap = new Map((wards || []).map(w => [w.ward_no, w]));
    const stats = {};
    (reports || []).forEach(r => {
      if (!r.ward_no) return;
      if (!stats[r.ward_no]) stats[r.ward_no] = { open:0, resolved:0 };
      if (r.status === 'resolved') stats[r.ward_no].resolved++;
      else stats[r.ward_no].open++;
    });
    const rows = Object.entries(stats).map(([ward, s]) => ({
      ward: parseInt(ward), ...s,
      councillor: wardMap.get(parseInt(ward))?.councillor_name || '—',
      party: wardMap.get(parseInt(ward))?.party || '—'
    })).sort((a, b) => b.open - a.open);
    if (!rows.length){ el.innerHTML = '<div class="ad-empty">No ward data yet.</div>'; return; }
    el.innerHTML = `
      <table class="ad-table">
        <thead><tr><th>Ward</th><th>Councillor</th><th class="num">Open</th><th class="num">Resolved</th></tr></thead>
        <tbody>
          ${rows.map(w => `
            <tr>
              <td class="amber">Ward ${w.ward}</td>
              <td>${esc(w.councillor)} <span style="color:var(--text-lo);">· ${esc(w.party)}</span></td>
              <td class="num ${w.open > 5 ? 'red' : ''}">${w.open}</td>
              <td class="num green">${w.resolved}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch(e){ el.innerHTML = '<div class="ad-empty">Could not load.</div>'; }
}

async function loadSla(){
  const el = document.getElementById('adSla');
  try {
    const { data } = await sb.from('reports').select('status, created_at, resolved_at, sla_days');
    const all = data || [];
    let inSla = 0, late = 0, overdue = 0, open = 0;
    all.forEach(r => {
      const sla = r.sla_days || 7;
      if (r.status === 'resolved' && r.resolved_at){
        const days = (new Date(r.resolved_at) - new Date(r.created_at)) / 86400000;
        if (days <= sla) inSla++; else late++;
      } else {
        open++;
        const days = (Date.now() - new Date(r.created_at)) / 86400000;
        if (days > sla) overdue++;
      }
    });
    const totalResolved = inSla + late;
    const onTimePct = totalResolved ? Math.round(inSla / totalResolved * 100) : 0;
    el.innerHTML = `
      <div class="ad-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:0;">
        <div class="ad-card"><div class="ad-card-label">Resolved in SLA</div><div class="ad-card-value green">${inSla}</div><div class="ad-card-sub">${onTimePct}% on time</div></div>
        <div class="ad-card"><div class="ad-card-label">Resolved late</div><div class="ad-card-value" style="color:var(--orange);">${late}</div><div class="ad-card-sub">Past SLA</div></div>
        <div class="ad-card"><div class="ad-card-label">Currently overdue</div><div class="ad-card-value red">${overdue}</div><div class="ad-card-sub">Of ${open} open</div></div>
      </div>
    `;
  } catch(e){ el.innerHTML = '<div class="ad-empty">Could not load.</div>'; }
}

const CATEGORY_KEYS = ['garbage', 'drain', 'road', 'streetlight', 'water', 'missing', 'encroachment',
  'illegal_construction', 'illegal_mining', 'illegal_other', 'other', 'dumpsite', 'toilet', 'hand_pump', 'anganwadi', 'health_centre', 'school'];

/* Count tiles over the queue: waiting now, hidden, and this month's decisions (the same
   public counts analytics.html shows, so the team and the public see one set of numbers). */
async function loadModTiles(q){
  const el = document.getElementById('adModTiles');
  const { data: tr } = await sb.rpc('kasa_public_transparency');
  const m = tr?.months?.[0] || {}, now = tr?.now || {};
  const waiting = (q?.reports?.length || 0) + (q?.claims?.length || 0);
  el.innerHTML = [
    [waiting, 'Waiting now', waiting ? 'warn' : 'good'],
    [now.hidden ?? '—', 'Hidden', 'bad'],
    [m.kept ?? '—', 'Kept this month', 'good'],
    [m.flagged ?? '—', 'Flags this month', ''],
  ].map(([n, l, c]) => `<div class="ad-mod-tile ${c}"><b>${esc(n)}</b><span>${esc(l)}</span></div>`).join('');
}

/* Hidden: everything currently hidden, newest first, with Restore (and Delete for admins,
   which the server only allows for flagged / held reports). Kept: reports a moderator
   approved or restored, from the public evidence trail, with Hide. */
async function loadModTab(tab){
  const el = document.getElementById('adModOther');
  el.innerHTML = '<div class="ad-loading">Loading…</div>';
  let rows = [];
  if (tab === 'hidden'){
    const { data, error } = await sb.from('reports').select('id,created_at,updated_at,category,ward_no,block_name,landmark,description,photo_url,flags,moderation_status')
      .eq('moderation_status', 'hidden').order('updated_at', { ascending: false }).limit(50);
    if (error){ el.innerHTML = `<div class="ad-empty">Could not load: ${esc(error.message)}</div>`; return; }
    rows = data || [];
  } else {
    const { data: ev, error } = await sb.from('kasa_public_events').select('report_id,detail,created_at')
      .eq('kind', 'moderated').order('created_at', { ascending: false }).limit(200);
    if (error){ el.innerHTML = `<div class="ad-empty">Could not load: ${esc(error.message)}</div>`; return; }
    const ids = [...new Set((ev || []).filter(e => ['approve', 'restore'].includes(e.detail?.action)).map(e => e.report_id))].slice(0, 50);
    if (ids.length){
      const { data } = await sb.from('reports').select('id,created_at,category,ward_no,block_name,landmark,description,photo_url,flags,moderation_status')
        .in('id', ids).eq('moderation_status', 'approved');
      rows = ids.map(id => (data || []).find(r => String(r.id) === String(id))).filter(Boolean);
    }
  }
  if (!rows.length){ el.innerHTML = `<div class="ad-empty">${tab === 'hidden' ? 'Nothing hidden.' : 'No reports kept after review yet.'}</div>`; return; }
  el.innerHTML = rows.map(r => `
    <div class="ad-item">
      <div class="ad-item-head">
        <div>
          <div class="ad-item-title">${esc(r.category)} · ${esc(r.ward_no ? 'Ward ' + r.ward_no : r.block_name ? r.block_name + ' block' : '?')} · flagged ${esc(r.flags || 0)}×</div>
          <div class="ad-item-meta">${esc(r.landmark || '')} ${esc(r.description || '')}<br>${new Date(r.created_at).toLocaleString('en-IN')}
            · <a href="kasa.html?report=${encodeURIComponent(r.id)}" target="_blank" rel="noopener" style="color:var(--amber)">open</a></div>
        </div>
        <div class="ad-actions">
          ${tab === 'hidden'
            ? `<button class="ad-ok" data-tabmod="restore" data-id="${esc(r.id)}">↺ Restore</button>`
            : `<button class="ad-bad" data-tabmod="hide" data-id="${esc(r.id)}">✕ Hide</button>`}
        </div>
      </div>
      ${r.photo_url ? `<div class="ad-photos"><figure><img src="${esc(r.photo_url)}" alt="" loading="lazy"></figure></div>` : ''}
    </div>`).join('');
  el.querySelectorAll('[data-tabmod]').forEach(b => b.addEventListener('click', async () => {
    await moderate(b.dataset.id, b.dataset.tabmod);
    loadModTab(tab);
  }));
}

document.querySelectorAll('[data-modtab]').forEach(b => b.addEventListener('click', () => {
  const tab = b.dataset.modtab;
  document.querySelectorAll('[data-modtab]').forEach(x => x.setAttribute('aria-selected', String(x === b)));
  document.getElementById('adResolutions').hidden = tab !== 'waiting';
  document.getElementById('adModOther').hidden = tab === 'waiting';
  if (tab !== 'waiting') loadModTab(tab);
}));

async function loadResolutions(){
  const { data, error } = await sb.rpc('kasa_admin_queue');
  loadModTiles(error ? null : data);
  if (!error) return renderModeration(data);
  document.getElementById('adResolutions').innerHTML = `<div class="ad-empty">${esc(error.code === 'KASA_NOT_ADMIN' || /KASA_NOT_ADMIN/.test(error.message)
    ? 'This account is not a moderator.' : 'Could not load the moderation queue: ' + (error.details || error.message))}</div>`;
}

/* What the phone said about a photo, for the moderator (never coordinates). */
function photoMetaText(m){
  if (!m || !m.capture || m.capture === 'none') return '';
  const bits = [m.capture === 'live' ? 'live camera' : m.capture === 'file' ? 'from gallery' : 'no metadata sent'];
  if (m.taken_minutes_ago != null) bits.push(`taken ${m.taken_minutes_ago} min before upload`);
  if (m.exif_distance_m != null) bits.push(`photo GPS ${m.exif_distance_m} m from the spot`);
  if (m.ai_edited) bits.push('marked AI-edited');
  if (m.gps_checked === false) bits.push('photo has no GPS — check closely');
  return bits.join(' · ');
}

function renderModeration(q){
  document.getElementById('adModNote').textContent =
    'Reports only become "resolved" through on-site confirmations. You can approve or hide reports, throw out a fake cleanup claim, void an obviously fake confirmation or dispute, or clear a photo held because its location data was far from the spot. Every action is published in the report\'s evidence trail with the reason you give.';
  document.getElementById('adReplySection').hidden = false;
  const el = document.getElementById('adResolutions');
  const reports = q.reports || [], claims = q.claims || [];
  const reportHtml = reports.map(r => `
    <div class="ad-item">
      <div class="ad-item-head">
        <div>
          <div class="ad-item-title">${esc(r.category)} · Ward ${esc(r.ward_no ?? '?')} · ${esc(r.moderation_status === 'review' ? 'waiting for approval' : r.moderation_status === 'approved' ? `flagged ${r.flags}× — still public` : 'under review, flagged ' + r.flags + '×')}</div>
          <div class="ad-item-meta">${esc(r.landmark || '')} ${esc(r.description || '')}<br>
            ${new Date(r.created_at).toLocaleString('en-IN')}
            ${photoMetaText(r.moderation_labels?.photo) ? ' · ' + esc(photoMetaText(r.moderation_labels.photo)) : ''}
            ${r.moderation_labels?.text ? ' · text needs review: ' + esc(r.moderation_labels.text) : ''}
            ${(r.flag_reasons || []).map(f => ' · ' + esc(f.reason) + (f.suggested_category ? ' → ' + esc(f.suggested_category) : '') + (f.note ? ': ' + esc(f.note) : '')).join('')}</div>
        </div>
        <div class="ad-actions">
          <button class="ad-ok" data-mod="approve" data-id="${esc(r.id)}">✓ Publish / keep</button>
          <button class="ad-bad" data-mod="hide" data-id="${esc(r.id)}">✕ Hide</button>
          <select class="ad-recat-sel" data-recat-sel="${esc(r.id)}" aria-label="Category">
            ${CATEGORY_KEYS.map(k => `<option value="${k}"${k === r.category ? ' selected' : ''}>${k}</option>`).join('')}
          </select>
          <button class="ad-ok" data-recat="${esc(r.id)}">Change category</button>
          <button class="ad-ok" data-note="${esc(r.id)}">💬 Add note</button>
        </div>
      </div>
      <div class="ad-photos"><figure><img src="${esc(r.photo_url)}" alt="" loading="lazy"><figcaption>Report photo</figcaption></figure></div>
    </div>`).join('');
  const claimHtml = claims.map(c => `
    <div class="ad-item">
      <div class="ad-item-head">
        <div>
          <div class="ad-item-title">${esc(c.category)} · Ward ${esc(c.ward_no ?? '?')} — cleanup claimed ${new Date(c.created_at).toLocaleString('en-IN')}</div>
          <div class="ad-item-meta">Claim photo taken ${esc(c.distance_m)} m from the spot · ${c.verify_count} confirmations · ${c.dispute_count} disputes${c.quorum_reached_at ? ' · quorum reached' : ''}
            ${photoMetaText(c.photo_meta) ? '<br>Claim photo: ' + esc(photoMetaText(c.photo_meta)) : ''}
            ${c.needs_review ? '<br><strong>⏸ Held: the claim photo\'s location data is far from the spot. It can\'t become final until you clear or reject it.</strong>' : ''}</div>
        </div>
        <div class="ad-actions">
          ${c.needs_review ? `<button class="ad-ok" data-clear-claim="${esc(c.id)}">✓ Clear photo</button>` : ''}
          ${isSuper() ? `<button class="ad-ok" data-accept-claim="${esc(c.id)}" title="The photos show it is cleaned: mark the report fixed now">✓ Accept cleanup</button>` : ''}
          <button class="ad-bad" data-reject-claim="${esc(c.id)}" title="The claim photo is fake or shows a different place">✕ Reject claim</button>
          <button class="ad-ok" data-note="${esc(c.report_id)}" title="Add a public note to this report's history">💬 Add note</button>
        </div>
      </div>
      <div class="ad-photos">
        <figure><img src="${esc(c.original_photo_url)}" alt="" loading="lazy"><figcaption>Before (report)</figcaption></figure>
        <figure><img src="${esc(c.photo_url)}" alt="" loading="lazy"><figcaption>Claim</figcaption></figure>
        ${(c.votes || []).map(v => `<figure${v.needs_review ? ' class="ad-held"' : ''}><img src="${esc(v.photo_url || '')}" alt="" loading="lazy">
          <figcaption>${v.vote === 'verify' ? '✓ confirm' : '✗ dispute'} · ${esc(v.distance_m)} m
            ${photoMetaText(v.photo_meta) ? '<br>' + esc(photoMetaText(v.photo_meta)) : ''}
            ${v.needs_review ? '<br><strong>⏸ held — not counted</strong> <button data-clear-vote="' + esc(v.id) + '">clear</button>' : ''}
            <button data-void="${esc(v.id)}" title="Don't count this confirmation or dispute">✕ Don't count</button></figcaption></figure>`).join('')}
      </div>
    </div>`).join('');
  el.innerHTML = (reportHtml ? '<div class="ad-sub-title">Reports</div>' + reportHtml : '') +
    (claimHtml ? '<div class="ad-sub-title">Cleanup claims being verified</div>' + claimHtml : '') ||
    '<div class="ad-empty">Nothing waiting. 🎉</div>';

  el.querySelectorAll('[data-mod]').forEach(b => b.addEventListener('click', () => moderate(b.dataset.id, b.dataset.mod)));
  el.querySelectorAll('[data-recat]').forEach(b => b.addEventListener('click', async () => {
    const cat = el.querySelector(`[data-recat-sel="${b.dataset.recat}"]`).value;
    const reason = prompt('Public reason for the new category (shown in the report history):');
    if (!reason) return;
    const { error } = await sb.rpc('kasa_admin_recategorize', { p_report_id: b.dataset.recat, p_category: cat, p_reason: reason });
    if (error){ alert('Failed: ' + (error.details || error.message)); return; }
    loadResolutions();
  }));
  el.querySelectorAll('[data-reject-claim]').forEach(b => b.addEventListener('click', () => rejectClaim(b.dataset.rejectClaim)));
  el.querySelectorAll('[data-accept-claim]').forEach(b => b.addEventListener('click', () => acceptClaim(b.dataset.acceptClaim)));
  el.querySelectorAll('[data-note]').forEach(b => b.addEventListener('click', () => addNote(b.dataset.note)));
  el.querySelectorAll('[data-void]').forEach(b => b.addEventListener('click', () => voidVote(b.dataset.void)));
  el.querySelectorAll('[data-clear-vote]').forEach(b => b.addEventListener('click', () => clearHeld('vote', b.dataset.clearVote)));
  el.querySelectorAll('[data-clear-claim]').forEach(b => b.addEventListener('click', () => clearHeld('claim', b.dataset.clearClaim)));
}

// Clearing says, on the public record, that the photo was checked and is from the spot.
async function clearHeld(kind, id){
  const note = prompt('Public reason for clearing this photo (e.g. "landmarks match the spot; phone had a stale location"):');
  if (!note) return;
  const { error } = kind === 'vote'
    ? await sb.rpc('kasa_admin_clear_vote', { p_vote_id: id, p_note: note })
    : await sb.rpc('kasa_admin_clear_claim', { p_claim_id: id, p_note: note });
  if (error){ alert('Failed: ' + (error.details || error.message)); return; }
  loadAll();
}

async function moderate(id, action){
  if (action === 'delete' && !confirm('Delete this report and its photo from the site for good? This cannot be undone.')) return;
  const reason = prompt(action === 'hide' ? 'Public reason for hiding this report:'
    : action === 'delete' ? 'Reason for deleting (kept in the deletion log), e.g. "exact repeat of another report":' : 'Optional public note:');
  if ((action === 'hide' || action === 'delete') && !(reason && reason.trim().length >= 3)) return;
  const { error } = await sb.rpc('kasa_admin_moderate', { p_report_id: id, p_action: action, p_reason: reason || null });
  if (error){ alert('Failed: ' + (error.details || error.message)); return; }
  loadAll();
}

/* Find any report by link/ID — including one nobody flagged — and hide, restore or (if
   flagged/held for review) delete it. The moderation queue above only lists what's waiting. */
document.getElementById('adFindBtn').addEventListener('click', findReport);
document.getElementById('adFindInput').addEventListener('keypress', (e) => { if (e.key === 'Enter') findReport(); });

async function findReport(){
  const raw = document.getElementById('adFindInput').value.trim();
  let id = raw;
  try { id = new URL(raw).searchParams.get('report') || raw; } catch (_) {}
  const el = document.getElementById('adFindResult');
  if (!id){ el.innerHTML = ''; return; }
  el.innerHTML = '<div class="ad-loading">Loading…</div>';
  const { data: r, error } = await sb.from('reports').select('*').eq('id', id).single();
  if (error || !r){
    el.innerHTML = `<div class="ad-empty">${esc(error && error.code === 'PGRST116' ? 'No report with that link or ID.' : 'Could not load: ' + ((error && (error.details || error.message)) || 'not found'))}</div>`;
    return;
  }
  const canDelete = isSuper();
  el.innerHTML = `
    <div class="ad-item">
      <div class="ad-item-head">
        <div>
          <div class="ad-item-title">${esc(r.category)} · Ward ${esc(r.ward_no ?? '?')} · ${esc(r.moderation_status)} · ${esc(r.status)}</div>
          <div class="ad-item-meta">${esc(r.landmark || '')} ${esc(r.description || '')}<br>${new Date(r.created_at).toLocaleString('en-IN')}</div>
        </div>
        <div class="ad-actions">
          <button class="ad-ok" data-find-mod="approve">✓ Approve / restore</button>
          <button class="ad-bad" data-find-mod="hide">✕ Hide</button>
          <button class="ad-ok" id="adFindNote">💬 Add note</button>
          ${canDelete ? '<button class="ad-bad" data-find-mod="delete">🗑 Delete permanently</button>'
            : '<span class="ad-note" style="margin:0;">Only an admin can delete permanently — hide this one instead.</span>'}
        </div>
      </div>
      ${r.photo_url ? `<div class="ad-photos"><figure><img src="${esc(r.photo_url)}" alt="" loading="lazy"><figcaption>Report photo</figcaption></figure></div>` : ''}
      <div id="adFindPhotos"></div>
      <div class="ad-actions" style="margin-top:.8rem;">
        <select class="ad-recat-sel" id="adFindCatSel" aria-label="Category">
          ${CATEGORY_KEYS.map(k => `<option value="${k}"${k === r.category ? ' selected' : ''}>${k}</option>`).join('')}
        </select>
        <button class="ad-ok" id="adFindCatBtn">Change category</button>
      </div>
    </div>`;
  el.querySelectorAll('[data-find-mod]').forEach(b => b.addEventListener('click', async () => {
    await moderate(r.id, b.dataset.findMod);
    findReport();
  }));
  document.getElementById('adFindNote').addEventListener('click', () => addNote(r.id));
  document.getElementById('adFindCatBtn').addEventListener('click', async () => {
    const cat = document.getElementById('adFindCatSel').value;
    if (cat === r.category) return;
    const reason = prompt('Public reason for the new category (shown in the report history):');
    if (!reason) return;
    const { error } = await sb.rpc('kasa_admin_recategorize', { p_report_id: r.id, p_category: cat, p_reason: reason });
    if (error){ alert('Failed: ' + (error.details || error.message)); return; }
    findReport();
  });
  loadReportPhotos(r.id);
}

/* Moderators keep reports readable and correct. The automatic check joins reports of the
   same kind within 40 m, and it can be wrong, so a person decides: keep the join, undo it,
   join a report the check missed, or delete a repeat photo. The report's first photo always
   stays; every change shows on the report's public timeline. */
async function removePhoto(reportId, kind, ref){
  const reason = prompt('Public reason for deleting this photo (e.g. "same photo as the first"):');
  if (!reason || reason.trim().length < 3) return false;
  const { error } = await sb.rpc('kasa_admin_remove_photo', { p_report_id: reportId, p_kind: kind, p_ref: String(ref), p_reason: reason });
  if (error){ alert('Failed: ' + (error.details || error.message)); return false; }
  return true;
}

async function repeatAction(action, childId, parentId){
  if (action === 'delete') return removePhoto(parentId, 'duplicate', childId);
  let res;
  if (action === 'keep') res = await sb.rpc('kasa_admin_confirm_duplicate', { p_report_id: childId });
  else {
    const reason = prompt('Why are these different? (shown publicly; leave empty for "A different problem, not the same spot")') ;
    if (reason === null) return false;
    res = await sb.rpc('kasa_admin_unlink_duplicate', { p_report_id: childId, p_reason: reason || null });
  }
  if (res.error){ alert('Failed: ' + (res.error.details || res.error.message)); return false; }
  return true;
}

const REPEAT_BTNS = `<button class="ad-ok" data-act="keep" title="Both photos show the same problem">✓ Same</button>
  <button class="ad-bad" data-act="split" title="Different problems: make it its own report again">✕ Not the same</button>
  <button class="ad-bad" data-act="delete" title="Delete this repeat photo from the site">🗑 Delete</button>`;

async function loadReportPhotos(id){
  const el = document.getElementById('adFindPhotos');
  if (!el) return;
  const { data, error } = await sb.rpc('kasa_admin_report_photos', { p_report_id: id });
  if (error){ el.innerHTML = `<div class="ad-empty">Could not load photos: ${esc(error.details || error.message)}</div>`; return; }
  const extras = data.extras || [], dups = data.duplicates || [];
  el.innerHTML = `
    ${extras.length ? `<div class="ad-photos">${extras.map((p, i) => `<figure>
      <img src="${esc(p.photo_url)}" alt="" loading="lazy">
      <figcaption>Extra photo ${esc(p.position)} <button class="ad-bad" data-rm-extra="${i}">🗑 Delete</button></figcaption>
    </figure>`).join('')}</div>` : ''}
    ${dups.length ? `<p class="ad-note" style="margin-top:.8rem;">Reports joined to this one as repeats:</p>
    <div class="ad-photos">${dups.map((d, i) => `<figure data-dup="${i}">
      ${d.photo_url ? `<img src="${esc(d.photo_url)}" alt="" loading="lazy">` : ''}
      <figcaption>Joined ${esc(new Date(d.created_at).toLocaleDateString('en-IN'))}<br>${REPEAT_BTNS}</figcaption>
    </figure>`).join('')}</div>` : ''}
    <div class="ad-actions" style="margin-top:.8rem;">
      <input type="text" id="adJoinTo" placeholder="Same problem as report (link or ID)" style="flex:1;min-width:14rem;">
      <button class="ad-ok" id="adJoinBtn">Join as a repeat</button>
    </div>`;
  el.querySelectorAll('[data-rm-extra]').forEach(b => b.addEventListener('click', async () => {
    if (await removePhoto(id, 'extra', extras[+b.dataset.rmExtra].position)) loadReportPhotos(id);
  }));
  el.querySelectorAll('[data-dup] [data-act]').forEach(b => b.addEventListener('click', async () => {
    const d = dups[+b.closest('[data-dup]').dataset.dup];
    if (await repeatAction(b.dataset.act, d.id, id)){ loadReportPhotos(id); loadRepeatPhotos(); }
  }));
  document.getElementById('adJoinBtn').addEventListener('click', async () => {
    const raw = document.getElementById('adJoinTo').value.trim();
    let parent = raw;
    try { parent = new URL(raw).searchParams.get('report') || raw; } catch (_) {}
    if (!parent) return;
    const { error: e2 } = await sb.rpc('kasa_admin_link_duplicate', { p_report_id: String(id), p_parent_id: parent });
    if (e2){ alert('Failed: ' + (e2.details || e2.message)); return; }
    alert('Joined. This report now counts as a repeat of the other one.');
    findReport(); loadRepeatPhotos();
  });
}

async function loadRepeatPhotos(){
  const el = document.getElementById('adRepeatPhotos');
  const { data, error } = await sb.rpc('kasa_admin_repeat_photos', { p_limit: 60 });
  if (error){ el.innerHTML = `<div class="ad-empty">Could not load: ${esc(error.details || error.message)}</div>`; return; }
  if (!data?.length){ el.innerHTML = '<div class="ad-empty">Nothing to check.</div>'; return; }
  const img = u => u ? `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="" style="width:96px;height:96px;object-fit:cover;border-radius:4px;"></a>` : '—';
  el.innerHTML = `
    <table class="ad-table">
      <thead><tr><th>Earlier report</th><th>Joined to it</th><th>Details</th><th>Is it the same problem?</th></tr></thead>
      <tbody>
        ${data.map((d, i) => `<tr data-row="${i}">
          <td>${img(d.parent_photo_url)}</td>
          <td>${img(d.photo_url)}</td>
          <td>${esc(d.category)} · Ward ${esc(d.ward_no ?? '?')} ${esc(d.block_name || '')}<br><small>${esc(d.distance_m ?? '?')} m apart · ${esc(new Date(d.created_at).toLocaleString('en-IN'))} · <a href="kasa.html?report=${encodeURIComponent(d.parent_id)}" target="_blank" rel="noopener">earlier</a> · <a href="kasa.html?report=${encodeURIComponent(d.id)}" target="_blank" rel="noopener">joined</a></small></td>
          <td style="white-space:nowrap;">${REPEAT_BTNS}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
  el.querySelectorAll('[data-row] [data-act]').forEach(b => b.addEventListener('click', async () => {
    const d = data[+b.closest('[data-row]').dataset.row];
    if (await repeatAction(b.dataset.act, d.id, d.parent_id)) loadRepeatPhotos();
  }));
}

async function loadAdoptions(){
  const el = document.getElementById('adAdoptions');
  const { data, error } = await sb.rpc('kasa_adopted_spots');
  if (error){ el.innerHTML = `<div class="ad-empty">Could not load: ${esc(error.details || error.message)}</div>`; return; }
  if (!data?.length){ el.innerHTML = '<div class="ad-empty">No adopted spots.</div>'; return; }
  el.innerHTML = `
    <table class="ad-table">
      <thead><tr><th>Name</th><th>Where</th><th>Since</th><th>Open problems</th><th></th></tr></thead>
      <tbody>
        ${data.map((a, i) => `<tr>
          <td><strong>${esc(a.name)}</strong></td>
          <td><a href="kasa.html?at=${esc(a.lat)},${esc(a.lng)}" target="_blank" rel="noopener">${esc(a.ward_no ? 'Ward ' + a.ward_no : a.block_name || 'map')}</a></td>
          <td>${esc(new Date(a.since).toLocaleDateString('en-IN'))}</td>
          <td>${esc(a.open)}</td>
          <td><button class="ad-bad" data-adopt-rm="${i}">Remove</button></td></tr>`).join('')}
      </tbody>
    </table>`;
  el.querySelectorAll('[data-adopt-rm]').forEach(b => b.addEventListener('click', async () => {
    const a = data[+b.dataset.adoptRm];
    const reason = prompt(`Reason for removing "${a.name}":`);
    if (!reason || reason.trim().length < 3) return;
    const { error: e2 } = await sb.rpc('kasa_admin_remove_adoption', { p_id: a.id, p_reason: reason });
    if (e2){ alert('Failed: ' + (e2.details || e2.message)); return; }
    loadAdoptions();
  }));
}

/* The latest reports, newest first, so an admin can spot an exact repeat without hunting for its ID. */
async function loadLatest(){
  const el = document.getElementById('adLatest');
  const { data, error } = await sb.from('reports').select('id,created_at,category,ward_no,block_name,landmark,photo_url,moderation_status,is_duplicate')
    .order('created_at', { ascending: false }).limit(20);
  if (error){ el.innerHTML = `<div class="ad-empty">Could not load: ${esc(error.details || error.message)}</div>`; return; }
  if (!data?.length){ el.innerHTML = ''; return; }
  el.innerHTML = `<p class="ad-note" style="margin-top:1rem;">Latest reports</p>
    <table class="ad-table"><tbody>
      ${data.map((r, i) => `<tr data-latest="${i}">
        <td>${r.photo_url ? `<a href="${esc(r.photo_url)}" target="_blank" rel="noopener"><img src="${esc(r.photo_url)}" alt="" style="width:72px;height:72px;object-fit:cover;border-radius:4px;"></a>` : ''}</td>
        <td>${esc(r.category)} · ${esc(r.ward_no ? 'Ward ' + r.ward_no : (r.block_name || ''))} ${esc(r.landmark || '')}<br>
          <small>${esc(new Date(r.created_at).toLocaleString('en-IN'))} · ${esc(r.moderation_status)}${r.is_duplicate ? ' · repeat' : ''}</small></td>
        <td style="white-space:nowrap;">
          <button class="ad-ok" data-latest-act="open">Open</button>
          ${isSuper() ? '<button class="ad-bad" data-latest-act="delete">🗑 Delete</button>' : ''}
        </td></tr>`).join('')}
    </tbody></table>`;
  el.querySelectorAll('[data-latest-act]').forEach(b => b.addEventListener('click', async () => {
    const r = data[+b.closest('[data-latest]').dataset.latest];
    if (b.dataset.latestAct === 'open'){
      document.getElementById('adFindInput').value = r.id;
      findReport();
      document.getElementById('adFindResult').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      await moderate(r.id, 'delete');
    }
  }));
}

async function acceptClaim(id){
  const note = prompt('Why do the photos show it is cleaned? (shown publicly on the report, e.g. "same wall, garbage gone")');
  if (!note || note.trim().length < 3) return;
  const { error } = await sb.rpc('kasa_admin_accept_claim', { p_claim_id: id, p_note: note });
  if (error){ alert('Failed: ' + (error.details || error.message)); return; }
  loadAll();
}

async function addNote(reportId){
  const note = prompt('Note to add under this report (shown publicly on its history):');
  if (!note || note.trim().length < 3) return false;
  const { error } = await sb.rpc('kasa_admin_note', { p_report_id: String(reportId), p_note: note });
  if (error){ alert('Failed: ' + (error.details || error.message)); return false; }
  alert('Note added to the report\'s public history.');
  return true;
}

async function rejectClaim(id){
  const reason = prompt('Public reason for rejecting this cleanup claim (e.g. "photo is of a different street"):');
  if (!reason) return;
  const { error } = await sb.rpc('kasa_admin_reject_claim', { p_claim_id: id, p_reason: reason });
  if (error){ alert('Failed: ' + (error.details || error.message)); return; }
  loadAll();
}

async function voidVote(id){
  const reason = prompt('Public reason for voiding this confirmation/dispute:');
  if (!reason) return;
  const { error } = await sb.rpc('kasa_admin_void_vote', { p_vote_id: id, p_reason: reason });
  if (error){ alert('Failed: ' + (error.details || error.message)); return; }
  loadAll();
}

document.getElementById('adReplyForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('adReplyMsg');
  const raw = document.getElementById('adReplyReport').value.trim();
  let id = raw;
  try { id = new URL(raw).searchParams.get('report') || raw; } catch (_) {}
  const { error } = await sb.rpc('kasa_admin_post_reply', {
    p_report_id: id,
    p_name: document.getElementById('adReplyName').value,
    p_role: document.getElementById('adReplyRole').value,
    p_body: document.getElementById('adReplyBody').value,
    p_verified_note: document.getElementById('adReplyNote').value || null
  });
  msg.style.color = error ? 'var(--red)' : 'var(--green)';
  msg.textContent = error ? 'Failed: ' + (error.details || error.message) : 'Published on the report.';
  if (!error) e.target.reset();
});

async function loadAutomation(){
  const el = document.getElementById('adAutomation');
  try {
    const { data } = await sb.from('automation_log').select('*').order('ran_at', { ascending: false }).limit(20);
    if (!data?.length){ el.innerHTML = '<div class="ad-empty">No automation runs yet.</div>'; return; }
    el.innerHTML = `
      <table class="ad-table">
        <thead><tr><th>Job</th><th>Result</th><th>Ran at</th></tr></thead>
        <tbody>
          ${data.map(log => `
            <tr>
              <td class="amber">${esc(log.job_name)}</td>
              <td style="font-family:var(--mono);font-size:11px;color:var(--text-md);">${esc(JSON.stringify(log.result || {}))}</td>
              <td>${new Date(log.ran_at).toLocaleString('en-IN')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch(e){ el.innerHTML = '<div class="ad-empty">Could not load.</div>'; }
}

async function loadCommunities(){
  const el = document.getElementById('adCommunities');
  const { data, error } = await sb.rpc('kasa_admin_communities');
  if (error){ el.innerHTML = `<div class="ad-empty">Could not load: ${esc(error.details || error.message)}</div>`; return; }
  if (!data?.length){ el.innerHTML = '<div class="ad-empty">No groups registered yet.</div>'; return; }
  el.innerHTML = `
    <table class="ad-table">
      <thead><tr><th>Status</th><th>Group</th><th>Wards</th><th>What they do</th><th>Public contact</th><th>Coordinator (private)</th><th></th></tr></thead>
      <tbody>
        ${data.map(c => `<tr>
          <td>${esc(c.status)}</td><td><strong>${esc(c.name)}</strong><br><small>${esc(c.kind)} · ${esc(new Date(c.created_at).toLocaleDateString('en-IN'))}</small></td>
          <td>${esc((c.wards || []).join(', '))}</td><td style="white-space:pre-wrap;">${esc(c.description || '')}</td>
          <td>${esc(c.public_contact || '')}</td><td>${esc(c.coordinator_contact)}</td>
          <td style="white-space:nowrap;">
            ${c.status !== 'approved' ? `<button class="ad-ok" data-group="${esc(c.id)}" data-group-act="approve">✓ Approve</button>` : ''}
            ${c.status !== 'hidden' ? `<button class="ad-bad" data-group="${esc(c.id)}" data-group-act="hide">✕ Hide</button>` : ''}
          </td></tr>`).join('')}
      </tbody>
    </table>`;
  el.querySelectorAll('[data-group]').forEach(b => b.addEventListener('click', async () => {
    const note = b.dataset.groupAct === 'hide' ? prompt('Reason for hiding (kept private):') : null;
    if (b.dataset.groupAct === 'hide' && note === null) return;
    const { error: e2 } = await sb.rpc('kasa_admin_moderate_community', { p_id: b.dataset.group, p_action: b.dataset.groupAct, p_note: note });
    if (e2){ alert('Failed: ' + (e2.details || e2.message)); return; }
    loadCommunities();
  }));
}

const HOLD_TEXT = { other_block: 'filed from another block', far_from_school: "far from the school's location" };
async function loadSchoolChecks(){
  const el = document.getElementById('adSchoolChecks');
  const { data, error } = await sb.rpc('kasa_admin_school_audit_queue');
  if (error){ el.innerHTML = `<div class="ad-empty">Could not load: ${esc(error.details || error.message)}</div>`; return; }
  if (!data?.length){ el.innerHTML = '<div class="ad-empty">Nothing waiting.</div>'; return; }
  const yn = v => v == null ? '—' : v ? '✓' : '✗';
  el.innerHTML = `
    <table class="ad-table">
      <thead><tr><th>Photo</th><th>School</th><th>Why held</th><th>Water · Toilets · Wall · Power · MDM · Building</th><th></th></tr></thead>
      <tbody>
        ${data.map(a => `<tr>
          <td><a href="${esc(a.photo_url)}" target="_blank" rel="noopener"><img src="${esc(a.photo_url)}" alt="" style="width:72px;height:72px;object-fit:cover;border-radius:4px;"></a></td>
          <td><strong>${esc(a.school_name)}</strong><br><small>${esc(a.udise_code || '')} · filed in ${esc(a.block_name || '?')} · ${esc(new Date(a.created_at).toLocaleString('en-IN'))}</small></td>
          <td>${esc(HOLD_TEXT[a.hold] || (a.moderation_status === 'flagged' ? `flagged ${a.flags}×` : 'photo check'))}</td>
          <td>${[a.water_ok, a.toilets_ok, a.boundary_ok, a.electricity_ok, a.mdm_ok].map(yn).join(' · ')} · ${esc(a.building_condition)}</td>
          <td style="white-space:nowrap;">
            <button class="ad-ok" data-sa="${esc(a.id)}" data-sa-act="approve">✓ Approve</button>
            <button class="ad-bad" data-sa="${esc(a.id)}" data-sa-act="hide">✕ Hide</button>
          </td></tr>`).join('')}
      </tbody>
    </table>`;
  el.querySelectorAll('[data-sa]').forEach(b => b.addEventListener('click', async () => {
    const { error: e2 } = await sb.rpc('kasa_admin_moderate_school_audit', { p_audit_id: b.dataset.sa, p_action: b.dataset.saAct });
    if (e2){ alert('Failed: ' + (e2.details || e2.message)); return; }
    loadSchoolChecks();
  }));
}

async function loadSignups(){
  const el = document.getElementById('adSignups');
  const { data, error } = await sb.rpc('kasa_admin_signups', { p_limit: 200 });
  if (error){ el.innerHTML = `<div class="ad-empty">Could not load: ${esc(error.details || error.message)}</div>`; return; }
  if (!data?.length){ el.innerHTML = '<div class="ad-empty">No sign-ups yet.</div>'; return; }
  el.innerHTML = `
    <table class="ad-table">
      <thead><tr><th>When</th><th>Form</th><th>Name</th><th>Role</th><th>Location</th><th>Contact</th><th>Message</th><th>Emailed</th></tr></thead>
      <tbody>
        ${data.map(s => `<tr>
          <td>${esc(new Date(s.created_at).toLocaleString('en-IN'))}</td><td>${esc(s.kind)}</td><td>${esc(s.name || '')}</td>
          <td>${esc(s.role || '')}</td><td>${esc(s.location || '')}</td><td>${esc(s.contact)}</td>
          <td style="white-space:pre-wrap;">${esc(s.message || '')}</td>
          <td>${s.alerted_at ? '✓' : s.alert_error ? `<span title="${esc(s.alert_error)}" style="color:var(--red);">failed</span>` : 'pending'}</td></tr>`).join('')}
      </tbody>
    </table>`;
}

async function loadTeam(){
  const el = document.getElementById('adTeam');
  const { data, error } = await sb.rpc('kasa_admin_team');
  if (error){ el.innerHTML = `<div class="ad-empty">Could not load: ${esc(error.details || error.message)}</div>`; return; }
  el.innerHTML = `
    <table class="ad-table">
      <thead><tr><th>Email</th><th>Role</th><th>Since</th><th></th></tr></thead>
      <tbody>
        ${(data || []).map(m => `<tr><td>${esc(m.email)}${m.me ? ' (you)' : ''}</td><td>${esc(m.role)}</td>
          <td>${esc(new Date(m.since).toLocaleDateString('en-IN'))}</td>
          <td>${m.me ? '' : `<button class="ad-bad" data-team-remove="${esc(m.email)}">Remove</button>`}</td></tr>`).join('')}
      </tbody>
    </table>`;
  el.querySelectorAll('[data-team-remove]').forEach(b => b.addEventListener('click', () => {
    if (confirm('Remove ' + b.dataset.teamRemove + ' from the team?')) setRole(b.dataset.teamRemove, 'remove');
  }));
}

async function setRole(email, role){
  const { error } = await sb.rpc('kasa_admin_set_role', { p_email: email, p_role: role });
  if (error){ alert('Failed: ' + (error.details || error.message)); return; }
  loadTeam();
}

document.getElementById('adTeamForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const email = document.getElementById('adTeamEmail').value.trim();
  if (email) setRole(email, document.getElementById('adTeamRole').value);
});

function esc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}
