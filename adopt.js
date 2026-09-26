/* Adopted spots page for Parishkar Purulia: who looks after which spot, and how each is doing. */
(async function(){
  const cfg = window.KASA_CONFIG || {};
  // Same saved session as the report map, so the adopter sees "Let go" on their own spots.
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DAY = 86400000;
  const fmt = d => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

  async function load(){
    const { data, error } = await sb.rpc('kasa_adopted_spots');
    const el = document.getElementById('ad-list');
    if (error){ set('ad-updated', 'Could not load. Please try again later.'); el.innerHTML = ''; return; }
    const spots = data || [];
    set('ad-updated', 'Updated ' + new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }));
    set('ad-t-spots', spots.length);
    set('ad-t-clean', spots.filter(s => !s.open).length);
    set('ad-t-fixed', spots.reduce((n, s) => n + (s.fixed || 0), 0));
    if (!spots.length){
      el.innerHTML = '<div class="an-empty">No spot adopted yet. Be the first: <a href="kasa.html?adopt=1">adopt the spot where you stand</a>.</div>';
      return;
    }
    const where = s => s.ward_no ? `Ward ${s.ward_no}` : s.block_name ? `${s.block_name} block` : '';
    el.innerHTML = `<table class="an-table"><thead><tr><th>Looked after by</th><th>Where</th><th>Since</th><th>Now</th><th class="n">Days clean</th><th class="n">Fixed</th><th></th></tr></thead><tbody>
      ${spots.map(s => {
        const clean = Math.floor((Date.now() - Date.parse(s.last_problem_at || s.since)) / DAY);
        return `<tr><td><strong>${esc(s.name)}</strong></td>
          <td><a href="kasa.html?at=${s.lat},${s.lng}">${esc(where(s) || 'See on map')}</a></td>
          <td>${esc(fmt(s.since))}</td>
          <td>${s.open ? `<span class="ad-bad">${s.open} open problem${s.open === 1 ? '' : 's'}</span>` : '<span class="ad-ok">Clean</span>'}</td>
          <td class="n">${s.open ? '—' : clean}</td><td class="n">${s.fixed || 0}</td>
          <td>${s.mine ? `<button class="ad-leave" data-leave="${esc(s.id)}">Let go</button>` : ''}</td></tr>`;
      }).join('')}</tbody></table>`;
    el.querySelectorAll('[data-leave]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Stop looking after this spot? It leaves the public list.')) return;
      const { error: e2 } = await sb.rpc('kasa_leave_spot', { p_id: Number(b.dataset.leave) });
      if (e2){ alert(e2.details || e2.message); return; }
      load();
    }));
  }
  load();
})();
