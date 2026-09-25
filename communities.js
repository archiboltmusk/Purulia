/* Volunteer groups: approved list (public view) and registration (goes to a moderator). */
(function(){
  const cfg = window.KASA_CONFIG || {};
  const API = cfg.SUPABASE_URL + '/rest/v1/';
  const HEAD = { apikey: cfg.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + cfg.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' };
  const KINDS = { nss: 'NSS unit', school_college: 'School or college club', puja_committee: 'Puja committee',
                  youth_club: 'Youth club', residents: "Residents' group", ngo: 'NGO', other: 'Group' };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = id => document.getElementById(id);
  let groups = [];

  // A contact becomes a link only for plain https / mailto addresses; everything else is text.
  function contactHtml(c){
    if (!c) return '';
    const v = c.trim();
    if (/^https:\/\/[^\s"<>]+$/i.test(v)) return `<a href="${esc(v)}" target="_blank" rel="noopener nofollow ugc">${esc(v.replace(/^https:\/\//i, ''))}</a>`;
    if (/^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(v)) return `<a href="mailto:${esc(v)}">${esc(v)}</a>`;
    return esc(v);
  }

  function render(){
    const ward = Number($('cm-ward').value) || null;
    const list = ward ? groups.filter(g => (g.wards || []).includes(ward)) : groups;
    $('cm-count').textContent = `${list.length} group${list.length === 1 ? '' : 's'}${ward ? ' in ward ' + ward : ''}`;
    $('cm-list').innerHTML = list.length ? list.map(g => `
      <article class="cm-card">
        <div class="cm-kind">${esc(KINDS[g.kind] || 'Group')}</div>
        <h3 class="cm-name">${esc(g.name)}</h3>
        ${g.description ? `<p class="cm-desc">${esc(g.description)}</p>` : ''}
        <div class="cm-wards">${(g.wards || []).map(w => `<span class="cm-ward">Ward ${w}</span>`).join('')}</div>
        ${g.public_contact ? `<div class="cm-contact">${contactHtml(g.public_contact)}</div>` : ''}
      </article>`).join('')
      : `<div class="cm-empty">${ward ? 'No registered group in this ward yet. Start one and register it here.' : 'No groups registered yet. Be the first.'}</div>`;
  }

  async function load(){
    try {
      const res = await fetch(API + 'kasa_public_communities?select=id,name,kind,wards,description,public_contact,created_at&order=created_at.desc', { headers: HEAD });
      if (!res.ok) throw new Error();
      groups = await res.json();
    } catch (e) {
      $('cm-count').textContent = 'Could not load groups right now.';
      return;
    }
    render();
  }

  const wardSel = $('cm-ward'), pick = $('cm-wardpick');
  for (let w = 1; w <= 23; w++){
    wardSel.insertAdjacentHTML('beforeend', `<option value="${w}">Ward ${w}</option>`);
    pick.insertAdjacentHTML('beforeend', `<label><input type="checkbox" value="${w}" aria-label="Ward ${w}">${w}</label>`);
  }
  const start = Number(new URLSearchParams(location.search).get('ward'));
  if (start >= 1 && start <= 23){
    wardSel.value = String(start);
    pick.querySelector(`input[value="${start}"]`).checked = true;
  }
  wardSel.addEventListener('change', render);

  $('cm-form').addEventListener('submit', async e => {
    e.preventDefault();
    const msg = $('cm-msg'), btn = $('cm-submit');
    const wards = [...pick.querySelectorAll('input:checked')].map(i => Number(i.value));
    msg.className = 'cm-msg';
    btn.disabled = true;
    try {
      const res = await fetch(API + 'rpc/kasa_register_community', {
        method: 'POST', headers: HEAD,
        body: JSON.stringify({ p_name: $('cm-name').value, p_kind: $('cm-kind').value, p_wards: wards,
          p_description: $('cm-desc').value || null, p_public_contact: $('cm-public').value || null,
          p_coordinator_contact: $('cm-coord').value, p_adult: $('cm-adult').checked })
      });
      if (!res.ok){
        let detail = '';
        try { detail = (await res.json()).details || ''; } catch (e2) {}
        throw new Error(detail || 'Could not register right now. Please try again later.');
      }
      e.target.reset();
      msg.className = 'cm-msg ok';
      msg.textContent = 'Thank you. A moderator will check your group, and it will appear here once approved.';
    } catch (err) {
      msg.className = 'cm-msg bad';
      msg.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });

  load();
})();
