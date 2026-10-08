/* Swachh Pandal: approved puja pandals in the chosen district (place-facts.js) with the reports filed near them during the puja. */
(async function(){
  const cfg = window.KASA_CONFIG || {};
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = d => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

  const PF = window.PlaceFacts;
  let slug = 'purulia', D = null;
  if (PF){ await PF.load().catch(() => null); if (PF.data){ slug = PF.current(); D = PF.data.districts[slug]; } }
  const NAME = D ? D.name : 'Purulia';
  const inPlace = PF && PF.data ? await PF.reportFilter(slug) : () => true;
  if (slug !== 'purulia') document.title = `Swachh Pandal in ${NAME} — Parishkar Bengal`;

  const { data, error } = await sb.rpc('kasa_pandals');
  const el = document.getElementById('pd-list');
  if (error){ set('pd-updated', 'Could not load. Please try again later.'); return; }
  const w = data?.window || {};
  if (w.radius_m) set('pd-radius', w.radius_m);
  if (w.start && w.end) set('pd-window', `Reports filed from ${fmt(w.start)} to ${fmt(w.end)} count. Moderators set these dates each year from the West Bengal government holiday list.`);
  const list = (data?.pandals || []).filter(inPlace);
  set('pd-updated', 'Updated ' + new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }));
  set('pd-t-pandals', list.length);
  set('pd-t-open', list.reduce((n, p) => n + (p.open || 0), 0));
  set('pd-t-fixed', list.reduce((n, p) => n + (p.fixed || 0), 0));
  if (!list.length){
    el.innerHTML = `<div class="an-empty">No pandal in ${esc(NAME)} on the list yet. Standing at one? <a href="kasa.html?pandal=1">Add it</a>.</div>`;
    return;
  }
  const where = p => [p.ward_no ? `Ward ${p.ward_no}` : p.block_name ? `${p.block_name} block` : '', p.district || ''].filter(Boolean).join(', ');
  el.innerHTML = `<table class="an-table"><thead><tr><th class="n">#</th><th>Pandal</th><th>Where</th><th class="n">Still open</th><th class="n">Cleaned up</th></tr></thead><tbody>
    ${list.map((p, i) => `<tr>
      <td class="n">${i + 1}</td>
      <td><strong>${esc(p.name)}</strong>${p.club ? `<br><span class="ad-role">${esc(p.club)}</span>` : ''}</td>
      <td><a href="kasa.html?at=${p.lat},${p.lng},17">${esc(where(p) || 'See on map')}</a></td>
      <td class="n${p.open ? ' ad-bad' : ''}">${esc(p.open)}</td>
      <td class="n${p.fixed ? ' ad-ok' : ''}">${esc(p.fixed)}</td></tr>`).join('')}</tbody></table>`;
})();
