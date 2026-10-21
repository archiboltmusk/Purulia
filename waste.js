/* "Where the waste goes": the dumping grounds residents have reported, in a list. The map is the
   report map with the dumpsite filter (kasa.html?category=dumpsite), which also shows the legacy sites. */
// The 14 municipalities the NGT order of 22.07.2026 (O.A. 606/2018, para 6[A](iii)) names as not
// transporting all their waste, by district.
const NGT_TOWNS = { Asansol: 'paschim-bardhaman', Dhupgiri: 'jalpaiguri', Haringhata: 'nadia', Baduria: 'north-24-parganas',
  Halisahar: 'north-24-parganas', Kachrapara: 'north-24-parganas', Madhyagram: 'north-24-parganas', Ghatal: 'paschim-medinipur',
  Jhargram: 'jhargram', Purulia: 'purulia', Dalkhola: 'uttar-dinajpur', Howrah: 'howrah', Mynaguri: 'jalpaiguri', Falkata: 'alipurduar' };

(async function(){
  const cfg = window.KASA_CONFIG || {};
  const list = document.getElementById('ws-dump-list');
  if (!window.supabase || !cfg.SUPABASE_URL){ list.innerHTML = '<li>Could not load the map.</li>'; return; }
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = d => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

  // The chosen district (place-facts.js). Purulia keeps the hand-written page; any other
  // district gets its own reports, the NGT towns named in it, and an RTI to its municipalities.
  const PF = window.PlaceFacts;
  let slug = 'purulia', D = null;
  if (PF){ await PF.load().catch(() => null); if (PF.data){
    let picked = false; try { picked = new URLSearchParams(location.search).has('d') || !!localStorage.getItem('parishkar_place'); } catch (e) {}
    if (!picked){
      const k = await PF.districtFromLocation().catch(() => null);
      if (k){ PF.choose(k); location.reload(); return; }
    }
    slug = PF.current(); D = PF.data.districts[slug]; } }
  const NAME = D ? D.name : 'Purulia', isPurulia = slug === 'purulia';
  // A town picked on the map (its slug in parishkar_place) shows only its own dumpsites, not the district's.
  const town = PF ? PF.savedTownSlug() : null;
  const inPlace = town ? (r => r.place === town) : PF && PF.data ? await PF.reportFilter(slug) : () => true;
  const bodies = isPurulia || !PF ? [] : await PF.bodies(slug);
  if (!isPurulia) otherDistrict();

  function otherDistrict(){
    const n = esc(NAME), ask = `<a href="grievance.html">Add a source</a>`;
    document.title = `Where ${NAME}'s waste goes — Parishkar Bengal`;
    document.querySelectorAll('[data-only]').forEach(e => { e.hidden = true; e.style.display = 'none'; });
    document.querySelector('.an-title').innerHTML = `Where ${n}'s waste <em>goes</em>`;
    document.querySelector('.an-sub').textContent = `Garbage on the street is the last link of a chain. Every town's waste needs five links, from your home to a safe landfill. When one is missing, the pile on the corner comes back however often it is swept. This page lists each link, what the rules require, and what ${NAME}'s municipalities have published about it.`;
    const named = Object.keys(NGT_TOWNS).filter(t => NGT_TOWNS[t] === slug);
    document.querySelector('#ws-ngt h2').textContent = named.length
      ? `The National Green Tribunal has named ${named.join(' and ')}` : `What the National Green Tribunal found in West Bengal`;
    const ngtSrc = document.querySelector('#ws-ngt .ws-src');
    ngtSrc.innerHTML = ngtSrc.innerHTML.replace("The order does not give Purulia's own share of the 177.03 tonnes; the RTI below asks for it.",
      named.length ? `The order does not give each town's own share of the 177.03 tonnes; the RTI below asks for it.` : `None of ${n}'s municipalities is among the 14 it names.`);
    const st = document.querySelectorAll('.ws-status');
    st.forEach(e => { e.innerHTML = `${n}: not on record yet. ${ask}`; });
    if (named.length) st[1].innerHTML = `${esc(named.join(', '))}: named by the <a href="#ws-ngt">National Green Tribunal</a> (July 2026) as not transporting all its waste. Other towns in ${n}: not on record yet. ${ask}`;
    document.querySelector('#ws-dumps h2').textContent = `Where ${NAME}'s waste is dumped: reported by residents`;
    document.querySelector('#ws-dumps .an-card-sub').innerHTML = `🚛 markers are dumping grounds residents reported, with a photo and location, confirmed by others on the spot like every report. Seen trucks or carts unloading somewhere? Stand there and report it as <strong>🚛 Dumping ground</strong>. No government list of ${n}'s legacy dumpsites is on this page yet; ${ask}.`;
    // RTI to whichever of the district's municipalities the reader picks.
    const rti = document.getElementById('ws-rti-text');
    const letter = b => [
      'To,', 'The Public Information Officer,', `${b ? b.body : '[Name of your municipality]'}, ${D.name}, West Bengal`, '',
      'Subject: Request for information under Section 6(1) of the Right to Information Act, 2005', '',
      `Please provide the following information about solid waste management in ${b ? b.body : 'the municipality'}:`, '',
      '1. The quantity of solid waste generated and collected per day, in tonnes, for the last 12 months.',
      '2. The number of wards with daily door-to-door collection, and the number where wet and dry waste are collected separately.',
      '3. The number of sanitation workers and collection vehicles, ward by ward.',
      '4. The number of street dustbins currently placed in each ward.',
      '5. The location, capacity and working status of every compost plant, biogas plant or Material Recovery Facility used by the municipality. If there is none, the date by which one is planned.',
      "6. The location and area of each of the municipality's dumping grounds, the estimated quantity of old (legacy) waste at each, and any tender issued for bio-mining or clean-up, with its status.",
      "7. The municipality's solid waste management plan and the funds received and spent under Swachh Bharat Mission (Urban) 2.0 for the last three financial years.",
      ...(b && named.includes(b.name) ? [`8. The National Green Tribunal, in its order dated 22.07.2026 in O.A. No. 606/2018, named ${b.name} among 14 municipalities not able to transport 100% of the waste they generate. Please provide the daily quantity of waste generated and the daily quantity collected and transported, in tonnes, as reported for that compliance report, and a copy of every action plan prepared since that order to close this gap.`] : []),
      '', 'I am a citizen of India. The fee of ₹10 is enclosed.', '', 'Name:', 'Address:', 'Date:'
    ].join('\n');
    if (bodies.length > 1){
      const lab = document.createElement('label');
      lab.className = 'ws-pick'; lab.style.cssText = 'display:block;margin:0 0 10px';
      lab.innerHTML = `Municipality <select id="ws-body">${bodies.map((b, i) => `<option value="${i}">${esc(b.body || b.name)}</option>`).join('')}</select>`;
      rti.before(lab);
      lab.querySelector('select').addEventListener('change', e => { rti.textContent = letter(bodies[e.target.value]); });
    }
    rti.textContent = letter(bodies[0]);
  }

  const { data, error } = await sb.from('kasa_public_reports')
    .select('id,created_at,lat,lng,ward_no,block_name,landmark,status,upvotes,seen_on_site,place')
    .eq('category', 'dumpsite').eq('is_duplicate', false).order('created_at', { ascending: false }).limit(500);
  if (error){ list.innerHTML = '<li>Could not load the dumping grounds. Please try again later.</li>'; return; }
  const rows = (data || []).filter(inPlace);
  const where = r => r.landmark || (r.ward_no ? `Ward ${r.ward_no}` : r.block_name ? `${r.block_name} block` : NAME);
  const seen = r => { const n = 1 + (r.upvotes || 0); return `${n} ${n === 1 ? 'person' : 'people'} reported it`; };
  list.innerHTML = rows.length
    ? rows.map(r => `<li><a href="kasa.html?report=${encodeURIComponent(r.id)}">${esc(where(r))}</a> · ${esc(seen(r))} · first reported ${esc(fmt(r.created_at))}${r.status === 'resolved' ? ' · cleared' : ''}</li>`).join('')
    : '<li>No dumping ground reported yet. Be the first: stand where the trucks unload and report it.</li>';

})();
