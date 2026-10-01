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

/* Team invite link: admin.html?invite=<token>&type=invite|recovery (made by kasa-team-invite).
   Sign in with the one-time token, then ask for a password before showing the dashboard. */
async function openInviteLink(){
  const q = new URLSearchParams(location.search);
  const token = q.get('invite');
  if (!token) return false;
  history.replaceState(null, '', location.pathname);
  const type = q.get('type') === 'recovery' ? 'recovery' : 'invite';
  const errEl = document.getElementById('adError');
  const { error } = await sb.auth.verifyOtp({ token_hash: token, type });
  if (error){
    errEl.textContent = 'This link has expired or was already used. Ask an admin to press Invite again.';
    return true;
  }
  document.getElementById('adLoginForm').classList.add('hidden');
  if (type === 'recovery') document.getElementById('adSetPwNote').textContent = 'Choose a new password.';
  document.getElementById('adSetPwForm').classList.remove('hidden');
  return true;
}

document.getElementById('adSetPwForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('adError');
  const password = document.getElementById('adNewPassword').value;
  if (password.length < 8){ errEl.textContent = 'Use 8 or more characters.'; return; }
  const btn = document.getElementById('adSetPwBtn');
  btn.disabled = true;
  const { error } = await sb.auth.updateUser({ password });
  btn.disabled = false;
  if (error){ errEl.textContent = error.message; return; }
  errEl.textContent = '';
  const { data: isAdmin } = await sb.rpc('kasa_is_admin');
  if (isAdmin) showDashboard();
  else errEl.textContent = 'Password saved, but this account is not on the team any more.';
});

(async () => {
  if (await openInviteLink()) return;
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
    loadResolutions(), loadLetters(), loadAutomation(), loadPromises(), loadDemands(), loadBugs(), loadCommunities(), loadSchoolChecks(), loadReportCards(), loadSchoolSuggestions(), loadOfficials(), loadDataFixes(), loadTranslations(), loadRepeatPhotos(), loadAdoptions(), loadFeedingSpots(), loadPlaces(), loadTownRequests(), loadLatest(),
    ...(isSuper() ? [loadSignups(), loadTeam()] : [])
  ]);
}

async function loadOverview(){
  const el = document.getElementById('adOverview');
  if (!el) return;
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
  if (!el) return;
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
  if (!el) return;
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
  if (!el) return;
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
  'illegal_construction', 'illegal_mining', 'illegal_other', 'other', 'dumpsite', 'toilet', 'hand_pump', 'anganwadi', 'health_centre', 'school', 'rural_jobs'];

/* Count tiles over the queue: waiting now, hidden, and this month's decisions (the same
   public counts analytics.html shows, so the team and the public see one set of numbers). */
async function loadModTiles(q){
  const el = document.getElementById('adModTiles');
  if (!el) return;
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
  if (!el) return;
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
  if (!el) return;
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
  if (!el) return;
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
  if (!el) return;
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

/* Visits and reports per place: Purulia, each town on the map, and each district that has had a visit or report. */
async function loadPlaces(){
  const el = document.getElementById('adPlaces');
  if (!el) return;
  const { data, error } = await sb.rpc('kasa_place_reaction');
  if (error){ el.innerHTML = `<div class="ad-empty">Could not load: ${esc(error.details || error.message)}</div>`; return; }
  if (!data?.length){ el.innerHTML = '<div class="ad-empty">No places yet.</div>'; return; }
  el.innerHTML = `
    <table class="ad-table">
      <thead><tr><th>Place</th><th>Visits 7d / 30d / all</th><th>Reports 7d / 30d / all</th><th>Counting since</th></tr></thead>
      <tbody>
        ${data.map(p => `<tr>
          <td><strong>${esc(p.name)}</strong></td>
          <td>${esc(p.visits_7d)} / ${esc(p.visits_30d)} / ${esc(p.visits)}</td>
          <td>${esc(p.reports_7d)} / ${esc(p.reports_30d)} / ${esc(p.reports)}</td>
          <td>${esc(p.first_visit || '—')}</td></tr>`).join('')}
      </tbody>
    </table>`;
}

/* A small outline of a sent-in ward map, so a moderator can see its shape without leaving the page. */
function wardsSvg(wards){
  const pts = wards.flatMap(w => w.polygons.flat(2));
  if (!pts.length) return '';
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const k = 180 / Math.max(x1 - x0, y1 - y0, 1e-6);
  const path = ring => ring.map((p, i) => `${i ? 'L' : 'M'}${((p[0] - x0) * k).toFixed(1)},${((y1 - p[1]) * k).toFixed(1)}`).join('') + 'Z';
  return `<svg width="190" height="190" viewBox="-5 -5 190 190" style="background:#0a0805;border-radius:6px">${wards.map(w => {
    const ring = w.polygons[0][0], cx = ring.reduce((a, p) => a + p[0], 0) / ring.length, cy = ring.reduce((a, p) => a + p[1], 0) / ring.length;
    return `<path d="${w.polygons.map(p => p.map(path).join('')).join('')}" fill="rgba(212,136,42,.15)" stroke="#d4882a" stroke-width="1"/>`
      + `<text x="${((cx - x0) * k).toFixed(1)}" y="${((y1 - cy) * k).toFixed(1)}" font-size="9" fill="#f0e6d0" text-anchor="middle">${esc(w.ward)}</text>`;
  }).join('')}</svg>`;
}

/* add-town.html link for a fix: a town slug, 'purulia', or 'area:<level>:<district>[:<block>[:<gp>]]'. */
function fixEditorHref(fix){
  if (!fix.startsWith('area:')) return 'add-town.html?fix=' + encodeURIComponent(fix);
  const [, level, district, block, gp] = fix.split(':');
  return 'add-town.html?' + new URLSearchParams({ fix: 'area', level, district, ...(block ? { block } : {}), ...(gp ? { gp } : {}) });
}

async function loadTownRequests(){
  const el = document.getElementById('adTownRequests');
  if (!el) return;
  const { data, error } = await sb.rpc('kasa_admin_place_submissions');
  if (error){ el.innerHTML = `<div class="ad-empty">Could not load: ${esc(error.details || error.message)}</div>`; return; }
  if (!data?.length){ el.innerHTML = '<div class="ad-empty">No town maps sent yet.</div>'; return; }
  el.innerHTML = `
    <table class="ad-table">
      <thead><tr><th>Status</th><th>Map</th><th>Town</th><th>In charge of cleaning</th><th>Map source</th><th></th></tr></thead>
      <tbody>
        ${data.map((s, i) => `<tr>
          <td>${esc(s.status)}${s.slug ? `<br><a href="kasa.html?place=${encodeURIComponent(s.slug)}" target="_blank" rel="noopener">${esc(s.slug)}</a>` : ''}${s.review_note ? `<br><small>${esc(s.review_note)}</small>` : ''}</td>
          <td>${s.ward_count ? wardsSvg(s.wards || []) + `<br><button class="ad-ok" data-town-dl="${i}">Download GeoJSON</button>` : '<small>Note only</small>'}</td>
          <td><strong>${esc(s.town)}</strong>${s.fix_of ? ` <small>(fix of ${esc(s.fix_of)}, <a href="${esc(fixEditorHref(s.fix_of))}" target="_blank" rel="noopener">open in editor</a>)</small>` : ''}<br>${esc(s.district)} district<br>${esc(s.body)}
            <br><small>${esc(s.ward_count)} wards: ${esc((s.wards || []).map(w => w.ward + (w.name ? ' ' + w.name : '')).join(', '))}</small>
            ${s.note ? `<br><strong>Note:</strong> ${esc(s.note)}` : ''}${s.pin ? `<br><small>Pinned: <a href="https://www.openstreetmap.org/?mlat=${esc(s.pin[1])}&mlon=${esc(s.pin[0])}#map=17/${esc(s.pin[1])}/${esc(s.pin[0])}" target="_blank" rel="noopener">${esc(s.pin[1])}, ${esc(s.pin[0])}</a></small>` : ''}
            ${(s.wards || []).filter(w => w.note).map(w => `<br><small>Ward ${esc(w.ward)}: ${esc(w.note)}</small>`).join('')}
            <br><small>${esc(new Date(s.created_at).toLocaleDateString('en-IN'))}${s.contact ? ' · ' + esc(s.contact) : ''}</small></td>
          <td>${esc(s.incharge || '—')}${s.incharge_source ? `<br><small>Found at: ${/^https:\/\//i.test(s.incharge_source) ? `<a href="${esc(s.incharge_source)}" target="_blank" rel="noopener nofollow">${esc(s.incharge_source)}</a>` : esc(s.incharge_source)}</small>` : ''}
            ${s.complaint_url ? `<br><small>Complaints: <a href="${esc(s.complaint_url)}" target="_blank" rel="noopener nofollow">${esc(s.complaint_url)}</a></small>` : ''}</td>
          <td>${s.drawn ? '<strong>Drawn</strong> (goes live as provisional)<br>' : ''}${/^https:\/\//i.test(s.map_source) ? `<a href="${esc(s.map_source)}" target="_blank" rel="noopener nofollow">${esc(s.map_source)}</a>` : esc(s.map_source)}</td>
          <td style="white-space:nowrap;">${s.status === 'pending' ? `
            <button class="ad-ok" data-town="${i}" data-town-act="approve">✓ Approve</button>
            <button class="ad-bad" data-town="${i}" data-town-act="reject">✕ Reject</button>` : ''}</td></tr>`).join('')}
      </tbody>
    </table>`;
  el.querySelectorAll('[data-town-dl]').forEach(b => b.addEventListener('click', () => {
    const s = data[+b.dataset.townDl];
    const fc = { type: 'FeatureCollection', features: s.wards.map(w => ({ type: 'Feature',
      properties: { ward: w.ward, ...(w.name ? { name: w.name } : {}), ...(w.note ? { note: w.note } : {}) },
      geometry: { type: 'MultiPolygon', coordinates: w.polygons } })) };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(fc)], { type: 'application/geo+json' }));
    a.download = `${s.fix_of || s.town.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${s.id}.geojson`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }));
  el.querySelectorAll('[data-town]').forEach(b => b.addEventListener('click', async () => {
    const s = data[+b.dataset.town], approve = b.dataset.townAct === 'approve';
    let slug = null;
    if (approve && !s.ward_count && !confirm('This fix is only a note. Approving marks it done and changes nothing on the map. Fix the border first (open in editor), then approve.')) return;
    if (approve && !s.fix_of){
      slug = prompt('Web name for the town (used in kasa.html?place=…):', s.town.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
      if (slug === null) return;
    }
    const note = approve ? null : prompt('Reason for rejecting (kept private):');
    if (!approve && note === null) return;
    const { error: e2 } = await sb.rpc('kasa_admin_review_place', { p_id: s.id, p_action: b.dataset.townAct, p_slug: slug, p_note: note });
    if (e2){ alert('Failed: ' + (e2.details || e2.message)); return; }
    loadTownRequests(); loadPlaces();
  }));
}

async function loadAdoptions(){
  const el = document.getElementById('adAdoptions');
  if (!el) return;
  const { data, error } = await sb.rpc('kasa_adopted_spots');
  if (error){ el.innerHTML = `<div class="ad-empty">Could not load: ${esc(error.details || error.message)}</div>`; return; }
  if (!data?.length){ el.innerHTML = '<div class="ad-empty">No adopted spots.</div>'; return; }
  el.innerHTML = `
    <table class="ad-table">
      <thead><tr><th>Looked after by</th><th>Where</th><th>Since</th><th>Open problems</th><th></th></tr></thead>
      <tbody>
        ${data.map((a, i) => `<tr>
          <td>${(a.partners || [a]).map((p, j) => `<strong>${esc(p.name)}</strong> ${esc(p.role || '')} <button class="ad-bad" data-adopt-rm="${i}:${j}">Remove</button>`).join('<br>')}
            ${a.office ? `<br>Ward office: ${esc(a.office.note)} (<a href="${esc(a.office.source_url)}" target="_blank" rel="noopener">source</a>)` : ''}</td>
          <td><a href="kasa.html?at=${esc(a.lat)},${esc(a.lng)}" target="_blank" rel="noopener">${esc(a.ward_no ? 'Ward ' + a.ward_no : a.block_name || 'map')}</a></td>
          <td>${esc(new Date(a.since).toLocaleDateString('en-IN'))}</td>
          <td>${esc(a.open)}</td>
          <td><button data-adopt-office="${i}">${a.office ? 'Change ward office' : 'Add ward office'}</button></td></tr>`).join('')}
      </tbody>
    </table>`;
  el.querySelectorAll('[data-adopt-rm]').forEach(b => b.addEventListener('click', async () => {
    const [i, j] = b.dataset.adoptRm.split(':').map(Number), a = (data[i].partners || [data[i]])[j];
    const reason = prompt(`Reason for removing "${a.name}":`);
    if (!reason || reason.trim().length < 3) return;
    const { error: e2 } = await sb.rpc('kasa_admin_remove_adoption', { p_id: a.id, p_reason: reason });
    if (e2){ alert('Failed: ' + (e2.details || e2.message)); return; }
    loadAdoptions();
  }));
  // What the ward office has committed at this spot (bins, daily pickup), only with a source link.
  el.querySelectorAll('[data-adopt-office]').forEach(b => b.addEventListener('click', async () => {
    const a = data[+b.dataset.adoptOffice];
    const note = prompt('What has the ward office committed at this spot? (e.g. "Two lidded bins, emptied every morning"). Leave empty to clear.', a.office?.note || '');
    if (note === null) return;
    const url = note.trim() ? prompt('https link to the letter, order or news report:', a.office?.source_url || '') : '';
    if (url === null) return;
    const { error: e2 } = await sb.rpc('kasa_admin_set_spot_office', { p_id: a.id, p_note: note, p_source_url: url });
    if (e2){ alert('Failed: ' + (e2.details || e2.message)); return; }
    loadAdoptions();
  }));
}

/* Dog feeding spots: waiting ones to approve or reject, approved ones to remove or mark as officially designated. */
async function loadFeedingSpots(){
  const el = document.getElementById('adFeeding');
  if (!el) return;
  const [q, pub] = await Promise.all([sb.rpc('kasa_admin_feeding_queue'), sb.rpc('kasa_feeding_spots')]);
  const error = q.error || pub.error;
  if (error){ el.innerHTML = `<div class="ad-empty">Could not load: ${esc(error.details || error.message)}</div>`; return; }
  const wait = q.data || [], live = pub.data || [];
  const where = f => esc([f.ward_no ? 'Ward ' + f.ward_no : f.block_name, f.district].filter(Boolean).join(', ') || 'map');
  el.innerHTML = (wait.length ? `
    <table class="ad-table">
      <thead><tr><th>Caregiver</th><th>Where</th><th>Nearest school</th><th></th></tr></thead>
      <tbody>
        ${wait.map(f => `<tr>
          <td><strong>${esc(f.name)}</strong><br><small>${esc(f.feed_time)} · ${esc(f.dogs)} dogs${f.helps_abc ? ' · helps with ABC' : ''} · sent ${esc(new Date(f.created_at).toLocaleString('en-IN'))}</small></td>
          <td><a href="https://www.openstreetmap.org/?mlat=${esc(f.lat)}&mlon=${esc(f.lng)}#map=18/${esc(f.lat)}/${esc(f.lng)}" target="_blank" rel="noopener">${where(f)}</a><br><small>GPS ±${esc(f.accuracy_m)} m</small></td>
          <td>${f.near_school ? `<span class="ad-bad">${esc(f.near_school_m)} m</span> ${esc(f.near_school)}` : '<small>none within 200 m</small>'}</td>
          <td style="white-space:nowrap;">
            <button class="ad-ok" data-fd="${esc(f.id)}" data-fd-act="approve">✓ Approve</button>
            <button class="ad-bad" data-fd="${esc(f.id)}" data-fd-act="reject">✕ Reject</button>
          </td></tr>`).join('')}
      </tbody>
    </table>` : '<div class="ad-empty">Nothing waiting.</div>') + (live.length ? `
    <p class="ad-note" style="margin-top:1rem;">On the public list</p>
    <table class="ad-table"><tbody>
      ${live.map((f, i) => `<tr>
        <td><strong>${esc(f.name)}</strong> <small>${esc(f.feed_time)}</small>${f.designated ? `<br>Designated: ${esc(f.designated.note)} (<a href="${esc(f.designated.source_url)}" target="_blank" rel="noopener">source</a>)` : ''}</td>
        <td><a href="kasa.html?at=${esc(f.lat)},${esc(f.lng)}" target="_blank" rel="noopener">${where(f)}</a></td>
        <td style="white-space:nowrap;"><button data-fd-desig="${i}">${f.designated ? 'Change designation' : 'Mark designated'}</button>
          <button class="ad-bad" data-fd-rm="${i}">Remove</button></td></tr>`).join('')}
    </tbody></table>` : '');
  el.querySelectorAll('[data-fd]').forEach(b => b.addEventListener('click', async () => {
    b.disabled = true;
    const { error: e2 } = await sb.rpc('kasa_admin_review_feeding_spot', { p_id: Number(b.dataset.fd), p_action: b.dataset.fdAct, p_note: null });
    if (e2){ alert('Failed: ' + (e2.details || e2.message)); b.disabled = false; return; }
    loadFeedingSpots();
  }));
  el.querySelectorAll('[data-fd-rm]').forEach(b => b.addEventListener('click', async () => {
    const f = live[+b.dataset.fdRm];
    const reason = prompt(`Reason for removing "${f.name}":`);
    if (!reason || reason.trim().length < 3) return;
    const { error: e2 } = await sb.rpc('kasa_admin_review_feeding_spot', { p_id: f.id, p_action: 'remove', p_note: reason });
    if (e2){ alert('Failed: ' + (e2.details || e2.message)); return; }
    loadFeedingSpots();
  }));
  el.querySelectorAll('[data-fd-desig]').forEach(b => b.addEventListener('click', async () => {
    const f = live[+b.dataset.fdDesig];
    const note = prompt('Who designated this spot? (e.g. "Ward 5 feeding spot, Purulia Municipality order 12/2026"). Leave empty to clear.', f.designated?.note || '');
    if (note === null) return;
    const url = note.trim() ? prompt('https link to the order, letter or minutes:', f.designated?.source_url || '') : '';
    if (url === null) return;
    const { error: e2 } = await sb.rpc('kasa_admin_set_feeding_designation', { p_id: f.id, p_note: note, p_source_url: url });
    if (e2){ alert('Failed: ' + (e2.details || e2.message)); return; }
    loadFeedingSpots();
  }));
}

/* The latest reports, newest first, so an admin can spot an exact repeat without hunting for its ID. */
async function loadLatest(){
  const el = document.getElementById('adLatest');
  if (!el) return;
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
  if (!el) return;
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

const PROMISE_STATUS = { promised: 'Promised', in_progress: 'In progress', delivered: 'Delivered', broken: 'Broken' };
const extLink = (u, label) => /^https?:\/\//i.test(u || '') ? `<a href="${esc(u)}" target="_blank" rel="noopener nofollow" class="amber">${esc(label)} ↗</a>` : '';

async function loadPromises(){
  const el = document.getElementById('adPromises');
  if (!el) return;
  const { data, error } = await sb.rpc('kasa_admin_promises');
  if (error){ el.innerHTML = `<div class="ad-empty">Could not load: ${esc(error.details || error.message)}</div>`; return; }
  const { pending = [], published = [], news = [] } = data || {};
  const row = (p, actions) => `<tr>
    <td><strong>${esc(p.who)}</strong><br><small>${esc([p.role, p.area].filter(Boolean).join(' · '))}</small></td>
    <td style="white-space:pre-wrap;">${esc(p.promise)}<br><small>Said ${esc(p.made_on)} · ${extLink(p.source_url, p.source_name || 'source')}${p.due_by ? ' · due ' + esc(p.due_by) : ''}</small>
      ${p.submitter_note ? `<br><small>Note: ${esc(p.submitter_note)}</small>` : ''}</td>
    <td>${p.update_of ? `<small>Update: ${esc(PROMISE_STATUS[p.target?.status] || '?')} →</small><br>` : ''}<strong>${esc(PROMISE_STATUS[p.status] || p.status)}</strong>
      ${p.status_source_url ? `<br><small>${esc(p.status_date || '')} · ${extLink(p.status_source_url, 'evidence')}</small>` : ''}
      ${p.status_note ? `<br><small>${esc(p.status_note)}</small>` : ''}</td>
    <td style="white-space:nowrap;">${actions(p)}</td></tr>`;
  el.innerHTML = `
    <h3 class="ad-note" style="margin-top:0;"><strong>Waiting (${pending.length})</strong></h3>
    ${pending.length ? `<table class="ad-table"><thead><tr><th>Who</th><th>Promise and source</th><th>Status</th><th></th></tr></thead><tbody>
      ${pending.map(p => row(p, x => `<button class="ad-ok" data-prom-pub="${esc(x.id)}">✓ Publish</button>
        <button class="ad-ok" data-prom-fix="${esc(x.id)}">✎ Fix &amp; publish</button>
        <button class="ad-bad" data-prom-rej="${esc(x.id)}">✕ Reject</button>`)).join('')}</tbody></table>` : '<div class="ad-empty">Nothing waiting.</div>'}
    <h3 class="ad-note"><strong>Published (${published.length})</strong></h3>
    ${published.length ? `<table class="ad-table"><thead><tr><th>Who</th><th>Promise and source</th><th>Status</th><th></th></tr></thead><tbody>
      ${published.map(p => row(p, x => `<button class="ad-ok" data-prom-status="${esc(x.id)}">Change status</button>
        <button class="ad-bad" data-prom-down="${esc(x.id)}">✕ Take down</button>`)).join('')}</tbody></table>` : '<div class="ad-empty">None yet.</div>'}
    <h3 class="ad-note"><strong>Latest headlines (automatic)</strong></h3>
    ${news.length ? `<table class="ad-table"><tbody>${news.map(n => `<tr${n.hidden ? ' style="opacity:.5;"' : ''}>
      <td>${extLink(n.url, n.title)}<br><small>${esc([n.source, n.published_at && new Date(n.published_at).toLocaleDateString('en-IN'), n.who].filter(Boolean).join(' · '))}</small></td>
      <td style="white-space:nowrap;"><button class="${n.hidden ? 'ad-ok' : 'ad-bad'}" data-news="${esc(n.id)}" data-news-hide="${n.hidden ? '0' : '1'}">${n.hidden ? '↺ Show' : '✕ Hide'}</button></td></tr>`).join('')}</tbody></table>`
      : '<div class="ad-empty">No headlines yet. The daily job adds them each morning.</div>'}`;

  const run = async (name, args) => {
    const { error: e2 } = await sb.rpc(name, args);
    if (e2){ alert('Failed: ' + (e2.details || e2.message)); return; }
    loadPromises();
  };
  const askStatus = (cur) => {
    const status = prompt('Status: promised, in_progress, delivered or broken', cur || 'delivered');
    if (status === null) return null;
    if (!PROMISE_STATUS[status.trim()]) { alert('Unknown status.'); return null; }
    if (status.trim() === 'promised') return { status: 'promised' };
    const url = prompt('Evidence link (https://…) showing this status:');
    if (!url) return null;
    const date = prompt('Date of the evidence (YYYY-MM-DD):', new Date().toISOString().slice(0, 10));
    if (!date) return null;
    const note = prompt('What the evidence shows (optional, public):') || undefined;
    return { status: status.trim(), status_source_url: url.trim(), status_date: date.trim(), status_note: note };
  };
  el.querySelectorAll('[data-prom-pub]').forEach(b => b.addEventListener('click', () =>
    run('kasa_admin_promise_review', { p_id: b.dataset.promPub, p_action: 'publish' })));
  el.querySelectorAll('[data-prom-fix]').forEach(b => b.addEventListener('click', () => {
    const p = pending.find(x => x.id === b.dataset.promFix);
    const edits = {};
    for (const [k, label] of [['who', 'Who'], ['role', 'Position'], ['promise', 'Promise'], ['made_on', 'Date said (YYYY-MM-DD)'], ['source_url', 'Source link']]) {
      const v = prompt(label + ':', p[k] || '');
      if (v === null) return;
      if (v.trim() && v.trim() !== (p[k] || '')) edits[k] = v.trim();
    }
    if (confirm('Change the status too?')) { const s = askStatus(p.status); if (!s) return; Object.assign(edits, s); }
    run('kasa_admin_promise_review', { p_id: p.id, p_action: 'publish', p_edits: edits });
  }));
  el.querySelectorAll('[data-prom-rej]').forEach(b => b.addEventListener('click', () => {
    const note = prompt('Reason for rejecting (kept private):');
    if (note === null) return;
    run('kasa_admin_promise_review', { p_id: b.dataset.promRej, p_action: 'reject', p_note: note });
  }));
  el.querySelectorAll('[data-prom-status]').forEach(b => b.addEventListener('click', () => {
    const p = published.find(x => x.id === b.dataset.promStatus);
    const s = askStatus(p.status);
    if (s) run('kasa_admin_promise_edit', { p_id: p.id, p_fields: s });
  }));
  el.querySelectorAll('[data-prom-down]').forEach(b => b.addEventListener('click', () => {
    if (confirm('Take this promise off the public page?')) run('kasa_admin_promise_edit', { p_id: b.dataset.promDown, p_fields: { review: 'rejected' } });
  }));
  el.querySelectorAll('[data-news]').forEach(b => b.addEventListener('click', () =>
    run('kasa_admin_promise_news_hide', { p_id: Number(b.dataset.news), p_hidden: b.dataset.newsHide === '1' })));
}

const DEMAND_ROLE = { chairman: 'Chairman', councillor: 'Councillor', mla: 'MLA', mp: 'MP', other: 'Other' };

async function loadDemands(){
  const el = document.getElementById('adDemands');
  if (!el) return;
  const { data, error } = await sb.rpc('kasa_admin_demands');
  if (error){ el.innerHTML = `<div class="ad-empty">Could not load: ${esc(error.details || error.message)}</div>`; return; }
  const { pending = [], replies = [], published = [], promises = [] } = data || {};
  const to = (d) => `<strong>${esc(DEMAND_ROLE[d.leader_role] || d.leader_role)} ${esc(d.leader_name)}</strong><br><small>${esc(d.leader_area || '')}</small>`;
  const body = (d) => `<strong>${esc(d.title)}</strong><br><span style="white-space:pre-wrap;">${esc(d.details)}</span>
    ${d.place ? `<br><small>Where: ${esc(d.place)}</small>` : ''}${d.submitter_note ? `<br><small>Note: ${esc(d.submitter_note)}</small>` : ''}`;
  el.innerHTML = `
    <h3 class="ad-note" style="margin-top:0;"><strong>Waiting (${pending.length})</strong></h3>
    ${pending.length ? `<table class="ad-table"><thead><tr><th>To</th><th>Demand</th><th></th></tr></thead><tbody>
      ${pending.map(d => `<tr><td>${to(d)}</td><td>${body(d)}</td><td style="white-space:nowrap;">
        <button class="ad-ok" data-dem-pub="${esc(d.id)}">✓ Publish</button>
        <button class="ad-ok" data-dem-fix="${esc(d.id)}">✎ Fix &amp; publish</button>
        <button class="ad-bad" data-dem-rej="${esc(d.id)}">✕ Reject</button></td></tr>`).join('')}</tbody></table>` : '<div class="ad-empty">Nothing waiting.</div>'}
    <h3 class="ad-note"><strong>Leaders' replies waiting (${replies.length})</strong></h3>
    ${replies.length ? `<table class="ad-table"><thead><tr><th>Demand</th><th>Reply and source</th><th></th></tr></thead><tbody>
      ${replies.map(r => `<tr><td><strong>${esc(r.leader_name)}</strong><br><small>${esc(r.demand_title)}</small></td>
        <td style="white-space:pre-wrap;">${esc(r.reply)}<br><small>Said ${esc(r.said_on)} · ${extLink(r.source_url, r.source_name || 'source')}</small></td>
        <td style="white-space:nowrap;"><button class="ad-ok" data-rep-pub="${esc(r.id)}">✓ Publish</button>
        <button class="ad-bad" data-rep-rej="${esc(r.id)}">✕ Reject</button></td></tr>`).join('')}</tbody></table>` : '<div class="ad-empty">Nothing waiting.</div>'}
    <h3 class="ad-note"><strong>Published (${published.length})</strong></h3>
    ${published.length ? `<table class="ad-table"><thead><tr><th>To</th><th>Demand</th><th></th></tr></thead><tbody>
      ${published.map(d => `<tr><td>${to(d)}</td><td>${body(d)}<br><small>+1: ${esc(d.supports)}${d.promise_id ? ' · linked to a promise' : ''}</small></td>
        <td style="white-space:nowrap;"><button class="ad-ok" data-dem-link="${esc(d.id)}">${d.promise_id ? 'Change promise link' : 'Link to promise'}</button>
        <button class="ad-bad" data-dem-down="${esc(d.id)}">✕ Take down</button></td></tr>`).join('')}</tbody></table>` : '<div class="ad-empty">None yet.</div>'}`;

  const run = async (name, args) => {
    const { error: e2 } = await sb.rpc(name, args);
    if (e2){ alert('Failed: ' + (e2.details || e2.message)); return; }
    loadDemands();
  };
  el.querySelectorAll('[data-dem-pub]').forEach(b => b.addEventListener('click', () =>
    run('kasa_admin_demand_review', { p_id: b.dataset.demPub, p_action: 'publish' })));
  el.querySelectorAll('[data-dem-fix]').forEach(b => b.addEventListener('click', () => {
    const d = pending.find(x => x.id === b.dataset.demFix);
    const edits = {};
    for (const [k, label] of [['leader_role', 'Role (chairman, councillor, mla, mp, other)'], ['leader_name', 'Leader'], ['leader_area', 'Seat or area'],
                              ['title', 'Title'], ['details', 'Why it helps everyone'], ['place', 'Where']]) {
      const v = prompt(label + ':', d[k] || '');
      if (v === null) return;
      if (v.trim() && v.trim() !== (d[k] || '')) edits[k] = v.trim();
    }
    run('kasa_admin_demand_review', { p_id: d.id, p_action: 'publish', p_edits: edits });
  }));
  el.querySelectorAll('[data-dem-rej]').forEach(b => b.addEventListener('click', () => {
    const note = prompt('Reason for rejecting (kept private):');
    if (note === null) return;
    run('kasa_admin_demand_review', { p_id: b.dataset.demRej, p_action: 'reject', p_note: note });
  }));
  el.querySelectorAll('[data-rep-pub]').forEach(b => b.addEventListener('click', () =>
    run('kasa_admin_demand_reply_review', { p_id: b.dataset.repPub, p_action: 'publish' })));
  el.querySelectorAll('[data-rep-rej]').forEach(b => b.addEventListener('click', () =>
    run('kasa_admin_demand_reply_review', { p_id: b.dataset.repRej, p_action: 'reject' })));
  el.querySelectorAll('[data-dem-link]').forEach(b => b.addEventListener('click', () => {
    if (!promises.length){ alert('No published promises yet. Add the promise on the Promises page first.'); return; }
    const list = promises.map((p, i) => `${i + 1}. ${p.who}: ${p.promise}`).join('\n');
    const pick = prompt(`Number of the promise this demand became (0 to unlink):\n\n${list}`);
    if (pick === null) return;
    const n = Number(pick);
    if (!Number.isInteger(n) || n < 0 || n > promises.length){ alert('Pick a number from the list.'); return; }
    run('kasa_admin_demand_edit', { p_id: b.dataset.demLink, p_promise: n ? promises[n - 1].id : null });
  }));
  el.querySelectorAll('[data-dem-down]').forEach(b => b.addEventListener('click', () => {
    if (confirm('Take this demand off the noticeboard?')) run('kasa_admin_demand_edit', { p_id: b.dataset.demDown, p_take_down: true });
  }));
}

async function loadBugs(){
  const el = document.getElementById('adBugs');
  if (!el) return;
  const { data, error } = await sb.rpc('kasa_admin_bugs');
  if (error){ el.innerHTML = `<div class="ad-empty">Could not load: ${esc(error.details || error.message)}</div>`; return; }
  const bugs = data || [];
  const dev = (d) => Object.entries(d || {}).map(([k, v]) => `${esc(k)}: ${esc(v)}`).join(' · ');
  el.innerHTML = `
    <h3 class="ad-note" style="margin-top:0;"><strong>Open (${bugs.length})</strong></h3>
    ${bugs.length ? `<table class="ad-table"><thead><tr><th>When and where</th><th>What went wrong</th><th></th></tr></thead><tbody>
      ${bugs.map(b => `<tr><td><small>${esc(new Date(b.created_at).toLocaleString())}</small><br>${b.page_url ? extLink(b.page_url, b.page_url.replace(/^https?:\/\/[^/]+\//, '/')) : ''}
          ${b.email ? `<br><small>Reply to: <a href="mailto:${esc(b.email)}" style="color:var(--amber);">${esc(b.email)}</a></small>` : ''}</td>
        <td><span style="white-space:pre-wrap;">${esc(b.what)}</span>
          <details><summary><small>Browser, device${b.errors && b.errors.length ? ` and ${b.errors.length} error${b.errors.length === 1 ? '' : 's'}` : ''}</small></summary>
          <small>${esc(b.user_agent || '')}<br>${dev(b.device)}</small>
          ${b.errors && b.errors.length ? `<pre style="white-space:pre-wrap;font-size:11px;margin:6px 0 0;">${b.errors.map(esc).join('\n')}</pre>` : ''}</details></td>
        <td style="white-space:nowrap;"><button class="ad-ok" data-bug-fixed="${esc(b.id)}">✓ Fixed</button>
        <button class="ad-bad" data-bug-dismiss="${esc(b.id)}">✕ Dismiss</button></td></tr>`).join('')}</tbody></table>` : '<div class="ad-empty">No open bugs.</div>'}`;
  const run = async (id, status) => {
    const { error: e2 } = await sb.rpc('kasa_admin_bug_close', { p_id: id, p_status: status });
    if (e2){ alert('Failed: ' + (e2.details || e2.message)); return; }
    loadBugs();
  };
  el.querySelectorAll('[data-bug-fixed]').forEach(b => b.addEventListener('click', () => run(b.dataset.bugFixed, 'fixed')));
  el.querySelectorAll('[data-bug-dismiss]').forEach(b => b.addEventListener('click', () => run(b.dataset.bugDismiss, 'dismissed')));
}

/* Letters to offices: a letter per office (the municipality for town wards, the BDO for a
   village block) listing its open reports. The kasa-office-letters function emails the same
   letter every Monday; this shows what went out and lets the admin copy a letter by hand. */
const SITE = 'https://archiboltmusk.github.io/Purulia/';
async function loadLetters(){
  const el = document.getElementById('adLetters');
  if (!el) return;
  loadLetterLog();
  const [rep, wardRes] = await Promise.all([
    sb.from('kasa_public_reports').select('id,created_at,ward_no,category,severity,status,landmark,sla_days,is_duplicate,area_kind,block_name,boundary_type').neq('status', 'resolved').limit(5000),
    sb.from('wards').select('ward_no,councillor_name')
  ]);
  if (rep.error){ el.innerHTML = `<div class="ad-empty">Could not load: ${esc(rep.error.message)}</div>`; return; }
  const city = window.KASA_CITY || {};
  const councillor = new Map((wardRes.data || []).map(w => [w.ward_no, w.councillor_name]));
  const now = Date.now(), age = r => Math.floor((now - Date.parse(r.created_at)) / 86400000);
  const offices = new Map();
  (rep.data || []).filter(r => !r.is_duplicate).forEach(r => {
    const town = r.ward_no != null;
    const key = town ? 'municipality' : 'bdo:' + (r.block_name || '?');
    if (!town && (!r.block_name || r.boundary_type === 'municipality')) return;  // Jhalda, Raghunathpur towns: not the BDO's
    if (!offices.has(key)) offices.set(key, town
      ? { title: 'Purulia Municipality', to: 'The Chairman, Purulia Municipality', email: city.municipalityEmail || '', page: SITE + 'municipality.html', list: [] }
      : { title: 'BDO, ' + r.block_name, to: 'The Block Development Officer, ' + r.block_name + ' Block, Purulia', email: '', page: SITE + 'ward.html?block=' + encodeURIComponent(r.block_name), list: [] });
    offices.get(key).list.push(r);
  });
  if (!offices.size){ el.innerHTML = '<div class="ad-empty">No open reports, so no letters.</div>'; return; }
  const line = r => {
    const where = r.ward_no != null ? `Ward ${r.ward_no}${councillor.get(r.ward_no) ? ' (Councillor ' + councillor.get(r.ward_no) + ')' : ''}` : r.block_name;
    const late = age(r) > (r.sla_days || 7) ? ', overdue' : '';
    return `- ${r.category}${r.landmark ? ' near ' + r.landmark : ''}, ${where}: open ${age(r)} days${late}. Photo and location: ${SITE}kasa.html?report=${r.id}`;
  };
  const letters = [...offices.values()].sort((a, b) => b.list.length - a.list.length).map(o => {
    o.list.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    const late = o.list.filter(r => age(r) > (r.sla_days || 7)).length;
    o.subject = `${o.list.length} open civic report${o.list.length === 1 ? '' : 's'} in your area${late ? `, ${late} overdue` : ''}`;
    o.body = `To ${o.to},\n\nResidents have reported the problems below on Parishkar Purulia. Each has a live-camera photo taken at the spot with GPS. They are still open.\n\n${o.list.map(line).join('\n')}\n\nWhen one is fixed, a resident photographs the fixed spot and it is marked resolved on the public record. If you would like to reply on the record, answer this email and we will publish your response next to the report.\n\nAll reports for your area: ${o.page}\n\nParishkar Purulia\n${SITE}`;
    return o;
  });
  el.innerHTML = letters.map((o, i) => `
    <details class="ad-card" style="margin-bottom:1rem;">
      <summary><strong>${esc(o.title)}</strong> · ${o.list.length} open${o.email ? '' : ' · <span style="color:var(--text-lo);">no public email on file</span>'}</summary>
      <p><small>Subject: ${esc(o.subject)}</small></p>
      <textarea readonly rows="12" style="width:100%;font-family:var(--mono);font-size:12px;" id="adLetter${i}">${esc(o.body)}</textarea>
      <p><button class="ad-ok" data-letter-copy="${i}">Copy text</button>
      ${o.email ? `<a class="ad-ok" style="text-decoration:none;" href="mailto:${esc(o.email)}?subject=${encodeURIComponent(o.subject)}&body=${encodeURIComponent(o.body)}">Open in my mail app</a>` : ''}</p>
    </details>`).join('');
  el.querySelectorAll('[data-letter-copy]').forEach(b => b.addEventListener('click', async () => {
    const t = document.getElementById('adLetter' + b.dataset.letterCopy);
    try { await navigator.clipboard.writeText(t.value); b.textContent = 'Copied'; }
    catch { t.select(); document.execCommand('copy'); b.textContent = 'Copied'; }
  }));
}

async function loadLetterLog(){
  const el = document.getElementById('adLetterLog');
  if (!el) return;
  const { data, error } = await sb.rpc('kasa_admin_office_letters');
  if (error){ el.innerHTML = `<div class="ad-empty">Could not load the send log: ${esc(error.details || error.message)}</div>`; return; }
  if (!data?.length){ el.innerHTML = '<div class="ad-empty">No letters emailed yet.</div>'; return; }
  el.innerHTML = `<table class="ad-table" style="margin-bottom:1rem;"><thead><tr><th>Week of</th><th>Office</th><th>Reports</th><th>Result</th></tr></thead><tbody>
    ${data.map(l => `<tr><td>${esc(l.week)}</td><td>${esc(l.office)}<br><small>${esc((l.emails || []).join(', '))}</small></td><td>${esc(l.reports)}</td>
      <td>${l.sent_at ? 'Sent ' + esc(new Date(l.sent_at).toLocaleString('en-IN')) : l.error ? '<span style="color:var(--red,#c44);">Failed: ' + esc(l.error) + '</span>' : 'Sending…'}</td></tr>`).join('')}
    </tbody></table>`;
}

async function loadCommunities(){
  const el = document.getElementById('adCommunities');
  if (!el) return;
  const { data, error } = await sb.rpc('kasa_admin_communities');
  if (error){ el.innerHTML = `<div class="ad-empty">Could not load: ${esc(error.details || error.message)}</div>`; return; }
  if (!data?.length){ el.innerHTML = '<div class="ad-empty">No communities registered yet.</div>'; return; }
  const dists = c => (c.districts?.length ? c.districts : ['purulia']).map(d => CM_DISTRICTS[d] || d);
  const where = c => c.all_district ? 'All of ' + dists(c).join(' + ')
    : [...(c.wards || []).map(w => 'Ward ' + w), ...(c.blocks || []).map(b => b + ' block'),
       ...dists(c).filter(d => d !== 'Purulia')].join(', ');
  const logo = c => /^data:image\/(jpeg|png|webp);base64,/.test(c.logo || '')
    ? `<img src="${esc(c.logo)}" alt="" style="width:56px;height:56px;object-fit:cover;border-radius:8px;">` : '—';
  const links = c => Object.entries(c.links || {}).map(([k, u]) => /^https:\/\//i.test(u)
      ? `<a href="${esc(u)}" target="_blank" rel="noopener nofollow">${esc(k)}</a>`
      : k === 'phone' || k === 'email' ? `${esc(k)}: ${esc(u)}` : '').filter(Boolean).join('<br>')
    || esc(c.public_contact || '');
  el.innerHTML = `
    <table class="ad-table">
      <thead><tr><th>Status</th><th>Logo</th><th>Community</th><th>Where</th><th>Links (open each to check)</th><th>Verification (private)</th><th></th></tr></thead>
      <tbody>
        ${data.map(c => `<tr>
          <td>${esc(c.status)}${c.review_note ? `<br><small>${esc(c.review_note)}</small>` : ''}</td><td>${logo(c)}</td>
          <td><strong>${esc(c.name)}</strong><br>${esc(c.tagline || '')}<br><small style="white-space:pre-wrap;">${esc(c.description || '')}</small>
            <br><small>${esc(new Date(c.created_at).toLocaleDateString('en-IN'))}</small></td>
          <td>${esc(where(c))}</td><td>${links(c)}</td>
          <td>${esc(c.coordinator_name || '')}<br>${/^[6-9][0-9]{9}$/.test(c.coordinator_contact || '')
            ? `<a href="tel:+91${esc(c.coordinator_contact)}">${esc(c.coordinator_contact)}</a>` : esc(c.coordinator_contact)}</td>
          <td style="white-space:nowrap;">
            <button data-group-edit="${esc(c.id)}">✎ Edit</button>
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
  el.querySelectorAll('[data-group-edit]').forEach(b => b.addEventListener('click', () => {
    const tr = b.closest('tr');
    if (tr.nextElementSibling?.classList.contains('cm-edit')) { tr.nextElementSibling.remove(); return; }
    const c = data.find(x => x.id === b.dataset.groupEdit);
    const row = document.createElement('tr');
    row.className = 'cm-edit';
    row.innerHTML = `<td colspan="7">${communityForm(c)}</td>`;
    tr.after(row);
    wireCommunityForm(row, c);
  }));
}

// Moderator edit for a volunteer community (kasa_admin_update_community).
const CM_DISTRICTS = { alipurduar: 'Alipurduar', bankura: 'Bankura', birbhum: 'Birbhum', 'cooch-behar': 'Cooch Behar',
  'dakshin-dinajpur': 'Dakshin Dinajpur', darjeeling: 'Darjeeling', hooghly: 'Hooghly', howrah: 'Howrah', jalpaiguri: 'Jalpaiguri',
  jhargram: 'Jhargram', kalimpong: 'Kalimpong', kolkata: 'Kolkata', malda: 'Malda', murshidabad: 'Murshidabad', nadia: 'Nadia',
  'north-24-parganas': 'North 24 Parganas', 'paschim-bardhaman': 'Paschim Bardhaman', 'paschim-medinipur': 'Paschim Medinipur',
  'purba-bardhaman': 'Purba Bardhaman', 'purba-medinipur': 'Purba Medinipur', purulia: 'Purulia',
  'south-24-parganas': 'South 24 Parganas', 'uttar-dinajpur': 'Uttar Dinajpur' };
const CM_BLOCKS = ['Arsha', 'Bagmundi', 'Balarampur', 'Barabazar', 'Bundwan', 'Hura', 'Jaipur', 'Jhalda I', 'Jhalda II', 'Kashipur',
  'Manbazar I', 'Manbazar II', 'Neturia', 'Para', 'Puncha', 'Purulia I', 'Purulia II', 'Raghunathpur I', 'Raghunathpur II', 'Santuri'];
const CM_LINKS = [['website', 'Website (https://…)'], ['instagram', 'Instagram'], ['facebook', 'Facebook'], ['x', 'X / Twitter'],
  ['youtube', 'YouTube'], ['whatsapp', 'WhatsApp group / wa.me link'], ['telegram', 'Telegram'], ['linkedin', 'LinkedIn'],
  ['phone', 'Public phone'], ['email', 'Public email']];
function communityForm(c){
  const ds = new Set(c.districts?.length ? c.districts : ['purulia']);
  const inp = (k, v, ph, type = 'text') => `<input data-f="${k}" type="${type}" value="${esc(v || '')}" placeholder="${esc(ph)}" style="width:100%;">`;
  return `<div style="display:grid;gap:.5rem;max-width:720px;">
    <label>Name ${inp('name', c.name, 'Community name')}</label>
    <label>One line ${inp('tagline', c.tagline, 'What they do')}</label>
    <label>About <textarea data-f="about" rows="3" style="width:100%;">${esc(c.description || '')}</textarea></label>
    <fieldset><legend>Districts</legend>${Object.entries(CM_DISTRICTS).map(([k, n]) =>
      `<label style="display:inline-block;margin-right:.6rem;"><input type="checkbox" data-dist="${k}"${ds.has(k) ? ' checked' : ''}> ${esc(n)}</label>`).join('')}
      <br><label><input type="checkbox" data-f="all"${c.all_district ? ' checked' : ''}> Works across the whole of every ticked district</label></fieldset>
    <fieldset data-areas><legend>Or Purulia wards / blocks</legend>
      <label>Wards (comma separated, 1–23) ${inp('wards', (c.wards || []).join(', '), 'e.g. 3, 5, 12')}</label>
      ${CM_BLOCKS.map(b => `<label style="display:inline-block;margin-right:.6rem;"><input type="checkbox" data-block="${esc(b)}"${(c.blocks || []).includes(b) ? ' checked' : ''}> ${esc(b)}</label>`).join('')}
    </fieldset>
    <fieldset><legend>Public links and contact</legend>${CM_LINKS.map(([k, l]) =>
      `<label>${esc(l)} ${inp('l_' + k, c.links?.[k], k === 'phone' ? '10-digit mobile or STD landline' : k === 'email' ? 'name@example.org' : 'https://…',
        k === 'phone' ? 'tel' : k === 'email' ? 'email' : 'url')}</label>`).join('')}</fieldset>
    <label>Replace logo <input data-f="logo" type="file" accept="image/*"></label>
    <fieldset><legend>Coordinator (private)</legend>
      <label>Name ${inp('cname', c.coordinator_name, 'Coordinator name')}</label>
      <label>Mobile ${inp('cphone', c.coordinator_contact, '10-digit mobile', 'tel')}</label></fieldset>
    <div><button class="ad-ok" data-save>Save changes</button> <span data-msg></span></div></div>`;
}
function wireCommunityForm(row, c){
  const f = k => row.querySelector(`[data-f="${k}"]`);
  const areas = row.querySelector('[data-areas]');
  const sync = () => { areas.hidden = f('all').checked; };
  f('all').addEventListener('change', sync); sync();
  let logo = null;
  f('logo').addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (!file) return;
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(img.naturalWidth, img.naturalHeight), cv = document.createElement('canvas');
      cv.width = cv.height = 256;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 256, 256);
      ctx.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, 256, 256);
      URL.revokeObjectURL(url);
      logo = cv.toDataURL('image/jpeg', 0.85);
    };
    img.src = url;
  });
  row.querySelector('[data-save]').addEventListener('click', async () => {
    const msg = row.querySelector('[data-msg]');
    const links = {};
    for (const [k] of CM_LINKS){
      let v = f('l_' + k).value.trim();
      if (!v) continue;
      if (k !== 'phone' && k !== 'email' && !/^https?:\/\//i.test(v)) v = 'https://' + v;
      links[k] = v.replace(/^http:/i, 'https:');
    }
    const all = f('all').checked;
    const { error } = await sb.rpc('kasa_admin_update_community', {
      p_id: c.id, p_name: f('name').value, p_tagline: f('tagline').value, p_about: f('about').value || null,
      p_all_district: all, p_districts: [...row.querySelectorAll('[data-dist]:checked')].map(i => i.dataset.dist),
      p_wards: all ? [] : f('wards').value.split(/[^0-9]+/).filter(Boolean).map(Number),
      p_blocks: all ? [] : [...row.querySelectorAll('[data-block]:checked')].map(i => i.dataset.block),
      p_links: links, p_logo: logo, p_contact_name: f('cname').value || null, p_contact_phone: f('cphone').value || null });
    if (error){ msg.textContent = 'Failed: ' + (error.details || error.message); return; }
    loadCommunities();
  });
}

const CARD_FIELDS = [['enrolment', 'Pupils'], ['teachers', 'Teachers'], ['classrooms', 'Classrooms'], ['drinking_water', 'Water'],
  ['girls_toilet', "Girls' toilet"], ['boys_toilet', "Boys' toilet"], ['electricity', 'Electricity'], ['boundary_wall', 'Wall'],
  ['handwash', 'Hand-wash'], ['library', 'Library'], ['playground', 'Playground'], ['ramp', 'Ramp']];
async function loadReportCards(){
  const el = document.getElementById('adReportCards');
  if (!el) return;
  const { data, error } = await sb.rpc('kasa_admin_report_card_queue');
  if (error){ el.innerHTML = `<div class="ad-empty">Could not load: ${esc(error.details || error.message)}</div>`; return; }
  if (!data?.length){ el.innerHTML = '<div class="ad-empty">Nothing waiting.</div>'; return; }
  const val = v => v === true ? '✓' : v === false ? '✗' : v == null ? '—' : esc(v);
  const figs = f => CARD_FIELDS.filter(([k]) => f && k in f).map(([k, l]) => `${esc(l)}: ${val(f[k])}`).join(' · ') || '—';
  el.innerHTML = `
    <table class="ad-table">
      <thead><tr><th>Card</th><th>School</th><th>Figures copied</th><th>Current record</th><th></th></tr></thead>
      <tbody>
        ${data.map(c => `<tr>
          <td><a href="${esc(c.photo_url)}" target="_blank" rel="noopener"><img src="${esc(c.photo_url)}" alt="" style="width:96px;height:96px;object-fit:cover;border-radius:4px;"></a></td>
          <td><strong>${esc(c.school_name)}</strong><br><small>${esc(c.udise_code)} · ${esc(c.block_name || '')} · sent ${esc(new Date(c.created_at).toLocaleString('en-IN'))}</small></td>
          <td><strong>${esc(c.year)}</strong><br>${figs(c.figures)}</td>
          <td>${c.current ? `<strong>${esc(c.current_year || '')}</strong><br>${figs(c.current)}` : '—'}</td>
          <td style="white-space:nowrap;">
            <button class="ad-ok" data-card="${esc(c.id)}" data-card-act="approve">✓ Matches the picture</button>
            <button class="ad-bad" data-card="${esc(c.id)}" data-card-act="reject">✕ Reject</button>
          </td></tr>`).join('')}
      </tbody>
    </table>`;
  el.querySelectorAll('[data-card]').forEach(b => b.addEventListener('click', async () => {
    b.disabled = true;
    const { error: e2 } = await sb.rpc('kasa_admin_moderate_report_card', { p_id: b.dataset.card, p_action: b.dataset.cardAct });
    if (e2){ alert('Failed: ' + (e2.details || e2.message)); b.disabled = false; return; }
    loadReportCards();
  }));
}

const OFFICIAL_ROLE = { pradhan: 'Pradhan', sabhapati: 'Sabhapati', sabhadhipati: 'Sabhadhipati', bdo: 'BDO', dm: 'District Magistrate', zp: 'Zilla Parishad officer (ADM)' };
async function loadOfficials(){
  const el = document.getElementById('adOfficials');
  if (!el) return;
  const { data, error } = await sb.rpc('kasa_admin_official_queue');
  if (error){ el.innerHTML = `<div class="ad-empty">Could not load: ${esc(error.details || error.message)}</div>`; return; }
  if (!data?.length){ el.innerHTML = '<div class="ad-empty">Nothing waiting.</div>'; return; }
  el.innerHTML = `
    <table class="ad-table">
      <thead><tr><th>Post and place</th><th>Name</th><th>Source</th><th></th></tr></thead>
      <tbody>
        ${data.map(o => `<tr>
          <td>${esc(OFFICIAL_ROLE[o.role] || o.role)}<br><small>${esc([o.gp, o.block, o.district].filter(Boolean).join(', '))}${o.lat != null ? ` · <a href="https://www.openstreetmap.org/?mlat=${o.lat}&mlon=${o.lng}#map=13/${o.lat}/${o.lng}" target="_blank" rel="noopener">map</a>` : ''} · sent ${esc(new Date(o.created_at).toLocaleString('en-IN'))}</small></td>
          <td><input class="ad-input" data-of-name="${esc(o.id)}" value="${esc(o.name)}" style="width:100%;">${o.phone ? `<br><small>${esc(o.phone)}</small>` : ''}</td>
          <td><a href="${esc(o.source_url)}" target="_blank" rel="noopener noreferrer">${esc(o.source_url.replace(/^https?:\/\//, '').slice(0, 60))}</a></td>
          <td style="white-space:nowrap;">
            <button class="ad-ok" data-of="${esc(o.id)}" data-of-act="approve">✓ Name is at the link</button>
            <button class="ad-bad" data-of="${esc(o.id)}" data-of-act="reject">✕ Reject</button>
          </td></tr>`).join('')}
      </tbody>
    </table>`;
  el.querySelectorAll('[data-of]').forEach(b => b.addEventListener('click', async () => {
    const id = b.dataset.of;
    b.disabled = true;
    const { error: e2 } = await sb.rpc('kasa_admin_review_official', { p_id: Number(id), p_action: b.dataset.ofAct,
      p_name: el.querySelector(`[data-of-name="${id}"]`).value, p_note: null });
    if (e2){ alert('Failed: ' + (e2.details || e2.message)); b.disabled = false; return; }
    loadOfficials();
  }));
}

async function loadDataFixes(){
  const el = document.getElementById('adDataFixes');
  if (!el) return;
  const { data, error } = await sb.rpc('kasa_admin_data_fix_queue');
  if (error){ el.innerHTML = `<div class="ad-empty">Could not load: ${esc(error.details || error.message)}</div>`; return; }
  if (!data?.length){ el.innerHTML = '<div class="ad-empty">Nothing waiting.</div>'; return; }
  const link = (u, n) => /^https?:\/\//i.test(u || '') ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(n || u.replace(/^https?:\/\//, '').slice(0, 60))}</a>` : '';
  el.innerHTML = `
    <table class="ad-table">
      <thead><tr><th>Figure</th><th>What is right</th><th>Source</th><th></th></tr></thead>
      <tbody>
        ${data.map(c => `<tr>
          <td>${esc(c.what)}<br><small>${link(c.page, (c.page || '').split('/').pop().split('#')[0] || 'page')} · sent ${esc(new Date(c.created_at).toLocaleString('en-IN'))}</small></td>
          <td>${esc(c.correction)}${c.note ? `<br><small>How they know: ${esc(c.note)}</small>` : ''}${c.email ? `<br><small><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></small>` : ''}</td>
          <td>${link(c.source_url) || '<small>No link</small>'}</td>
          <td style="white-space:nowrap;">
            <button class="ad-ok" data-df="${esc(c.id)}" data-df-act="fixed">✓ Page fixed</button>
            <button class="ad-bad" data-df="${esc(c.id)}" data-df-act="reject">✕ Reject</button>
          </td></tr>`).join('')}
      </tbody>
    </table>`;
  el.querySelectorAll('[data-df]').forEach(b => b.addEventListener('click', async () => {
    b.disabled = true;
    const { error: e2 } = await sb.rpc('kasa_admin_review_data_fix', { p_id: Number(b.dataset.df), p_action: b.dataset.dfAct });
    if (e2){ alert('Failed: ' + (e2.details || e2.message)); b.disabled = false; return; }
    loadDataFixes();
  }));
}

async function loadTranslations(){
  const el = document.getElementById('adTranslations');
  if (!el) return;
  const { data, error } = await sb.rpc('kasa_admin_translation_queue');
  if (error){ el.innerHTML = `<div class="ad-empty">Could not load: ${esc(error.details || error.message)}</div>`; return; }
  if (!data?.length){ el.innerHTML = '<div class="ad-empty">Nothing waiting.</div>'; return; }
  const en = (s) => s.ns === 'kasa' ? (window.KASA_I18N?.en?.[s.key] || '') : '';
  const toks = (s) => (String(s).match(/\{\w+\}|\[\[\d+\|/g) || []).sort().join(' ');
  el.innerHTML = `
    <table class="ad-table">
      <thead><tr><th>Line</th><th>On the site now</th><th>Suggested (edit before approving)</th><th></th></tr></thead>
      <tbody>
        ${data.map(s => `<tr>
          <td><small>${esc(s.ns)} · ${esc(s.key)}${s.page ? ` · <a href="${esc(s.page)}" target="_blank" rel="noopener">page</a>` : ''}<br>sent ${esc(new Date(s.created_at).toLocaleString('en-IN'))}</small>${en(s) ? `<br><small lang="en">EN: ${esc(en(s))}</small>` : ''}</td>
          <td lang="bn">${esc(s.current)}</td>
          <td><textarea class="ad-input" data-tr-text="${esc(s.id)}" lang="bn" rows="3" style="width:100%;">${esc(s.suggested)}</textarea>${s.note ? `<br><small>Why: ${esc(s.note)}</small>` : ''}${toks(s.suggested) !== toks(s.current) ? '<br><small style="color:#b3261e">{…} or [[n|…]] parts differ from the current line</small>' : ''}</td>
          <td style="white-space:nowrap;">
            <button class="ad-ok" data-tr="${esc(s.id)}" data-tr-act="approve">✓ Use it</button>
            <button class="ad-bad" data-tr="${esc(s.id)}" data-tr-act="reject">✕ Reject</button>
          </td></tr>`).join('')}
      </tbody>
    </table>`;
  el.querySelectorAll('[data-tr]').forEach(b => b.addEventListener('click', async () => {
    const id = b.dataset.tr;
    b.disabled = true;
    const { error: e2 } = await sb.rpc('kasa_admin_review_translation', { p_id: Number(id), p_action: b.dataset.trAct,
      p_text: el.querySelector(`[data-tr-text="${id}"]`).value });
    if (e2){ alert('Failed: ' + (e2.details || e2.message)); b.disabled = false; return; }
    loadTranslations();
  }));
}

async function loadSchoolSuggestions(){
  const el = document.getElementById('adSchoolSuggestions');
  if (!el) return;
  const { data, error } = await sb.rpc('kasa_admin_school_suggestion_queue');
  if (error){ el.innerHTML = `<div class="ad-empty">Could not load: ${esc(error.details || error.message)}</div>`; return; }
  if (!data?.length){ el.innerHTML = '<div class="ad-empty">Nothing waiting.</div>'; return; }
  el.innerHTML = `
    <table class="ad-table">
      <thead><tr><th>Photo</th><th>School</th><th>Already listed nearby</th><th>UDISE code</th><th></th></tr></thead>
      <tbody>
        ${data.map(g => `<tr>
          <td><a href="${esc(g.photo_url)}" target="_blank" rel="noopener"><img src="${esc(g.photo_url)}" alt="" style="width:96px;height:96px;object-fit:cover;border-radius:4px;"></a></td>
          <td><input class="ad-input" data-sg-name="${esc(g.id)}" value="${esc(g.name)}" style="width:100%;"><br>
            <small>${esc([g.village, g.block_name].filter(Boolean).join(', '))} · <a href="https://www.openstreetmap.org/?mlat=${g.lat}&mlon=${g.lng}#map=18/${g.lat}/${g.lng}" target="_blank" rel="noopener">map (±${Math.round(g.accuracy || 0)} m)</a> · sent ${esc(new Date(g.created_at).toLocaleString('en-IN'))}</small></td>
          <td>${g.nearby.length ? g.nearby.map(s => `${esc(s.name)} <small>${esc(s.udise_code)}</small>`).join('<br>') : '—'}</td>
          <td><input class="ad-input" data-sg-code="${esc(g.id)}" value="${esc(g.udise_hint || '')}" inputmode="numeric" maxlength="11" placeholder="11 digits" style="width:9em;">
            <br><a href="https://kys.udiseplus.gov.in/" target="_blank" rel="noopener"><small>Find on Know Your School</small></a></td>
          <td style="white-space:nowrap;">
            <button class="ad-ok" data-sg="${esc(g.id)}" data-sg-act="approve">✓ Add to the list</button>
            <button class="ad-bad" data-sg="${esc(g.id)}" data-sg-act="reject">✕ Reject</button>
          </td></tr>`).join('')}
      </tbody>
    </table>`;
  el.querySelectorAll('[data-sg]').forEach(b => b.addEventListener('click', async () => {
    const id = b.dataset.sg, approve = b.dataset.sgAct === 'approve';
    const code = el.querySelector(`[data-sg-code="${id}"]`).value.trim();
    if (approve && !/^\d{11}$/.test(code)){ alert('Enter the 11-digit UDISE code first.'); return; }
    b.disabled = true;
    const { error: e2 } = await sb.rpc('kasa_admin_moderate_school_suggestion', {
      p_id: id, p_action: b.dataset.sgAct, p_udise_code: approve ? code : null,
      p_name: approve ? el.querySelector(`[data-sg-name="${id}"]`).value : null });
    if (e2){ alert('Failed: ' + (e2.details || e2.message)); b.disabled = false; return; }
    loadSchoolSuggestions();
  }));
}

const HOLD_TEXT = { other_block: 'filed from another block', far_from_school: "far from the school's location" };
async function loadSchoolChecks(){
  const el = document.getElementById('adSchoolChecks');
  if (!el) return;
  const { data, error } = await sb.rpc('kasa_admin_school_audit_queue');
  if (error){ el.innerHTML = `<div class="ad-empty">Could not load: ${esc(error.details || error.message)}</div>`; return; }
  if (!data?.length){ el.innerHTML = '<div class="ad-empty">Nothing waiting.</div>'; return; }
  const yn = v => v == null ? '—' : v ? '✓' : '✗';
  el.innerHTML = `
    <table class="ad-table">
      <thead><tr><th>Photo</th><th>School</th><th>Why held</th><th>Water · Toilets · Wall · Power · MDM kitchen · Girls' toilet · Meal today · Building · Teachers seen</th><th></th></tr></thead>
      <tbody>
        ${data.map(a => `<tr>
          <td><a href="${esc(a.photo_url)}" target="_blank" rel="noopener"><img src="${esc(a.photo_url)}" alt="" style="width:72px;height:72px;object-fit:cover;border-radius:4px;"></a></td>
          <td><strong>${esc(a.school_name)}</strong><br><small>${esc(a.udise_code || '')} · filed in ${esc(a.block_name || '?')} · ${esc(new Date(a.created_at).toLocaleString('en-IN'))}</small></td>
          <td>${esc(HOLD_TEXT[a.hold] || (a.moderation_status === 'flagged' ? `flagged ${a.flags}×` : 'photo check'))}</td>
          <td>${[a.water_ok, a.toilets_ok, a.boundary_ok, a.electricity_ok, a.mdm_ok, a.girls_toilet_ok, a.meal_today_ok].map(yn).join(' · ')} · ${esc(a.building_condition)} · ${a.teachers_seen ?? '—'}</td>
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
  if (!el) return;
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
  if (!el) return;
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

// Makes the account if needed, adds it to the team, and shows a one-time link to send them.
async function invite(email, role){
  const box = document.getElementById('adInvite');
  box.hidden = false;
  box.textContent = 'Making a link…';
  const { data, error } = await sb.functions.invoke('kasa-team-invite', { body: { email, role } });
  if (error || !data?.token){
    let msg = error?.message || 'unknown error';
    try { msg = (await error.context.json()).error || msg; } catch (_) {}
    box.textContent = 'Could not invite: ' + msg;
    return;
  }
  const link = location.origin + location.pathname + '?invite=' + encodeURIComponent(data.token) + '&type=' + data.type;
  const text = (data.existing
    ? 'Parishkar Purulia: use this link to set a new password for the admin page. It works once: '
    : 'You are invited to the Parishkar Purulia moderation team. Open this link and choose a password. It works once: ') + link;
  box.innerHTML = `${data.existing ? esc(email) + ' already has an account, so this is a password-reset link.' : 'Send this to ' + esc(email) + '.'}
    It works once and expires after a while; press Invite again for a fresh one.<br>
    <input class="ad-input" readonly value="${esc(link)}" aria-label="Invite link">
    <a class="ad-ok" href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">Send on WhatsApp</a>
    <button class="ad-ok" type="button" id="adInviteCopy">Copy</button>`;
  document.getElementById('adInviteCopy').addEventListener('click', (e) => {
    navigator.clipboard.writeText(text).then(() => { e.target.textContent = 'Copied'; }, () => box.querySelector('input').select());
  });
  loadTeam();
}

document.getElementById('adTeamForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const email = document.getElementById('adTeamEmail').value.trim();
  if (email) invite(email, document.getElementById('adTeamRole').value);
});

function esc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}
