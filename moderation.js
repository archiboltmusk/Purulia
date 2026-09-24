let supabase = null;
let currentUser = null;

document.addEventListener('DOMContentLoaded', async () => {
  // Initialize Supabase
  const url = KASA_CONFIG.SUPABASE_URL;
  const key = KASA_CONFIG.SUPABASE_ANON_KEY;
  if (!url || !key) {
    document.getElementById('mod-login').innerHTML = '<p style="color:var(--red);">Configuration error: Missing Supabase credentials</p>';
    return;
  }

  supabase = window.supabase.createClient(url, key);

  // Check if user is logged in
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    currentUser = session.user;
    showDashboard();
    loadReports();
  } else {
    showLogin();
  }

  // Set up event listeners
  document.getElementById('mod-login-form')?.addEventListener('submit', handleLogin);
  document.getElementById('mod-logout')?.addEventListener('click', handleLogout);
  document.getElementById('mod-filter-status')?.addEventListener('change', loadReports);
  document.getElementById('mod-filter-unsafe')?.addEventListener('change', loadReports);

  // Set up auth state listener
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN') {
      currentUser = session.user;
      showDashboard();
      loadReports();
    } else if (event === 'SIGNED_OUT') {
      currentUser = null;
      showLogin();
    }
  });
});

function showLogin() {
  document.getElementById('mod-wrap').hidden = true;
  document.getElementById('mod-login').hidden = false;
}

function showDashboard() {
  document.getElementById('mod-login').hidden = true;
  document.getElementById('mod-wrap').hidden = false;
}

async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('mod-email').value.trim();
  const errorEl = document.getElementById('mod-error');

  if (!email) {
    errorEl.textContent = 'Please enter an email address';
    errorEl.hidden = false;
    return;
  }

  try {
    errorEl.hidden = true;
    const { error } = await supabase.auth.signInWithOtp({ email });
    if (error) throw error;
    document.getElementById('mod-login').innerHTML = `<p style="color:var(--amber);font-family:var(--serif);margin:2rem 0;">Check your email for a login link. This link works for 24 hours.</p>`;
  } catch (err) {
    errorEl.textContent = err.message || 'Failed to send login link. Try again.';
    errorEl.hidden = false;
  }
}

async function handleLogout() {
  await supabase.auth.signOut();
}

async function loadReports() {
  const statusFilter = document.getElementById('mod-filter-status').value;
  const unsafeFilter = document.getElementById('mod-filter-unsafe').value;
  const listEl = document.getElementById('mod-list');

  listEl.innerHTML = '<div class="mod-loading">Loading reports…</div>';

  try {
    // Build query
    let query = supabase
      .from('civic_reports')
      .select('*')
      .order('created_at', { ascending: false });

    if (statusFilter) {
      query = query.eq('status', statusFilter);
    }
    if (unsafeFilter !== '') {
      query = query.eq('unsafe', unsafeFilter === '1');
    }

    const { data: reports, error } = await query;

    if (error) throw error;

    if (!reports || reports.length === 0) {
      listEl.innerHTML = '<p style="text-align:center;color:var(--text-lo);padding:2rem;">No reports found</p>';
      return;
    }

    listEl.innerHTML = reports.map(report => renderReport(report)).join('');

    // Add event listeners to action buttons
    document.querySelectorAll('[data-action-delete]').forEach(btn => {
      btn.addEventListener('click', () => deleteReport(btn.dataset.reportId));
    });
    document.querySelectorAll('[data-action-approve]').forEach(btn => {
      btn.addEventListener('click', () => updateReportStatus(btn.dataset.reportId, 'approved'));
    });
    document.querySelectorAll('[data-action-reject]').forEach(btn => {
      btn.addEventListener('click', () => updateReportStatus(btn.dataset.reportId, 'rejected'));
    });
  } catch (err) {
    listEl.innerHTML = `<p style="color:var(--red);padding:1rem;">${escapeHtml(err.message)}</p>`;
  }
}

function renderReport(report) {
  const date = new Date(report.created_at).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });

  let safetyBadge = '';
  if (report.unsafe) {
    safetyBadge = '<span class="mod-safety mod-safety-bad">⚠ UNSAFE</span>';
  } else if (report.garbage_score !== null) {
    safetyBadge = `<span class="mod-safety mod-safety-ok">✓ Safe</span>`;
  } else {
    safetyBadge = '<span class="mod-safety mod-safety-unchecked">? Unchecked</span>';
  }

  const photoHtml = report.photo_path
    ? `<img class="mod-item-photo" src="${getPhotoUrl(report.photo_path)}" alt="Report photo" onerror="this.style.display='none'">`
    : '';

  return `
    <div class="mod-item">
      <div class="mod-item-head">
        <div class="mod-item-meta">
          <div class="mod-item-id">Report #${report.id}</div>
          <div class="mod-item-desc">${escapeHtml(report.description)}</div>
          <div class="mod-item-details">
            <span>${escapeHtml(report.category || 'Unknown')}</span>
            <span>${escapeHtml(report.location_name || `${report.latitude.toFixed(4)}, ${report.longitude.toFixed(4)}`)} </span>
            <span>${date}</span>
          </div>
          ${safetyBadge}
        </div>
        ${photoHtml}
      </div>
      <div class="mod-item-actions">
        <button class="mod-btn mod-btn-approve" data-action-approve data-report-id="${report.id}">Approve</button>
        <button class="mod-btn mod-btn-reject" data-action-reject data-report-id="${report.id}">Reject</button>
        <button class="mod-btn mod-btn-delete" data-action-delete data-report-id="${report.id}">Delete</button>
      </div>
    </div>
  `;
}

async function deleteReport(reportId) {
  if (!confirm('Permanently delete this report? This cannot be undone.')) {
    return;
  }

  const btn = document.querySelector(`[data-action-delete][data-report-id="${reportId}"]`);
  btn.disabled = true;

  try {
    const { error } = await supabase
      .from('civic_reports')
      .delete()
      .eq('id', reportId);

    if (error) throw error;

    // Remove from UI
    btn.closest('.mod-item').remove();
  } catch (err) {
    alert('Failed to delete report: ' + err.message);
    btn.disabled = false;
  }
}

async function updateReportStatus(reportId, status) {
  const btn = document.querySelector(`[data-action-${status}][data-report-id="${reportId}"]`);
  btn.disabled = true;

  try {
    const { error } = await supabase
      .from('civic_reports')
      .update({ status, moderated_at: new Date().toISOString(), moderator_id: currentUser.id })
      .eq('id', reportId);

    if (error) throw error;

    // Reload to reflect changes
    loadReports();
  } catch (err) {
    alert('Failed to update report: ' + err.message);
    btn.disabled = false;
  }
}

function getPhotoUrl(photoPath) {
  // Return signed URL or storage URL
  const bucket = 'kasa-photos';
  const url = `${KASA_CONFIG.SUPABASE_URL}/storage/v1/object/public/${bucket}/${photoPath}`;
  return url;
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
