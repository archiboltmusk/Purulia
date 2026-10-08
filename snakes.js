/* Snake rescuers and the last 48 hours of snake sightings in the chosen district (place-facts.js). */
(async function(){
  const cfg = window.KASA_CONFIG || {};
  // Same saved session as the report map, so a rescuer sees "Stop" on their own entry.
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const when = d => new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

  const PF = window.PlaceFacts;
  let slug = 'purulia', D = null;
  if (PF){ await PF.load().catch(() => null); if (PF.data){ slug = PF.current(); D = PF.data.districts[slug]; } }
  const NAME = D ? D.name : 'Purulia';
  const inPlace = PF && PF.data ? await PF.reportFilter(slug) : () => true;
  if (slug !== 'purulia') document.title = `Snakes in ${NAME} — Parishkar Bengal`;
  const where = s => [s.ward_no ? `Ward ${s.ward_no}` : s.block_name ? `${s.block_name} block` : '', s.district || ''].filter(Boolean).join(', ');

  async function load(){
    const [res, seen] = await Promise.all([sb.rpc('kasa_snake_rescuers'), sb.rpc('kasa_snake_sightings')]);
    if (res.error || seen.error){ set('sn-updated', 'Could not load. Please try again later.'); return; }
    const rescuers = (res.data || []).filter(inPlace), sightings = (seen.data || []).filter(inPlace);
    set('sn-updated', 'Updated ' + new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }));
    set('sn-t-res', rescuers.length);
    set('sn-t-seen', sightings.length);

    const rEl = document.getElementById('sn-res');
    rEl.innerHTML = rescuers.length ? `<table class="an-table"><thead><tr><th>Rescuer</th><th>Based near</th><th class="n">Travels</th><th>Contact</th></tr></thead><tbody>
      ${rescuers.map(r => `<tr>
        <td><strong>${esc(r.name)}</strong>${r.note ? `<br><span class="ad-office">${esc(r.note)}</span>` : ''}${r.mine ? ` <button class="ad-leave" data-stop>Stop</button>` : ''}</td>
        <td>${esc(where(r) || 'See on map')}</td>
        <td class="n">${esc(r.range_km)} km</td>
        <td style="white-space:nowrap;"><a href="tel:+91${esc(r.phone)}">📞 ${esc(r.phone)}</a>${r.whatsapp ? ` · <a href="https://wa.me/91${esc(r.phone)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}</td></tr>`).join('')}</tbody></table>`
      : `<div class="an-empty">No snake rescuer registered in ${esc(NAME)} yet. If you rescue snakes, <a href="kasa.html?rescuer=1">register here</a>.</div>`;
    rEl.querySelectorAll('[data-stop]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Stop being listed as a snake rescuer?')) return;
      const { error } = await sb.rpc('kasa_leave_snake_rescuer');
      if (error){ alert(error.details || error.message); return; }
      load();
    }));

    document.getElementById('sn-seen').innerHTML = sightings.length ? `<table class="an-table"><thead><tr><th>Photo</th><th>Where</th><th>When</th></tr></thead><tbody>
      ${sightings.map(s => `<tr>
        <td><a href="${esc(s.photo_url)}" target="_blank" rel="noopener"><img src="${esc(s.photo_url)}" alt="Snake photo" loading="lazy" style="width:72px;height:72px;object-fit:cover;border-radius:4px;"></a></td>
        <td><a href="kasa.html?at=${s.lat},${s.lng},17">${esc(where(s) || 'See on map')}</a>${s.note ? `<br><span class="ad-office">${esc(s.note)}</span>` : ''}</td>
        <td>${esc(when(s.at))}</td></tr>`).join('')}</tbody></table>`
      : `<div class="an-empty">No snake reported in ${esc(NAME)} in the last 48 hours.</div>`;
  }
  load();
})();
