/* "Where the waste goes": the dumping grounds residents have reported, on a map and in a list. */
(async function(){
  const cfg = window.KASA_CONFIG || {};
  const list = document.getElementById('ws-dump-list');
  if (!window.supabase || !cfg.SUPABASE_URL){ list.innerHTML = '<li>Could not load the map.</li>'; return; }
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = d => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

  const { data, error } = await sb.from('kasa_public_reports')
    .select('id,created_at,lat,lng,ward_no,block_name,landmark,status,upvotes,seen_on_site')
    .eq('category', 'dumpsite').eq('is_duplicate', false).order('created_at', { ascending: false }).limit(500);
  if (error){ list.innerHTML = '<li>Could not load the dumping grounds. Please try again later.</li>'; return; }
  const rows = data || [];
  const where = r => r.landmark || (r.ward_no ? `Ward ${r.ward_no}` : r.block_name ? `${r.block_name} block` : 'Purulia');
  const seen = r => { const n = 1 + (r.upvotes || 0); return `${n} ${n === 1 ? 'person' : 'people'} reported it`; };
  list.innerHTML = rows.length
    ? rows.map(r => `<li><a href="kasa.html?report=${encodeURIComponent(r.id)}">${esc(where(r))}</a> · ${esc(seen(r))} · first reported ${esc(fmt(r.created_at))}${r.status === 'resolved' ? ' · cleared' : ''}</li>`).join('')
    : '<li>No dumping ground reported yet. Be the first: stand where the trucks unload and report it.</li>';

  if (!window.maplibregl) return;
  const map = new maplibregl.Map({ container: 'ws-map', style: 'https://tiles.openfreemap.org/styles/dark',
    center: [86.36, 23.33], zoom: rows.length ? 11 : 9, attributionControl: { compact: true } });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  const bounds = new maplibregl.LngLatBounds();
  rows.forEach(r => {
    const el = document.createElement('div');
    el.textContent = '🚛'; el.style.fontSize = '22px'; el.style.cursor = 'pointer';
    new maplibregl.Marker({ element: el }).setLngLat([r.lng, r.lat])
      .setPopup(new maplibregl.Popup({ offset: 14 }).setHTML(`<strong>${esc(where(r))}</strong><br>${esc(seen(r))}<br><a href="kasa.html?report=${encodeURIComponent(r.id)}">Open the report →</a>`))
      .addTo(map);
    bounds.extend([r.lng, r.lat]);
  });
  if (rows.length > 1) map.fitBounds(bounds, { padding: 40, maxZoom: 14 });
  else if (rows.length === 1) map.setCenter([rows[0].lng, rows[0].lat]);
})();
