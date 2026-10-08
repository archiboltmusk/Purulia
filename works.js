/* Public works boards in the chosen district (place-facts.js), their defect liability period, and an RTI request. */
(async function(){
  const cfg = window.KASA_CONFIG || {};
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = d => d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const dlp = y => y == null ? '' : Number(y) < 1 ? `${Math.round(Number(y) * 12)} months` : `${Number(y)} year${Number(y) === 1 ? '' : 's'}`;

  const PF = window.PlaceFacts;
  let slug = 'purulia', D = null;
  if (PF){ await PF.load().catch(() => null); if (PF.data){ slug = PF.current(); D = PF.data.districts[slug]; } }
  const NAME = D ? D.name : 'Purulia';
  const inPlace = PF && PF.data ? await PF.reportFilter(slug) : () => true;
  if (slug !== 'purulia') document.title = `Public works warranty in ${NAME} — Parishkar Bengal`;

  let works = [];
  const where = w => [w.ward_no ? `Ward ${w.ward_no}` : w.block_name ? `${w.block_name} block` : '', w.district || ''].filter(Boolean).join(', ');

  const { data, error } = await sb.rpc('kasa_public_works');
  const el = document.getElementById('wk-list');
  if (error){ set('wk-updated', 'Could not load. Please try again later.'); }
  else {
    works = (data || []).filter(inPlace);
    set('wk-updated', 'Updated ' + new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }));
    set('wk-t-works', works.length);
    set('wk-t-live', works.filter(w => w.under_warranty).length);
    set('wk-t-dlp', works.filter(w => w.dlp_years != null).length);
    el.innerHTML = !works.length
      ? `<div class="an-empty">No works board recorded in ${esc(NAME)} yet. Standing at one? <a href="kasa.html?work=1">Record it</a>.</div>`
      : `<table class="an-table"><thead><tr><th>Board</th><th>Work</th><th>Where</th><th>Completed</th><th>Defect liability</th><th>Warranty</th></tr></thead><tbody>
        ${works.map(w => `<tr id="work-${esc(w.id)}">
          <td><a href="${esc(w.photo_url)}" target="_blank" rel="noopener"><img class="wk-thumb" src="${esc(w.photo_url)}" alt="Photo of the site board" loading="lazy"></a></td>
          <td><strong>${esc(w.work_name)}</strong>
            <span class="wk-small">${esc(w.agency)}${w.work_order ? ' · ' + esc(w.work_order) : ''}${w.cost ? ' · ' + esc(w.cost) : ''}</span>
            ${w.contractor ? `<span class="wk-small">Contractor (as on the board): ${esc(w.contractor)}</span>` : ''}</td>
          <td><a href="kasa.html?at=${esc(w.lat)},${esc(w.lng)},18">${esc(where(w) || 'See on map')}</a></td>
          <td>${esc(fmt(w.completed_on)) || '<span class="ad-over">not on the board</span>'}</td>
          <td>${esc(dlp(w.dlp_years)) || '<span class="ad-over">not on the board</span>'}</td>
          <td>${w.warranty_until
            ? (w.under_warranty ? `<span class="ad-ok">Until ${esc(fmt(w.warranty_until))}</span>` : `<span class="ad-over">Ended ${esc(fmt(w.warranty_until))}</span>`)
            : '<span class="ad-over">—</span>'}
            <span class="wk-small"><a href="#rti" data-rti="${esc(w.id)}">RTI request</a></span></td></tr>`).join('')}</tbody></table>`;
  }

  // The RTI request: RTI Act 2005, s.6(1) application, s.6(3) transfer. The items are the papers
  // clause 17 turns on: the contract's period, the measurements, the completion certificate.
  const pick = document.getElementById('wk-f-work');
  pick.insertAdjacentHTML('beforeend', works.map(w => `<option value="${esc(w.id)}">${esc(w.work_name.slice(0, 80))}</option>`).join(''));
  const f = id => document.getElementById(id).value.trim();
  function fill(id){
    const w = works.find(x => String(x.id) === String(id));
    pick.value = w ? String(w.id) : '';
    document.getElementById('wk-f-name').value = w ? w.work_name : '';
    document.getElementById('wk-f-agency').value = w ? w.agency : '';
    document.getElementById('wk-f-order').value = w ? (w.work_order || '') : '';
    rti();
  }
  function rti(){
    const w = works.find(x => String(x.id) === pick.value);
    const name = f('wk-f-name') || '[name of the work]', agency = f('wk-f-agency') || '[office or body that did the work]', order = f('wk-f-order');
    const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
    const place = w && where(w) ? `, at ${where(w)}` : '';
    const board = w ? `\nThe site board of this work${w.completed_on ? `, which gives the date of completion as ${fmt(w.completed_on)}` : ''}${w.dlp_years != null ? ` and the defect liability period as ${dlp(w.dlp_years)}` : ''}, is recorded at ${location.origin}${location.pathname}#work-${w.id}\n` : '';
    document.getElementById('wk-rti').value =
`To
The Public Information Officer
${agency}

Date: ${today}

Subject: Application under section 6(1) of the Right to Information Act, 2005

Sir / Madam,

Please provide the following information about the work "${name}"${order ? ` (work order / tender no. ${order})` : ''}${place}.
${board}
1. A copy of the work order and the contract agreement for this work, including the clause on the defect liability period.
2. Copies of the measurement book entries for this work.
3. A copy of the completion certificate, showing the actual date of completion.
4. The amount paid to the contractor so far, and whether the security deposit for this work is still held or has been refunded, with the dates.
5. Copies of any complaints about defects in this work received after its completion, and the action taken on each, including repairs done at the contractor's cost.

I am a citizen of India. I am paying the application fee as prescribed. If this information is held by another public authority, please transfer this application to it under section 6(3) of the Act and inform me.

Yours faithfully,

${f('wk-f-me') || '[Your name]'}
${f('wk-f-addr') || '[Your address]'}
`;
  }
  pick.addEventListener('change', () => fill(pick.value));
  ['wk-f-name', 'wk-f-agency', 'wk-f-order', 'wk-f-me', 'wk-f-addr'].forEach(id => document.getElementById(id).addEventListener('input', rti));
  el.addEventListener('click', e => { const a = e.target.closest('[data-rti]'); if (a) fill(a.dataset.rti); });
  const m = /^#work-(\d+)$/.exec(location.hash);
  if (m && works.some(w => String(w.id) === m[1])){ fill(m[1]); document.getElementById('work-' + m[1])?.scrollIntoView({ block: 'center' }); }
  else rti();

  document.getElementById('wk-copy').addEventListener('click', async e => {
    const t = document.getElementById('wk-rti');
    try { await navigator.clipboard.writeText(t.value); } catch (err) { t.select(); document.execCommand('copy'); }
    e.target.textContent = 'Copied';
    setTimeout(() => { e.target.textContent = 'Copy the request'; }, 2000);
  });
})();
