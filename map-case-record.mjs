function add(parent, tag, text) {
  const node = document.createElement(tag);
  node.textContent = text;
  parent.append(node);
  return node;
}

async function rpc(name, args) {
  const config = window.KASA_CONFIG;
  const response = await fetch(config.SUPABASE_URL + '/rest/v1/rpc/' + name, {
    method: 'POST', headers: { apikey: config.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(args), cache: 'no-store', signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error('Request failed');
  return response.json();
}

function rows(parent, heading, records, describe, missing) {
  const section = add(parent, 'details', '');
  add(section, 'summary', heading + ' (' + records.length + ')');
  if (!records.length) add(section, 'p', missing);
  for (const item of records) {
    add(section, 'p', describe(item).filter(Boolean).join(' · '));
    if (/^https:\/\//i.test(item.source_url || '')) {
      const link = add(section, 'a', 'Original source');
      link.href = item.source_url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    }
  }
}

function correction(parent, id) {
  const section = add(parent, 'details', '');
  add(section, 'summary', 'Submit evidence or correct this record');
  const form = add(section, 'form', '');
  const kind = add(add(form, 'label', 'Evidence type '), 'select', '');
  for (const type of ['Dated site observation','News report','Public social post','Office response','Public document','Correction']) add(kind,'option',type);
  const note = add(add(form,'label',' What did you observe or what needs correcting? '),'textarea','');
  note.required = true; note.minLength = 3; note.maxLength = 2000;
  const when = add(add(form,'label',' Event or observation date, if known '),'input','');
  when.type = 'date';
  const source = add(add(form,'label',' Public source URL, if available '),'input','');
  source.type = 'url'; source.maxLength = 500;
  add(form,'p','Omit private names, contact details and home locations. Submissions enter moderation.');
  const submit = add(form,'button','Send for review');
  const status = add(form,'p',''); status.setAttribute('role','status');
  form.onsubmit = async event => {
    event.preventDefault();
    if (submit.disabled) return;
    submit.disabled = true;
    try {
      const result = await rpc('kasa_suggest_data_fix',{p_what:'Civic case '+id,p_correction:note.value.trim(),p_source_url:source.value.trim() || null,p_note:[kind.value,when.value].filter(Boolean).join(' · '),p_page:'kasa.html?report='+encodeURIComponent(id)});
      if (!result?.ok) throw new Error();
      form.reset(); status.textContent = 'Submitted for moderator review.';
    } catch { status.textContent = 'Submission could not be confirmed. Your text is still here.'; }
    finally { submit.disabled = false; }
  };
}

export async function showRecord(parent, id) {
  const [caseResult, orderResult] = await Promise.allSettled([
    rpc('kasa_case_dossier',{p_report_id:id}), rpc('kasa_partner_board',{})
  ]);
  if (!parent.isConnected) return;
  parent.replaceChildren();
  add(parent,'h3','Case evidence & follow-up');
  const dossier = caseResult.value;
  const orders = orderResult.value?.orders?.filter(order => String(order.report_id) === id);
  if (dossier?.relations) {
    const r = dossier.report, rel = dossier.relations;
    const confirmed = rel.asset?.match === 'confirmed';
    const works = rel.works?.works || [];
    const owner = orders?.[0]?.office || (confirmed && rel.asset?.asset?.owner?.body);
    add(parent,'p','Executing office: '+(owner || 'unconfirmed')+'. Record retrieved '+dossier.generated_at.slice(0,10)+'.');
    add(parent,'p', r.recurrence_count > 0 ? 'Repeat failure reported. Request a cause review, a preventive repair and a dated follow-up inspection.' :
      !owner ? 'Next step: establish the asset owner before assigning a repair.' :
      r.status === 'resolved' ? 'Next step: check that the service still works and record any recurrence.' : 'Next step: request the inspection reference and scheduled repair date.');
    rows(parent,'Jurisdiction records',rel.authorities || [],x=>[x.body,x.department],'No jurisdiction record linked.');
    rows(parent,confirmed ? 'Asset works' : 'Possible asset works · match unconfirmed',works,x=>[x.title,x.work_order_ref,x.issued_by,x.status,x.completed_on],'No linked work record.');
    rows(parent,'Filed correspondence',rel.official_dockets || [],x=>[x.portal,x.filed_on || x.added,x.status],'No docket on file. Delivery to the office is unknown.');
    rows(parent,'Published office replies',rel.official_responses || [],x=>[x.responder_role,x.created_at,x.body],'No published reply linked.');
    rows(parent,'Site verification history',rel.verification_events || [],x=>[x.kind,x.created_at],'No verification event linked.');
  } else add(parent,'p','Case evidence unavailable.');
  if (orders) rows(parent,'Municipal work orders',orders,x=>[x.order_no || x.order_id,x.office,x.state,x.sla_due && 'Recorded due date '+x.sla_due,x.updated_at],'No matching order in the public board’s latest 200 orders.');
  else add(parent,'p','Municipal order board unavailable.');
  correction(parent,id);
}
