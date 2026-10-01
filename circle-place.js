/* circle.html: the same circle, in the chosen district's own figures, from
 * places/wb_district_facts.json (place-facts.js). Purulia keeps the hand-written page
 * (and its translations); any other district gets its NFHS-5 and Jal Jeevan Mission
 * figures, and "not published" where no source has a figure for it. */
(() => {
  const PF = window.PlaceFacts, esc = PF.esc, n = PF.n;
  const $ = s => document.querySelector(s);
  let slug = null;

  function render() {
    const D = PF.data, d = D.districts[slug], N = D.nfhs, S = D.sources;
    const nfName = d.nfhs_district, v = N.districts[nfName] || {};
    const nfSrc = `<a href="${esc(S.nfhs.url)}" target="_blank" rel="noopener">NFHS-5 District Fact Sheet, ${esc(nfName)} (2019–21)</a>`;
    const part = d.nfhs_part_of ? ` NFHS-5 surveyed ${esc(d.name)} as part of ${esc(d.nfhs_part_of)}, before it was split, so these are ${esc(d.nfhs_part_of)}'s figures.` : '';
    const ask = what => `<div><div class="ci-n">—</div><div class="ci-l">${what} No published figure for ${esc(d.name)} yet. <a href="grievance.html">Add a source</a></div></div>`;
    const fact = (k, label) => {
      const x = v[k];
      if (!x || x[0] == null) return ask(esc(label) + '.');
      const r = PF.rank(k, nfName);
      const was = x[1] == null ? '' : ` (${x[1]}% five years earlier)`;
      return `<div><div class="ci-n">${x[0]}%</div><div class="ci-l">${esc(label)}${was}; ${PF.rankText(r)} (median ${r.median}%)</div></div>`;
    };
    const step = (id, facts, src) => {
      const li = document.getElementById(id);
      li.querySelector('.ci-facts').innerHTML = facts.join('');
      li.querySelectorAll('p:not(.ci-src)').forEach(p => { p.hidden = true; });
      li.querySelector('.ci-src').innerHTML = src;
    };

    document.title = `The Circle: how ${d.name}'s problems feed each other — Parishkar Bengal`;
    $('.an-sub').innerHTML = `In ${esc(d.name)}, no problem stays in its own department. A girl married young becomes an anaemic mother; her child is born small into a home without a tap; when the land gives one crop, the father leaves to find work; and the family that stays behind is poorer and more likely to marry the next daughter young. This page follows that circle through ${esc(d.name)}'s official figures, one step at a time.${part}`;

    step('marriage', [fact('child_marriage', 'Women aged 20–24 married before 18'), fact('teen_mothers', 'Girls aged 15–19 already mothers or pregnant'),
      fact('women_literate', 'Women aged 15–49 who can read and write'), fact('women_10yrs', 'Women with 10 or more years of schooling')],
      `Source: ${nfSrc}. School-by-school checks are on the <a href="schools.html">Schools</a> page.`);
    step('mothers', [fact('women_anaemia', 'Women aged 15–49 who are anaemic'), fact('anc4', 'Mothers who had at least four antenatal check-ups'),
      fact('inst_births', 'Births in a hospital or clinic')], `Source: ${nfSrc}.`);
    step('children', [fact('child_anaemia', 'Children aged 6–59 months who are anaemic'), fact('underweight', 'Children under 5 who are underweight'),
      fact('stunted', 'Children under 5 who are stunted'), fact('wasted', 'Children under 5 who are wasted')], `Source: ${nfSrc}.`);

    const j = d.jjm, water = [];
    if (j && j.pct != null) {
      water.push(`<div><div class="ci-n">${j.pct}%</div><div class="ci-l">Rural homes with a tap connection: ${n(j.tap)} of ${n(j.homes)}. ${j.rank_wb} of ${j.of_wb} in West Bengal and ${j.rank_india} of ${j.of_india} districts on the national dashboard (1 = most homes connected)</div></div>`,
        `<div><div class="ci-n">${n(j.homes - j.tap)}</div><div class="ci-l">Rural homes still waiting for a tap</div></div>`);
    } else if (slug !== 'kolkata') water.push(ask('Rural homes with a tap connection.'));
    else water.push(`<div><div class="ci-n">—</div><div class="ci-l">Rural homes with a tap connection: the Jal Jeevan Mission dashboard covers rural districts only, and does not list ${esc(d.name)}</div></div>`);
    water.push(fact('sanitation', 'People in homes with an improved toilet'), fact('water', 'People with an improved drinking-water source of any kind'));
    step('water', water, `Sources: <a href="${esc(S.jjm.url)}" target="_blank" rel="noopener">Jal Jeevan Mission dashboard</a>, read ${esc(S.jjm.read)}; ${nfSrc}.`);

    const site = d.website ? `<a href="${esc(d.website)}" target="_blank" rel="noopener">${esc(d.name)}'s district website</a>` : `${esc(d.name)}'s district website`;
    step('work', [ask('Share of farmland under a single monsoon crop, and irrigated land.'), ask('Marginal workers (under six months\' work a year), Census 2011.'),
      `<div><div class="ci-n">2022–25</div><div class="ci-l">Years the Centre withheld rural jobs guarantee (MGNREGA) funds from West Bengal</div></div>`],
      `Crop, irrigation and worker figures are in each district's profile; if ${site} or its District Statistical Handbook has them, <a href="grievance.html">send the link</a>. MGNREGA: see <a href="data.html?d=${esc(slug)}">Ground Truth</a>.`);
    const leave = document.querySelector('#leaving p');
    leave.textContent = `Nobody publishes how many people leave ${d.name} for work each year. The 2011 Census migration tables are fifteen years old, the 2021 Census was postponed and the next one has not reported, and neither the district nor the state publishes a count of seasonal migrants. A family whose earner is away, or in debt, is under more pressure to marry the next daughter early, and the circle starts again.`;
    const back = document.querySelector('.ci-back p');
    back.innerHTML = 'Each step has a scheme meant to break it and an office that answers for that scheme. The table below names them.';
    document.querySelectorAll('#who td.gap').forEach(td => { td.hidden = true; });
    document.querySelectorAll('#who th:last-child').forEach(th => { th.hidden = true; });
    const disha = [...document.querySelectorAll('#who td')].find(td => /Purulia's MP/.test(td.textContent));
    if (disha) disha.innerHTML = `Chaired by ${esc(d.name)}'s MP (<a href="kasa.html?place=district:${esc(slug)}">on the map</a>); convened by the District Magistrate`;
  }

  PF.load().then(() => {
    slug = PF.current();
    const pick = document.getElementById('circlePick');
    if (pick) { PF.picker(pick, slug, () => location.reload()); pick.closest('.gt-pick').hidden = false; }
    if (slug === 'purulia') return;
    render();
    // The translations are Purulia's own text, so another district stays in English.
    document.addEventListener('pagelang', render);
  }).catch(() => {});
})();
