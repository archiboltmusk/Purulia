/* Admin: the evidence record (record.html). One screen for every kind: pick a kind, see its rows
   with state and approvals, add or edit one, approve / reject / send back / archive with a reason.
   Server rules (migration 20261014200000_kasa_evidence.sql) decide what can go public; this only
   calls kasa_admin_ev_save / _review / _list / _link / _triage_submission. Uses admin.js's sb + esc. */
const EV_STATE = ['draft', 'in_review', 'published', 'rejected', 'archived'];
const EV_KINDS = {
  source:       { label: 'Sources', show: r => `${r.title} · ${r.validation_state}`, fields: [
    ['url', 'Link', 'url'], ['title', 'Title'], ['publisher', 'Publisher'], ['source_type', 'Type', ['government', 'court', 'legislature', 'audit', 'dataset', 'regulator', 'oversight', 'public_submission', 'other']],
    ['jurisdiction', 'Covers (state / India)'], ['domains', 'Topics'], ['access_method', 'How we get it', ['manual_review', 'download', 'api', 'rss', 'bulk_dataset', 'unknown']],
    ['access_terms_url', 'Terms of use link', 'url'], ['update_frequency', 'How often it updates'], ['limitations', 'Limits', 'area']] },
  document:     { label: 'Documents', show: r => `${r.title} · source ${r.source_id}`, fields: [
    ['source_id', 'Source id', 'number'], ['url', 'Link', 'url'], ['title', 'Title'], ['source_class', 'Kind of record', ['official_primary', 'court', 'audit', 'official_statistics', 'secondary_reporting', 'first_hand', 'other']],
    ['document_type', 'Document type (work order, RTI reply…)'], ['published_on', 'Published on', 'date'], ['language', 'Language'], ['page_count', 'Pages', 'number'],
    ['sha256', 'SHA-256 of the file (sha256sum)'], ['archive_url', 'Archived copy (web.archive.org)', 'url'], ['rights_review', 'Rights', ['link_only', 'permitted', 'public_domain', 'restricted', 'pending']],
    ['status', 'Status', ['live', 'changed', 'gone']], ['supersedes_id', 'Replaces document id', 'number']] },
  assertion:    { label: 'Assertions', pub: true, show: r => `${r.headline} · ${r.evidence_state}`, fields: [
    ['harm_id', 'Harm id', 'number'], ['headline', 'Headline (one checkable statement)'], ['body', 'What the record says (attribute it)', 'area'], ['domain', 'Topic'], ['district', 'District slug'],
    ['event_from', 'Event from', 'date'], ['event_to', 'Event to', 'date'],
    ['evidence_state', 'Evidence state', ['unverified', 'source_checked', 'corroborated', 'disputed', 'insufficient_evidence', 'established_by_finding', 'corrected', 'withdrawn', 'superseded']],
    ['evidence_as_of', 'State as of', 'date'], ['uncertainty_note', 'What is uncertain', 'area'],
    ['right_of_reply_status', 'Right of reply', ['not_requested', 'requested', 'received', 'no_response', 'not_applicable']], ['sensitivity', 'Sensitivity', ['public', 'sensitive']]] },
  evidence:     { label: 'Evidence', show: r => `assertion ${r.assertion_id} · doc ${r.document_id} · ${r.locator} · ${r.role} · ${r.review_status}`, fields: [
    ['assertion_id', 'Assertion id', 'number'], ['document_id', 'Document id', 'number'], ['locator', 'Page / para / table'], ['excerpt', 'Exact words from the document', 'area'],
    ['role', 'Role', ['supports', 'contradicts', 'context']], ['rationale', 'Why it matters', 'area']] },
  harm:         { label: 'Harms', pub: true, show: r => `${r.title} · ${r.harm_status}`, fields: [
    ['title', 'Title'], ['description', 'Description', 'area'], ['domain', 'Topic (infrastructure, health, procurement…)'], ['subdomain', 'Sub-topic'], ['district', 'District slug'], ['block', 'Block'],
    ['local_body', 'Municipality / GP'], ['lgd_code', 'LGD code'], ['period_from', 'From', 'date'], ['period_to', 'To', 'date'], ['affected_estimate', 'People affected (only if a source gives it)', 'number'],
    ['affected_basis', 'Source of that number'], ['financial_exposure', 'Money involved (₹)', 'number'], ['financial_exposure_basis', 'Kind of amount', ['', 'alleged', 'reported', 'budgeted', 'estimated', 'awarded', 'audited', 'ordered', 'paid', 'recovered']],
    ['unknown_note', 'What is still not known (required to publish)', 'area'], ['harm_status', 'Status', ['under_assessment', 'active', 'partially_remedied', 'remedied', 'recurring', 'unresolved', 'closed_no_finding']], ['sensitivity', 'Sensitivity', ['public', 'sensitive']]] },
  entity:       { label: 'Entities', pub: true, show: r => `${r.name} · ${r.kind}`, fields: [
    ['kind', 'Kind', ['public_body', 'department', 'office', 'public_official', 'company', 'project', 'work', 'asset', 'court', 'regulator', 'place', 'other']], ['name', 'Name'], ['aliases', 'Other names'],
    ['jurisdiction', 'Jurisdiction'], ['district', 'District slug'], ['lgd_code', 'LGD code'], ['identifier', 'Official number (GSTIN, CNR, tender id)'], ['identity_basis', 'How we know it is this one'],
    ['ref_table', 'Mirrors table (e.g. kasa_private.works)'], ['ref_id', 'Mirrors row id']] },
  relationship: { label: 'Links', pub: true, show: r => `${r.from_entity_id} —${r.kind}→ ${r.to_entity_id} · ${r.confidence}`, fields: [
    ['from_entity_id', 'From entity id', 'number'], ['to_entity_id', 'To entity id', 'number'], ['kind', 'Link (awarded_work_to, administers, executed…)'], ['assertion_id', 'Assertion id', 'number'],
    ['document_id', 'Document id', 'number'], ['locator', 'Page / para'], ['rationale', 'What the document says', 'area'],
    ['confidence', 'Basis', ['strong_documentary_link', 'confirmed_identifier_match', 'tentative_candidate']], ['valid_from', 'From', 'date'], ['valid_to', 'To', 'date']] },
  proceeding:   { label: 'Cases', pub: true, show: r => `${r.kind} ${r.ref_no || ''} · ${r.stage}`, fields: [
    ['kind', 'Kind', ['rti', 'grievance', 'court', 'criminal', 'administrative', 'audit', 'departmental', 'vigilance', 'lokayukta', 'legislative', 'other']], ['ref_no', 'Reference number'], ['forum', 'Court / authority'],
    ['jurisdiction', 'Jurisdiction'], ['filed_on', 'Filed on', 'date'], ['statutes', 'Law / sections'],
    ['stage', 'Stage', ['complaint', 'preliminary_review', 'fir_registered', 'investigation', 'charge_sheet', 'trial', 'hearing', 'decision', 'conviction', 'acquittal', 'discharge', 'closure', 'dismissed', 'quashed', 'appeal_pending', 'reversed', 'compliance_pending', 'complied', 'administrative_resolution', 'withdrawn', 'unknown']],
    ['stage_as_of', 'Stage as of', 'date'], ['stage_document_id', 'Document showing the stage', 'number'], ['official_url', 'Official status page', 'url'], ['summary', 'Summary', 'area'], ['report_docket_id', 'Report docket id', 'number']] },
  money:        { label: 'Money', pub: true, show: r => `${r.amount_basis} ₹${r.amount} · harm ${r.harm_id || '—'}`, fields: [
    ['harm_id', 'Harm id', 'number'], ['work_id', 'Work id', 'number'], ['payer_entity_id', 'Payer entity id', 'number'], ['recipient_entity_id', 'Recipient entity id', 'number'], ['proceeding_id', 'Case id', 'number'],
    ['amount_basis', 'Kind of amount', ['allocated', 'contract', 'reported_paid', 'verified_paid', 'work_done', 'audit_questioned', 'recoverable', 'recovered']], ['amount', 'Amount (₹)', 'number'],
    ['as_of', 'As of', 'date'], ['financial_year', 'Financial year'], ['tender_ref', 'Tender ref'], ['document_id', 'Document id', 'number'], ['locator', 'Page / table'], ['notes', 'Notes', 'area']] },
  response:     { label: 'Responses', pub: true, show: r => `${r.from_label} on ${r.target_type} ${r.target_id}`, fields: [
    ['target_type', 'About', ['harm', 'assertion', 'proceeding', 'remedy']], ['target_id', 'Its id', 'number'], ['from_entity_id', 'From entity id', 'number'], ['from_label', 'From (as signed)'],
    ['document_id', 'Letter document id', 'number'], ['url', 'Or link where it was said', 'url'], ['received_on', 'Received on', 'date'], ['summary', 'What they said (their words)', 'area']] },
  remedy:       { label: 'Remedies', pub: true, show: r => `${r.requested_action} · ${r.stage} · ${r.action_status}`, fields: [
    ['harm_id', 'Harm id', 'number'], ['body_entity_id', 'Responsible entity id', 'number'], ['responsible_label', 'Or responsible office (text)'], ['requested_action', 'What was asked', 'area'],
    ['remedy_type', 'Type', ['repair_under_warranty', 'service_restored', 'money_recovered', 'order_complied', 'policy_changed', 'disciplinary_action', 'environmental_reduction', 'compensation', 'record_corrected', 'other']],
    ['legal_basis_assertion_id', 'Rule / order it rests on (assertion id)', 'number'], ['requested_on', 'Asked on', 'date'], ['due_on', 'Due by', 'date'],
    ['stage', 'Stage', ['identified', 'verified', 'referred', 'assessed', 'outcome_verified']], ['action_status', 'What the office says', ['proposed', 'submitted', 'acknowledged', 'in_progress', 'claimed_complete', 'verified_complete', 'rejected', 'overdue']],
    ['unresolved', 'Unresolved', ['false', 'true']], ['recurred', 'Came back', ['false', 'true']]] },
  outcome:      { label: 'Outcomes', show: r => `remedy ${r.remedy_id} · ${r.metric} · ${r.verified ? 'verified' : 'not verified'}`, fields: [
    ['remedy_id', 'Remedy id', 'number'], ['metric', 'What was measured'], ['unit', 'Unit'], ['baseline', 'Before', 'number'], ['observed', 'After', 'number'], ['period_from', 'From', 'date'], ['period_to', 'To', 'date'],
    ['method', 'How it was checked', 'area'], ['evidence_kind', 'Evidence', ['live_photo', 'document', 'measurement']], ['evidence_ref', 'Report / claim id (live photo)'], ['document_id', 'Document id', 'number']] },
  submission:   { label: 'Inbox', show: r => r.ref_no }
};
let evKind = 'submission';

async function loadEvidence(){
  const el = document.getElementById('adEvidence');
  if (!el) return;
  const K = EV_KINDS[evKind];
  const { data, error } = await sb.rpc('kasa_admin_ev_list', { p_kind: evKind, p_limit: 200 });
  const tabs = `<div style="display:flex;flex-wrap:wrap;gap:.35rem;margin-bottom:.8rem">${Object.entries(EV_KINDS).map(([k, v]) =>
    `<button class="${k === evKind ? 'ad-ok' : 'ad-ev'}" data-evk="${k}">${esc(v.label)}</button>`).join('')}</div>`;
  if (error){ el.innerHTML = tabs + `<div class="ad-empty">Could not load: ${esc(error.details || error.message)}</div>`; wireTabs(el); return; }
  if (evKind === 'submission'){
    el.innerHTML = tabs + (data.length ? `<table class="ad-table"><thead><tr><th>Ref</th><th>What</th><th>Status</th><th></th></tr></thead><tbody>
      ${data.map(s => `<tr><td>${esc(s.ref_no)}<br><small>${esc(new Date(s.created_at).toLocaleString('en-IN'))}</small></td>
        <td>${esc(s.kind)}${s.target_type ? ` on ${esc(s.target_type)} ${esc(s.target_id)}` : ''}<br>${esc(s.body)}${s.url ? `<br><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.url.slice(0, 80))}</a>` : ''}</td>
        <td>${esc(s.status)}${s.reason ? `<br><small>${esc(s.reason)}</small>` : ''}</td>
        <td><select data-evsub="${esc(s.id)}"><option value="">Move to…</option>${['triage', 'source_review', 'legal_privacy_review', 'needs_more_information', 'accepted', 'rejected', 'referred']
          .map(x => `<option>${x}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table>` : '<div class="ad-empty">Inbox empty.</div>');
    wireTabs(el);
    el.querySelectorAll('[data-evsub]').forEach(sel => sel.addEventListener('change', async () => {
      if (!sel.value) return;
      const reason = ['rejected', 'needs_more_information', 'referred'].includes(sel.value) ? prompt('Reason the sender will see:') : (prompt('Note for the sender (optional):') || null);
      const { error: e2 } = await sb.rpc('kasa_admin_ev_triage_submission', { p_id: Number(sel.dataset.evsub), p_status: sel.value, p_reason: reason });
      if (e2) alert('Failed: ' + (e2.details || e2.message)); loadEvidence();
    }));
    return;
  }
  el.innerHTML = tabs + `
    <details style="margin-bottom:.8rem"><summary class="ad-ev" style="display:inline-block">+ Add ${esc(K.label.toLowerCase().replace(/s$/, ''))}</summary>${evForm(K, {}, null)}</details>
    ${evKind === 'harm' || evKind === 'assertion' ? evLinkForm() : ''}
    ${data.length ? `<table class="ad-table"><thead><tr><th>Id</th><th>Record</th><th>State</th><th></th></tr></thead><tbody>
      ${data.map(r => `<tr><td>${esc(r.id)}</td><td>${esc(K.show(r))}${r.sensitivity === 'sensitive' ? ' <small>· sensitive (2 moderators + legal gate)</small>' : ''}</td>
        <td>${esc(r.publication_state || r.review_status || (r.verified ? 'verified' : r.validation_state) || '')}<br><small>${r.approvals} approval${r.approvals === 1 ? '' : 's'}</small></td>
        <td style="white-space:nowrap">
          <button class="ad-ok" data-evr="${esc(r.id)}" data-act="approve">✓ Approve</button>
          <button class="ad-ev" data-evr="${esc(r.id)}" data-act="request_changes">↺ Send back</button>
          <button class="ad-bad" data-evr="${esc(r.id)}" data-act="reject">✕ Reject</button>
          ${K.pub ? `<button class="ad-ev" data-evr="${esc(r.id)}" data-act="archive">Archive</button>` : ''}
          ${K.fields ? `<button class="ad-ev" data-eve="${esc(r.id)}">Edit</button>` : ''}
        </td></tr><tr hidden data-evrow="${esc(r.id)}"><td colspan="4">${evForm(K, r, r.id)}</td></tr>`).join('')}
    </tbody></table>` : '<div class="ad-empty">None yet.</div>'}`;
  wireTabs(el);
  el.querySelectorAll('[data-eve]').forEach(b => b.addEventListener('click', () => {
    const row = el.querySelector(`[data-evrow="${b.dataset.eve}"]`); row.hidden = !row.hidden;
  }));
  el.querySelectorAll('[data-evr]').forEach(b => b.addEventListener('click', async () => {
    const why = prompt(b.dataset.act === 'approve' ? 'What did you check? (kept in the review log)' : 'Reason (kept in the review log):');
    if (!why) return;
    b.disabled = true;
    const { data: r, error: e2 } = await sb.rpc('kasa_admin_ev_review', { p_kind: evKind, p_id: Number(b.dataset.evr), p_decision: b.dataset.act, p_rationale: why });
    if (e2){ alert(e2.details || e2.message); b.disabled = false; return; }
    if (r && r.state === 'in_review') alert(`Saved. ${r.approvals} of ${r.needed} approvals from different moderators.`);
    loadEvidence();
  }));
  el.querySelectorAll('form[data-evform]').forEach(f => f.addEventListener('submit', async e => {
    e.preventDefault();
    const row = {};
    K.fields.forEach(([c, , t]) => {
      const v = f.elements[c].value.trim();
      if (v === '' && !f.dataset.evform) return;
      row[c] = v === '' ? null : t === 'number' ? Number(v) : (v === 'true' || v === 'false') && Array.isArray(t) ? v === 'true' : v;
    });
    const id = f.dataset.evform ? Number(f.dataset.evform) : null;
    let note = null;
    if (id && f.dataset.pub === 'published') { note = prompt('This is public. What did you correct and why? (published in the corrections log)'); if (!note) return; }
    const { error: e2 } = await sb.rpc('kasa_admin_ev_save', { p_kind: evKind, p_row: row, p_id: id, p_note: note });
    if (e2){ alert(e2.details || e2.message); return; }
    loadEvidence();
  }));
  const lf = el.querySelector('#evLink');
  if (lf) lf.addEventListener('submit', async e => {
    e.preventDefault();
    const { error: e2 } = await sb.rpc('kasa_admin_ev_link', { p_kind: lf.kind.value, p_a: Number(lf.a.value), p_b: lf.b.value.trim(),
      p_role: lf.role.value.trim() || null, p_document_id: lf.doc.value ? Number(lf.doc.value) : null, p_rationale: lf.why.value.trim() || null, p_remove: lf.remove.checked });
    if (e2){ alert(e2.details || e2.message); return; }
    alert('Saved.'); lf.reset();
  });
}

function wireTabs(el){
  el.querySelectorAll('[data-evk]').forEach(b => b.addEventListener('click', () => { evKind = b.dataset.evk; loadEvidence(); }));
}

function evForm(K, r, id){
  return `<form data-evform="${id || ''}" data-pub="${esc(r.publication_state || '')}" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:.5rem;margin:.6rem 0">
    ${K.fields.map(([c, label, t]) => {
      const v = r[c] == null ? '' : String(r[c]);
      const input = Array.isArray(t) ? `<select name="${c}">${t.map(o => `<option${o === v ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`
        : t === 'area' ? `<textarea name="${c}" rows="3">${esc(v)}</textarea>`
        : `<input name="${c}" type="${t === 'number' ? 'number' : t === 'date' ? 'date' : t === 'url' ? 'url' : 'text'}" step="any" value="${esc(t === 'date' ? v.slice(0, 10) : v)}">`;
      return `<label style="display:grid;gap:.2rem;font-size:.85rem">${esc(label)}${input}</label>`;
    }).join('')}
    <div><button class="ad-ok" type="submit">${id ? 'Save changes' : 'Add'}</button></div></form>`;
}

function evLinkForm(){
  return `<details style="margin-bottom:.8rem"><summary class="ad-ev" style="display:inline-block">Link records</summary>
    <form id="evLink" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:.5rem;margin:.6rem 0">
      <label>Link<select name="kind"><option value="harm_report">Harm ↔ map report</option><option value="assertion_entity">Assertion ↔ entity</option><option value="assertion_proceeding">Assertion ↔ case</option></select></label>
      <label>Harm / assertion id<input name="a" type="number" required></label>
      <label>Report / entity / case id<input name="b" required></label>
      <label>Role (entity links)<input name="role" placeholder="executing agency, contractor…"></label>
      <label>Document id<input name="doc" type="number"></label>
      <label>Why (from the document)<input name="why"></label>
      <label><input name="remove" type="checkbox"> Remove this link</label>
      <div><button class="ad-ok" type="submit">Save link</button></div>
    </form></details>`;
}
