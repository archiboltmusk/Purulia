/* Admin: claim vs reality signals (private). Candidate DLP damage clusters from
   kasa_private.reality_signals (migration 20261021110000_kasa_reality_signals.sql). Moderator-only:
   run the check, list by §13 status, move a signal one step with a private note
   (kasa_admin_transition_cluster_state, migration 20261021120000). Nothing here is public;
   contractor names and reporter hashes are never returned by the RPCs. Uses admin.js's sb + esc. */
let sigStatus = 'staged';
const SIG_STATES = { staged: 'Staged', internal_review: 'Internal review', notice_issued: 'Notice issued',
  under_counsel_review: 'With counsel', disputed_paused: 'Disputed, paused', rejected_evidence: 'Rejected',
  rectified_officially: 'Fixed by office', approved_public: 'Public' };
// Mirrors the server's transition trigger. approved_public is refused server-side until counsel sign-off exists.
const SIG_NEXT = {
  staged: ['internal_review', 'rejected_evidence'],
  internal_review: ['notice_issued', 'under_counsel_review', 'rectified_officially', 'rejected_evidence'],
  notice_issued: ['under_counsel_review', 'disputed_paused', 'rectified_officially', 'rejected_evidence'],
  under_counsel_review: ['disputed_paused', 'rectified_officially', 'rejected_evidence'],
  disputed_paused: ['under_counsel_review', 'rectified_officially', 'rejected_evidence'],
  approved_public: ['disputed_paused'] };
const SIG_REASONS = ['insufficient_evidence', 'duplicate', 'personal_data', 'child_in_photo', 'wrong_asset', 'noise', 'other'];

async function loadSignals(){
  const el = document.getElementById('adSignals');
  if (!el) return;
  const tabs = `<div style="display:flex;flex-wrap:wrap;gap:.35rem;margin-bottom:.8rem">
    ${Object.keys(SIG_STATES).map(s => `<button class="${s === sigStatus ? 'ad-ok' : 'ad-ev'}" data-sigs="${s}">${SIG_STATES[s]}</button>`).join('')}
    <button class="ad-ev" id="sigRun">Run the check now</button></div>`;
  const { data, error } = await sb.rpc('kasa_admin_reality_signals', { p_status: sigStatus, p_limit: 100 });
  if (error){ el.innerHTML = tabs + `<div class="ad-empty">Could not load: ${esc(error.details || error.message)}</div>`; wireSignals(el); return; }
  el.innerHTML = tabs + (data.length ? `<table class="ad-table"><thead><tr><th>Work</th><th>Reports</th><th>Dates</th><th>Where</th><th></th></tr></thead><tbody>
    ${data.map(s => `<tr>
      <td>${esc(s.work_title)}<br><small>${esc(s.portal || '')} ${esc(s.tender_ref || '')} · completed ${esc(s.completed_on)} · DLP ${esc(s.dlp_months)} months
        ${/^https?:\/\//.test(s.dlp_source_url || '') ? `(<a href="${esc(s.dlp_source_url)}" target="_blank" rel="noopener noreferrer">source</a>)` : ''}</small>
        <br><small>${esc(s.asset_name || '')} ${esc(s.asset_ref || '')}</small></td>
      <td>${esc(s.report_count)} reports<br><small>${esc(s.distinct_reporters)} different reporters</small></td>
      <td><small>${esc(s.first_reported_on)} to ${esc(s.latest_reported_on)}</small></td>
      <td><a href="kasa.html?at=${esc(s.cluster_lat)},${esc(s.cluster_lng)},18" target="_blank" rel="noopener">Map</a></td>
      <td><small>#${esc(s.id)}${s.reviewed_at ? ' · ' + esc(new Date(s.reviewed_at).toLocaleDateString('en-IN')) : ''}${s.reject_reason ? ` · ${esc(s.reject_reason)}${s.duplicate_of ? ' of #' + esc(s.duplicate_of) : ''}` : ''}${s.review_note ? `<br>${esc(s.review_note)}` : ''}</small>
        ${(SIG_NEXT[s.status] || []).map(t => `<br><button class="${t === 'rejected_evidence' ? 'ad-bad' : 'ad-ok'}" data-sigid="${esc(s.id)}" data-sigto="${t}">${SIG_STATES[t]}</button>`).join('')}</td>
    </tr>`).join('')}</tbody></table>`
    : `<div class="ad-empty">${sigStatus === 'staged' ? 'Nothing staged. The check needs completed works with a cited DLP and a moderator-confirmed road link.' : 'None.'}</div>`);
  wireSignals(el);
}

function wireSignals(el){
  el.querySelectorAll('[data-sigs]').forEach(b => b.addEventListener('click', () => { sigStatus = b.dataset.sigs; loadSignals(); }));
  const run = el.querySelector('#sigRun');
  if (run) run.addEventListener('click', async () => {
    run.disabled = true;
    const { data, error } = await sb.rpc('kasa_admin_reality_signals_run');
    if (error) alert('Failed: ' + (error.details || error.message)); else alert(`${data} signal${data === 1 ? '' : 's'} staged or refreshed.`);
    loadSignals();
  });
  el.querySelectorAll('[data-sigto]').forEach(b => b.addEventListener('click', async () => {
    const to = b.dataset.sigto;
    let reason = null, dup = null;
    if (to === 'rejected_evidence'){
      reason = prompt('Reject reason, one of:\n' + SIG_REASONS.join(', '), 'insufficient_evidence');
      if (reason === null) return;
      reason = reason.trim();
      if (!SIG_REASONS.includes(reason)){ alert('Unknown reason.'); return; }
      if (reason === 'duplicate'){
        dup = prompt('Duplicate of which signal? (number after #)');
        if (dup === null) return;
      }
    }
    const note = prompt(`Note (private) for "${SIG_STATES[to]}": what you checked${to === 'notice_issued' ? ', and the docket or RTI reference' : ''}`);
    if (note === null) return;
    const { error } = await sb.rpc('kasa_admin_transition_cluster_state', { p_id: Number(b.dataset.sigid), p_to: to, p_note: note,
      p_reason: reason, p_duplicate_of: dup ? Number(dup) : null });
    if (error) alert('Failed: ' + (error.details || error.message));
    loadSignals();
  }));
}
