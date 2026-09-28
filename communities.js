/* ══════════════════════════════════════════════════════════
   PURULIA — communities.html: volunteer communities
   Reads the approved list (kasa_public_communities) and sends new
   listings to kasa_register_community, where they wait for a
   moderator. The verification name and phone are never public.
   ══════════════════════════════════════════════════════════ */
(function(){
  const cfg = window.KASA_CONFIG || {};
  const API = cfg.SUPABASE_URL + '/rest/v1/';
  const HEAD = { apikey: cfg.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + cfg.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' };
  // The district's 20 CD blocks, as named in kasa_private.areas (OpenStreetMap outlines).
  const BLOCKS = ['Arsha', 'Bagmundi', 'Balarampur', 'Barabazar', 'Bundwan', 'Hura', 'Jaipur', 'Jhalda I', 'Jhalda II', 'Kashipur',
    'Manbazar I', 'Manbazar II', 'Neturia', 'Para', 'Puncha', 'Purulia I', 'Purulia II', 'Raghunathpur I', 'Raghunathpur II', 'Santuri'];
  const WARDS = Array.from({ length: 23 }, (_, i) => i + 1);

  const T = {
    en: {
      nav_home: 'Home', title: 'Volunteer <em>communities</em>',
      sub: 'People already cleaning up and looking after Purulia. Find one near you and join them.',
      loading: 'Loading…', load_err: 'Could not load communities right now.',
      count: '{n} communities', count_1: '1 community', where_all: 'Everywhere', ward: 'Ward {n}', block: '{b} block',
      works_all: 'Works across Purulia district', works_in: 'Works in {p}',
      empty: 'No community listed yet. If you run one, register it so people can find you.',
      empty_here: 'No community listed here yet. If you run one, register it so people nearby can find you.',
      register: 'Register your community', register_sub: 'Get listed so people nearby can find and join you',
      f_name: 'Community name', ph_name: 'e.g. Saheb Bandh Bachao Mancha',
      f_tag: 'What you do', ph_tag: 'e.g. Sunday cleanups around Saheb Bandh',
      f_about: 'About your community', h_about: 'Optional. A few lines on what you do and how people can get involved.',
      ph_about: 'Tell people what your community does',
      f_where: 'Where you work', all_district: 'We work across all of Purulia district',
      ph_area: 'Search a ward or block', h_area: 'Pick the town wards and blocks your community covers.',
      f_links: 'Links', h_links: 'Add at least one so people can reach you.', h_addlinks: 'Tap an icon to add more links.',
      l_whatsapp: 'WhatsApp group or community link', l_instagram: 'Instagram link or @handle', l_facebook: 'Facebook page link',
      l_x: 'X link or @handle', l_website: 'Website', l_linkedin: 'LinkedIn page link', l_youtube: 'YouTube channel link', l_telegram: 'Telegram link or @handle',
      f_logo: 'Logo', h_logo: 'Any image works; it is cropped to a square.', logo_btn: 'Upload a logo', logo_change: 'Change logo', logo_err: 'That image could not be read. Try another.',
      f_verify: 'Verification details', h_verify: 'Not shown publicly. Only so the Parishkar team can verify and contact you about your listing.',
      ph_cname: 'Your name', ph_cphone: 'Phone', adult: 'I am 18 or older and I run this community.',
      review: 'Listings are reviewed before they go live.', cancel: 'Cancel', submit: 'Submit', sending: 'Sending…',
      e_name: 'Give your community’s name.', e_tag: 'Say in one line what you do.', e_where: 'Choose where your community works.',
      e_links: 'Add at least one link so people can reach you.', e_link_bad: 'Check the {k} link: it should be a full address starting with https://',
      e_logo: 'Upload a logo.', e_cname: 'Give your name (kept private).', e_phone: 'Give a 10-digit mobile number (kept private).',
      e_adult: 'Tick the box to confirm you are 18 or older.', e_send: 'Could not send right now. Please try again later.',
      done: 'Thank you. The Parishkar team will check your listing, and it will appear here once approved.',
      f_map: 'Report map', f_privacy: 'Privacy', f_grievance: 'Grievance Officer'
    },
    bn: {
      nav_home: 'হোম', title: 'স্বেচ্ছাসেবী <em>দল</em>',
      sub: 'যাঁরা ইতিমধ্যেই পুরুলিয়া পরিষ্কার রাখছেন ও দেখাশোনা করছেন। আপনার কাছের একটি দল খুঁজে যোগ দিন।',
      loading: 'লোড হচ্ছে…', load_err: 'এখন দলগুলি লোড করা যাচ্ছে না।',
      count: '{n}টি দল', count_1: '১টি দল', where_all: 'সব জায়গা', ward: 'ওয়ার্ড {n}', block: '{b} ব্লক',
      works_all: 'সারা পুরুলিয়া জেলায় কাজ করে', works_in: '{p}-এ কাজ করে',
      empty: 'এখনও কোনো দল তালিকায় নেই। আপনি কোনো দল চালালে নথিভুক্ত করুন, যাতে মানুষ আপনাকে খুঁজে পায়।',
      empty_here: 'এখানে এখনও কোনো দল তালিকায় নেই। আপনি কোনো দল চালালে নথিভুক্ত করুন, যাতে কাছের মানুষ আপনাকে খুঁজে পায়।',
      register: 'আপনার দল নথিভুক্ত করুন', register_sub: 'তালিকায় থাকলে কাছের মানুষ আপনাকে খুঁজে যোগ দিতে পারবেন',
      f_name: 'দলের নাম', ph_name: 'যেমন সাহেব বাঁধ বাঁচাও মঞ্চ',
      f_tag: 'আপনারা কী করেন', ph_tag: 'যেমন প্রতি রবিবার সাহেব বাঁধের চারপাশ পরিষ্কার',
      f_about: 'আপনার দল সম্পর্কে', h_about: 'ঐচ্ছিক। আপনারা কী করেন আর মানুষ কীভাবে যুক্ত হতে পারেন, কয়েক লাইনে লিখুন।',
      ph_about: 'আপনার দল কী করে, মানুষকে জানান',
      f_where: 'কোথায় কাজ করেন', all_district: 'আমরা সারা পুরুলিয়া জেলায় কাজ করি',
      ph_area: 'ওয়ার্ড বা ব্লক খুঁজুন', h_area: 'আপনার দল শহরের যে ওয়ার্ড ও ব্লকগুলিতে কাজ করে, বেছে নিন।',
      f_links: 'লিঙ্ক', h_links: 'অন্তত একটি দিন, যাতে মানুষ আপনার সঙ্গে যোগাযোগ করতে পারে।', h_addlinks: 'আরও লিঙ্ক যোগ করতে আইকনে চাপুন।',
      l_whatsapp: 'হোয়াটসঅ্যাপ গ্রুপ বা কমিউনিটির লিঙ্ক', l_instagram: 'ইনস্টাগ্রাম লিঙ্ক বা @হ্যান্ডেল', l_facebook: 'ফেসবুক পেজের লিঙ্ক',
      l_x: 'X লিঙ্ক বা @হ্যান্ডেল', l_website: 'ওয়েবসাইট', l_linkedin: 'লিংকডইন পেজের লিঙ্ক', l_youtube: 'ইউটিউব চ্যানেলের লিঙ্ক', l_telegram: 'টেলিগ্রাম লিঙ্ক বা @হ্যান্ডেল',
      f_logo: 'লোগো', h_logo: 'যেকোনো ছবি চলবে; বর্গাকারে কেটে নেওয়া হবে।', logo_btn: 'লোগো আপলোড করুন', logo_change: 'লোগো বদলান', logo_err: 'এই ছবিটি পড়া গেল না। অন্য একটি দিন।',
      f_verify: 'যাচাইয়ের তথ্য', h_verify: 'সর্বজনীনভাবে দেখানো হবে না। শুধু পরিষ্কার টিম যাচাই করতে ও আপনার তালিকা নিয়ে যোগাযোগ করতে ব্যবহার করবে।',
      ph_cname: 'আপনার নাম', ph_cphone: 'ফোন', adult: 'আমার বয়স ১৮ বা তার বেশি এবং আমি এই দলটি চালাই।',
      review: 'তালিকা প্রকাশের আগে যাচাই করা হয়।', cancel: 'বাতিল', submit: 'জমা দিন', sending: 'পাঠানো হচ্ছে…',
      e_name: 'দলের নাম দিন।', e_tag: 'এক লাইনে লিখুন আপনারা কী করেন।', e_where: 'আপনার দল কোথায় কাজ করে, বেছে নিন।',
      e_links: 'অন্তত একটি লিঙ্ক দিন, যাতে মানুষ যোগাযোগ করতে পারে।', e_link_bad: '{k} লিঙ্কটি দেখুন: https:// দিয়ে শুরু পুরো ঠিকানা দিন',
      e_logo: 'একটি লোগো আপলোড করুন।', e_cname: 'আপনার নাম দিন (গোপন থাকবে)।', e_phone: '১০ সংখ্যার মোবাইল নম্বর দিন (গোপন থাকবে)।',
      e_adult: 'আপনার বয়স ১৮ বা তার বেশি, তা নিশ্চিত করতে বাক্সে টিক দিন।', e_send: 'এখন পাঠানো গেল না। পরে আবার চেষ্টা করুন।',
      done: 'ধন্যবাদ। পরিষ্কার টিম আপনার তালিকা যাচাই করবে, অনুমোদনের পর এখানে দেখা যাবে।',
      f_map: 'রিপোর্ট ম্যাপ', f_privacy: 'গোপনীয়তা', f_grievance: 'অভিযোগ আধিকারিক'
    },
    hi: {
      nav_home: 'होम', title: 'स्वयंसेवी <em>समूह</em>',
      sub: 'जो लोग पहले से पुरुलिया को साफ़ रख रहे हैं और उसकी देखभाल कर रहे हैं। अपने पास का समूह खोजें और जुड़ें।',
      loading: 'लोड हो रहा है…', load_err: 'अभी समूह लोड नहीं हो पा रहे।',
      count: '{n} समूह', count_1: '1 समूह', where_all: 'हर जगह', ward: 'वार्ड {n}', block: '{b} ब्लॉक',
      works_all: 'पूरे पुरुलिया ज़िले में काम करता है', works_in: '{p} में काम करता है',
      empty: 'अभी कोई समूह सूची में नहीं है। अगर आप कोई समूह चलाते हैं, तो उसे दर्ज करें ताकि लोग आपको खोज सकें।',
      empty_here: 'यहाँ अभी कोई समूह सूची में नहीं है। अगर आप कोई समूह चलाते हैं, तो उसे दर्ज करें ताकि पास के लोग आपको खोज सकें।',
      register: 'अपना समूह दर्ज करें', register_sub: 'सूची में आने से पास के लोग आपको खोजकर जुड़ सकेंगे',
      f_name: 'समूह का नाम', ph_name: 'जैसे साहेब बांध बचाओ मंच',
      f_tag: 'आप क्या करते हैं', ph_tag: 'जैसे हर रविवार साहेब बांध के आसपास सफ़ाई',
      f_about: 'आपके समूह के बारे में', h_about: 'वैकल्पिक। कुछ पंक्तियों में बताएँ कि आप क्या करते हैं और लोग कैसे जुड़ सकते हैं।',
      ph_about: 'लोगों को बताएँ कि आपका समूह क्या करता है',
      f_where: 'आप कहाँ काम करते हैं', all_district: 'हम पूरे पुरुलिया ज़िले में काम करते हैं',
      ph_area: 'वार्ड या ब्लॉक खोजें', h_area: 'शहर के वे वार्ड और ब्लॉक चुनें जहाँ आपका समूह काम करता है।',
      f_links: 'लिंक', h_links: 'कम से कम एक दें ताकि लोग आपसे संपर्क कर सकें।', h_addlinks: 'और लिंक जोड़ने के लिए आइकन दबाएँ।',
      l_whatsapp: 'व्हाट्सऐप ग्रुप या कम्युनिटी लिंक', l_instagram: 'इंस्टाग्राम लिंक या @हैंडल', l_facebook: 'फ़ेसबुक पेज लिंक',
      l_x: 'X लिंक या @हैंडल', l_website: 'वेबसाइट', l_linkedin: 'लिंक्डइन पेज लिंक', l_youtube: 'यूट्यूब चैनल लिंक', l_telegram: 'टेलीग्राम लिंक या @हैंडल',
      f_logo: 'लोगो', h_logo: 'कोई भी तस्वीर चलेगी; उसे चौकोर काटा जाएगा।', logo_btn: 'लोगो अपलोड करें', logo_change: 'लोगो बदलें', logo_err: 'यह तस्वीर पढ़ी नहीं जा सकी। कोई दूसरी दें।',
      f_verify: 'सत्यापन विवरण', h_verify: 'सार्वजनिक नहीं दिखेगा। सिर्फ़ परिष्कार टीम जाँचने और आपकी सूची के बारे में संपर्क करने के लिए इस्तेमाल करेगी।',
      ph_cname: 'आपका नाम', ph_cphone: 'फ़ोन', adult: 'मेरी उम्र 18 या उससे अधिक है और मैं यह समूह चलाता/चलाती हूँ।',
      review: 'सूची प्रकाशित होने से पहले जाँची जाती है।', cancel: 'रद्द करें', submit: 'भेजें', sending: 'भेजा जा रहा है…',
      e_name: 'समूह का नाम दें।', e_tag: 'एक पंक्ति में बताएँ कि आप क्या करते हैं।', e_where: 'चुनें कि आपका समूह कहाँ काम करता है।',
      e_links: 'कम से कम एक लिंक दें ताकि लोग संपर्क कर सकें।', e_link_bad: '{k} लिंक जाँचें: https:// से शुरू होने वाला पूरा पता दें',
      e_logo: 'एक लोगो अपलोड करें।', e_cname: 'अपना नाम दें (गोपनीय रहेगा)।', e_phone: '10 अंकों का मोबाइल नंबर दें (गोपनीय रहेगा)।',
      e_adult: 'पुष्टि करने के लिए बॉक्स पर टिक करें कि आपकी उम्र 18 या उससे अधिक है।', e_send: 'अभी भेजा नहीं जा सका। बाद में फिर कोशिश करें।',
      done: 'धन्यवाद। परिष्कार टीम आपकी सूची जाँचेगी, और मंज़ूरी के बाद यह यहाँ दिखेगी।',
      f_map: 'रिपोर्ट मैप', f_privacy: 'गोपनीयता', f_grievance: 'शिकायत अधिकारी'
    }
  };

  let lang = 'en';
  try { lang = localStorage.getItem('kasa_lang') || 'en'; } catch (e) {}
  if (!T[lang]) lang = 'en';
  const t = (k, vars) => {
    let s = (T[lang] && T[lang][k]) || T.en[k] || k;
    if (vars) for (const [a, b] of Object.entries(vars)) s = s.split('{' + a + '}').join(b);
    return s;
  };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = id => document.getElementById(id);

  const svg = (d, fill) => `<svg viewBox="0 0 24 24" fill="${fill ? 'currentColor' : 'none'}" stroke="${fill ? 'none' : 'currentColor'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  // Networks in the order the form offers them; the first two always show an input.
  const NETS = {
    whatsapp:  { name: 'WhatsApp', color: '#25d366', icon: svg('<path d="M21 11.5a8.4 8.4 0 0 1-12.4 7.4L3 21l2.1-5.5A8.4 8.4 0 1 1 21 11.5z"/>') },
    instagram: { name: 'Instagram', color: '#e1306c', handle: 'https://www.instagram.com/', icon: svg('<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".8" fill="currentColor"/>') },
    facebook:  { name: 'Facebook', color: '#1877f2', icon: svg('<circle cx="12" cy="12" r="9"/><path d="M15 8h-1.5A2.5 2.5 0 0 0 11 10.5V21M9 13h5"/>') },
    x:         { name: 'X', color: 'currentColor', handle: 'https://x.com/', icon: svg('<path d="M4 4l16 16M20 4L4 20"/>') },
    website:   { name: 'Website', color: 'currentColor', icon: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>') },
    linkedin:  { name: 'LinkedIn', color: '#0a66c2', icon: svg('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 10v7M8 7v.01M12 17v-4a2 2 0 0 1 4 0v4M12 10v7"/>') },
    youtube:   { name: 'YouTube', color: '#ff0033', icon: svg('<rect x="2" y="5" width="20" height="14" rx="4"/><path d="M10 9l5 3-5 3z"/>') },
    telegram:  { name: 'Telegram', color: '#229ed9', handle: 'https://t.me/', icon: svg('<path d="M22 3L2 11l7 2 2 7 4-5 5 4z"/><path d="M9 13l13-10"/>') }
  };
  const ALWAYS = ['whatsapp', 'instagram'];

  const state = { list: [], loaded: false, failed: false, where: '', all: false, areas: [], shown: new Set(ALWAYS), logo: null };
  const areaKey = a => a.ward ? 'w' + a.ward : 'b:' + a.block;
  const areaLabel = a => a.ward ? t('ward', { n: a.ward }) : t('block', { b: a.block });

  const params = new URLSearchParams(location.search);
  const wardParam = Number(params.get('ward'));
  if (wardParam >= 1 && wardParam <= 23) state.where = 'w' + wardParam;
  if (BLOCKS.includes(params.get('block'))) state.where = 'b:' + params.get('block');

  // What a link chip reads: the handle for profile links, the host for a website.
  function chipText(k, url){
    let u;
    try { u = new URL(url); } catch (e) { return NETS[k].name; }
    const seg = u.pathname.split('/').filter(Boolean)[0];
    if (k === 'website') return u.hostname.replace(/^www\./, '');
    if (['instagram', 'x', 'telegram', 'facebook', 'youtube'].includes(k) && seg && !/^(groups|pages|channel|c|profile\.php|share)$/i.test(seg)) return decodeURIComponent(seg).replace(/^@/, '');
    return NETS[k].name;
  }

  function placesOf(g){
    if (g.all_district) return t('works_all');
    const p = [...(g.wards || []).map(n => t('ward', { n })), ...(g.blocks || []).map(b => t('block', { b }))];
    return t('works_in', { p: p.join(', ') });
  }

  function renderList(){
    const w = state.where;
    const list = !w ? state.list : state.list.filter(g => g.all_district
      || (w[0] === 'w' ? (g.wards || []).includes(Number(w.slice(1))) : (g.blocks || []).includes(w.slice(2))));
    if (state.failed){ $('cm-count').textContent = t('load_err'); $('cm-list').innerHTML = ''; return; }
    if (!state.loaded) return;
    $('cm-count').textContent = list.length === 1 ? t('count_1') : t('count', { n: list.length });
    $('cm-list').innerHTML = list.length ? list.map(g => {
      const links = Object.keys(NETS).filter(k => g.links && typeof g.links[k] === 'string' && /^https:\/\//i.test(g.links[k]));
      const logo = /^data:image\/(jpeg|png|webp);base64,/.test(g.logo || '') ? g.logo : '';
      return `<article class="cm-card" id="c-${esc(g.id)}">
        <div class="cm-head">
          ${logo ? `<img class="cm-logo" src="${esc(logo)}" alt="" loading="lazy" width="64" height="64">` : '<span class="cm-logo"></span>'}
          <div style="min-width:0;"><h2 class="cm-name">${esc(g.name)}</h2><div class="cm-where">📍 ${esc(placesOf(g))}</div></div>
        </div>
        ${g.tagline ? `<p class="cm-tag">${esc(g.tagline)}</p>` : ''}
        ${g.description ? `<p class="cm-about">${esc(g.description)}</p>` : ''}
        ${links.length ? `<div class="cm-links">${links.map(k => `<a class="cm-chip" href="${esc(g.links[k])}" target="_blank" rel="noopener nofollow ugc">
          <span class="cm-ico" style="color:${NETS[k].color}">${NETS[k].icon}</span><span>${esc(chipText(k, g.links[k]))}</span></a>`).join('')}</div>` : ''}
      </article>`;
    }).join('') : `<div class="cm-empty">${esc(t(w ? 'empty_here' : 'empty'))}</div>`;
  }

  function renderWhere(){
    const sel = $('cm-where');
    sel.innerHTML = `<option value="">${esc(t('where_all'))}</option>`
      + WARDS.map(n => `<option value="w${n}">${esc(t('ward', { n }))}</option>`).join('')
      + BLOCKS.map(b => `<option value="b:${esc(b)}">${esc(t('block', { b }))}</option>`).join('');
    sel.value = state.where;
  }

  function renderAreas(){
    $('cm-areapick').hidden = state.all;
    const q = $('cm-areaq').value.trim().toLowerCase();
    const picked = new Set(state.areas.map(areaKey));
    const all = [...WARDS.map(ward => ({ ward })), ...BLOCKS.map(block => ({ block }))];
    const hits = q ? all.filter(a => !picked.has(areaKey(a)) && (areaLabel(a).toLowerCase().includes(q) || String(a.ward || a.block).toLowerCase().startsWith(q))) : [];
    const box = $('cm-areas');
    box.hidden = !hits.length;
    box.innerHTML = hits.slice(0, 30).map(a => `<button type="button" data-add="${esc(areaKey(a))}">${esc(areaLabel(a))}</button>`).join('');
    $('cm-picked').innerHTML = state.areas.map(a => `<button type="button" data-drop="${esc(areaKey(a))}" aria-label="Remove">${esc(areaLabel(a))} ✕</button>`).join('');
  }

  function renderLinks(){
    const rows = $('cm-linkrows');
    const keep = {};
    rows.querySelectorAll('input[data-net]').forEach(i => { keep[i.dataset.net] = i.value; });
    rows.innerHTML = Object.keys(NETS).filter(k => state.shown.has(k)).map(k =>
      `<div class="cm-linkrow"><input class="cm-input" data-net="${k}" type="url" inputmode="url" maxlength="300" autocomplete="off"
        placeholder="${esc(t('l_' + k))}" aria-label="${esc(NETS[k].name)}" value="${esc(keep[k] || '')}"></div>`).join('');
    $('cm-addlinks').innerHTML = Object.keys(NETS).filter(k => !ALWAYS.includes(k)).map(k =>
      `<button type="button" data-net-add="${k}" aria-label="${esc(NETS[k].name)}" title="${esc(NETS[k].name)}" style="color:${NETS[k].color}"${state.shown.has(k) ? ' hidden' : ''}>${NETS[k].icon}</button>`).join('');
  }

  function applyStatic(){
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-t]').forEach(el => { el.textContent = t(el.dataset.t); });
    document.querySelectorAll('[data-t-html]').forEach(el => { el.innerHTML = t(el.dataset.tHtml); });
    document.querySelectorAll('[data-t-ph]').forEach(el => { el.placeholder = t(el.dataset.tPh); });
    document.querySelectorAll('.cm-lang button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
    if (!state.loaded && !state.failed) $('cm-count').textContent = t('loading');
  }
  function renderAll(){ applyStatic(); renderWhere(); renderList(); renderAreas(); renderLinks(); }

  // "@handle" or a bare handle becomes a profile link; anything else missing a scheme gets https://.
  function normLink(k, v){
    v = v.trim();
    if (!v) return '';
    if (NETS[k].handle && /^@?[A-Za-z0-9_.]{1,60}$/.test(v) && !/\.[a-z]{2,}$/i.test(v)) return NETS[k].handle + v.replace(/^@/, '');
    if (/^http:\/\//i.test(v)) v = v.replace(/^http:/i, 'https:');
    if (!/^https:\/\//i.test(v)) v = 'https://' + v;
    return v;
  }

  // Centre-crop to a 256 px square JPEG so the listing stays small.
  function readLogo(file){
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const s = Math.min(img.naturalWidth, img.naturalHeight);
        if (!s){ URL.revokeObjectURL(url); return reject(new Error()); }
        const c = document.createElement('canvas');
        c.width = c.height = 256;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, 256, 256);
        ctx.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, 256, 256);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error()); };
      img.src = url;
    });
  }

  async function load(){
    try {
      const res = await fetch(API + 'kasa_public_communities?select=id,name,tagline,description,all_district,wards,blocks,links,logo,listed_at&order=listed_at.desc', { headers: HEAD });
      if (!res.ok) throw new Error();
      state.list = await res.json();
      state.loaded = true;
    } catch (e) {
      state.failed = true;
    }
    renderList();
  }

  // ── events ──
  document.querySelectorAll('.cm-lang button').forEach(b => b.addEventListener('click', () => {
    lang = b.dataset.lang;
    try { localStorage.setItem('kasa_lang', lang); } catch (e) {}
    renderAll();
  }));
  $('cm-where').addEventListener('change', e => { state.where = e.target.value; renderList(); });

  const dlg = $('cm-dialog');
  $('cm-open').addEventListener('click', () => {
    if (!state.areas.length && state.where){
      const w = state.where;
      state.areas = [w[0] === 'w' ? { ward: Number(w.slice(1)) } : { block: w.slice(2) }];
      renderAreas();
    }
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
  });
  dlg.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => dlg.close ? dlg.close() : dlg.removeAttribute('open')));

  $('cm-all').addEventListener('change', e => { state.all = e.target.checked; renderAreas(); });
  $('cm-areaq').addEventListener('input', renderAreas);
  $('cm-areas').addEventListener('click', e => {
    const b = e.target.closest('[data-add]');
    if (!b) return;
    const k = b.dataset.add;
    state.areas.push(k[0] === 'w' ? { ward: Number(k.slice(1)) } : { block: k.slice(2) });
    $('cm-areaq').value = '';
    renderAreas();
    $('cm-areaq').focus();
  });
  $('cm-picked').addEventListener('click', e => {
    const b = e.target.closest('[data-drop]');
    if (!b) return;
    state.areas = state.areas.filter(a => areaKey(a) !== b.dataset.drop);
    renderAreas();
  });
  $('cm-addlinks').addEventListener('click', e => {
    const b = e.target.closest('[data-net-add]');
    if (!b) return;
    state.shown.add(b.dataset.netAdd);
    renderLinks();
    const inp = $('cm-linkrows').querySelector(`[data-net="${b.dataset.netAdd}"]`);
    if (inp) inp.focus();
  });
  $('cm-logo').addEventListener('change', async e => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const msg = $('cm-msg');
    try {
      state.logo = await readLogo(f);
      $('cm-logobox').innerHTML = `<img src="${state.logo}" alt="">`;
      msg.textContent = ''; msg.className = 'cm-msg';
    } catch (err) {
      state.logo = null;
      msg.className = 'cm-msg bad'; msg.textContent = t('logo_err');
    }
  });

  $('cm-form').addEventListener('submit', async e => {
    e.preventDefault();
    const msg = $('cm-msg'), btn = $('cm-submit');
    const fail = (k, vars) => { msg.className = 'cm-msg bad'; msg.textContent = t(k, vars); };
    const links = {};
    for (const i of $('cm-linkrows').querySelectorAll('input[data-net]')){
      const v = normLink(i.dataset.net, i.value);
      if (!v) continue;
      try { new URL(v); } catch (err) { return fail('e_link_bad', { k: NETS[i.dataset.net].name }); }
      links[i.dataset.net] = v;
    }
    const phone = $('cm-cphone').value.replace(/\D/g, '').replace(/^(91|0)(?=[6-9]\d{9}$)/, '');
    if (!$('cm-name').value.trim()) return fail('e_name');
    if (!$('cm-tag').value.trim()) return fail('e_tag');
    if (!state.all && !state.areas.length) return fail('e_where');
    if (!Object.keys(links).length) return fail('e_links');
    if (!state.logo) return fail('e_logo');
    if (!$('cm-cname').value.trim()) return fail('e_cname');
    if (!/^[6-9]\d{9}$/.test(phone)) return fail('e_phone');
    if (!$('cm-adult').checked) return fail('e_adult');

    msg.className = 'cm-msg'; msg.textContent = t('sending');
    btn.disabled = true;
    try {
      const res = await fetch(API + 'rpc/kasa_register_community', {
        method: 'POST', headers: HEAD,
        body: JSON.stringify({
          p_name: $('cm-name').value, p_tagline: $('cm-tag').value, p_about: $('cm-about').value || null,
          p_all_district: state.all,
          p_wards: state.all ? [] : state.areas.filter(a => a.ward).map(a => a.ward),
          p_blocks: state.all ? [] : state.areas.filter(a => a.block).map(a => a.block),
          p_links: links, p_logo: state.logo,
          p_contact_name: $('cm-cname').value, p_contact_phone: phone, p_adult: true })
      });
      if (!res.ok){
        let detail = '';
        try { detail = (await res.json()).details || ''; } catch (e2) {}
        throw new Error(detail || t('e_send'));
      }
      e.target.reset();
      Object.assign(state, { all: false, areas: [], shown: new Set(ALWAYS), logo: null });
      $('cm-linkrows').innerHTML = '';
      $('cm-logobox').textContent = '⤒';
      renderAreas(); renderLinks();
      msg.className = 'cm-msg ok'; msg.textContent = t('done');
    } catch (err) {
      msg.className = 'cm-msg bad'; msg.textContent = err.message || t('e_send');
    } finally {
      btn.disabled = false;
    }
  });

  renderAll();
  load();
})();
