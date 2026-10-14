/* "Behind the numbers" on data.html: a real story beside a district figure. Only stories already
   published with the person's agreement, each shown unedited with the link to where it appeared,
   after a moderator has opened that link (kasa_submit_story → kasa_stories). */
(function(){
  const box = document.getElementById('stories');
  if (!box) return;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safe = u => /^https?:\/\//i.test(String(u || '')) ? String(u) : '';
  const cfg = () => window.KASA_CONFIG ? Promise.resolve(window.KASA_CONFIG) : new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = 'config.js';
    s.onload = () => window.KASA_CONFIG ? res(window.KASA_CONFIG) : rej(new Error('no config')); s.onerror = rej;
    document.head.appendChild(s);
  });
  async function rpc(name, body){
    const c = await cfg();
    const res = await fetch(c.SUPABASE_URL + '/rest/v1/rpc/' + name, { method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: c.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + c.SUPABASE_ANON_KEY },
      body: JSON.stringify(body) });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error((data && (data.details || data.message)) || 'Could not send. Please try again.');
    return data;
  }
  const slug = () => (window.PlaceFacts && window.PlaceFacts.data ? window.PlaceFacts.current() : 'purulia');
  const list = document.getElementById('st-list'), form = document.getElementById('st-form'), msg = document.getElementById('st-msg');
  const statPick = document.getElementById('st-stat');

  function fillStats(){
    const labels = [...document.querySelectorAll('#gtGrid .gt-card:not(.gt-card-note) .gt-card-label')]
      .filter(el => el.offsetParent !== null).map(el => el.textContent.trim()).filter(Boolean);
    statPick.innerHTML = '<option value="">Which figure does it stand beside?</option>' + [...new Set(labels)].map(l => `<option>${esc(l)}</option>`).join('');
  }
  async function load(){
    fillStats();
    let rows = [];
    try { rows = await rpc('kasa_stories', { p_district: slug() }) || []; } catch (e) { list.innerHTML = '<p class="st-empty">Stories could not load right now.</p>'; return; }
    list.innerHTML = rows.length ? rows.map(s => `
      <figure class="st-item">
        <div class="st-stat">${esc(s.stat_label)}</div>
        <blockquote>${esc(s.story)}</blockquote>
        <figcaption>${s.place ? esc(s.place) + ' · ' : ''}<a href="${esc(safe(s.source_url))}" target="_blank" rel="noopener">where this was published</a></figcaption>
      </figure>`).join('')
      : '<p class="st-empty">No story is on record for this district yet. Every figure above is a count of people; if one of them has told their story in public, add the link below.</p>';
  }
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(form);
    msg.textContent = 'Sending…';
    try {
      await rpc('kasa_submit_story', { p_district: slug(), p_stat_label: f.get('stat'), p_story: f.get('story'), p_place: f.get('place') || null,
        p_source_url: f.get('source'), p_consent: f.get('consent') === 'on' });
      form.reset(); fillStats();
      msg.textContent = 'Thank you. A moderator will open the link, and the story goes up once it is found there.';
    } catch (err){ msg.textContent = err.message; }
  });
  const pick = document.getElementById('gtPick');
  if (pick) pick.addEventListener('change', () => setTimeout(load, 50));
  if (document.readyState === 'complete') setTimeout(load, 300); else window.addEventListener('load', () => setTimeout(load, 300));
})();
