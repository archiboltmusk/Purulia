/* Per-office board: open reports grouped by owner, from kasa_office_board() (counts and dates only). */
(async function(){
  const cfg = window.KASA_CONFIG || {};
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const day = d => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
  const CAT = { garbage: 'Garbage', dumpsite: 'Dumpsite', toilet: 'Toilet', drain: 'Drain', road: 'Road', streetlight: 'Streetlight', water: 'Water', missing: 'Missing', hand_pump: 'Hand pump', health_centre: 'Health centre', other: 'Other' };
  const status = document.getElementById('of-status'), list = document.getElementById('of-list');
  if (!window.supabase || !cfg.SUPABASE_URL) { status.textContent = 'Not available right now.'; return; }
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: false } });

  const { data, error } = await sb.rpc('kasa_office_board');
  if (error) { status.textContent = 'The office board is not available right now.'; return; }
  status.textContent = '';
  const rows = Array.isArray(data) ? data : [];
  if (!rows.length) { status.textContent = 'No open reports on record.'; return; }

  list.innerHTML = rows.map(o => {
    const cats = Object.entries(o.by_category || {}).sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `<span>${esc(CAT[k] || k)} · ${n}</span>`).join('');
    const contact = o.on_record
      ? `On record: ${esc(o.source)}`
      : 'Contact: not on record yet';
    const reports = (o.reports || []).map(r =>
      `<li><a href="case.html?id=${encodeURIComponent(r.id)}">${esc(CAT[r.category] || r.category)}, reported ${esc(day(r.created_at))} (${r.days_open} days open)</a></li>`).join('');
    return `<article class="of-card">
      <h2>${esc(o.title)}</h2>
      <div class="of-line">${contact}</div>
      <div class="of-nums">
        <span>Open: ${o.open}</span>
        <span>Past deadline: ${o.overdue}</span>
        <span>Oldest open: ${esc(day(o.oldest_open))} (${o.oldest_days} days)</span>
      </div>
      <div class="of-chips">${cats}</div>
      <div class="of-links">
        <a href="rti.html">RTI tracker</a>
        <span class="of-line">State grievance portal: not verified yet</span>
      </div>
      <details><summary>Reports (${o.open})</summary><ul>${reports}</ul></details>
    </article>`;
  }).join('');
})();
