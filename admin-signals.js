/* Admin: claim vs reality signals (private). Candidate DLP damage clusters from
   kasa_private.reality_signals (migration 20261021110000_kasa_reality_signals.sql). Moderator-only:
   run the check, list by status, approve or reject a candidate with a note. Nothing here is public;
   contractor names and reporter hashes are never returned by the RPCs. Uses admin.js's sb + esc. */
let sigStatus = 'candidate';

async function loadSignals(){
  const el = document.getElementById('adSignals');
  if (!el) return;
  const tabs = `<div style="display:flex;flex-wrap:wrap;gap:.35rem;margin-bottom:.8rem">
    ${['candidate', 'approved', 'rejected'].map(s => `<button class="${s === sigStatus ? 'ad-ok' : 'ad-ev'}" data-sigs="${s}">${s}</button>`).join('')}
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
      <td>${s.status === 'candidate'
        ? `<button class="ad-ok" data-sigok="${esc(s.id)}">Approve</button> <button class="ad-bad" data-signo="${esc(s.id)}">Reject</button>`
        : `<small>${esc(s.status)} ${s.reviewed_at ? esc(new Date(s.reviewed_at).toLocaleDateString('en-IN')) : ''}${s.review_note ? `<br>${esc(s.review_note)}` : ''}</small>`}</td>
    </tr>`).join('')}</tbody></table>`
    : `<div class="ad-empty">${sigStatus === 'candidate' ? 'No candidates. The check needs completed works with a cited DLP and a moderator-confirmed road link.' : 'None.'}</div>`);
  wireSignals(el);
}

function wireSignals(el){
  el.querySelectorAll('[data-sigs]').forEach(b => b.addEventListener('click', () => { sigStatus = b.dataset.sigs; loadSignals(); }));
  const run = el.querySelector('#sigRun');
  if (run) run.addEventListener('click', async () => {
    run.disabled = true;
    const { data, error } = await sb.rpc('kasa_admin_reality_signals_run');
    if (error) alert('Failed: ' + (error.details || error.message)); else alert(`${data} candidate${data === 1 ? '' : 's'} raised or refreshed.`);
    loadSignals();
  });
  el.querySelectorAll('[data-sigok],[data-signo]').forEach(b => b.addEventListener('click', async () => {
    const approve = 'sigok' in b.dataset;
    const note = prompt(approve ? 'Note (private): what you checked (photos, link, counts)' : 'Note (private): why rejected (duplicate, noise, wrong road, photo issue)');
    if (note === null) return;
    const { error } = await sb.rpc('kasa_admin_review_reality_signal', { p_id: Number(approve ? b.dataset.sigok : b.dataset.signo), p_decision: approve ? 'approved' : 'rejected', p_note: note });
    if (error) alert('Failed: ' + (error.details || error.message));
    loadSignals();
  }));
}
