/* ══════════════════════════════════════════════════════════
   PURULIA KASA — Admin Analytics
   ══════════════════════════════════════════════════════════ */

const SUPABASE_URL = 'https://YOUR-PROJECT.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR-ANON-KEY';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
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
    loadResolutions(), loadAutomation()
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
      if (r.status !== 'open') return false;
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
      } else if (r.status === 'open'){
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

async function loadResolutions(){
  const el = document.getElementById('adResolutions');
  try {
    const { data } = await sb.from('pending_resolutions').select('*');
    if (!data?.length){
      el.innerHTML = '<div class="ad-empty">No pending resolutions. 🎉</div>';
      return;
    }
    el.innerHTML = data.map(r => `
      <div class="ad-card" style="margin-bottom:1rem;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:1rem;flex-wrap:wrap;gap:.6rem;">
          <div>
            <div class="ad-card-label">Ward ${r.ward_no} · ${esc(r.councillor_name || '—')}</div>
            <div style="font-family:var(--serif);font-size:1.05rem;color:var(--cream);margin-top:.3rem;">${esc(r.description || 'Garbage reported')}</div>
            <div style="font-family:var(--mono);font-size:11px;color:var(--text-lo);margin-top:.4rem;">
              Reported ${new Date(r.reported_at).toLocaleDateString('en-IN')} · Submitted ${new Date(r.resolution_submitted_at).toLocaleString('en-IN')}
            </div>
          </div>
          <div style="display:flex;gap:.5rem;flex-shrink:0;">
            <button class="ad-refresh" data-approve="${esc(r.id)}" style="background:var(--green);">✓ Approve</button>
            <button class="ad-refresh" data-reject="${esc(r.id)}" style="background:var(--red);">✕ Reject</button>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
          <div>
            <div style="font-family:var(--mono);font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:var(--red);margin-bottom:.5rem;">Before</div>
            <img src="${esc(r.original_photo)}" style="width:100%;height:200px;object-fit:cover;border-radius:4px;border:1px solid var(--border);" alt="">
          </div>
          <div>
            <div style="font-family:var(--mono);font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:var(--green);margin-bottom:.5rem;">After</div>
            <img src="${esc(r.cleanup_photo)}" style="width:100%;height:200px;object-fit:cover;border-radius:4px;border:1px solid var(--border);" alt="">
          </div>
        </div>
      </div>
    `).join('');

    el.querySelectorAll('[data-approve]').forEach(btn => {
      btn.addEventListener('click', () => handleApprove(btn.dataset.approve));
    });
    el.querySelectorAll('[data-reject]').forEach(btn => {
      btn.addEventListener('click', () => handleReject(btn.dataset.reject));
    });
  } catch(e){ el.innerHTML = '<div class="ad-empty">Could not load.</div>'; }
}

async function handleApprove(reportId){
  if (!confirm('Approve this cleanup?')) return;
  const { error } = await sb.rpc('approve_resolution', { p_report_id: reportId, p_reviewed_by: 'admin' });
  if (error){ alert('Failed: ' + error.message); return; }
  await loadResolutions();
  await loadOverview();
  await loadWards();
}

async function handleReject(reportId){
  const reason = prompt('Why rejected?');
  const { error } = await sb.rpc('reject_resolution', { p_report_id: reportId, p_reason: reason || null, p_reviewed_by: 'admin' });
  if (error){ alert('Failed: ' + error.message); return; }
  await loadResolutions();
}

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

function esc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}
