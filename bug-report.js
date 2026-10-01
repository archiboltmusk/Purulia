// "Report a bug" on every public page: a small button that opens a short form and saves
// to kasa_bug_submit (admin.html shows the queue). For problems with the website itself,
// not civic reports (kasa.html) or grievances (grievance.html).
//
// Load it early (plain <script>, no defer) so it can remember the page's errors from the
// start. A page that has its own [data-bug-report] trigger (e.g. a menu item) gets no
// floating button. Needs config.js; loads it itself on pages that don't.
(function () {
  'use strict';
  if (window.__bugReport) return;
  window.__bugReport = true;

  // ── Remember the last few errors on this page ─────────────────────────
  const errors = [];
  const note = (msg) => {
    msg = String(msg || '').slice(0, 500);
    if (!msg || errors[errors.length - 1] === msg) return;
    errors.push(msg);
    if (errors.length > 10) errors.shift();
  };
  window.addEventListener('error', (e) => {
    if (e.target && e.target !== window && (e.target.src || e.target.href)) {
      note('Failed to load ' + (e.target.src || e.target.href));
    } else {
      note((e.message || 'Error') + (e.filename ? ' @ ' + e.filename.split('/').pop() + ':' + e.lineno : ''));
    }
  }, true);
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    note('Unhandled: ' + (r && (r.message || r.error_description) || r));
  });
  const origError = console.error;
  console.error = function () {
    try { note([].map.call(arguments, (a) => (a && a.message) || (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')); } catch (_) {}
    return origError.apply(this, arguments);
  };

  const T = {
    en: { btn: 'Report a bug', title: 'Something not working?', intro: 'Tell us what went wrong on this website. For a problem in your area, use Report on the map instead.',
          what: 'What went wrong?', whatPh: 'e.g. I tapped Share and nothing happened', email: 'Your email (optional, if you want a reply)',
          attach: 'We also send this page address, your browser and device, and any recent error messages. No photos or location.',
          send: 'Send', sending: 'Sending…', cancel: 'Cancel', thanks: 'Thank you! We will look into it.', close: 'Close',
          short: 'Please say a little more (at least 5 letters).', fail: 'Could not send. Please check your connection and try again.' },
    bn: { btn: 'সমস্যা জানান', title: 'কিছু কাজ করছে না?', intro: 'এই ওয়েবসাইটে কী ভুল হয়েছে বলুন। আপনার এলাকার সমস্যার জন্য ম্যাপে রিপোর্ট করুন।',
          what: 'কী ভুল হয়েছে?', whatPh: 'যেমন: শেয়ার টিপলাম, কিছু হল না', email: 'আপনার ইমেল (ইচ্ছা হলে, উত্তর পেতে)',
          attach: 'সঙ্গে এই পাতার ঠিকানা, আপনার ব্রাউজার ও ডিভাইস, আর সাম্প্রতিক ত্রুটির বার্তা পাঠানো হবে। কোনো ছবি বা লোকেশন নয়।',
          send: 'পাঠান', sending: 'পাঠানো হচ্ছে…', cancel: 'বাতিল', thanks: 'ধন্যবাদ! আমরা দেখছি।', close: 'বন্ধ',
          short: 'আর একটু লিখুন (অন্তত ৫টি অক্ষর)।', fail: 'পাঠানো যায়নি। সংযোগ দেখে আবার চেষ্টা করুন।' },
    hi: { btn: 'बग बताएं', title: 'कुछ काम नहीं कर रहा?', intro: 'इस वेबसाइट पर क्या गड़बड़ हुई, बताइए। अपने इलाके की समस्या के लिए मैप पर रिपोर्ट करें।',
          what: 'क्या गड़बड़ हुई?', whatPh: 'जैसे: शेयर दबाया, कुछ नहीं हुआ', email: 'आपका ईमेल (वैकल्पिक, जवाब चाहिए तो)',
          attach: 'साथ में इस पेज का पता, आपका ब्राउज़र और डिवाइस, और हाल की त्रुटियाँ भेजी जाएँगी। कोई फ़ोटो या लोकेशन नहीं।',
          send: 'भेजें', sending: 'भेजा जा रहा है…', cancel: 'रद्द करें', thanks: 'धन्यवाद! हम देखेंगे।', close: 'बंद करें',
          short: 'थोड़ा और लिखें (कम से कम 5 अक्षर)।', fail: 'भेजा नहीं जा सका। कनेक्शन देखकर फिर कोशिश करें।' }
  };
  const t = () => {
    let l = (document.documentElement.lang || '').slice(0, 2);
    if (!T[l]) { try { l = (localStorage.getItem('kasa_lang') || '').slice(0, 2); } catch (_) {} }
    return T[l] || T.en;
  };

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
.br-fab{position:fixed;left:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:900;display:inline-flex;align-items:center;gap:6px;
  padding:6px 11px;border-radius:999px;border:1px solid rgba(128,128,128,.35);background:rgba(20,18,15,.72);color:#f3eee6;
  font:500 12px/1.2 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;cursor:pointer;opacity:.7;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
.br-fab:hover,.br-fab:focus-visible{opacity:1}
body:has(#waFloat) .br-fab{bottom:calc(88px + env(safe-area-inset-bottom,0px))}
@media print{.br-fab{display:none}}
.br-back{position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.55);display:flex;align-items:flex-end;justify-content:center;padding:16px}
@media (min-width:600px){.br-back{align-items:center}}
.br-box{width:100%;max-width:440px;max-height:calc(100vh - 32px);overflow:auto;background:#fffdf8;color:#1d1a16;border-radius:14px;padding:18px;
  font:15px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.35)}
.br-box h2{margin:0 0 6px;font-size:18px}
.br-box p{margin:0 0 12px;font-size:13px;color:#5a534a}
.br-box label{display:block;font-weight:600;font-size:13px;margin:10px 0 4px}
.br-box textarea,.br-box input{width:100%;box-sizing:border-box;font:inherit;padding:9px 10px;border:1px solid #cfc6b8;border-radius:8px;background:#fff;color:#1d1a16}
.br-box textarea{min-height:96px;resize:vertical}
.br-row{display:flex;gap:8px;justify-content:flex-end;margin-top:14px}
.br-row button{font:600 14px system-ui,sans-serif;padding:9px 16px;border-radius:8px;border:1px solid #cfc6b8;background:#fff;color:#1d1a16;cursor:pointer}
.br-row .br-send{background:#1d1a16;color:#fff;border-color:#1d1a16}
.br-row button:disabled{opacity:.6;cursor:default}
.br-msg{font-size:13px;margin-top:8px;min-height:1em}
.br-msg.br-err{color:#b3261e}
.br-hp{position:absolute;left:-9999px;width:1px;height:1px;opacity:0}
@media (prefers-color-scheme:dark){.br-box{background:#1f1c18;color:#f3eee6}.br-box p{color:#b9b0a3}
  .br-box textarea,.br-box input,.br-row button{background:#14120f;color:#f3eee6;border-color:#4a443c}
  .br-row .br-send{background:#f3eee6;color:#14120f;border-color:#f3eee6}.br-msg.br-err{color:#ff8a80}}`;

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function device() {
    const n = navigator, s = window.screen || {};
    return {
      screen: s.width + 'x' + s.height, viewport: window.innerWidth + 'x' + window.innerHeight,
      dpr: window.devicePixelRatio || 1, lang: n.language || '', page_lang: document.documentElement.lang || '',
      touch: 'ontouchstart' in window || (n.maxTouchPoints || 0) > 0, online: n.onLine !== false,
      platform: (n.userAgentData && n.userAgentData.platform) || n.platform || '',
      standalone: !!(window.matchMedia && matchMedia('(display-mode: standalone)').matches)
    };
  }

  let open = null;
  function show() {
    if (open) return;
    const L = t();
    const back = document.createElement('div');
    back.className = 'br-back';
    back.innerHTML = `<form class="br-box" role="dialog" aria-modal="true" aria-labelledby="br-title" novalidate>
      <h2 id="br-title">${esc(L.title)}</h2><p>${esc(L.intro)}</p>
      <label for="br-what">${esc(L.what)}</label>
      <textarea id="br-what" maxlength="2000" required placeholder="${esc(L.whatPh)}"></textarea>
      <label for="br-email">${esc(L.email)}</label>
      <input id="br-email" type="email" maxlength="200" autocomplete="email">
      <input class="br-hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
      <p style="margin-top:10px">${esc(L.attach)}</p>
      <div class="br-msg" role="status" aria-live="polite"></div>
      <div class="br-row"><button type="button" class="br-cancel">${esc(L.cancel)}</button><button type="submit" class="br-send">${esc(L.send)}</button></div>
    </form>`;
    const form = back.firstElementChild, msg = form.querySelector('.br-msg'), send = form.querySelector('.br-send');
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
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const what = form.querySelector('#br-what').value.trim();
      msg.className = 'br-msg';
      if (what.length < 5) { msg.className = 'br-msg br-err'; msg.textContent = L.short; return; }
      if (form.querySelector('.br-hp').value) { close(); return; }
      send.disabled = true; send.textContent = L.sending;
      try {
        const cfg = await config();
        const res = await fetch(cfg.SUPABASE_URL + '/rest/v1/rpc/kasa_bug_submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: cfg.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + cfg.SUPABASE_ANON_KEY },
          body: JSON.stringify({
            p_what: what, p_email: form.querySelector('#br-email').value.trim() || null,
            p_page_url: location.href.slice(0, 500), p_user_agent: navigator.userAgent.slice(0, 500),
            p_device: device(), p_errors: errors.slice()
          })
        });
        if (!res.ok) {
          let m = '';
          try { const j = await res.json(); m = /^KASA_/.test(j.message || '') ? (j.details || '') : ''; } catch (_) {}
          throw new Error(m || L.fail);
        }
        form.innerHTML = `<h2 id="br-title">${esc(L.thanks)}</h2><div class="br-row"><button type="button" class="br-send">${esc(L.close)}</button></div>`;
        const btn = form.querySelector('button');
        btn.addEventListener('click', close);
        btn.focus();
      } catch (err) {
        msg.className = 'br-msg br-err';
        msg.textContent = (err && err.message && err.message !== 'Failed to fetch' && err.message !== 'no config') ? err.message : L.fail;
        send.disabled = false; send.textContent = L.send;
      }
    });
    document.body.appendChild(back);
    open = back;
    form.querySelector('#br-what').focus();
  }
  window.openBugReport = show;

  // "Suggest a correction" for the site's figures rides along on every page (source-fix.js).
  if (!window.SourceFix) {
    const sf = document.createElement('script');
    sf.src = 'source-fix.js';
    document.head.appendChild(sf);
  }

  function init() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    document.addEventListener('click', (e) => {
      const el = e.target.closest && e.target.closest('[data-bug-report]');
      if (el) { e.preventDefault(); show(); }
    });
    if (document.querySelector('[data-bug-report]')) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'br-fab';
    b.setAttribute('data-bug-report', '');
    b.innerHTML = '<span aria-hidden="true">🐞</span><span class="br-fab-label"></span>';
    const label = () => { b.querySelector('.br-fab-label').textContent = t().btn; };
    label();
    // Pages switch language after load; keep the label in step.
    new MutationObserver(label).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    document.body.appendChild(b);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
