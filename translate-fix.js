// Readers fix the Bengali wording. One toggle, shown only while the page is in Bengali
// (in the report app's menu next to the language buttons; on static pages next to page-lang's
// switch). While it is on, tapping any Bengali interface text opens a box to send a better
// version (kasa_suggest_translation). Moderators approve in admin.html; approved text comes
// back from kasa_translations and replaces the built-in string in window.KASA_I18N.bn
// (ns 'kasa') or window.PAGE_I18N.bn (ns = this page's name, e.g. 'ward').
//
// Load after the page's dictionaries: after kasa-i18n.js (defer) and before kasa.js, or
// between <page>-i18n.js and page-lang.js. Needs config.js; loads it itself if missing.
(function () {
  'use strict';
  if (window.__translateFix) return;
  window.__translateFix = true;

  const CACHE = 'kasa_tr_bn';
  const PAGE_NS = (location.pathname.split('/').pop() || 'index').replace(/\.html$/, '') || 'index';
  const L = {
    toggle: '✎ অনুবাদ ঠিক করুন', on: 'অনুবাদ ঠিক করার মোড চালু: যে বাংলা লেখা ভুল মনে হয় তাতে টিপুন।', off: 'বন্ধ করুন',
    title: 'আরও ভালো অনুবাদ লিখুন', en: 'ইংরেজিতে', now: 'এখন যা লেখা আছে', yours: 'আপনার অনুবাদ',
    note: 'কেন? (ইচ্ছা হলে)', keep: 'এই অংশগুলো যেমন আছে রাখুন: ', send: 'পাঠান', sending: 'পাঠানো হচ্ছে…', cancel: 'বাতিল',
    thanks: 'ধন্যবাদ! একজন মডারেটর দেখে নিলে সাইটে দেখাবে।', close: 'বন্ধ', same: 'আগে লেখাটি বদলান।',
    fail: 'পাঠানো যায়নি। সংযোগ দেখে আবার চেষ্টা করুন।', nomatch: 'এই লেখাটি অনুবাদ নয় (তথ্য বা নাম), তাই এখানে বদলানো যায় না।'
  };

  const dicts = () => {
    const out = [];
    if (window.PAGE_I18N && window.PAGE_I18N.bn) out.push([PAGE_NS, window.PAGE_I18N.bn]);
    if (window.KASA_I18N && window.KASA_I18N.bn) out.push(['kasa', window.KASA_I18N.bn]);
    return out;
  };

  // ── Approved wording ──────────────────────────────────────────────────
  let approved = {}, index = null;
  try { approved = JSON.parse(localStorage.getItem(CACHE) || '{}') || {}; } catch (_) {}
  function patch() {
    dicts().forEach(([ns, d]) => { const m = approved[ns]; if (m) Object.keys(m).forEach((k) => { d[k] = m[k]; }); });
    index = null;
  }
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
  async function rpc(name, body) {
    const cfg = await config();
    const res = await fetch(cfg.SUPABASE_URL + '/rest/v1/rpc/' + name, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: cfg.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + cfg.SUPABASE_ANON_KEY },
      body: JSON.stringify(body)
    });
    let j = null;
    try { j = await res.json(); } catch (_) {}
    if (!res.ok) throw new Error(j && /^KASA_/.test(j.message || '') ? (j.details || '') : '');
    return j;
  }
  let fetched = false;
  function refresh() {
    if (fetched) return;
    fetched = true;
    rpc('kasa_translations', { p_lang: 'bn' }).then((m) => {
      if (!m || typeof m !== 'object') return;
      const s = JSON.stringify(m);
      if (s === JSON.stringify(approved)) return;
      approved = m;
      try { localStorage.setItem(CACHE, s); } catch (_) {}
      patch();
      document.dispatchEvent(new Event('kasa-translations'));
    }).catch(() => {});
  }
  patch();

  // ── Find which string a tapped element shows ──────────────────────────
  // Text as the page shows it: markup and [[n|link]] wrappers dropped (parsed inertly, never inserted).
  const parser = new DOMParser();
  const plain = (s) => {
    s = String(s).replace(/\[\[\d+\|([^\]]*)\]\]/g, '$1');
    if (/[<&]/.test(s)) s = parser.parseFromString(s, 'text/html').body.textContent || '';
    return s.replace(/\s+/g, ' ').trim();
  };
  function build() {
    const exact = new Map(), pats = [];
    dicts().forEach(([ns, d]) => Object.keys(d).forEach((key) => {
      if (typeof d[key] !== 'string') return;
      const p = plain(d[key]);
      if (!/[\u0980-\u09FF]/.test(p)) return;  // symbols and English-only lines are not translations
      if (/\{\w+\}/.test(p)) {
        const re = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{\w+\\\}/g, '.+?');
        pats.push({ ns, key, re: new RegExp('^' + re + '$') });
      } else if (!exact.has(p)) exact.set(p, { ns, key });
    }));
    return (index = { exact, pats });
  }
  function lookup(text) {
    const ix = index || build();
    const p = plain(text);
    if (!p || p.length > 2000) return null;
    return ix.exact.get(p) || ix.pats.find((x) => x.re.test(p)) || null;
  }
  function find(target) {
    const k = target.closest('[data-t]');
    if (k && window.PAGE_I18N && window.PAGE_I18N.bn && k.dataset.t in window.PAGE_I18N.bn) return { ns: PAGE_NS, key: k.dataset.t };
    const i = target.closest('[data-i18n]');
    if (i && window.KASA_I18N && window.KASA_I18N.bn && i.dataset.i18n in window.KASA_I18N.bn) return { ns: 'kasa', key: i.dataset.i18n };
    if (target.placeholder) { const m = lookup(target.placeholder); if (m) return m; }
    for (let el = target, n = 0; el && el !== document.body && n < 5; el = el.parentElement, n++) {
      const m = lookup(el.textContent || '');
      if (m) return m;
    }
    return null;
  }
  function english(m) {
    if (m.ns === 'kasa') return (window.KASA_I18N && window.KASA_I18N.en && window.KASA_I18N.en[m.key]) || '';
    return (window.PAGE_LANG_EN && window.PAGE_LANG_EN(m.key)) || '';
  }
  const tokens = (s) => (String(s).match(/\{\w+\}|\[\[\d+\|/g) || []).sort().join(' ');

  // ── Look ──────────────────────────────────────────────────────────────
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const style = document.createElement('style');
  style.textContent = `
.tf-toggle{font:500 12px/1.2 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:.45rem .7rem;margin:.5rem 0 0;border-radius:6px;border:1px dashed rgba(212,136,42,.7);background:transparent;color:inherit;cursor:pointer}
.tf-toggle[aria-pressed="true"]{background:#D4882A;color:#0a0805;border-style:solid}
.pl-lang + .tf-toggle{margin:0 .8rem 0 0;vertical-align:middle}
.tf-bar{position:fixed;left:50%;transform:translateX(-50%);top:calc(8px + env(safe-area-inset-top,0px));z-index:9990;display:flex;gap:10px;align-items:center;max-width:calc(100vw - 24px);
  padding:8px 12px;border-radius:10px;background:#D4882A;color:#0a0805;font:500 13px/1.35 system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.3)}
.tf-bar button{font:600 13px system-ui,sans-serif;padding:5px 10px;border-radius:6px;border:0;background:#0a0805;color:#fff;cursor:pointer;flex:none}
html.tf-on[lang="bn"] [data-i18n]:hover,html.tf-on[lang="bn"] [data-t]:hover{outline:1px dashed #D4882A;outline-offset:2px;cursor:help}
.tf-toast{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(20px + env(safe-area-inset-bottom,0px));z-index:9991;max-width:calc(100vw - 32px);padding:9px 14px;border-radius:8px;background:#1d1a16;color:#fff;font:13px/1.4 system-ui,sans-serif}
.tf-back{position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.55);display:flex;align-items:flex-end;justify-content:center;padding:16px}
@media (min-width:600px){.tf-back{align-items:center}}
.tf-box{width:100%;max-width:460px;max-height:calc(100vh - 32px);overflow:auto;background:#fffdf8;color:#1d1a16;border-radius:14px;padding:18px;font:15px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.35)}
.tf-box h2{margin:0 0 8px;font-size:18px}
.tf-box label{display:block;font-weight:600;font-size:13px;margin:10px 0 4px}
.tf-box .tf-was{font-size:14px;color:#5a534a;margin:0;padding:8px 10px;border-radius:8px;background:rgba(128,128,128,.12)}
.tf-box textarea,.tf-box input{width:100%;box-sizing:border-box;font:inherit;padding:9px 10px;border:1px solid #cfc6b8;border-radius:8px;background:#fff;color:#1d1a16}
.tf-box textarea{min-height:90px;resize:vertical}
.tf-row{display:flex;gap:8px;justify-content:flex-end;margin-top:14px}
.tf-row button{font:600 14px system-ui,sans-serif;padding:9px 16px;border-radius:8px;border:1px solid #cfc6b8;background:#fff;color:#1d1a16;cursor:pointer}
.tf-row .tf-send{background:#1d1a16;color:#fff;border-color:#1d1a16}
.tf-row button:disabled{opacity:.6;cursor:default}
.tf-msg{font-size:13px;margin-top:8px;min-height:1em;color:#b3261e}
.tf-hp{position:absolute;left:-9999px;width:1px;height:1px;opacity:0}
@media (prefers-color-scheme:dark){.tf-box{background:#1f1c18;color:#f3eee6}.tf-box .tf-was{color:#d8cfc2}
  .tf-box textarea,.tf-box input,.tf-row button{background:#14120f;color:#f3eee6;border-color:#4a443c}
  .tf-row .tf-send{background:#f3eee6;color:#14120f;border-color:#f3eee6}.tf-msg{color:#ff8a80}}
@media print{.tf-toggle,.tf-bar{display:none}}`;
  document.head.appendChild(style);

  // ── Mode ──────────────────────────────────────────────────────────────
  let on = false, bar = null, box = null, toggle = null;
  function toast(text) {
    const t = document.createElement('div');
    t.className = 'tf-toast'; t.setAttribute('role', 'status'); t.textContent = text;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3500);
  }
  function setOn(v) {
    on = v;
    document.documentElement.classList.toggle('tf-on', on);
    if (toggle) toggle.setAttribute('aria-pressed', String(on));
    if (on && !bar) {
      bar = document.createElement('div');
      bar.className = 'tf-bar'; bar.setAttribute('role', 'status');
      bar.innerHTML = `<span>${esc(L.on)}</span><button type="button">${esc(L.off)}</button>`;
      bar.querySelector('button').addEventListener('click', () => setOn(false));
      document.body.appendChild(bar);
    } else if (!on && bar) { bar.remove(); bar = null; }
  }
  const isBn = () => (document.documentElement.lang || '').slice(0, 2) === 'bn';

  document.addEventListener('click', (e) => {
    if (!on || box || !(e.target instanceof Element)) return;
    if (e.target.closest('.tf-bar,.tf-toggle,.tf-back')) return;
    const m = find(e.target);
    if (!m) {
      if (/[ঀ-৿]/.test(e.target.textContent || '')) { e.preventDefault(); e.stopPropagation(); toast(L.nomatch); }
      return;
    }
    e.preventDefault(); e.stopPropagation();
    openBox(m);
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && on && !box) setOn(false); });

  function openBox(m) {
    const d = dicts().find(([ns]) => ns === m.ns)[1];
    const cur = d[m.key] || '';
    const en = plain(english(m));
    const keep = String(cur).match(/\{\w+\}|\[\[\d+\|/g);
    box = document.createElement('div');
    box.className = 'tf-back';
    box.innerHTML = `<form class="tf-box" role="dialog" aria-modal="true" aria-labelledby="tf-title">
      <h2 id="tf-title">${esc(L.title)}</h2>
      ${en ? `<label>${esc(L.en)}</label><p class="tf-was" lang="en">${esc(en)}</p>` : ''}
      <label>${esc(L.now)}</label><p class="tf-was">${esc(plain(cur))}</p>
      <label for="tf-new">${esc(L.yours)}</label><textarea id="tf-new" maxlength="2000"></textarea>
      ${keep ? `<p class="tf-was" style="margin-top:6px;font-size:12px">${esc(L.keep + [...new Set(keep)].map((k) => k.startsWith('[[') ? k + '…]]' : k).join('  '))}</p>` : ''}
      <label for="tf-note">${esc(L.note)}</label><input id="tf-note" maxlength="300">
      <input class="tf-hp" tabindex="-1" autocomplete="off" aria-hidden="true">
      <div class="tf-msg" aria-live="polite"></div>
      <div class="tf-row"><button type="button" class="tf-cancel">${esc(L.cancel)}</button><button type="submit" class="tf-send">${esc(L.send)}</button></div>
    </form>`;
    const form = box.querySelector('form'), ta = form.querySelector('#tf-new'), msg = form.querySelector('.tf-msg'), send = form.querySelector('.tf-send');
    ta.value = cur;
    const close = () => { box.remove(); box = null; };
    form.querySelector('.tf-cancel').addEventListener('click', close);
    box.addEventListener('click', (e) => { if (e.target === box) close(); });
    box.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = ta.value.trim();
      msg.textContent = '';
      if (!v || v === String(cur).trim()) { msg.textContent = L.same; return; }
      if (tokens(v) !== tokens(cur)) { msg.textContent = L.keep + [...new Set(keep || [])].join('  '); return; }
      if (form.querySelector('.tf-hp').value) { close(); return; }
      send.disabled = true; send.textContent = L.sending;
      try {
        await rpc('kasa_suggest_translation', { p_ns: m.ns, p_key: m.key, p_current: cur, p_suggested: v,
          p_note: form.querySelector('#tf-note').value.trim() || null, p_page: location.pathname.slice(0, 200) });
        form.innerHTML = `<h2 id="tf-title">${esc(L.thanks)}</h2><div class="tf-row"><button type="button" class="tf-send">${esc(L.close)}</button></div>`;
        const b = form.querySelector('button'); b.addEventListener('click', close); b.focus();
      } catch (err) {
        msg.textContent = (err && err.message) || L.fail;
        send.disabled = false; send.textContent = L.send;
      }
    });
    document.body.appendChild(box);
    ta.focus();
  }

  // ── The one toggle ────────────────────────────────────────────────────
  function mount() {
    const host = document.querySelector('.k-drawer-lang .k-lang-switch') || document.querySelector('.pl-lang');
    if (!host) return;
    toggle = document.createElement('button');
    toggle.type = 'button'; toggle.className = 'tf-toggle'; toggle.textContent = L.toggle;
    toggle.setAttribute('aria-pressed', 'false');
    toggle.addEventListener('click', () => {
      if (!on) { const x = document.getElementById('k-drawer-close'); if (x && x.offsetParent) x.click(); }
      setOn(!on);
    });
    host.after(toggle);
    const sync = () => {
      toggle.hidden = !isBn();
      if (!isBn() && on) setOn(false);
      if (isBn()) refresh();
    };
    new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    sync();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { patch(); mount(); });
  else mount();
})();
