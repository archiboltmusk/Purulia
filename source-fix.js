// "Suggest a correction" for the figures on the site. Every figure links to where it was
// published; when a reader thinks one is wrong, out of date or missing its source, this
// form sends it to the moderators (kasa_suggest_data_fix; admin.html shows the queue).
//
// Loaded by bug-report.js on every page, so pages need nothing. It adds one short line at
// the foot of the page (inside <footer> if there is one, or into [data-source-fix-note]),
// with the contact email for anyone who would rather write. Pages in SKIP get no line.
// Hooks: any [data-source-fix] element opens the form (data-what prefills the figure);
// an element marked data-doubt gets a small "source?" button after it, for figures whose
// source we could not link yet. Uses bug-report.js's form styles (.br-*).
(function () {
  'use strict';
  if (window.SourceFix) return;

  const EMAIL = 'thelosthillproject@gmail.com';
  const PAGE = (location.pathname.split('/').pop() || 'index').replace(/\.html$/, '') || 'index';
  const SKIP = new Set(['kasa', 'admin', 'og-card', 'privacy', 'terms', 'rules', 'poster', 'changelog', 'suggest-feature',
    'grievance', 'add-town', 'map', 'audience', 'digest-subscribe', 'suggestions', 'routes']);

  const T = {
    en: { note1: 'Every figure here links to where it was published online. If one looks wrong, out of date or has no link,',
          link: 'suggest a correction', note2: ', or email', note3: 'anytime.', mail: 'Prefer email? Write anytime to', chip: 'source?', chipTitle: 'We could not link a source for this yet. Know one?',
          title: 'Suggest a correction', intro: 'Tell us which figure is wrong or missing its source. A moderator checks your link before the page changes.',
          what: 'Which figure or line?', whatPh: 'e.g. "32.45% rural homes with tap water"', fix: 'What is right, or what is missing?',
          fixPh: 'e.g. The dashboard now shows 41.2% (read 1 Oct 2026)', src: 'Link that shows it (official source if you can)',
          how: 'How do you know? (optional)', email: 'Your email (optional, if you want a reply)', send: 'Send', sending: 'Sending…',
          cancel: 'Cancel', close: 'Close', thanks: 'Thank you! A moderator will check it against your link.',
          short: 'Please fill in which figure and what is right.', badUrl: 'The link must start with http:// or https://',
          fail: 'Could not send. Check your connection, or email us:' },
    bn: { note1: 'এখানের প্রতিটি তথ্য যেখানে প্রকাশিত হয়েছে তার লিংক দেওয়া আছে। কোনোটা ভুল, পুরনো বা লিংক ছাড়া মনে হলে',
          link: 'সংশোধন জানান', note2: ', অথবা যেকোনো সময় ইমেল করুন', note3: '।', mail: 'ইমেলে লিখতে চাইলে যেকোনো সময়:', chip: 'সূত্র?', chipTitle: 'এর সূত্রের লিংক এখনও দিতে পারিনি। আপনি জানেন?',
          title: 'সংশোধন জানান', intro: 'কোন তথ্যটি ভুল বা সূত্র ছাড়া, বলুন। পাতা বদলানোর আগে একজন মডারেটর আপনার লিংক মিলিয়ে দেখবেন।',
          what: 'কোন তথ্য বা লাইন?', whatPh: 'যেমন: "৩২.৪৫% গ্রামের বাড়িতে কলের জল"', fix: 'ঠিকটা কী, বা কী নেই?',
          fixPh: 'যেমন: ড্যাশবোর্ডে এখন ৪১.২% দেখাচ্ছে (১ অক্টোবর ২০২৬)', src: 'যে লিংকে এটা দেখা যায় (পারলে সরকারি সূত্র)',
          how: 'কীভাবে জানলেন? (ইচ্ছা হলে)', email: 'আপনার ইমেল (ইচ্ছা হলে, উত্তর পেতে)', send: 'পাঠান', sending: 'পাঠানো হচ্ছে…',
          cancel: 'বাতিল', close: 'বন্ধ', thanks: 'ধন্যবাদ! একজন মডারেটর আপনার লিংক মিলিয়ে দেখবেন।',
          short: 'কোন তথ্য আর ঠিকটা কী, দুটোই লিখুন।', badUrl: 'লিংক http:// বা https:// দিয়ে শুরু হতে হবে',
          fail: 'পাঠানো যায়নি। সংযোগ দেখুন, অথবা ইমেল করুন:' },
    hi: { note1: 'यहाँ हर आँकड़ा उस जगह से जुड़ा है जहाँ वह ऑनलाइन छपा। कोई गलत, पुराना या बिना लिंक लगे तो',
          link: 'सुधार सुझाएँ', note2: ', या कभी भी ईमेल करें', note3: '।', mail: 'ईमेल करना चाहें तो कभी भी लिखें:', chip: 'स्रोत?', chipTitle: 'इसका स्रोत लिंक अभी नहीं दे पाए। आप जानते हैं?',
          title: 'सुधार सुझाएँ', intro: 'बताइए कौन सा आँकड़ा गलत है या बिना स्रोत है। पेज बदलने से पहले एक मॉडरेटर आपका लिंक जाँचेगा।',
          what: 'कौन सा आँकड़ा या पंक्ति?', whatPh: 'जैसे: "32.45% ग्रामीण घरों में नल का पानी"', fix: 'सही क्या है, या क्या छूटा है?',
          fixPh: 'जैसे: डैशबोर्ड अब 41.2% दिखाता है (1 अक्टूबर 2026)', src: 'लिंक जहाँ यह दिखता है (हो सके तो सरकारी स्रोत)',
          how: 'आपको कैसे पता? (वैकल्पिक)', email: 'आपका ईमेल (वैकल्पिक, जवाब चाहिए तो)', send: 'भेजें', sending: 'भेजा जा रहा है…',
          cancel: 'रद्द करें', close: 'बंद करें', thanks: 'धन्यवाद! एक मॉडरेटर आपके लिंक से जाँचेगा।',
          short: 'कौन सा आँकड़ा और सही क्या है, दोनों लिखें।', badUrl: 'लिंक http:// या https:// से शुरू होना चाहिए',
          fail: 'भेजा नहीं जा सका। कनेक्शन देखें, या ईमेल करें:' }
  };
  const t = () => {
    let l = (document.documentElement.lang || '').slice(0, 2);
    if (!T[l]) { try { l = (localStorage.getItem('kasa_lang') || '').slice(0, 2); } catch (_) {} }
    return T[l] || T.en;
  };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function config() {
    if (window.KASA_CONFIG) return Promise.resolve(window.KASA_CONFIG);
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'config.js';
      s.onload = () => (window.KASA_CONFIG ? resolve(window.KASA_CONFIG) : reject(new Error('no config')));
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  const CSS = `
.sf-note{max-width:760px;margin:24px auto;padding:0 16px 56px;font:13px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;opacity:.8;text-align:center}
footer .sf-note{margin:0 auto 12px;padding:0}
.sf-note a,.sf-note button.sf-open{color:inherit;text-decoration:underline;text-underline-offset:2px}
.sf-note button.sf-open{background:none;border:0;padding:0;font:inherit;cursor:pointer}
.sf-chip{display:inline-block;margin-left:4px;padding:0 6px;border:1px dashed currentColor;border-radius:999px;background:none;color:inherit;
  font:600 10.5px/1.6 system-ui,sans-serif;opacity:.75;cursor:pointer;vertical-align:middle}
.sf-chip:hover,.sf-chip:focus-visible{opacity:1}
@media print{.sf-chip,.sf-note button.sf-open{display:none}}`;

  let open = null;
  function show(prefill) {
    if (open) return;
    const L = t();
    const back = document.createElement('div');
    back.className = 'br-back';
    back.innerHTML = `<form class="br-box sf-box" role="dialog" aria-modal="true" aria-labelledby="sf-title" novalidate>
      <h2 id="sf-title">${esc(L.title)}</h2><p>${esc(L.intro)}</p>
      <label for="sf-what">${esc(L.what)}</label>
      <textarea id="sf-what" maxlength="1000" rows="2" required placeholder="${esc(L.whatPh)}"></textarea>
      <label for="sf-fix">${esc(L.fix)}</label>
      <textarea id="sf-fix" maxlength="2000" required placeholder="${esc(L.fixPh)}"></textarea>
      <label for="sf-src">${esc(L.src)}</label>
      <input id="sf-src" type="url" maxlength="500" inputmode="url" placeholder="https://">
      <label for="sf-how">${esc(L.how)}</label>
      <input id="sf-how" maxlength="1000">
      <label for="sf-email">${esc(L.email)}</label>
      <input id="sf-email" type="email" maxlength="200" autocomplete="email">
      <input class="br-hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
      <p style="margin-top:10px">${esc(L.mail)} <a href="mailto:${EMAIL}">${EMAIL}</a></p>
      <div class="br-msg" role="status" aria-live="polite"></div>
      <div class="br-row"><button type="button" class="br-cancel">${esc(L.cancel)}</button><button type="submit" class="br-send">${esc(L.send)}</button></div>
    </form>`;
    const form = back.firstElementChild, msg = form.querySelector('.br-msg'), send = form.querySelector('.br-send');
    const $ = (id) => form.querySelector('#sf-' + id);
    if (prefill) $('what').value = String(prefill).replace(/\s+/g, ' ').trim().slice(0, 1000);
    const prevFocus = document.activeElement;
    const close = () => {
      back.remove(); open = null;
      document.removeEventListener('keydown', onKey, true);
      if (prevFocus && prevFocus.focus) prevFocus.focus();
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    back.addEventListener('click', (e) => { if (e.target === back) close(); });
    form.querySelector('.br-cancel').addEventListener('click', close);
    const err = (text, mail) => {
      msg.className = 'br-msg br-err';
      msg.innerHTML = esc(text) + (mail ? ` <a href="mailto:${EMAIL}">${EMAIL}</a>` : '');
    };
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const what = $('what').value.trim(), fix = $('fix').value.trim(), src = $('src').value.trim();
      msg.className = 'br-msg'; msg.textContent = '';
      if (!what || fix.length < 3) return err(L.short);
      if (src && !/^https?:\/\/\S+\.\S+$/i.test(src)) return err(L.badUrl);
      if (form.querySelector('.br-hp').value) { close(); return; }
      send.disabled = true; send.textContent = L.sending;
      try {
        const cfg = await config();
        const res = await fetch(cfg.SUPABASE_URL + '/rest/v1/rpc/kasa_suggest_data_fix', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: cfg.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + cfg.SUPABASE_ANON_KEY },
          body: JSON.stringify({ p_what: what, p_correction: fix, p_source_url: src || null, p_note: $('how').value.trim() || null,
            p_email: $('email').value.trim() || null, p_page: location.href.slice(0, 300) })
        });
        if (!res.ok) {
          let m = '';
          try { const j = await res.json(); m = /^KASA_/.test(j.message || '') ? (j.details || '') : ''; } catch (_) {}
          throw new Error(m);
        }
        form.innerHTML = `<h2 id="sf-title">${esc(L.thanks)}</h2><div class="br-row"><button type="button" class="br-send">${esc(L.close)}</button></div>`;
        const btn = form.querySelector('button');
        btn.addEventListener('click', close);
        btn.focus();
      } catch (e2) {
        if (e2 && e2.message && e2.message !== 'Failed to fetch' && e2.message !== 'no config') err(e2.message);
        else err(L.fail, true);
        send.disabled = false; send.textContent = L.send;
      }
    });
    document.body.appendChild(back);
    open = back;
    (prefill ? $('fix') : $('what')).focus();
  }

  function renderNote(el) {
    const L = t();
    el.innerHTML = `${esc(L.note1)} <button type="button" class="sf-open" data-source-fix>${esc(L.link)}</button>${esc(L.note2)} <a href="mailto:${EMAIL}">${EMAIL}</a> ${esc(L.note3)}`;
  }
  function renderChips() {
    const L = t();
    document.querySelectorAll('[data-doubt]').forEach((el) => {
      let b = el.nextElementSibling;
      if (!b || !b.classList.contains('sf-chip')) {
        b = document.createElement('button');
        b.type = 'button';
        b.className = 'sf-chip';
        b.setAttribute('data-source-fix', '');
        el.insertAdjacentElement('afterend', b);
      }
      b.dataset.what = el.getAttribute('data-doubt') || el.textContent;
      b.textContent = L.chip;
      b.title = L.chipTitle;
    });
  }

  function init() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    document.addEventListener('click', (e) => {
      const el = e.target.closest && e.target.closest('[data-source-fix]');
      if (el) { e.preventDefault(); show(el.dataset.what || ''); }
    });
    let note = document.querySelector('[data-source-fix-note]');
    if (!note && !SKIP.has(PAGE)) {
      note = document.createElement('p');
      const foot = document.querySelector('body > footer, footer');
      if (foot) foot.insertBefore(note, foot.firstChild); else document.body.appendChild(note);
    }
    if (note) note.classList.add('sf-note');
    const render = () => { if (note) renderNote(note); renderChips(); };
    render();
    // Pages switch language after load; keep the wording in step.
    new MutationObserver(render).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  }

  window.SourceFix = { open: show, email: EMAIL };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
