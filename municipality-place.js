/* municipality.html for the chosen district (place-facts.js): its municipalities and ward
 * counts (places/wb_towns.geojson; ward counts from the 2022 State Election Commission tables
 * via Wikipedia), the same chain of control under the West Bengal Municipal Act, and an RTI to
 * the municipality you pick. Purulia keeps the hand-written page and its translations. */
(() => {
  const PF = window.PlaceFacts, esc = PF.esc;
  const $ = s => document.querySelector(s);
  const hide = el => { if (el){ el.hidden = true; el.style.display = 'none'; } };
  const SEC = 'https://en.wikipedia.org/wiki/2022_West_Bengal_local_elections';
  let slug = null, D = null, bodies = [], pick = 0;

  const letter = b => [
    'To,', 'The Public Information Officer,', `${b ? b.body : '[Name of your municipality]'}, ${D.name}, West Bengal`, '',
    'Subject: Request for information under Section 6(1) of the Right to Information Act, 2005', '',
    'Please provide the following information for the financial years 2023-24, 2024-25 and 2025-26:', '',
    '1. The amount budgeted and the amount actually spent on solid waste management, ward by ward, split into salaries and wages, vehicles and fuel, dustbins and equipment, contracts, and processing or disposal.',
    '2. The funds received for solid waste management from each source (State Finance Commission and other state grants, Swachh Bharat Mission (Urban) 2.0, Finance Commission grants, any other scheme), the amount spent from each, and copies of the utilisation certificates sent for them.',
    '3. A list of every work order issued for roads, drains, street lights and solid waste management, giving for each: ward, name of work, tender ID, sanctioned amount, name of the contractor, accepted amount, date of work order, completion deadline, actual completion date, and amount paid so far.',
    '4. The number of sanitation workers (permanent and contractual) and collection vehicles deployed in each ward as on the date of this application.',
    '5. Whether the municipality charges households or businesses any fee for garbage collection. If so, a copy of the resolution or notification fixing it, the rates, the amount collected in each year, and what it was spent on.',
    `6. Copies of the annual budget and the annual accounts (audited, where audit is complete) of ${b ? b.body : 'the municipality'} for these years.`, '',
    'If any of this is held by another public authority, please transfer that part under Section 6(3) and tell me.', '',
    'I am a citizen of India. The fee of ₹10 is enclosed.', '', 'Name:', 'Address:', 'Date:'
  ].join('\n');

  function render() {
    const n = esc(D.name), ask = '<a href="grievance.html">Add a source</a>';
    document.title = `Who runs ${D.name}'s municipalities — Parishkar Bengal`;
    $('.an-sub').textContent = `A pothole or an overflowing drain in your ward is the end of a long chain: the state government, the elected board, the officers, the contractors, and the money that passes between them. This page lays out that chain for the municipalities of ${D.name}, and says plainly what has not been published.`;
    $('[data-t="m8"]').innerHTML = `One elected councillor per ward. The councillors elect the Chairman, who heads the municipality with the Chairman-in-Council. Who chairs each of ${n}'s municipalities is not on this page yet. ${ask}`;
    $('[data-t="m11"]').textContent = 'If the state dissolves the board, an officer it appoints runs the municipality instead of the elected councillors.';
    hide($('#mu-2025')); hide($('#mu-gap'));
    hide($('[data-t="m28"]')); hide($('[data-t="m29"]'));
    $('[data-t="m21"]').textContent = 'Money given for a named project has to be spent on that project, and the municipality must send the funding department a utilisation certificate saying how it was spent. That is why ward-wise records exist, even when they are not published.';
    $('[data-t="m22"]').innerHTML = `How much each of ${n}'s municipalities received from each source, and how much it spent in each ward, is not on this page. The RTI below asks for it. City-level figures for many West Bengal towns are on the Centre's <a href="https://www.cityfinance.in/municipal-data/state/west-bengal" rel="noopener">CityFinance</a> portal.`;

    // The district's municipalities, in place of Purulia's 2025–26 story.
    let card = document.getElementById('mu-bodies');
    if (!card){
      card = document.createElement('section');
      card.className = 'an-card an-span'; card.id = 'mu-bodies';
      $('#mu-money').before(card);
    }
    const rows = bodies.map(b => `<tr><td>${esc(b.body || b.name)}</td><td class="n">${b.wards != null ? b.wards : '—'}</td><td>${b.mapped
      ? `On the <a href="kasa.html?place=${esc(b.slug)}">map</a>, ward by ward` : `<a href="add-town.html?town=${encodeURIComponent(b.name)}&body=${encodeURIComponent(b.body || '')}&district=${encodeURIComponent(slug)}">Add its ward map</a>`}</td></tr>`).join('');
    card.innerHTML = `<h2>The municipalities of ${n}</h2>` + (bodies.length
      ? `<div class="an-table-wrap"><table class="an-table"><thead><tr><th>Municipality</th><th class="n">Wards</th><th>Ward map</th></tr></thead><tbody>${rows}</tbody></table></div>
         <p class="ws-src">${slug === 'kolkata' ? 'Wards: <a href="https://www.kmcgov.in/" rel="noopener">Kolkata Municipal Corporation</a>.' : `Wards: West Bengal State Election Commission, 2022 municipal elections, as tabulated on <a href="${SEC}" rel="noopener">Wikipedia</a>. Ward maps: AMRUT GIS (Ministry of Housing and Urban Affairs) where one exists.`}</p>`
      : `<p class="an-card-sub">No municipality of ${n} is listed here yet. ${ask}</p>`);

    const rti = document.getElementById('mu-rti-text');
    let sel = document.getElementById('mu-body');
    if (bodies.length > 1 && !sel){
      const lab = document.createElement('label');
      lab.style.cssText = 'display:block;margin:0 0 10px';
      lab.innerHTML = `Municipality <select id="mu-body">${bodies.map((b, i) => `<option value="${i}">${esc(b.body || b.name)}</option>`).join('')}</select>`;
      rti.before(lab);
      sel = lab.querySelector('select');
      sel.addEventListener('change', () => { pick = +sel.value; rti.textContent = letter(bodies[pick]); });
    }
    rti.textContent = letter(bodies[pick]);
  }

  PF.load().then(async () => {
    slug = PF.current();
    if (slug === 'purulia') return;
    D = PF.data.districts[slug];
    bodies = slug === 'kolkata'
      ? [{ name: 'Kolkata', body: 'Kolkata Municipal Corporation', wards: 144, mapped: 141, slug: 'kolkata' }]
      : await PF.bodies(slug);
    render();
    // The translations describe Purulia, so a language switch would put its text back.
    document.addEventListener('pagelang', render);
  }).catch(() => {});
})();
