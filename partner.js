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
    reopened: 'Reopened', verified: 'Verified', paid: 'Paid (reference recorded)', rejected: 'Rejected'
  };

  const show = (id, on) => $(id).classList.toggle('hidden', !on);
  const fail = msg => { $('err').textContent = msg || ''; $('werr').textContent = msg || ''; };

  function showSignIn(msg) {
    show('app', false); show('worker', false); show('signin', true);
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
          <div><a href="case.html?id=${encodeURIComponent(o.report_id)}">View case & location</a>${workerActions(o)}<button data-photos="${o.order_id}">Work photos</button></div>
        </div></div>`).join('');
    $('myjobs').querySelectorAll('[data-wstep]').forEach(b => b.addEventListener('click', () => workerStep(b.dataset.order, b.dataset.wstep)));
    bindPhotos($('myjobs'), false);
  }

  function workerActions(o) {
    if (o.state === 'assigned') return `<button class="primary" data-order="${o.order_id}" data-wstep="start">Start job</button>`;
    if (o.state === 'in_progress') return `<button data-camera="${o.order_id}">Take work photo</button><button class="primary" data-order="${o.order_id}" data-wstep="complete">Mark complete</button>`;
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
        <a href="case.html?id=${encodeURIComponent(o.report_id)}">View evidence & community verification</a><button data-photos="${o.order_id}">Review work photos</button>${timelineHTML(o.timeline)}
      </div>`).join('');
    bindPhotos(el, true);
    el.querySelectorAll('[data-step]').forEach(b => b.addEventListener('click', () => step(b.dataset.order, b.dataset.step)));
  }

  function actions(o) {
    const b = (step, label, cls) => `<button ${cls ? `class="${cls}"` : ''} data-order="${o.order_id}" data-step="${step}">${label}</button>`;
    switch (o.state) {
      case 'approved': return b('assign', 'Assign firm', 'primary') + b('reject', 'Reject');
      case 'assigned': return b('start', 'Mark started', 'primary');
      case 'in_progress': return b('complete', 'Mark complete', 'primary');
      case 'reopened': return b('send_back', 'Request new work photo', 'primary');
      case 'completed': return (o.signed_off ? b('sync', 'Check verification') : b('signoff', 'Officer sign-off', 'primary')) + b('send_back', 'Send back');
      case 'verified': return b('pay', 'Record payment reference', 'primary') + b('reopen', 'Reopen disputed work');
      case 'paid': return b('reopen', 'Reopen disputed work');
      default: return '';
    }
  }

  async function step(orderId, action) {
    if(action === 'reopen'){
      const reason=(prompt('Why does this work need reopening? At least 10 characters.')||'').trim();if(reason.length<10)return;
      const {error}=await sb.rpc('kasa_partner_reopen',{p_order:Number(orderId),p_reason:reason});if(error)return fail(error.message);return load();
    }

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

  function bindPhotos(root,admin){
    root.querySelectorAll('[data-camera]').forEach(b=>b.onclick=()=>openWorkCamera(b.dataset.camera));
    root.querySelectorAll('[data-photos]').forEach(b=>b.onclick=async()=>{
      b.disabled=true;
      try{
        let panel=b.parentElement.querySelector('.photo-panel');if(panel){panel.remove();return;}
        const {data,error}=await sb.rpc('kasa_partner_order_photos',{p_order:Number(b.dataset.photos)});if(error)throw error;
        panel=document.createElement('div');panel.className='photo-panel';
        if(!data?.length)panel.textContent='No work photos recorded.';
        for(const p of data||[]){
          const card=document.createElement('div');card.className='card';const image=document.createElement('img');image.className='work-photo';image.alt='Work photo taken '+fmt(p.taken_at);image.loading='lazy';image.src=sb.storage.from('kasa-photos').getPublicUrl(p.path).data.publicUrl;
          const label=document.createElement('p');label.textContent=(p.current?'Current cycle':'Previous cycle')+' · '+(p.rejected?'Rejected':p.approved?'Approved':'Awaiting review')+(p.note?' · '+p.note:'');card.append(image,label);
          if(admin&&p.current){for(const decision of ['approve','reject']){const action=document.createElement('button');action.textContent=decision==='approve'?'Approve photo':'Reject photo';action.onclick=async()=>{
            const note=decision==='reject'?(prompt('Reason for rejection')||'').trim():null;if(decision==='reject'&&(!note||note.length<3))return;
            action.disabled=true;try{const r=await sb.rpc('kasa_admin_partner_photo_review',{p_photo:p.id,p_decision:decision,p_note:note});if(r.error)throw r.error;await load();}catch(e){fail(e.message);action.disabled=false;}
          };card.append(action);}}
          panel.append(card);
        }
        b.parentElement.append(panel);
      }catch(e){fail(e.message||'Photo review unavailable. Apply the partner evidence migration.');}finally{b.disabled=false;}
    });
  }
  let stream=null,cameraOrder=null,photoDraft=null,cameraGeneration=0,uploading=false;
  const dialog=$('work-camera'),video=$('work-video'),shutter=$('work-shutter'),cameraStatus=$('camera-status');
  function stopCamera(){cameraGeneration++;stream?.getTracks().forEach(t=>t.stop());stream=null;video.srcObject=null;}
  function closeCamera(){if(uploading)return;stopCamera();dialog.close();}
  $('work-cancel').onclick=closeCamera;
  $('work-retake').onclick=()=>{if(uploading)return;photoDraft=null;shutter.textContent='Take photo & upload';cameraStatus.textContent='Ready for a new photo.';};
  dialog.addEventListener('cancel',e=>{e.preventDefault();closeCamera();});
  window.addEventListener('pagehide',stopCamera);
  async function openWorkCamera(order){
    if(photoDraft&&photoDraft.order!==Number(order)&&!confirm('Discard the unsent photo from the previous job?'))return;
    if(photoDraft?.order!==Number(order))photoDraft=null;
    cameraOrder=Number(order);stopCamera();const generation=cameraGeneration;dialog.showModal();shutter.disabled=true;cameraStatus.textContent='Starting camera…';
    try{
      const media=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
      if(generation!==cameraGeneration){media.getTracks().forEach(t=>t.stop());return;}
      stream=media;video.srcObject=stream;await video.play();shutter.disabled=false;
      shutter.textContent=photoDraft?'Retry photo upload':'Take photo & upload';cameraStatus.textContent=photoDraft?'Unsent photo is ready to retry.':'Stand at the reported location. A fresh GPS fix is required.';
    }catch(e){cameraStatus.textContent='Camera unavailable. Allow camera access on HTTPS and try again.';}
  }
  shutter.onclick=async()=>{
    if(uploading)return;uploading=true;shutter.disabled=true;$('work-cancel').disabled=true;
    try{
      if(!photoDraft){
        const {data:token,error}=await sb.rpc('kasa_issue_capture_token');if(error||!token)throw new Error('Could not authorise capture. Check your connection and try again.');
        cameraStatus.textContent='Getting a fresh location…';
        const gps=await new Promise((ok,no)=>navigator.geolocation.getCurrentPosition(ok,no,{enableHighAccuracy:true,maximumAge:0,timeout:20000}));
        if(!video.videoWidth)throw new Error('Camera is not ready. Try again.');
        const canvas=document.createElement('canvas'),scale=Math.min(1,1600/video.videoWidth);canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
        const blob=await new Promise(ok=>canvas.toBlob(ok,'image/jpeg',.85));if(!blob)throw new Error('Could not capture a photo.');
        photoDraft={order:cameraOrder,blob,path:'partner/'+crypto.randomUUID().replaceAll('-','')+'.jpg',uploaded:false,meta:{capture:'live',capture_token:token,taken_at:new Date().toISOString(),lat:gps.coords.latitude,lng:gps.coords.longitude,accuracy:gps.coords.accuracy}};
      }
      cameraStatus.textContent='Uploading work photo…';const d=photoDraft;
      if(!d.uploaded){const {error}=await sb.storage.from('kasa-photos').upload(d.path,d.blob,{contentType:'image/jpeg',upsert:false});if(error&&String(error.statusCode)!=='409')throw error;d.uploaded=true;}
      const {error}=await sb.rpc('kasa_partner_add_work_photo',{p_order:d.order,p_path:d.path,p_meta:d.meta});if(error)throw error;
      photoDraft=null;cameraStatus.textContent='Work photo recorded. You can now mark the job complete.';shutter.textContent='Take another photo';
    }catch(e){cameraStatus.textContent=e.message||'Upload failed. Keep this tab open and retry.';shutter.textContent=photoDraft?'Retry photo upload':'Take photo & upload';}
    finally{uploading=false;shutter.disabled=false;$('work-cancel').disabled=false;}
  };

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
