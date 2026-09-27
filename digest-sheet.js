/* Weekly digest sign-up: "Join N neighbours" banner at the top of the page and the
   sign-up sheet it opens. Load with digest-sheet.css and config.js.
     <script defer src="digest-sheet.js" data-banner></script>        banner + sheet
     <script defer src="digest-sheet.js" data-inline="#root"></script> form drawn in #root
   Any element with [data-digest-open] opens the sheet. */
(function () {
  'use strict';
  const me = document.currentScript;
  const CFG = window.KASA_CONFIG || {};
  const HIDE_KEY = 'kasa_digest_banner';

  const T = {
    en: {
      banner: 'Join <b>{n} {people}</b> on the Monday digest', banner0: 'Get the <b>Monday digest</b> by email',
      one: 'neighbour', many: 'neighbours', close: 'Close', hide: 'Hide',
      title: 'Parishkar Weekly',
      intro: "Every Monday, get the week's civic reports, the worst wards, and the problems left unfixed longest, straight to your inbox. Made for residents, journalists, and anyone watching Purulia closely.",
      chips: ['Weekly stats', 'Worst wards', 'Overdue problems', 'Live map link'],
      count: '<b>{n}</b> {people} already subscribe',
      email: 'Your email', name: 'Name', optional: '(optional)', email_ph: 'you@example.com', name_ph: 'What should we call you?',
      btn: 'Subscribe', busy: 'Subscribing…', foot: 'We send one email a week. Unsubscribe anytime with one click.',
      done: "You're in!", done_sub: 'The next digest arrives on Monday.', fail: 'Could not subscribe. Please try again.',
    },
    bn: {
      banner: 'সোমবারের ডাইজেস্টে <b>{n} জন {people}</b>-এর সঙ্গে যোগ দিন', banner0: 'ইমেলে <b>সোমবারের ডাইজেস্ট</b> পান',
      one: 'প্রতিবেশী', many: 'প্রতিবেশী', close: 'বন্ধ করুন', hide: 'লুকান',
      title: 'পরিষ্কার সাপ্তাহিক',
      intro: 'প্রতি সোমবার সপ্তাহের নাগরিক অভিযোগ, সবচেয়ে পিছিয়ে থাকা ওয়ার্ড আর দীর্ঘদিন ধরে সমাধান না হওয়া সমস্যা সরাসরি আপনার ইনবক্সে। বাসিন্দা, সাংবাদিক আর পুরুলিয়ার দিকে নজর রাখা সবার জন্য।',
      chips: ['সাপ্তাহিক হিসাব', 'পিছিয়ে থাকা ওয়ার্ড', 'বকেয়া সমস্যা', 'লাইভ ম্যাপ লিংক'],
      count: '<b>{n}</b> জন {people} ইতিমধ্যে যুক্ত', email: 'আপনার ইমেল', name: 'নাম', optional: '(ঐচ্ছিক)',
      email_ph: 'you@example.com', name_ph: 'আপনাকে কী নামে ডাকব?', btn: 'সাবস্ক্রাইব', busy: 'সাবস্ক্রাইব হচ্ছে…',
      foot: 'সপ্তাহে একটি ইমেল। এক ক্লিকে যেকোনো সময় বন্ধ করুন।', done: 'আপনি যুক্ত হয়েছেন!',
      done_sub: 'পরের ডাইজেস্ট সোমবার আসবে।', fail: 'সাবস্ক্রাইব করা গেল না। আবার চেষ্টা করুন।',
    },
    hi: {
      banner: 'सोमवार डाइजेस्ट में <b>{n} {people}</b> से जुड़ें', banner0: 'ईमेल पर <b>सोमवार डाइजेस्ट</b> पाएं',
      one: 'पड़ोसी', many: 'पड़ोसियों', close: 'बंद करें', hide: 'छिपाएं',
      title: 'परिष्कार साप्ताहिक',
      intro: 'हर सोमवार हफ़्ते की नागरिक शिकायतें, सबसे पीछे वाले वार्ड और सबसे लंबे समय से अनसुलझी समस्याएँ सीधे आपके इनबॉक्स में। निवासियों, पत्रकारों और पुरुलिया पर नज़र रखने वाले हर व्यक्ति के लिए।',
      chips: ['साप्ताहिक आँकड़े', 'सबसे पीछे वाले वार्ड', 'लंबित समस्याएँ', 'लाइव मैप लिंक'],
      count: '<b>{n}</b> {people} पहले से जुड़े हैं', email: 'आपका ईमेल', name: 'नाम', optional: '(वैकल्पिक)',
      email_ph: 'you@example.com', name_ph: 'आपको क्या कहकर बुलाएँ?', btn: 'सब्सक्राइब करें', busy: 'सब्सक्राइब हो रहा है…',
      foot: 'हफ़्ते में एक ईमेल। एक क्लिक में कभी भी बंद करें।', done: 'आप जुड़ गए!',
      done_sub: 'अगला डाइजेस्ट सोमवार को आएगा।', fail: 'सब्सक्राइब नहीं हो सका। फिर कोशिश करें।',
    },
  };
  let lang = 'en';
  try { lang = localStorage.getItem('kasa_lang') || 'en'; } catch (e) {}
  const L = T[lang] || T.en;
  const t = (k, n) => {
    const s = L[k] ?? T.en[k];
    if (typeof s !== 'string') return s;
    return s.replace('{n}', n == null ? '' : Number(n).toLocaleString('en-IN'))
            .replace('{people}', n === 1 ? L.one : L.many);
  };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const store = (k, v) => { try { v === undefined ? (v = localStorage.getItem(k)) : localStorage.setItem(k, v); } catch (e) { v = null; } return v; };

  // A form-encoded POST with the key in the query string is a "simple" CORS request: no
  // preflight, which some iPhone setups fail with "Load failed". Retried once on a network error.
  function rpc(fn, args, retry) {
    if (!CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY) return Promise.reject(new Error('not configured'));
    const body = new URLSearchParams();
    Object.entries(args || {}).forEach(([k, v]) => { if (v != null) body.set(k, v); });
    return fetch(CFG.SUPABASE_URL + '/rest/v1/rpc/' + fn + '?apikey=' + encodeURIComponent(CFG.SUPABASE_ANON_KEY), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    }).then(
      r => r.ok ? r.json() : r.json().catch(() => ({})).then(j => Promise.reject(new Error(j.message || r.statusText))),
      err => retry === false ? Promise.reject(Object.assign(err, { network: true }))
                             : new Promise(ok => setTimeout(ok, 800)).then(() => rpc(fn, args, false))
    );
  }

  let count = null;
  const counters = [];
  function setCount(n) {
    count = Number(n) || 0;
    counters.forEach(fn => fn(count));
  }

  const ICON = '<svg class="dgs-banner-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>';

  function formHTML() {
    return `
      <p class="dgs-intro">${esc(t('intro'))}</p>
      <ul class="dgs-chips">${t('chips').map(c => `<li>${esc(c)}</li>`).join('')}</ul>
      <p class="dgs-count" data-dgs-count hidden><span class="dgs-dot" aria-hidden="true"></span><span></span></p>
      <form data-dgs-form novalidate>
        <label class="dgs-label" for="dgs-email-${uid}">${esc(t('email'))}</label>
        <input class="dgs-input" id="dgs-email-${uid}" name="email" type="email" inputmode="email" autocomplete="email" placeholder="${esc(t('email_ph'))}" required maxlength="254">
        <label class="dgs-label" for="dgs-name-${uid}">${esc(t('name'))}<small>${esc(t('optional'))}</small></label>
        <input class="dgs-input" id="dgs-name-${uid}" name="name" type="text" autocomplete="given-name" placeholder="${esc(t('name_ph'))}" maxlength="80">
        <button class="dgs-btn" type="submit" disabled>${esc(t('btn'))}</button>
        <p class="dgs-msg" role="status" aria-live="polite"></p>
      </form>
      <p class="dgs-foot">${esc(t('foot'))}</p>`;
  }
  let uid = 0;

  function wire(root) {
    const countEl = root.querySelector('[data-dgs-count]');
    counters.push(n => {
      countEl.hidden = !n;
      countEl.lastElementChild.innerHTML = t('count', n);
    });
    if (count != null) counters[counters.length - 1](count);

    const form = root.querySelector('[data-dgs-form]');
    const email = form.elements.email, name = form.elements.name;
    const btn = form.querySelector('button'), msg = form.querySelector('.dgs-msg');
    const valid = () => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.value.trim());
    email.addEventListener('input', () => { btn.disabled = !valid(); msg.textContent = ''; });
    form.addEventListener('submit', e => {
      e.preventDefault();
      if (!valid()) return;
      btn.disabled = true; btn.textContent = t('busy'); msg.className = 'dgs-msg'; msg.textContent = '';
      rpc('kasa_digest_join', { p_email: email.value.trim(), p_name: name.value.trim() || null })
        .then(d => {
          if (!d || !d.success) throw new Error(d && d.message);
          store(HIDE_KEY, 'subscribed');
          document.querySelectorAll('.dgs-banner').forEach(b => { b.hidden = true; });
          if (d.total_subscribers != null) setCount(d.total_subscribers);
          form.outerHTML = `<div class="dgs-done"><p class="dgs-done-big">✓ ${esc(t('done'))}</p><p>${esc(t('done_sub'))}</p></div>`;
        })
        .catch(err => {
          btn.disabled = false; btn.textContent = t('btn');
          msg.className = 'dgs-msg err';
          msg.textContent = (err && err.message && !err.network && err.message !== 'not configured') ? err.message : t('fail');
        });
    });
    return email;
  }

  let modal = null, lastFocus = null;
  function open() {
    if (!modal) {
      uid++;
      modal = document.createElement('div');
      modal.className = 'dgs-modal';
      modal.innerHTML = `
        <div class="dgs-backdrop" data-dgs-close></div>
        <div class="dgs-sheet" role="dialog" aria-modal="true" aria-labelledby="dgs-title">
          <div class="dgs-handle" aria-hidden="true"></div>
          <div class="dgs-head"><h2 class="dgs-title" id="dgs-title">${esc(t('title'))}</h2>
            <button type="button" class="dgs-close" data-dgs-close aria-label="${esc(t('close'))}">✕</button></div>
          <div class="dgs-body">${formHTML()}</div>
        </div>`;
      document.body.appendChild(modal);
      modal.addEventListener('click', e => { if (e.target.closest('[data-dgs-close]')) close(); });
      modal._email = wire(modal);
    }
    lastFocus = document.activeElement;
    modal.classList.add('open');
    document.documentElement.style.overflow = 'hidden';
    const email = modal.querySelector('input[name=email]');
    if (email) setTimeout(() => email.focus(), 50);
  }
  function close() {
    if (!modal) return;
    modal.classList.remove('open');
    document.documentElement.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && modal && modal.classList.contains('open')) close(); });
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-digest-open]');
    if (a) { e.preventDefault(); open(); }
  });

  function banner() {
    if (store(HIDE_KEY)) return;
    const b = document.createElement('div');
    b.className = 'dgs-banner';
    b.innerHTML = `<button type="button" class="dgs-banner-open" data-digest-open>${ICON}<span></span></button>
      <button type="button" class="dgs-banner-x" aria-label="${esc(t('hide'))}">✕</button>`;
    const label = b.querySelector('.dgs-banner-open span');
    label.innerHTML = t('banner0');
    counters.push(n => { label.innerHTML = n ? t('banner', n) : t('banner0'); });
    b.querySelector('.dgs-banner-x').addEventListener('click', () => { store(HIDE_KEY, 'hidden'); b.hidden = true; });
    document.body.prepend(b);
  }

  function inline(sel) {
    const root = document.querySelector(sel);
    if (!root) return;
    uid++;
    root.classList.add('dgs-inline');
    root.innerHTML = `<div class="dgs-head"><h1 class="dgs-title">${esc(t('title'))}</h1></div><div class="dgs-body">${formHTML()}</div>`;
    wire(root);
  }

  function start() {
    if (me && me.hasAttribute('data-banner')) banner();
    if (me && me.dataset.inline) inline(me.dataset.inline);
    rpc('kasa_digest_subscriber_count').then(setCount).catch(() => {});
  }
  window.KasaDigest = { open, close };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
