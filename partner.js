/* Partner queue: moderator stand-in for the municipal officer. Uses the work-order RPCs
   (migration 20261016140000_kasa_partner_workflow.sql). Payment is a reference only. */
(function () {
  const cfg = window.KASA_CONFIG || {};
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = d => d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const LIVE_EXCLUDE = ['rejected', 'paid'];
  const STATE_LABEL = {
    approved: 'Approved', assigned: 'Assigned', in_progress: 'In progress', completed: 'Completed',
    verified: 'Verified', paid: 'Paid (reference recorded)', rejected: 'Rejected'
  };

  const show = (id, on) => $(id).classList.toggle('hidden', !on);
  const fail = msg => { $('err').textContent = msg || ''; };

  function showSignIn(msg) {
    show('app', false); show('signin', true);
    $('signErr').textContent = msg || '';
  }

  async function boot() {
    fail('');
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return showSignIn('');
    const { error } = await sb.rpc('kasa_admin_queue');
    if (error) {
      await sb.auth.signOut();
      return showSignIn('This account is not a moderator. Sign in with a moderator account.');
    }
    show('signin', false); show('app', true);
    await load();
  }

  async function load() {
    const [board, reports] = await Promise.all([
      sb.rpc('kasa_partner_board'),
      sb.from('kasa_public_reports')
        .select('id,created_at,category,waste_type,ward_no,block_name,sla_days,status,is_duplicate')
        .neq('status', 'resolved').order('created_at', { ascending: true }).limit(200)
    ]);
    if (board.error || reports.error) return fail('Could not load. Please try again later.');

    const orders = (board.data && board.data.orders) || [];
    const live = orders.filter(o => !LIVE_EXCLUDE.includes(o.state));
    const liveReports = new Set(live.map(o => o.report_id));
    const counts = (board.data && board.data.counts) || {};
    $('counts').textContent = Object.keys(counts).length
      ? Object.entries(counts).map(([k, v]) => `${STATE_LABEL[k] || k}: ${v}`).join(' · ')
      : 'No work orders yet';

    renderQueue((reports.data || []).filter(r => !r.is_duplicate && !liveReports.has(r.id)));
    renderOrders(orders);
  }

  function place(r) {
    return [r.ward_no ? `Ward ${r.ward_no}` : '', r.block_name ? `${r.block_name} block` : ''].filter(Boolean).join(', ') || 'Place not on record';
  }

  function renderQueue(list) {
    const el = $('queue');
    if (!list.length) { el.innerHTML = '<p class="muted">No open problems waiting for an order.</p>'; return; }
    el.innerHTML = list.map(r => `
      <div class="card"><div class="row">
        <div><strong>${esc(r.category || 'Problem')}${r.waste_type ? ' · ' + esc(String(r.waste_type).replace(/_/g, ' ')) : ''}</strong>
          <div class="muted">${esc(place(r))} · reported ${esc(fmt(r.created_at))}</div></div>
        <button class="primary" data-approve="${esc(r.id)}">Approve for work</button>
      </div></div>`).join('');
    el.querySelectorAll('[data-approve]').forEach(b => b.addEventListener('click', () => approve(b.dataset.approve)));
  }

  async function approve(reportId) {
    const office = (prompt('Which office will do the work? (as on the office letter)') || '').trim();
    if (!office) return;
    const sla = parseInt(prompt('Days to fix (SLA, 1 to 90)', '7') || '', 10);
    if (!sla) return;
    const { error } = await sb.rpc('kasa_admin_partner_approve', { p_report: reportId, p_office: office, p_sla_days: sla });
    if (error) return fail(error.message);
    await load();
  }

  function renderOrders(orders) {
    const el = $('orders');
    if (!orders.length) { el.innerHTML = '<p class="muted">No work orders yet.</p>'; return; }
    el.innerHTML = orders.map(o => `
      <div class="card">
        <div class="row">
          <div><strong>${esc(o.office)}</strong> <span class="pill">${esc(STATE_LABEL[o.state] || o.state)}</span>
            ${o.overdue ? '<span class="late"> · overdue</span>' : ''}
            <div class="muted">Report ${esc(String(o.report_id).slice(0, 8))} · due ${esc(fmt(o.sla_due))}
              ${o.firm ? ' · firm: ' + esc(o.firm) : ''}${o.order_no ? ' · order ' + esc(o.order_no) : ''}
              ${o.signed_off ? ' · officer signed off' : ''}${o.paid_on ? ' · paid ' + esc(fmt(o.paid_on)) : ''}</div>
          </div>
          <div>${actions(o)}</div>
        </div>
      </div>`).join('');
    el.querySelectorAll('[data-step]').forEach(b => b.addEventListener('click', () => step(b.dataset.order, b.dataset.step)));
  }

  function actions(o) {
    const b = (step, label, cls) => `<button ${cls ? `class="${cls}"` : ''} data-order="${o.order_id}" data-step="${step}">${label}</button>`;
    switch (o.state) {
      case 'approved': return b('assign', 'Assign firm', 'primary') + b('reject', 'Reject');
      case 'assigned': return b('start', 'Mark started', 'primary');
      case 'in_progress': return b('complete', 'Mark complete', 'primary');
      case 'completed': return (o.signed_off ? b('sync', 'Check verification') : b('signoff', 'Officer sign-off', 'primary')) + b('send_back', 'Send back');
      case 'verified': return b('pay', 'Record payment reference', 'primary');
      default: return '';
    }
  }

  async function step(orderId, action) {
    const args = { p_order: Number(orderId), p_action: action, p_firm: null, p_order_no: null, p_note: null };
    if (action === 'assign') {
      args.p_firm = (prompt('Firm or worker name (shown publicly as the firm)') || '').trim();
      args.p_order_no = (prompt('Municipality work order number') || '').trim();
      if (!args.p_firm || !args.p_order_no) return;
    } else if (action === 'reject' || action === 'send_back') {
      args.p_note = (prompt('Reason (shown publicly)') || '').trim();
      if (!args.p_note) return;
    } else if (action === 'complete') {
      args.p_note = (prompt('Completion note (optional)') || '').trim() || null;
    } else if (action === 'pay') {
      args.p_order_no = (prompt('Municipality payment reference (we record it, we pay nothing)') || '').trim();
      if (!args.p_order_no) return;
    }
    const { error } = await sb.rpc('kasa_admin_partner_step', args);
    if (error) return fail(error.message);
    await load();
  }

  $('go').addEventListener('click', async () => {
    const { error } = await sb.auth.signInWithPassword({ email: $('em').value.trim(), password: $('pw').value });
    if (error) return ($('signErr').textContent = 'Sign-in failed. Check the email and password.');
    $('pw').value = '';
    await boot();
  });
  $('out').addEventListener('click', async () => { await sb.auth.signOut(); await boot(); });

  boot();
})();
