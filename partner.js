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
  const fail = msg => { $('err').textContent = msg || ''; $('werr').textContent = msg || ''; };

  function showSignIn(msg) {
    show('app', false); show('signin', true);
    $('signErr').textContent = msg || '';
  }

  async function boot() {
    fail('');
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return showSignIn('');
    const { error } = await sb.rpc('kasa_admin_queue');
    if (!error) { show('signin', false); show('app', true); show('worker', false); return load(); }
    const mine = await sb.rpc('kasa_partner_my_orders');
    if (!mine.error) { show('signin', false); show('app', false); show('worker', true); return loadWorker(); }
    await sb.auth.signOut();
    return showSignIn('This account is neither a moderator nor a registered partner worker.');
  }

  async function loadWorker() {
    const { data, error } = await sb.rpc('kasa_partner_my_orders');
    if (error) return fail('Could not load your jobs. Please try again later.');
    $('myjobs').innerHTML = !data || !data.length
      ? '<p class="muted">No jobs assigned to you right now.</p>'
      : data.map(o => `
        <div class="card"><div class="row">
          <div><strong>${esc(o.office)}</strong> <span class="pill">${esc(STATE_LABEL[o.state] || o.state)}</span>
            <div class="muted">Order ${esc(o.order_no || '')} · due ${esc(fmt(o.sla_due))} · ${esc(o.firm || '')}</div></div>
          <div>${workerActions(o)}</div>
        </div></div>`).join('');
    $('myjobs').querySelectorAll('[data-wstep]').forEach(b => b.addEventListener('click', () => workerStep(b.dataset.order, b.dataset.wstep)));
  }

  function workerActions(o) {
    if (o.state === 'assigned') return `<button class="primary" data-order="${o.order_id}" data-wstep="start">Start job</button>`;
    if (o.state === 'in_progress') return `<button class="primary" data-order="${o.order_id}" data-wstep="complete">Mark complete</button>`;
    return '';
  }

  async function workerStep(orderId, action) {
    const note = action === 'complete' ? ((prompt('Completion note (optional)') || '').trim() || null) : null;
    const { error } = await sb.rpc('kasa_partner_worker_step', { p_order: Number(orderId), p_action: action, p_note: note });
    if (error) return fail(error.message);
    await loadWorker();
  }

  // Timeline in the tracking style of a delivery status: a green dot per step, state, time, note.
  function timelineHTML(events) {
    if (!events || !events.length) return '<p class="muted">No steps yet.</p>';
    return '<ol class="tl">' + events.map(e => `
      <li><span class="dot"></span><div><strong>${esc(STATE_LABEL[e.to] || e.to)}</strong>
        <span class="muted"> ${esc(new Date(e.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }))}</span>
        ${e.note ? `<div class="muted">${esc(e.note)}</div>` : ''}</div></li>`).join('') + '</ol>';
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
        ${timelineHTML(o.timeline)}
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
      const worker = (prompt('Worker account id (added with "Add worker")') || '').trim();
      args.p_order_no = (prompt('Municipality work order number') || '').trim();
      if (!worker || !args.p_order_no) return;
      const { error } = await sb.rpc('kasa_admin_partner_assign', { p_order: Number(orderId), p_worker: worker, p_order_no: args.p_order_no });
      if (error) return fail(error.message);
      return load();
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
  $('wout').addEventListener('click', async () => { await sb.auth.signOut(); await boot(); });
  $('addWorker').addEventListener('click', async () => {
    const user = (prompt('Worker account id (from the sign-up email)') || '').trim();
    if (!user) return;
    const firm = (prompt('Firm or worker name, as on the municipality order') || '').trim();
    if (!firm) return;
    const phone = (prompt('Phone (kept private, optional)') || '').trim() || null;
    const { error } = await sb.rpc('kasa_admin_partner_add_worker', { p_user: user, p_firm: firm, p_phone: phone });
    if (error) return fail(error.message);
    fail('Worker added.');
  });

  boot();
})();
