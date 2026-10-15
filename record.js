/* The record: published harms, each traced from source document to assertion, case, remedy and
   checked outcome (kasa_ev_* RPCs, migration 20261014200000_kasa_evidence.sql). Views:
   no query = counts + registry + sources; ?h=H-1 = one harm; ?e=E-1 = one entity; ?s=S-XXXX = a
   submission's status (key kept on this device). Every figure on screen is a row count or a value
   copied from a document that is linked beside it. */
(async function(){
  const cfg = window.KASA_CONFIG || {};
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = id => document.getElementById(id);
  const view = $('rc-view');
  const qs = new URLSearchParams(location.search);
  const fmt = d => d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const words = s => String(s || '').replace(/_/g, ' ');
  const url = u => /^https?:\/\//i.test(String(u || '')) ? esc(u) : '#';
  const KEYS = 'parishkar_ev_keys';
  const keys = () => { try { return JSON.parse(localStorage.getItem(KEYS) || '{}'); } catch (e) { return {}; } };

  const EVIDENCE = {
    unverified: ['Not yet checked', 'warn'], source_checked: ['Source checked', ''], corroborated: ['Corroborated', 'ok'],
    disputed: ['Disputed', 'bad'], insufficient_evidence: ['Not enough evidence', 'warn'],
    established_by_finding: ['Official or court finding', 'ok'], corrected: ['Corrected', 'warn'], withdrawn: ['Withdrawn', 'bad'], superseded: ['Superseded', 'warn']
  };
  const STAGES = [['identified', 'Identified'], ['verified', 'Verified'], ['referred', 'Referred'], ['assessed', 'Response assessed'], ['outcome_verified', 'Outcome checked']];
  const MONEY = {
    allocated: 'Allocated', contract: 'Contract value', reported_paid: 'Reported as paid', verified_paid: 'Independently verified as paid',
    work_done: 'Value of work done', audit_questioned: 'Questioned by audit', recoverable: 'Officially recoverable', recovered: 'Actually recovered'
  };
  const tag = (txt, cls) => `<span class="rc-tag ${cls || ''}">${esc(txt)}</span>`;
  const evTag = s => tag((EVIDENCE[s] || [words(s)])[0], (EVIDENCE[s] || [])[1]);
  const rupees = n => '₹' + Number(n).toLocaleString('en-IN');
  const hist = h => (h && h.length > 1) ? `<div class="rc-hist">History: ${h.map((x, i) =>
      (i < h.length - 1 ? `<s>${esc(words(x.value))}</s>` : `<b>${esc(words(x.value))}</b>`) + ` <span>${fmt(x.as_of)}</span>`).join(' → ')}</div>` : '';
  const doc = (d, locator, excerpt) => !d ? '' : `<div>
      <a href="${url(d.url)}" target="_blank" rel="noopener">${esc(d.title)}</a>${locator ? `, ${esc(locator)}` : ''}
      ${excerpt ? `<blockquote>“${esc(excerpt)}”</blockquote>` : ''}
      <small>${esc(d.publisher || '')}${d.published_on ? ` · published ${fmt(d.published_on)}` : ''} · retrieved ${fmt(d.retrieved_at)}
        ${d.archive_url ? ` · <a href="${url(d.archive_url)}" target="_blank" rel="noopener">archived copy</a>` : ''}
        ${d.sha256 ? ` · SHA-256 <code>${esc(d.sha256.slice(0, 12))}…</code>` : ''}
        ${d.status !== 'live' ? ` · ${tag(d.status === 'gone' ? 'source removed' : 'source changed since', 'warn')}` : ''}
        ${d.source_state !== 'approved' ? ` · ${tag('source not yet checked', 'warn')}` : ''}</small></div>`;

  async function rpc(name, args){
    const { data, error } = await sb.rpc(name, args || {});
    if (error) throw error;
    return data;
  }

  function submitForm(kind, target){
    const KINDS = target
      ? [['correction', 'Something here is wrong'], ['right_of_reply', 'Reply from a body or person named here'], ['evidence', 'Another document about this']]
      : [['document', 'A public document about a problem'], ['source', 'An official source we should check'], ['harm', 'A public problem with documents']];
    return `<section class="an-card" id="send">
      <h2>${target ? 'Correct this, reply to it, or add a document' : 'Send a document or source'}</h2>
      <p class="an-card-sub">Nothing you send is published as it is. A moderator checks it against the document first, and you get a reference number to follow it. Send links to public documents only, not private papers or anyone's personal details. We cannot promise to keep your identity secret in every case, so leave your name out unless you are replying on behalf of a body.</p>
      <form class="rc-form" id="rc-send">
        <select class="rc-in" name="kind">${KINDS.map(([k, l]) => `<option value="${k}"${k === kind ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>
        <input class="rc-in" name="url" type="url" placeholder="Link to the document or page (https://…)">
        <textarea class="rc-in" name="body" required minlength="20" maxlength="4000" placeholder="What does it show? Give the page or table number."></textarea>
        <div><button class="rc-btn pri" type="submit">Send for checking</button> <span class="rc-msg" id="rc-send-msg"></span></div>
      </form></section>`;
  }
  function wireForm(target){
    const f = $('rc-send'); if (!f) return;
    f.addEventListener('submit', async e => {
      e.preventDefault();
      const msg = $('rc-send-msg'); msg.textContent = 'Sending…';
      try {
        const r = await rpc('kasa_ev_submit', { p_kind: f.kind.value, p_body: f.body.value, p_url: f.url.value || null,
          p_target_type: target ? target.type : null, p_target_id: target ? target.id : null });
        const k = keys(); k[r.ref_no] = r.key;
        try { localStorage.setItem(KEYS, JSON.stringify(k)); } catch (err) {}
        f.reset();
        msg.innerHTML = `Received. Your reference is <b>${esc(r.ref_no)}</b>. <a href="record.html?s=${encodeURIComponent(r.ref_no)}">Follow it</a> (works on this phone).`;
      } catch (err) { msg.textContent = err.message || 'Could not send. Please try again.'; }
    });
  }

  async function home(){
    const [stats, sources] = await Promise.all([rpc('kasa_ev_stats'), rpc('kasa_ev_sources')]);
    const sum = o => Object.values(o || {}).reduce((a, b) => a + Number(b), 0);
    const PF = window.PlaceFacts; let districts = [];
    if (PF) { await PF.load().catch(() => null); if (PF.data) districts = Object.entries(PF.data.districts).map(([s, d]) => [s, d.name]).sort((a, b) => a[1].localeCompare(b[1])); }
    const mine = Object.keys(keys());
    view.innerHTML = `
      <div class="an-tiles">
        <div class="an-tile"><div class="an-tile-n">${sum(stats.harms)}</div><div class="an-tile-l">Published records</div><div class="an-tile-s">${stats.remedies_unresolved} with a remedy still unresolved</div></div>
        <div class="an-tile"><div class="an-tile-n">${sum(stats.assertions)}</div><div class="an-tile-l">Checked assertions</div><div class="an-tile-s">${Number((stats.assertions || {}).disputed || 0)} disputed</div></div>
        <div class="an-tile"><div class="an-tile-n">${Number((stats.remedies || {}).outcome_verified || 0)}</div><div class="an-tile-l">Fixes checked on the ground</div><div class="an-tile-s">of ${sum(stats.remedies)} remedies asked for</div></div>
        <div class="an-tile"><div class="an-tile-n">${stats.documents}</div><div class="an-tile-l">Documents on file</div><div class="an-tile-s">${Number((stats.sources || {}).approved || 0)} of ${sum(stats.sources)} sources checked</div></div>
        <div class="an-tile"><div class="an-tile-n">${stats.corrections}</div><div class="an-tile-l">Corrections made</div><div class="an-tile-s">all listed on each record</div></div>
      </div>
      <section class="an-card" style="margin-top:1.4rem">
        <h2>Records</h2>
        <form class="rc-bar" id="rc-filter">
          <input class="rc-in" type="search" name="q" placeholder="Search a place, office, case number or firm">
          <select class="rc-in" name="d"><option value="">All districts</option>${districts.map(([s, n]) => `<option value="${esc(s)}">${esc(n)}</option>`).join('')}</select>
          <button class="rc-btn" type="submit">Search</button>
        </form>
        <ul class="rc-list" id="rc-list"></ul>
      </section>
      ${mine.length ? `<section class="an-card"><h2>What you sent</h2><ul class="rc-list">${mine.map(r => `<li><a href="record.html?s=${encodeURIComponent(r)}"><b>${esc(r)}</b><small>Check where it is</small></a></li>`).join('')}</ul></section>` : ''}
      ${submitForm('document', null)}
      <section class="an-card">
        <h2>Sources we use or plan to check</h2>
        <p class="an-card-sub">Official portals a record can cite. "Not yet checked" means a moderator has not yet opened the source and confirmed what it publishes and on what terms. Nothing from such a source is published until it is checked.</p>
        <div class="an-table-wrap"><table class="an-table"><thead><tr><th>Source</th><th>Covers</th><th>State</th><th>Documents</th></tr></thead><tbody>
        ${sources.map(s => `<tr><td><a href="${url(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a><br><small class="rc-muted">${esc(s.publisher || '')} · ${esc(s.jurisdiction)}</small></td>
          <td>${esc(s.domains || '')}${s.limitations ? `<br><small class="rc-muted">${esc(s.limitations)}</small>` : ''}</td>
          <td>${s.state === 'approved' ? tag('Checked', 'ok') : s.state === 'retired' ? tag('No longer used') : tag('Not yet checked', 'warn')}</td><td>${s.documents}</td></tr>`).join('')}
        </tbody></table></div>
      </section>`;
    const list = async () => {
      const f = $('rc-filter');
      const q = f.q.value.trim();
      const rows = q.length >= 2 && !f.d.value ? await rpc('kasa_ev_search', { p_q: q })
        : await rpc('kasa_ev_harms', { p_district: f.d.value || null, p_domain: null, p_q: q || null });
      $('rc-list').innerHTML = rows.length ? rows.map(r => {
        const href = r.type === 'entity' ? `record.html?e=${encodeURIComponent(r.id)}` : `record.html?h=${encodeURIComponent(r.harm || r.id)}`;
        return `<li><a href="${href}"><b>${esc(r.title)}</b><small>${r.type && r.type !== 'harm' ? tag(r.type === 'entity' ? words(r.kind) : 'case') : ''}
          ${r.status ? tag(words(r.status)) : ''}${r.remedy_stage ? tag('remedy: ' + words(r.remedy_stage)) : ''}
          ${esc([r.local_body, r.block, r.district].filter(Boolean).join(', '))}${r.updated ? ` · updated ${fmt(r.updated)}` : ''}</small></a></li>`;
      }).join('') : `<li class="an-empty">${q ? 'Nothing matches.' : 'No records are published yet. Each one goes up only after its documents are checked; send one below.'}</li>`;
    };
    $('rc-filter').addEventListener('submit', e => { e.preventDefault(); list().catch(err => { $('rc-list').innerHTML = `<li class="an-empty">${esc(err.message)}</li>`; }); });
    await list();
    wireForm(null);
  }

  async function harm(id){
    const h = await rpc('kasa_ev_harm', { p_id: id });
    if (!h) { view.innerHTML = `<p class="an-empty">This record is not published, or the link is wrong. <a href="record.html">All records</a></p>`; return; }
    document.title = h.title + ' — Parishkar Bengal';
    const place = [h.local_body, h.block, h.district, h.state].filter(Boolean).join(', ');
    const rem = h.remedies;
    view.innerHTML = `
      <p class="rc-muted"><a href="record.html" style="color:var(--amber)">← All records</a> · ${esc(h.id)}</p>
      <section class="an-card">
        <h2>${esc(h.title)}</h2>
        <p class="an-card-sub">${tag(words(h.status))} ${esc(place)}${h.period_from ? ` · ${fmt(h.period_from)}${h.period_to ? ' to ' + fmt(h.period_to) : ' onwards'}` : ''} · updated ${fmt(h.updated)}</p>
        <p style="margin-top:.8rem">${esc(h.description)}</p>
        ${h.affected_estimate != null ? `<p class="rc-muted">People affected: about ${Number(h.affected_estimate).toLocaleString('en-IN')} (${esc(h.affected_basis || 'basis not given')})</p>` : ''}
        <div class="rc-unknown"><b>Still not known:</b> ${esc(h.unknown)}</div>
        ${hist(h.history)}
        ${h.reports.length ? `<p style="margin-top:.8rem">Photo reports on the map: ${h.reports.map(r => `<a href="case.html?id=${encodeURIComponent(r)}">case file</a>`).join(', ')}</p>` : ''}
      </section>
      <section class="an-card"><h2>What the documents say</h2>
        ${h.assertions.map(a => `<div style="margin-top:1rem">
          <p>${evTag(a.evidence_state)} <b style="color:var(--cream)">${esc(a.headline)}</b> <span class="rc-muted">${esc(a.id)}${a.as_of ? ` · as of ${fmt(a.as_of)}` : ''}</span></p>
          <p>${esc(a.body)}</p>
          ${a.uncertainty ? `<p class="rc-muted">Uncertain: ${esc(a.uncertainty)}</p>` : ''}
          ${hist(a.history)}
          ${a.evidence.map(e => `<div class="rc-ev ${esc(e.role)}">${tag(e.role === 'supports' ? 'Supports' : e.role === 'contradicts' ? 'Contradicts' : 'Context', e.role === 'supports' ? 'ok' : e.role === 'contradicts' ? 'bad' : '')}${doc(e.document, e.locator, e.excerpt)}</div>`).join('')}
          ${a.entities.length ? `<p class="rc-muted" style="margin-top:.5rem">Named in this: ${a.entities.map(x => `<a href="record.html?e=${encodeURIComponent(x.id)}">${esc(x.name)}</a> (${esc(x.role)})`).join(', ')}</p>` : ''}
          ${a.proceedings.map(p => `<div class="rc-ev"><b>${esc(words(p.kind).toUpperCase())}${p.ref_no ? ' ' + esc(p.ref_no) : ''}</b>${p.forum ? ` · ${esc(p.forum)}` : ''}
            <br>Stage: ${tag(words(p.stage))} as of ${fmt(p.as_of)}${p.filed_on ? ` · filed ${fmt(p.filed_on)}` : ''}
            ${p.summary ? `<br>${esc(p.summary)}` : ''}${hist(p.history)}${doc(p.document)}
            ${p.url ? `<small><a href="${url(p.url)}" target="_blank" rel="noopener">Official status page</a></small>` : ''}</div>`).join('')}
          ${a.reply && a.reply !== 'not_requested' ? `<p class="rc-muted">Right of reply: ${esc(words(a.reply))}</p>` : ''}
        </div>`).join('')}
      </section>
      ${h.money.length ? `<section class="an-card"><h2>Money on record</h2>
        <p class="an-card-sub">Each figure is a different kind of amount and they are never added together. A contract value is not money paid; money questioned by an audit is not money found missing.</p>
        <div class="an-table-wrap"><table class="an-table"><thead><tr><th>Kind</th><th>Amount</th><th>As of</th><th>Document</th></tr></thead><tbody>
        ${h.money.map(m => `<tr><td>${esc(MONEY[m.basis] || words(m.basis))}</td><td>${rupees(m.amount)}</td><td>${fmt(m.as_of) || esc(m.year || '')}</td><td>${doc(m.document, m.locator)}</td></tr>`).join('')}
        </tbody></table></div></section>` : ''}
      ${h.responses.length ? `<section class="an-card"><h2>Responses</h2>${h.responses.map(r => `<div class="rc-ev"><b>${esc(r.from)}</b>, ${fmt(r.received_on)}<blockquote>${esc(r.summary)}</blockquote>${doc(r.document)}${r.url ? `<small><a href="${url(r.url)}" target="_blank" rel="noopener">Where it was said</a></small>` : ''}</div>`).join('')}</section>` : ''}
      <section class="an-card"><h2>Fixing it</h2>
        ${rem.length ? rem.map(r => `<div style="margin-top:.8rem">
          <p><b style="color:var(--cream)">${esc(r.requested)}</b> <span class="rc-muted">${esc(r.id)}${r.responsible ? ` · asked of ${esc(r.responsible)}` : ''}${r.due_on ? ` · due ${fmt(r.due_on)}` : ''}</span></p>
          <div class="rc-steps">${STAGES.map(([k, l], i) => `<span class="${STAGES.findIndex(s => s[0] === r.stage) >= i ? 'on' : ''}">${l}</span>`).join('')}</div>
          ${r.unresolved ? `<p>${tag(r.recurred ? 'Came back after the fix' : 'Unresolved', 'bad')}</p>` : ''}
          <p class="rc-muted">Office says: ${esc(words(r.action_status))}. ${r.stage !== 'outcome_verified' ? 'Not counted as fixed until someone checks it on the ground.' : ''}${r.recheck_on ? ` Checked again on ${fmt(r.recheck_on)}.` : ''}</p>
          ${hist(r.history)}
          ${r.outcomes.map(o => `<div class="rc-ev supports">${tag('Checked', 'ok')} ${esc(o.metric)}${o.baseline != null ? `: ${esc(o.baseline)} → ${esc(o.observed)} ${esc(o.unit || '')}` : ''}<br><small>${esc(o.method)} · ${fmt(o.verified_at)}
            ${o.evidence_kind === 'live_photo' && o.evidence_ref ? ` · <a href="case.html?id=${encodeURIComponent(o.evidence_ref)}">live camera photo</a>` : ''}</small>${doc(o.document)}</div>`).join('')}
        </div>`).join('') : '<p class="an-empty">No remedy has been asked for yet.</p>'}
      </section>
      <section class="an-card"><h2>Corrections</h2>
        ${h.corrections.length ? `<ul class="cl-list" style="list-style:none;padding:0">${h.corrections.map(c => `<li style="margin-top:.5rem">${fmt(c.at)}: ${esc(c.note)} <span class="rc-muted">(${esc(c.what)})</span></li>`).join('')}</ul>` : '<p class="an-empty">No corrections so far.</p>'}
      </section>
      ${submitForm('correction', true)}`;
    wireForm({ type: 'harm', id: h.id });
  }

  async function entity(id){
    const e = await rpc('kasa_ev_entity', { p_id: id });
    if (!e) { view.innerHTML = `<p class="an-empty">Not published, or the link is wrong. <a href="record.html">All records</a></p>`; return; }
    document.title = e.name + ' — Parishkar Bengal';
    view.innerHTML = `
      <p class="rc-muted"><a href="record.html" style="color:var(--amber)">← All records</a> · ${esc(e.id)}</p>
      <section class="an-card"><h2>${esc(e.name)}</h2>
        <p class="an-card-sub">${tag(words(e.kind))}${esc([e.district, e.jurisdiction].filter(Boolean).join(', '))}${e.identifier ? ` · ${esc(e.identifier)}` : ''}</p>
        ${e.identity_basis ? `<p class="rc-muted">How we know it is this one: ${esc(e.identity_basis)}</p>` : ''}
        <p class="rc-muted">A link below only records what a document says. Sharing a contract, office or place does not show that anyone did anything wrong.</p></section>
      <section class="an-card"><h2>Links on record</h2>
        ${e.links.length ? e.links.map(l => `<div class="rc-ev">${l.direction === 'out' ? '' : '← '}<b>${esc(words(l.kind))}</b> ${l.direction === 'out' ? '→ ' : ''}
          ${l.other ? `<a href="record.html?e=${encodeURIComponent(l.other.id)}">${esc(l.other.name)}</a>` : '(not published)'}
          ${tag(l.confidence === 'confirmed_identifier_match' ? 'Same official number' : 'Stated in a document', 'ok')}
          <br>${esc(l.rationale)}${l.valid_from ? ` <span class="rc-muted">· from ${fmt(l.valid_from)}${l.valid_to ? ' to ' + fmt(l.valid_to) : ''}</span>` : ''}${doc(l.document, l.locator)}</div>`).join('') : '<p class="an-empty">No published links.</p>'}
      </section>
      ${e.harms.length ? `<section class="an-card"><h2>Records that name it</h2><ul class="rc-list">${e.harms.map(h => `<li><a href="record.html?h=${encodeURIComponent(h.id)}"><b>${esc(h.title)}</b><small>${tag(words(h.status))} named as ${esc(h.role)}</small></a></li>`).join('')}</ul></section>` : ''}`;
  }

  async function status(ref){
    const k = keys()[ref];
    const s = k ? await rpc('kasa_ev_submission_status', { p_ref_no: ref, p_key: k }) : null;
    view.innerHTML = `<p class="rc-muted"><a href="record.html" style="color:var(--amber)">← All records</a></p>
      <section class="an-card"><h2>${esc(ref)}</h2>${s ? `<p>${tag(words(s.status))} sent ${fmt(s.sent)}${s.updated ? ` · updated ${fmt(s.updated)}` : ''}</p>${s.reason ? `<p style="margin-top:.6rem">Moderator's note: ${esc(s.reason)}</p>` : ''}`
        : '<p class="an-empty">This can only be checked on the phone it was sent from.</p>'}</section>`;
  }

  try {
    if (qs.get('h')) await harm(qs.get('h'));
    else if (qs.get('e')) await entity(qs.get('e'));
    else if (qs.get('s')) await status(qs.get('s').toUpperCase());
    else await home();
    $('rc-updated').textContent = 'Live from the record';
  } catch (err) {
    view.innerHTML = `<p class="an-empty">Could not load the record (${esc(err.message || err)}). Please try again.</p>`;
    $('rc-updated').textContent = '';
  }
})();
