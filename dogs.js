/* Community dog feeding spots in the chosen district (place-facts.js), and the letter to the municipality. */
(async function(){
  const cfg = window.KASA_CONFIG || {};
  // Same saved session as the report map, so a caregiver sees "Stop" on their own spots.
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = d => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

  const PF = window.PlaceFacts;
  let slug = 'purulia', D = null;
  if (PF){ await PF.load().catch(() => null); if (PF.data){ slug = PF.current(); D = PF.data.districts[slug]; } }
  const NAME = D ? D.name : 'Purulia';
  const inPlace = PF && PF.data ? await PF.reportFilter(slug) : () => true;
  if (slug !== 'purulia') document.title = `Community dogs in ${NAME} — Parishkar Bengal`;

  async function load(){
    const { data, error } = await sb.rpc('kasa_feeding_spots');
    const el = document.getElementById('dg-list');
    if (error){ set('dg-updated', 'Could not load. Please try again later.'); el.innerHTML = ''; return; }
    const spots = (data || []).filter(inPlace);
    set('dg-updated', 'Updated ' + new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }));
    set('dg-t-spots', spots.length);
    set('dg-t-desig', spots.filter(s => s.designated).length);
    set('dg-t-abc', spots.filter(s => s.helps_abc).length);
    if (!spots.length){
      el.innerHTML = `<div class="an-empty">No feeding spot registered in ${esc(NAME)} yet. If you feed dogs, <a href="kasa.html?feed=1">register the spot where you stand</a>.</div>`;
      return;
    }
    const where = s => [s.ward_no ? `Ward ${s.ward_no}` : s.block_name ? `${s.block_name} block` : '', s.district || ''].filter(Boolean).join(', ');
    el.innerHTML = `<table class="an-table"><thead><tr><th>Caregiver</th><th>Where</th><th>Feeding time</th><th class="n">Dogs</th><th>Status</th></tr></thead><tbody>
      ${spots.map(s => `<tr>
        <td><strong>${esc(s.name)}</strong>${s.helps_abc ? '<br><span class="ad-role">Helps with vaccination</span>' : ''}${s.mine ? ` <button class="ad-leave" data-stop="${esc(s.id)}">Stop</button>` : ''}</td>
        <td><a href="kasa.html?at=${s.lat},${s.lng}">${esc(where(s) || 'See on map')}</a></td>
        <td>${esc(s.feed_time)}</td>
        <td class="n">${esc(s.dogs)}</td>
        <td>${s.designated
          ? `<span class="ad-ok">Designated</span><br><span class="ad-office">${esc(s.designated.note)} <a href="${esc(s.designated.source_url)}" target="_blank" rel="noopener">source</a></span>`
          : `Proposed by caregiver<br><span class="ad-office">since ${esc(fmt(s.since))}</span>`}</td></tr>`).join('')}</tbody></table>`;
    el.querySelectorAll('[data-stop]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Stop this feeding spot? It leaves the public list.')) return;
      const { error: e2 } = await sb.rpc('kasa_leave_feeding_spot', { p_id: Number(b.dataset.stop) });
      if (e2){ alert(e2.details || e2.message); return; }
      load();
    }));
  }
  load();

  // The letter cites only rule 20 of the ABC Rules 2023 and the Supreme Court order of 22 Aug 2025 (see #rules).
  const f = id => document.getElementById(id).value.trim();
  function letter(){
    const body = f('dg-f-body') || '[Municipality]', ward = f('dg-f-ward') || '[ward no.]';
    const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
    document.getElementById('dg-letter').value =
`To
The Chairperson / Commissioner
${body}

Copy to: The Councillor, Ward No. ${ward}, ${body}

Date: ${today}

Subject: Request to designate fixed feeding spots for community dogs in Ward No. ${ward}, under rule 20 of the Animal Birth Control Rules, 2023

Sir / Madam,

I live in Ward No. ${ward}. Community dogs in our ward are fed at random places and times. This leads to quarrels between residents and feeders, food waste on the road, and dogs that cannot be found when the vaccination or sterilisation team comes.

1. Rule 20(1) of the Animal Birth Control Rules, 2023 (G.S.R. 193(E), 10 March 2023) makes the local body's representative of the area responsible for arranging the feeding of community animals together with the residents who feed them. It requires feeding spots that are mutually agreed, keeping in mind the number of dogs and their territories, far from children's play areas, entry and exit points and staircases; feeding times when children and senior citizens are least likely to be about; designated feeders who leave no litter; and allows those feeders to volunteer for vaccination, catching and release under the ABC programme.

2. The Hon'ble Supreme Court, in Suo Motu W.P.(C) No. 5/2025, order dated 22 August 2025, para 33(d), directed municipal authorities to "forthwith commence an exercise for creating dedicated feeding spaces for the stray dogs in each municipal ward", with notice boards near them, and in para 33(e) asked each municipal authority to create a dedicated helpline.

I therefore request you to:

(a) identify and notify dedicated feeding spots and times in Ward No. ${ward}, in consultation with the residents and the people who already feed the dogs, and put up notice boards at them;
(b) record the designated feeders for each spot, and involve them in the next anti-rabies vaccination and sterilisation drive in the ward;
(c) tell us the helpline number for complaints about dog bites and feeding disputes, and how a dispute will be referred to the Animal Welfare Committee under rule 20(2);
(d) as a first step, start with Ward No. ${ward} as a pilot and share the result with the residents.

Please send a written reply with the action taken.

Yours faithfully,

${f('dg-f-name') || '[Your name]'}
${f('dg-f-addr') || '[Your address]'}${f('dg-f-phone') ? '\nPhone: ' + f('dg-f-phone') : ''}
`;
  }
  ['dg-f-name', 'dg-f-addr', 'dg-f-body', 'dg-f-ward', 'dg-f-phone'].forEach(id => document.getElementById(id).addEventListener('input', letter));
  letter();
  // wb_towns.geojson leaves out Purulia's own three towns.
  const bodies = slug === 'purulia'
    ? Promise.resolve(['Purulia Municipality', 'Jhalda Municipality', 'Raghunathpur Municipality'])
    : PF && PF.data ? PF.bodies(slug).then(list => list.map(b => b.body)) : Promise.resolve([]);
  bodies.then(list => {
    document.getElementById('dg-bodies').innerHTML = list.filter(Boolean).map(b => `<option value="${esc(b)}">`).join('');
  }).catch(() => {});
  document.getElementById('dg-copy').addEventListener('click', async e => {
    const t = document.getElementById('dg-letter');
    try { await navigator.clipboard.writeText(t.value); } catch (err) { t.select(); document.execCommand('copy'); }
    e.target.textContent = 'Copied';
    setTimeout(() => { e.target.textContent = 'Copy the letter'; }, 2000);
  });
})();
