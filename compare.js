/* Compare districts side by side: up to four West Bengal districts (?c=a,b,c,d) and the state,
   one row per sourced figure in places/wb_district_facts.json (Census 2011, Jal Jeevan Mission,
   NITI Aayog, NFHS-5 with the NFHS-4 change). Best and worst of the chosen districts are marked. */
(async function(){
  const PF = window.PlaceFacts;
  const $ = id => document.getElementById(id);
  const esc = PF.esc, num = v => v == null ? '' : Number(v).toLocaleString('en-IN');
  await PF.load().catch(() => null);
  if (!PF.data){ $('cp-table').innerHTML = '<p class="an-empty">Could not load the district figures. Please try again later.</p>'; return; }
  const DS = PF.data.districts, N = PF.data.nfhs, S = PF.data.sources;
  const MAX = 4;

  let picked = (new URLSearchParams(location.search).get('c') || '').split(',').filter(s => DS[s]);
  if (!picked.length){
    const here = PF.current();
    picked = [here, ...['purulia', 'bankura', 'kolkata'].filter(s => s !== here)].slice(0, 3);
  }
  picked = [...new Set(picked)].slice(0, MAX);

  const nf = (s, k) => { const d = DS[s]; const v = d.nfhs_district && N.districts[d.nfhs_district]; return v && v[k] ? v[k] : null; };
  const rows = [
    { label: 'People (Census 2011)', val: s => DS[s].census2011?.population, show: num, src: 'wikidata' },
    { label: 'Area (km²)', val: s => DS[s].area_km2, show: num, src: 'wikidata' },
    { label: 'People per km²', val: s => DS[s].census2011?.population && DS[s].area_km2 ? Math.round(DS[s].census2011.population / DS[s].area_km2) : null, show: num, src: 'wikidata', note: 'population ÷ area' },
    { label: 'Rural share of people', val: s => DS[s].census2011?.rural && DS[s].census2011?.population ? Math.round(1000 * DS[s].census2011.rural / DS[s].census2011.population) / 10 : null, show: v => v + '%', src: 'wikidata' },
    { label: 'Homes with a tap connection', val: s => DS[s].jjm?.pct, show: v => v + '%', src: 'jjm', better: true,
      extra: s => DS[s].jjm?.rank_wb ? `${DS[s].jjm.rank_wb} of ${DS[s].jjm.of_wb} in WB` : '' },
    { label: 'NITI Aayog aspirational district', val: s => DS[s].aspirational == null ? null : DS[s].aspirational ? 'Yes' : 'No', show: v => v, src: 'niti' },
    ...Object.entries(N.indicators).map(([k, ind]) => ({
      label: ind.label, val: s => nf(s, k)?.[0], show: v => v + '%', src: 'nfhs', better: ind.higher_is_better, state: N.west_bengal[k],
      extra: s => { const v = nf(s, k); if (!v || v[1] == null) return ''; const d = Math.round((v[0] - v[1]) * 10) / 10;
        return `${d > 0 ? '+' : ''}${d} since NFHS-4`; }
    }))
  ];

  function render(){
    try { const u = new URL(location.href); u.searchParams.set('c', picked.join(',')); history.replaceState(null, '', u); } catch (e) {}
    const opts = cur => Object.entries(DS).sort((a, b) => a[1].name.localeCompare(b[1].name))
      .map(([s, d]) => `<option value="${esc(s)}"${s === cur ? ' selected' : ''}>${esc(d.name)}</option>`).join('');
    const head = picked.map((s, i) => `<th><select data-i="${i}" aria-label="District ${i + 1}">${opts(s)}</select>
      ${picked.length > 1 ? `<button type="button" class="cp-x" data-drop="${i}" aria-label="Remove ${esc(DS[s].name)}">✕</button>` : ''}</th>`).join('');
    const body = rows.map(r => {
      const vals = picked.map(r.val);
      const nums = vals.filter(v => typeof v === 'number');
      const best = r.better == null || nums.length < 2 ? null : (r.better ? Math.max : Math.min)(...nums);
      const worst = r.better == null || nums.length < 2 ? null : (r.better ? Math.min : Math.max)(...nums);
      const cells = picked.map((s, i) => {
        const v = vals[i];
        if (v == null) return '<td class="cp-none">not in the source</td>';
        const part = r.src === 'nfhs' && DS[s].nfhs_part_of ? `<small>figure for ${esc(DS[s].nfhs_part_of)}, which included it then</small>` : '';
        const ex = r.extra ? r.extra(s) : '';
        return `<td class="${v === best ? 'cp-best' : v === worst ? 'cp-worst' : ''}">${esc(r.show(v))}${ex ? `<small>${esc(ex)}</small>` : ''}${part}</td>`;
      }).join('');
      return `<tr><th scope="row">${esc(r.label)}${r.note ? `<small>${esc(r.note)}</small>` : ''}</th>${cells}<td class="cp-state">${r.state != null ? esc(r.show(r.state)) : ''}</td></tr>`;
    }).join('');
    $('cp-table').innerHTML = `<table class="an-table cp-table"><thead><tr><th></th>${head}<th>West Bengal</th></tr></thead><tbody>${body}</tbody></table>`;
    $('cp-add').hidden = picked.length >= MAX;
  }

  $('cp-table').addEventListener('change', e => {
    const sel = e.target.closest('select[data-i]'); if (!sel) return;
    picked[Number(sel.dataset.i)] = sel.value; picked = [...new Set(picked)]; render();
  });
  $('cp-table').addEventListener('click', e => {
    const b = e.target.closest('[data-drop]'); if (!b) return;
    picked.splice(Number(b.dataset.drop), 1); render();
  });
  $('cp-add').addEventListener('click', () => {
    const next = Object.keys(DS).find(s => !picked.includes(s)); if (next){ picked.push(next); render(); }
  });
  const link = (k, txt) => S[k] && S[k].url ? `<a href="${esc(S[k].url)}" target="_blank" rel="noopener">${esc(txt || S[k].name)}</a>` : esc(S[k] ? S[k].name : k);
  $('cp-sources').innerHTML = `${link('wikidata')}${S.wikidata?.read ? `, read ${esc(S.wikidata.read)}` : ''}. ${link('jjm')}${S.jjm?.read ? `, read ${esc(S.jjm.read)}` : ''}. ${link('niti')}. ${link('nfhs')}${S.nfhs?.read ? `, read ${esc(S.nfhs.read)}` : ''}. The West Bengal column is the NFHS-5 figure for the whole state.`;
  render();
})();
