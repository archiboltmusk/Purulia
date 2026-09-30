/* ══════════════════════════════════════════════════════════
   districts.html: every West Bengal district on NFHS-5 figures.
   Data: districts.json, built by tools/build-district-health.py.
   ══════════════════════════════════════════════════════════ */
(() => {
  const LABELS = {
    child_marriage: 'Young women married before 18', women_10yrs: 'Women with 10+ years of school',
    anc4: 'Mothers with 4+ antenatal visits', inst_births: 'Births in a hospital or clinic',
    stunted: 'Children under 5 who are stunted', child_anaemia: 'Young children with anaemia',
    women_anaemia: 'Women with anaemia', sanitation: 'People with a proper toilet',
    clean_fuel: 'Homes cooking with clean fuel', insurance: 'Homes with any health cover'
  };
  const NAMES = { Puruliya: 'Purulia', Haora: 'Howrah', Hugli: 'Hooghly', Maldah: 'Malda', 'Koch Bihar': 'Cooch Behar',
    'North Twenty Four Parganas': 'North 24 Parganas', 'South Twenty Four Parganas': 'South 24 Parganas' };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const me = new URLSearchParams(location.search).get('d') || 'Puruliya';
  let data, key = new URLSearchParams(location.search).get('m') || 'child_marriage';

  function render() {
    if (!LABELS[key]) key = 'child_marriage';
    const good = data.indicators[key].higher_is_better;
    document.querySelectorAll('.dt-chip').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.k === key)));
    document.getElementById('dt-h').textContent = LABELS[key];
    const rows = Object.entries(data.districts).filter(([, v]) => v[key] != null)
      .sort((a, b) => good ? a[1][key] - b[1][key] : b[1][key] - a[1][key]);
    const max = Math.max(...rows.map(r => r[1][key]), data.west_bengal[key], data.india[key]);
    const i = rows.findIndex(r => r[0] === me);
    document.getElementById('dt-rank').textContent = i < 0 ? '' :
      `${NAMES[me] || me} is ${i === 0 ? 'the worst' : `number ${i + 1} from the worst`} of ${rows.length} districts. West Bengal: ${data.west_bengal[key]}%. India: ${data.india[key]}%.`;
    const bar = v => `<div class="dt-bar" style="width:${(v / max * 100).toFixed(1)}%"></div>`;
    const ref = (name, v) => `<tr class="dt-ref"><td class="n"></td><td>${name}</td><td class="n">${v}</td><td>${bar(v)}</td></tr>`;
    document.getElementById('dt-rows').innerHTML = rows.map(([d, v], n) =>
      `<tr${d === me ? ' class="dt-me"' : ''}><td class="n">${n + 1}</td><td><a href="?d=${encodeURIComponent(d)}&m=${key}">${esc(NAMES[d] || d)}</a></td><td class="n">${v[key]}</td><td>${bar(v[key])}</td></tr>`
    ).join('') + ref('West Bengal', data.west_bengal[key]) + ref('India', data.india[key]);
  }

  fetch('districts.json').then(r => r.json()).then(d => {
    data = d;
    const chips = document.getElementById('dt-chips');
    chips.innerHTML = Object.keys(LABELS).map(k => `<button type="button" class="dt-chip" data-k="${k}">${esc(LABELS[k])}</button>`).join('');
    chips.addEventListener('click', e => {
      const b = e.target.closest('.dt-chip'); if (!b) return;
      key = b.dataset.k; history.replaceState(null, '', `?d=${encodeURIComponent(me)}&m=${key}`); render();
    });
    render();
  }).catch(() => { document.getElementById('dt-rows').innerHTML = '<tr><td colspan="4" class="an-empty">Could not load the figures. Reload to try again.</td></tr>'; });
})();
