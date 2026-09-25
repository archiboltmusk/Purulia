/* ══════════════════════════════════════════════════════════
   PURULIA KASA — Admin Analytics
   ══════════════════════════════════════════════════════════ */

const SUPABASE_URL = (window.KASA_CONFIG && window.KASA_CONFIG.SUPABASE_URL) || '';
const SUPABASE_ANON_KEY = (window.KASA_CONFIG && window.KASA_CONFIG.SUPABASE_ANON_KEY) || '';

const TURNSTILE_SITE_KEY = (window.KASA_CONFIG && window.KASA_CONFIG.TURNSTILE_SITE_KEY) || '';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* When CAPTCHA protection is on in Supabase Auth, every sign-in needs a Turnstile token. */
let captchaToken = null;
if (TURNSTILE_SITE_KEY){
  const s = document.createElement('script');
  s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  s.onload = () => window.turnstile.render('#adCaptcha', {
    sitekey: TURNSTILE_SITE_KEY, theme: 'dark', action: 'kasa-admin',
    callback: (t) => { captchaToken = t; }, 'expired-callback': () => { captchaToken = null; }
  });
  document.head.appendChild(s);
}

document.getElementById('adLoginBtn').addEventListener('click', tryLogin);
document.getElementById('adPassword').addEventListener('keypress', (e) => { if (e.key === 'Enter') tryLogin(); });

async function tryLogin(){
  const email = document.getElementById('adEmail').value.trim();
  const password = document.getElementById('adPassword').value;
  if (!email || !password){
    document.getElementById('adError').textContent = 'Email and password required.';
    return;
  }
  const btn = document.getElementById('adLoginBtn');
  btn.disabled = true; btn.textContent = 'Signing in…';
  if (TURNSTILE_SITE_KEY && !captchaToken){
    document.getElementById('adError').textContent = 'Complete the human check first.';
    btn.disabled = false; btn.textContent = 'Continue →';
    return;
  }
  const { data, error } = await sb.auth.signInWithPassword({ email, password, options: captchaToken ? { captchaToken } : undefined });
  captchaToken = null;
  if (error && window.turnstile) window.turnstile.reset('#adCaptcha');
  if (error){
    document.getElementById('adError').textContent = error.message;
    btn.disabled = false; btn.textContent = 'Continue →';
    return;
  }
  const { data: adminRow } = await sb.from('admins').select('user_id').eq('user_id', data.user.id).single();
  if (!adminRow){
    await sb.auth.signOut();
    document.getElementById('adError').textContent = 'Not an admin account.';
    btn.disabled = false; btn.textContent = 'Continue →';
    return;
  }
  showDashboard();
}

document.getElementById('adSignout').addEventListener('click', async () => {
  await sb.auth.signOut();
  location.reload();
});

document.getElementById('adRefreshBtn').addEventListener('click', loadAll);

(async () => {
  const { data: { session } } = await sb.auth.getSession();
  if (session){
    const { data: adminRow } = await sb.from('admins').select('user_id').eq('user_id', session.user.id).single();
    if (adminRow) showDashboard();
  }
})();

function showDashboard(){
  document.getElementById('adLogin').classList.add('hidden');
  document.getElementById('adDash').classList.remove('hidden');
  loadAll();
}

async function loadAll(){
  document.getElementById('adTimestamp').textContent =
    'Updated ' + new Date().toLocaleString('en-IN', { dateStyle:'medium', timeStyle:'short' });
  await Promise.all([
    loadOverview(), loadDaily(), loadWards(), loadSla(),
    loadResolutions(), loadAutomation(), loadSignups(), loadCommunities()
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
  'illegal_construction', 'illegal_mining', 'illegal_other', 'other'];

async function loadResolutions(){
  const { data, error } = await sb.rpc('kasa_admin_queue');
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
          <div class="ad-item-title">${esc(r.category)} · Ward ${esc(r.ward_no ?? '?')} · ${esc(r.moderation_status === 'review' ? 'waiting for approval' : 'flagged by ' + r.flags)}</div>
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
          <button class="ad-bad" data-reject-claim="${esc(c.id)}">✕ Reject claim</button>
        </div>
      </div>
      <div class="ad-photos">
        <figure><img src="${esc(c.original_photo_url)}" alt="" loading="lazy"><figcaption>Before (report)</figcaption></figure>
        <figure><img src="${esc(c.photo_url)}" alt="" loading="lazy"><figcaption>Claim</figcaption></figure>
        ${(c.votes || []).map(v => `<figure${v.needs_review ? ' class="ad-held"' : ''}><img src="${esc(v.photo_url || '')}" alt="" loading="lazy">
          <figcaption>${v.vote === 'verify' ? '✓ confirm' : '✗ dispute'} · ${esc(v.distance_m)} m
            ${photoMetaText(v.photo_meta) ? '<br>' + esc(photoMetaText(v.photo_meta)) : ''}
            ${v.needs_review ? '<br><strong>⏸ held — not counted</strong> <button data-clear-vote="' + esc(v.id) + '">clear</button>' : ''}
            <button data-void="${esc(v.id)}">void</button></figcaption></figure>`).join('')}
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
  const reason = prompt(action === 'hide' ? 'Public reason for hiding this report:' : 'Optional public note:') ;
  if (action === 'hide' && !reason) return;
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
  const canDelete = r.moderation_status === 'flagged' || r.moderation_status === 'review';
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
          ${canDelete ? '<button class="ad-bad" data-find-mod="delete">🗑 Delete permanently</button>'
            : '<span class="ad-note" style="margin:0;">Only a flagged or held-for-review report can be deleted outright — hide this one instead.</span>'}
        </div>
      </div>
      ${r.photo_url ? `<div class="ad-photos"><figure><img src="${esc(r.photo_url)}" alt="" loading="lazy"><figcaption>Report photo</figcaption></figure></div>` : ''}
    </div>`;
  el.querySelectorAll('[data-find-mod]').forEach(b => b.addEventListener('click', async () => {
    await moderate(r.id, b.dataset.findMod);
    findReport();
  }));
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

function esc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}
