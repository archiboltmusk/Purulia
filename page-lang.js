/* Bengali / Hindi for static pages. Elements carrying data-t="key" are translated from
   window.PAGE_I18N = { bn: { key: '…' }, hi: { … } } (a <page>-i18n.js file loaded first).
   English stays in the HTML itself, so a missing key simply shows English.
   A translation writes a link as [[n|text]]: the n-th link of the English element, with new text,
   so URLs are never retyped. The choice is shared with the report app (localStorage kasa_lang). */
(function(){
  const D = window.PAGE_I18N || {};
  const NAMES = { en: 'EN', bn: 'বাং', hi: 'हिं' };
  let lang = 'en';
  try { lang = localStorage.getItem('kasa_lang') || 'en'; } catch (e) {}
  const els = [...document.querySelectorAll('[data-t]')];
  const orig = new Map(els.map(e => [e, e.innerHTML]));

  function render(el, en, t){
    if (!t){ el.innerHTML = en; return; }
    const tmp = document.createElement('div'); tmp.innerHTML = en;
    const links = [...tmp.querySelectorAll('a')];
    el.innerHTML = t.replace(/\[\[(\d+)\|([^\]]*)\]\]/g, (m, i, text) => {
      const a = links[i - 1]; if (!a) return text;
      const c = a.cloneNode(false); c.innerHTML = text; return c.outerHTML;
    });
  }

  function apply(l){
    lang = (l === 'en' || D[l]) ? l : 'en';
    document.documentElement.lang = lang;
    els.forEach(el => render(el, orig.get(el), lang !== 'en' && D[lang] && D[lang][el.dataset.t]));
    document.querySelectorAll('.pl-lang button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
    document.dispatchEvent(new CustomEvent('pagelang', { detail: lang }));
  }

  const box = document.createElement('div');
  box.className = 'pl-lang'; box.setAttribute('role', 'group'); box.setAttribute('aria-label', 'Language');
  box.innerHTML = Object.entries(NAMES).map(([k, v]) => `<button type="button" data-lang="${k}">${v}</button>`).join('');
  box.addEventListener('click', e => {
    const b = e.target.closest('button[data-lang]'); if (!b) return;
    try { localStorage.setItem('kasa_lang', b.dataset.lang); } catch (err) {}
    apply(b.dataset.lang);
  });
  const style = document.createElement('style');
  style.textContent = '.pl-lang{display:inline-flex;gap:2px;margin-right:.8rem;vertical-align:middle}'
    + '.pl-lang button{font:500 11px/1 var(--mono,monospace);padding:.45rem .55rem;background:transparent;color:inherit;border:1px solid rgba(212,136,42,.35);border-radius:3px;cursor:pointer}'
    + '.pl-lang button[aria-pressed="true"]{background:#D4882A;color:#0a0805;border-color:#D4882A}'
    + '.pl-lang-top{display:flex;justify-content:flex-end;margin-bottom:1rem}';
  document.head.appendChild(style);
  const navRight = document.querySelector('.k-nav-right');
  if (navRight) navRight.before(box);
  else { const wrap = document.createElement('div'); wrap.className = 'pl-lang-top'; wrap.appendChild(box); (document.querySelector('main') || document.body).prepend(wrap); }

  window.PAGE_LANG = () => lang;
  window.PAGE_LANG_EN = (k) => { const el = els.find(e => e.dataset.t === k); return el ? orig.get(el) : ''; };
  document.addEventListener('kasa-translations', () => apply(lang));  // approved reader fixes (translate-fix.js)
  apply(lang);
})();
