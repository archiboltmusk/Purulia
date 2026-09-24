/* ══════════════════════════════════════════════════════════
   PURULIA KASA — Admin Analytics
   ══════════════════════════════════════════════════════════ */

/* ── CONFIG — REPLACE THESE ── */
const SUPABASE_URL = 'https://YOUR-PROJECT.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR-ANON-KEY';
const ADMIN_PASSWORD = 'purulia-kasa-2026';   /* ← Change this to something only you know */

/* ── Client ── */
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ── Login ── */
document.getElementById('adLoginBtn').addEventListener('click', tryLogin);
document.getElementById('adPassword').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') tryLogin();
});

function tryLogin(){
  const input = document.getElementById('adPassword').value;
  if (input === ADMIN_PASSWORD){
    sessionStorage.setItem('kasa_admin_authed', '1');
    showDashboard();
  } else {
    document.getElementById('adError').textContent = 'Wrong password. Try again.';
    document.getElementById('adPassword').value = '';
  }
}

/* Auto-auth within session */
if (sessionStorage.getItem('kasa_admin_authed') === '1'){
  showDashboard();
}

function showDashboard(){
  document.getElementById('adLogin').classList.add('hidden');
  document.getElementById('adDash').classList.remove('hidden');
  loadAll();
}

/* ── Refresh ── */
document.getElementById('adRefreshBtn').addEventListener('click', loadAll);

/* ── Load everything ── */
async function loadAll(){
  document.getElementById('adTimestamp').textContent =
    'Updated ' + new Date().toLocaleString('en-IN', { dateStyle:'medium', timeStyle:'short' });
  await Promise.all([
    loadOverview(),
    loadDaily(),
    loadWards(),
    loadSla(),
    loadSeverity(),
    loadModeration(),
    loadReporters(),
    loadDuplicates()
  ]);
}

/* ── 1. Overview cards ── */
async function loadOverview(){
  const el = document.getElementById('adOverview');
  try {
    const { data: all } = await sb.from('reports').select('*').neq('moderation_status','rejected');
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
      <div class="ad-card">
        <div class="ad-card-label">Total reports</div>
        <div class="ad-card-value">${total}</div>
        <div class="ad-card-sub">${last24} in last 24h</div>
      </div>
      <div class="ad-card">
        <div class="ad-card-label">Open</div>
        <div class="ad-card-value">${open}</div>
        <div class="ad-card-sub">${overdue} overdue</div>
      </div>
      <div class="ad-card">
        <div class="ad-card-label">Resolved</div>
        <div class="ad-card-value">${resolved}</div>
        <div class="ad-card-sub">${total ? Math.round(resolved/total*100) : 0}% rate</div>
      </div>
      <div class="ad-card">
        <div class="ad-card-label">Wards active</div>
        <div class="ad-card-value">${wardsActive}<span style="font-size:1rem;color:var(--text-lo);"> / 23</span></div>
        <div class="ad-card-sub">${wardsActive < 23 ? (23 - wardsActive) + ' silent' : 'All covered'}</div>
      </div>
    `;
  } catch(e){
    el.innerHTML = '<div class="ad-empty">Could not load overview.</div>';
    console.error(e);
  }
}

/* ── 2. Daily activity bars ── */
async function loadDaily(){
  const el = document.getElementById('adDaily');
  try {
    const { data } = await sb.from('analytics_daily').select('*').limit(14);
    if (!data?.length){
      el.innerHTML = '<div class="ad-empty">No reports in the last 90 days.</div>';
      return;
    }
    const sorted = [...data].reverse();
    const max = Math.max(...sorted.map(d => d.total), 1);
    el.innerHTML = sorted.map(d => `
      <div class="ad-bar-row">
        <div class="ad-bar-label">${new Date(d.day).toLocaleDateString('en-IN', { day:'numeric', month:'short' })}</div>
        <div class="ad-bar-track"><div class="ad-bar-fill" style="width:${(d.total/max*100).toFixed(1)}%"></div></div>
        <div class="ad-bar-value">${d.total}</div>
      </div>
    `).join('');
  } catch(e){
    el.innerHTML = '<div class="ad-empty">Could not load daily activity.</div>';
    console.error(e);
  }
}

/* ── 3. Ward performance table ── */
async function loadWards(){
  const el = document.getElementById('adWards');
  try {
    const { data } = await sb.from('analytics_wards').select('*');
    if (!data?.length){
      el.innerHTML = '<div class="ad-empty">No ward data yet.</div>';
      return;
    }
    const rows = data
      .filter(w => w.total > 0)
      .sort((a, b) => b.open - a.open);

    if (!rows.length){
      el.innerHTML = '<div class="ad-empty">No reports filed yet.</div>';
      return;
    }

    el.innerHTML = `
      <table class="ad-table">
        <thead>
          <tr>
            <th>Ward</th>
            <th>Councillor</th>
            <th class="num">Open</th>
            <th class="num">Resolved</th>
            <th class="num">Resolution</th>
            <th class="num">Avg days</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(w => `
            <tr>
              <td class="amber">Ward ${w.ward_no}</td>
              <td>${esc(w.councillor_name || '—')} <span style="color:var(--text-lo);">· ${esc(w.party || '—')}</span></td>
              <td class="num ${w.open > 5 ? 'red' : ''}">${w.open}</td>
              <td class="num green">${w.resolved}</td>
              <td class="num">${w.resolution_pct || 0}%</td>
              <td class="num">${w.avg_resolution_days || '—'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch(e){
    el.innerHTML = '<div class="ad-empty">Could not load ward data.</div>';
    console.error(e);
  }
}

/* ── 4. SLA compliance ── */
async function loadSla(){
  const el = document.getElementById('adSla');
  try {
    const { data } = await sb.from('analytics_sla').select('*').single();
    if (!data){
      el.innerHTML = '<div class="ad-empty">No SLA data yet.</div>';
      return;
    }
    const totalResolved = (data.resolved_in_sla || 0) + (data.resolved_late || 0);
    const onTimePct = totalResolved
      ? Math.round((data.resolved_in_sla / totalResolved) * 100)
      : 0;

    el.innerHTML = `
      <div class="ad-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:0;">
        <div class="ad-card">
          <div class="ad-card-label">Resolved in SLA</div>
          <div class="ad-card-value green">${data.resolved_in_sla || 0}</div>
          <div class="ad-card-sub">${onTimePct}% on time</div>
        </div>
        <div class="ad-card">
          <div class="ad-card-label">Resolved late</div>
          <div class="ad-card-value" style="color:var(--orange);">${data.resolved_late || 0}</div>
          <div class="ad-card-sub">Past SLA window</div>
        </div>
        <div class="ad-card">
          <div class="ad-card-label">Currently overdue</div>
          <div class="ad-card-value red">${data.currently_overdue || 0}</div>
          <div class="ad-card-sub">Of ${data.currently_open || 0} open</div>
        </div>
      </div>
    `;
  } catch(e){
    el.innerHTML = '<div class="ad-empty">Could not load SLA data.</div>';
    console.error(e);
  }
}

/* ── 5. Severity breakdown ── */
async function loadSeverity(){
  const el = document.getElementById('adSeverity');
  try {
    const { data } = await sb.from('analytics_severity').select('*');
    if (!data?.length){
      el.innerHTML = '<div class="ad-empty">No data yet.</div>';
      return;
    }
    const total = data.reduce((s, d) => s + d.total, 0);
    const colors = { minor:'var(--amber)', severe:'var(--orange)', critical:'var(--red)' };
    el.innerHTML = data.map(d => {
      const pct = total ? (d.total / total * 100).toFixed(1) : 0;
      return `
        <div class="ad-bar-row" style="grid-template-columns:5rem 1fr 5rem;">
          <div class="ad-bar-label" style="color:${colors[d.severity]};text-transform:uppercase;letter-spacing:.14em;">${d.severity}</div>
          <div class="ad-bar-track"><div class="ad-bar-fill" style="width:${pct}%;background:${colors[d.severity]};"></div></div>
          <div class="ad-bar-value" style="color:${colors[d.severity]};">${d.total} · ${pct}%</div>
        </div>
      `;
    }).join('');
  } catch(e){
    el.innerHTML = '<div class="ad-empty">Could not load severity.</div>';
    console.error(e);
  }
}

/* ── 6. Moderation funnel ── */
async function loadModeration(){
  const el = document.getElementById('adModeration');
  try {
    const { data } = await sb.from('analytics_moderation').select('*');
    if (!data?.length){
      el.innerHTML = '<div class="ad-empty">No data yet.</div>';
      return;
    }
    el.innerHTML = `
      <table class="ad-table">
        <thead>
          <tr>
            <th>Status</th>
            <th class="num">Count</th>
            <th class="num">%</th>
          </tr>
        </thead>
        <tbody>
          ${data.map(m => `
            <tr>
              <td>${esc(m.moderation_status || 'pending')}</td>
              <td class="num">${m.total}</td>
              <td class="num amber">${m.pct}%</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch(e){
    el.innerHTML = '<div class="ad-empty">Could not load moderation funnel.</div>';
    console.error(e);
  }
}

/* ── 7. Top reporters ── */
async function loadReporters(){
  const el = document.getElementById('adReporters');
  try {
    const { data } = await sb.from('analytics_reporters').select('*');
    if (!data?.length){
      el.innerHTML = '<div class="ad-empty">No repeat reporters yet.</div>';
      return;
    }
    el.innerHTML = `
      <table class="ad-table">
        <thead>
          <tr>
            <th>Reporter hash</th>
            <th class="num">Reports</th>
            <th class="num">Duplicates</th>
            <th>First seen</th>
            <th>Latest</th>
          </tr>
        </thead>
        <tbody>
          ${data.map(r => `
            <tr>
              <td style="font-family:var(--mono);font-size:11px;color:var(--text-lo);">${esc(r.reporter_hash?.slice(0, 12) || '—')}…</td>
              <td class="num amber">${r.reports_filed}</td>
              <td class="num">${r.duplicates}</td>
              <td>${new Date(r.first_report).toLocaleDateString('en-IN')}</td>
              <td>${new Date(r.latest_report).toLocaleDateString('en-IN')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch(e){
    el.innerHTML = '<div class="ad-empty">Could not load reporters.</div>';
    console.error(e);
  }
}

/* ── 8. Duplicate stats ── */
async function loadDuplicates(){
  const el = document.getElementById('adDuplicates');
  try {
    const { data } = await sb.from('analytics_duplicates').select('*').single();
    if (!data){
      el.innerHTML = '<div class="ad-empty">No data yet.</div>';
      return;
    }
    el.innerHTML = `
      <div class="ad-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:0;">
        <div class="ad-card">
          <div class="ad-card-label">Unique reports</div>
          <div class="ad-card-value">${data.originals || 0}</div>
        </div>
        <div class="ad-card">
          <div class="ad-card-label">Duplicates merged</div>
          <div class="ad-card-value" style="color:var(--green);">${data.duplicates || 0}</div>
        </div>
        <div class="ad-card">
          <div class="ad-card-label">Duplicate rate</div>
          <div class="ad-card-value">${data.duplicate_pct || 0}%</div>
          <div class="ad-card-sub">${(data.duplicate_pct || 0) < 15 ? 'Healthy' : 'High — check radius'}</div>
        </div>
      </div>
    `;
  } catch(e){
    el.innerHTML = '<div class="ad-empty">Could not load duplicate stats.</div>';
    console.error(e);
  }
}

/* ── Utilities ── */
function esc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}
