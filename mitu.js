/* Mitu the reporter and Bhulu, her desi dog: Parishkar's guide, drawn ligne claire (our own
   characters, in the spirit of Hergé; never Tintin or Snowy). She appears only where a page has
   nothing to show yet, and says in a speech balloon what to do next. One guide per page.
   MITU.guide(html) returns the markup; the caller escapes anything it puts in html. */
(function(){
  const SVG = `<svg viewBox="0 0 140 120" role="img" aria-label="Mitu the reporter, notebook in hand, with Bhulu the dog"><g stroke="#1a1410" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">
    <rect x="1" y="1" width="138" height="118" rx="4" fill="#f3ead6"/><path d="M8 112H132" fill="none"/>
    <path d="M28 112L32 76Q50 64 68 76L72 112Z" fill="#3b6ea8"/><path d="M43 69L50 76L57 69" fill="#fbf7ee"/>
    <circle cx="50" cy="46" r="17" fill="#f2c9a0"/>
    <circle cx="63" cy="28" r="6" fill="#2b1d14"/><path d="M33 45Q33 27 50 27Q67 27 67 45Q62 36 54 37Q50 33 46 37Q38 36 33 45Z" fill="#2b1d14"/>
    <circle cx="44" cy="48" r="1.4" fill="#1a1410"/><circle cx="56" cy="48" r="1.4" fill="#1a1410"/><path d="M46 55Q50 58 54 55" fill="none"/>
    <g transform="rotate(-8 66 92)"><rect x="57" y="81" width="18" height="23" rx="1" fill="#fbf7ee"/><path d="M61 87h10M61 91h10M61 95h6" fill="none" stroke-width="1.2"/></g>
    <path d="M37 80Q44 96 58 94" fill="none"/><path d="M76 76L84 66" fill="none" stroke-width="2.5"/><path d="M66 78Q74 82 78 74" fill="none"/>
    <path d="M118 110Q132 102 128 90" fill="none"/>
    <path d="M94 112Q92 92 103 88Q117 86 120 112Z" fill="#d9a86a"/><path d="M100 112Q100 98 106 94Q112 98 112 112Z" fill="#fbf7ee"/>
    <path d="M101 74L98 63L107 70Z" fill="#d9a86a"/><path d="M110 70L116 61L117 73Z" fill="#d9a86a"/>
    <ellipse cx="108" cy="80" rx="10" ry="9" fill="#d9a86a"/><path d="M114 79Q123 79 123 84Q119 88 112 86" fill="#fbf7ee"/>
    <circle cx="122.5" cy="81.5" r="1.6" fill="#1a1410"/><circle cx="108" cy="78" r="1.3" fill="#1a1410"/>
  </g></svg>`;
  const CSS = `.mitu-guide{display:grid;grid-template-columns:150px 1fr;gap:1rem;align-items:end;max-width:660px;}
.mitu-guide svg{width:150px;height:auto;display:block;}
.mitu-balloon{position:relative;margin:0 0 3.2rem;padding:.7rem 1rem;background:#f3ead6;color:#1a1410;border:2px solid #1a1410;border-radius:18px;font-family:var(--serif,Georgia,serif);font-style:normal;font-size:1.05rem;line-height:1.45;}
.mitu-balloon::after{content:'';position:absolute;left:-12px;bottom:14px;width:16px;height:16px;background:#f3ead6;border-left:2px solid #1a1410;border-bottom:2px solid #1a1410;transform:skewY(-30deg) rotate(45deg) scale(.8);}
.mitu-balloon a{color:#8a4b0f;}
@media(max-width:600px){.mitu-guide{grid-template-columns:96px 1fr;}.mitu-guide svg{width:96px;}}`;
  function style(){
    if (document.getElementById('mitu-css')) return;
    const el = document.createElement('style'); el.id = 'mitu-css'; el.textContent = CSS;
    (document.head || document.documentElement).appendChild(el);
  }
  window.MITU = {
    svg: SVG,
    guide(html){ style(); return `<div class="mitu-guide">${SVG}<p class="mitu-balloon">${html}</p></div>`; }
  };
})();
