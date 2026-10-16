/* "Public toilets": the ones residents have reported as locked, dry, unclean or otherwise
   unusable, in a list. The map is the report map (kasa.html?category=toilet). */
(async function(){
  const cfg = window.KASA_CONFIG || {};
  const list = document.getElementById('tl-list');
  if (!window.supabase || !cfg.SUPABASE_URL){ list.innerHTML = '<li>Could not load the map.</li>'; return; }
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = d => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

  // The chosen district (place-facts.js): its own reports, and an RTI to its municipalities.
  const PF = window.PlaceFacts;
  let slug = 'purulia', D = null;
  if (PF){ await PF.load().catch(() => null); if (PF.data){
    // No place chosen yet: ask the device once for its position and take the district it is in.
    let picked = false; try { picked = new URLSearchParams(location.search).has('d') || !!localStorage.getItem('parishkar_place'); } catch (e) {}
    if (!picked){
      const k = await PF.districtFromLocation().catch(() => null);
      if (k){ PF.choose(k); location.reload(); return; }
    }
    slug = PF.current(); D = PF.data.districts[slug]; } }
  const NAME = D ? D.name : 'Purulia', isPurulia = slug === 'purulia';
  // A town picked on the map shows only its own toilets, not the district's.
  const town = PF ? PF.savedTownSlug() : null;
  const inPlace = town ? (r => r.place === town) : PF && PF.data ? await PF.reportFilter(slug) : () => true;
  const bodies = isPurulia || !PF ? [] : await PF.bodies(slug);
  if (!isPurulia){
    document.title = `Public toilets in ${NAME} — Parishkar Bengal`;
    // The ODF finding is about Purulia town only.
    document.querySelector('.an-sub').textContent = `A toilet with no water, broken, or kept locked is, in practice, no toilet at all. The map below shows the ones residents have reported in ${NAME}. Whether ${NAME}'s municipalities are Open Defecation Free: not on record yet.`;
    const rti = document.getElementById('tl-rti-text');
    const letter = b => [
      'To,', 'The Public Information Officer,', `${b ? b.body : '[Name of your municipality]'}, ${NAME}, West Bengal`, '',
      'Subject: Request for information under Section 6(1) of the Right to Information Act, 2005', '',
      `Please provide the following information about public toilets in ${b ? b.body : 'the municipality'}:`, '',
      '1. The total number of public/community toilets built or maintained by the municipality, ward by ward, with their locations.',
      '2. For each, whether it currently has a working water supply, and the date it was last inspected or repaired.',
      '3. The number of these toilets that are locked, non-functional, or otherwise not usable by the public, and why.',
      '4. Any plan and timeline to make every public toilet in the municipality usable, and the funds allocated for this under Swachh Bharat Mission (Urban) 2.0 for the last three financial years.',
      "5. The municipality's current Open Defecation Free (ODF, ODF+ or ODF++) status and the date it was certified.",
      '', 'I am a citizen of India. The fee of ₹10 is enclosed.', '', 'Name:', 'Address:', 'Date:'
    ].join('\n');
    if (bodies.length > 1){
      const lab = document.createElement('label');
      lab.style.cssText = 'display:block;margin:0 0 10px';
      lab.innerHTML = `Municipality <select id="tl-body">${bodies.map((b, i) => `<option value="${i}">${esc(b.body || b.name)}</option>`).join('')}</select>`;
      rti.before(lab);
      lab.querySelector('select').addEventListener('change', e => { rti.textContent = letter(bodies[e.target.value]); });
    }
    rti.textContent = letter(bodies[0]);
  }

  const { data, error } = await sb.from('kasa_public_reports')
    .select('id,created_at,lat,lng,ward_no,block_name,landmark,status,upvotes,seen_on_site,place')
    .eq('category', 'toilet').eq('is_duplicate', false).order('created_at', { ascending: false }).limit(500);
  if (error){ list.innerHTML = '<li>Could not load the reported toilets. Please try again later.</li>'; return; }
  const rows = (data || []).filter(inPlace);
  const where = r => r.landmark || (r.ward_no ? `Ward ${r.ward_no}` : r.block_name ? `${r.block_name} block` : NAME);
  const seen = r => { const n = 1 + (r.upvotes || 0); return `${n} ${n === 1 ? 'person' : 'people'} reported it`; };
  list.innerHTML = rows.length
    ? rows.map(r => `<li><a href="kasa.html?report=${encodeURIComponent(r.id)}">${esc(where(r))}</a> · ${esc(seen(r))} · first reported ${esc(fmt(r.created_at))}${r.status === 'resolved' ? ' · fixed' : ''}</li>`).join('')
    : '<li>No public toilet reported yet. Be the first: if one near you is locked, dry or unusable, report it.</li>';

})();
