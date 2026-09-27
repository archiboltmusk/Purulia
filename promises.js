/* ══════════════════════════════════════════════════════════
   PURULIA — promises.html: who promised what, what was delivered
   Reads kasa_promises (published promises + daily news links);
   suggestions go to kasa_promise_suggest and wait for a moderator.
   ══════════════════════════════════════════════════════════ */
(() => {
  const CFG = window.KASA_CONFIG || {};
  const URL_ = CFG.SUPABASE_URL, KEY = CFG.SUPABASE_ANON_KEY;

  const T = {
    en: {
      nav_home: 'Home', nav_money: 'Who runs the municipality',
      title: 'Who promised <em>what</em>, and what was delivered',
      sub: 'Promises made to Purulia by its MP, MLAs, the municipality and the state government. Every promise links to where and when it was said. A promise is only marked in progress, delivered or broken with a link that shows it. News links are added automatically every morning.',
      tile_all: 'Promises', st_promised: 'Nothing shown yet', st_in_progress: 'In progress', st_delivered: 'Delivered', st_broken: 'Broken',
      list_h: 'Promises', all_people: 'Everyone', search_ph: 'Search promises', all_status: 'All', loading: 'Loading…',
      news_h: 'Latest news',
      news_sub: "Headlines about Purulia and the people above, collected automatically every morning from Google News. They link to the original reports. They are not checked by us and never change a promise's status on their own.",
      news_checked: 'Last checked {d}.', news_none: 'No headlines yet. The first daily check will add them.',
      none: 'No promises match.', none_yet: 'No promises published yet. Add one below.', load_err: 'Could not load the promises. Check your connection and reload.',
      said_on: 'Said on {d}', source: 'source', due: 'promised by {d}', overdue: 'past its date', status_on: '{s} on {d}', evidence: 'evidence',
      in_news: 'In the news', suggest_update: 'Suggest an update',
      form_h: 'Add a promise, or an update',
      form_sub: 'Heard a promise in a speech, a newspaper or an official post? Add it with a link to where it was said. Seen a promise delivered, started or dropped? Use "Suggest an update" on that promise and add a link that shows it. A moderator checks every link before anything appears here.',
      upd_for: 'Update for: {p}', upd_cancel: 'Add a new promise instead',
      f_who: 'Who made the promise', f_who_ph: 'Name', f_role: 'Their position', f_role_ph: 'e.g. MLA, Purulia', f_promise: 'What was promised',
      f_made_on: 'Date it was said', f_due_by: 'Promised by (if a date was given)', f_source: 'Link to where it was said', f_source_name: 'Newspaper or channel (optional)',
      f_status: 'What has happened since', f_status_date: 'Date of that news', f_status_url: 'Link that shows it (needed unless "Nothing shown yet")',
      f_status_note: 'What the link shows (optional)', f_note: 'Note for the moderator (optional)', f_submit: 'Send for checking', f_sending: 'Sending…',
      f_thanks: 'Thank you. A moderator will check the link before it appears here.',
      e_who: 'Add who made the promise.', e_promise: 'Describe the promise (at least 10 letters).', e_date: 'Add the date it was said.',
      e_url: 'Add a link starting with http:// or https://.', e_evidence: 'Add a link and a date that show the progress, delivery or failure.', e_update: 'Pick what has happened, and add a link and a date that show it.',
      rules_h: 'How this page stays fair',
      rule_1: 'Every promise links to where it was said, with the date. No link, no entry.',
      rule_2: '"In progress", "delivered" and "broken" each need their own link and date. Without one, a promise stays at "nothing shown yet".',
      rule_3: 'A volunteer moderator checks each link before it is published. News headlines are collected by a free daily job and are only links, never a verdict.',
      rule_4: 'Anyone named here can reply or correct an entry through the <a href="grievance.html">Grievance Officer</a>. For who controls the municipality and its money, see <a href="municipality.html">Who runs the municipality</a>.'
    },
    bn: {
      nav_home: 'হোম', nav_money: 'পুরসভা কে চালায়',
      title: 'কে <em>কী</em> প্রতিশ্রুতি দিয়েছিলেন, কী হয়েছে',
      sub: 'পুরুলিয়ার সাংসদ, বিধায়ক, পুরসভা ও রাজ্য সরকারের দেওয়া প্রতিশ্রুতি। প্রতিটি প্রতিশ্রুতির সঙ্গে কোথায় ও কবে বলা হয়েছিল তার লিঙ্ক আছে। প্রমাণের লিঙ্ক ছাড়া কোনও প্রতিশ্রুতিকে "কাজ চলছে", "পূরণ হয়েছে" বা "ভাঙা" বলা হয় না। খবরের লিঙ্ক প্রতিদিন সকালে নিজে থেকেই যোগ হয়।',
      tile_all: 'প্রতিশ্রুতি', st_promised: 'এখনও কিছু দেখা যায়নি', st_in_progress: 'কাজ চলছে', st_delivered: 'পূরণ হয়েছে', st_broken: 'ভাঙা',
      list_h: 'প্রতিশ্রুতি', all_people: 'সবাই', search_ph: 'প্রতিশ্রুতি খুঁজুন', all_status: 'সব', loading: 'লোড হচ্ছে…',
      news_h: 'সাম্প্রতিক খবর',
      news_sub: 'পুরুলিয়া ও ওপরের মানুষদের নিয়ে খবরের শিরোনাম, প্রতিদিন সকালে Google News থেকে নিজে থেকে সংগ্রহ করা। লিঙ্কগুলি মূল খবরে নিয়ে যায়। আমরা এগুলি যাচাই করি না, আর এগুলি নিজে থেকে কোনও প্রতিশ্রুতির অবস্থা বদলায় না।',
      news_checked: 'শেষ দেখা হয়েছে {d}।', news_none: 'এখনও কোনও শিরোনাম নেই। প্রথম দৈনিক খোঁজে যোগ হবে।',
      none: 'কোনও প্রতিশ্রুতি মেলেনি।', none_yet: 'এখনও কোনও প্রতিশ্রুতি প্রকাশ হয়নি। নিচে যোগ করুন।', load_err: 'প্রতিশ্রুতি লোড করা গেল না। সংযোগ দেখে আবার লোড করুন।',
      said_on: 'বলা হয়েছিল {d}', source: 'সূত্র', due: '{d}-এর মধ্যে', overdue: 'সময় পেরিয়ে গেছে', status_on: '{s}, {d}', evidence: 'প্রমাণ',
      in_news: 'খবরে', suggest_update: 'আপডেট জানান',
      form_h: 'প্রতিশ্রুতি বা আপডেট যোগ করুন',
      form_sub: 'ভাষণে, খবরের কাগজে বা সরকারি পোস্টে কোনও প্রতিশ্রুতি শুনেছেন? যেখানে বলা হয়েছিল তার লিঙ্ক দিয়ে যোগ করুন। কোনও প্রতিশ্রুতি পূরণ হতে, শুরু হতে বা বাদ পড়তে দেখেছেন? সেই প্রতিশ্রুতিতে "আপডেট জানান" চাপুন আর প্রমাণের লিঙ্ক দিন। কিছু প্রকাশের আগে একজন মডারেটর প্রতিটি লিঙ্ক দেখে নেন।',
      upd_for: 'আপডেট: {p}', upd_cancel: 'বদলে নতুন প্রতিশ্রুতি যোগ করুন',
      f_who: 'কে প্রতিশ্রুতি দিয়েছিলেন', f_who_ph: 'নাম', f_role: 'তাঁর পদ', f_role_ph: 'যেমন বিধায়ক, পুরুলিয়া', f_promise: 'কী প্রতিশ্রুতি দেওয়া হয়েছিল',
      f_made_on: 'কবে বলা হয়েছিল', f_due_by: 'কবের মধ্যে (তারিখ বলা থাকলে)', f_source: 'যেখানে বলা হয়েছিল তার লিঙ্ক', f_source_name: 'খবরের কাগজ বা চ্যানেল (ঐচ্ছিক)',
      f_status: 'তারপর কী হয়েছে', f_status_date: 'সেই খবরের তারিখ', f_status_url: 'প্রমাণের লিঙ্ক ("এখনও কিছু দেখা যায়নি" ছাড়া দরকার)',
      f_status_note: 'লিঙ্কে কী দেখা যাচ্ছে (ঐচ্ছিক)', f_note: 'মডারেটরের জন্য নোট (ঐচ্ছিক)', f_submit: 'যাচাইয়ের জন্য পাঠান', f_sending: 'পাঠানো হচ্ছে…',
      f_thanks: 'ধন্যবাদ। এখানে দেখানোর আগে একজন মডারেটর লিঙ্কটি দেখে নেবেন।',
      e_who: 'কে প্রতিশ্রুতি দিয়েছিলেন লিখুন।', e_promise: 'প্রতিশ্রুতিটি লিখুন (অন্তত ১০ অক্ষর)।', e_date: 'কবে বলা হয়েছিল তারিখ দিন।',
      e_url: 'http:// বা https:// দিয়ে শুরু লিঙ্ক দিন।', e_evidence: 'অগ্রগতি, পূরণ বা ব্যর্থতার প্রমাণের লিঙ্ক ও তারিখ দিন।', e_update: 'কী হয়েছে বেছে নিন, আর প্রমাণের লিঙ্ক ও তারিখ দিন।',
      rules_h: 'এই পাতা কীভাবে নিরপেক্ষ থাকে',
      rule_1: 'প্রতিটি প্রতিশ্রুতির সঙ্গে কোথায় ও কবে বলা হয়েছিল তার লিঙ্ক থাকে। লিঙ্ক নেই, তো যোগ হবে না।',
      rule_2: '"কাজ চলছে", "পূরণ হয়েছে" আর "ভাঙা" — প্রতিটির জন্য আলাদা লিঙ্ক ও তারিখ লাগে। না থাকলে প্রতিশ্রুতি "এখনও কিছু দেখা যায়নি" থাকে।',
      rule_3: 'প্রকাশের আগে একজন স্বেচ্ছাসেবী মডারেটর প্রতিটি লিঙ্ক দেখেন। খবরের শিরোনাম একটি বিনামূল্যের দৈনিক কাজে সংগ্রহ হয়; সেগুলি শুধু লিঙ্ক, রায় নয়।',
      rule_4: 'এখানে যাঁর নাম আছে তিনি <a href="grievance.html">অভিযোগ আধিকারিক</a>-এর মাধ্যমে উত্তর বা সংশোধন দিতে পারেন। পুরসভা কে চালায় ও টাকা কোথায় যায় জানতে দেখুন <a href="municipality.html">পুরসভা কে চালায়</a>।'
    },
    hi: {
      nav_home: 'होम', nav_money: 'नगरपालिका कौन चलाता है',
      title: 'किसने <em>क्या</em> वादा किया, और क्या पूरा हुआ',
      sub: 'पुरुलिया के सांसद, विधायकों, नगरपालिका और राज्य सरकार के वादे। हर वादे के साथ लिंक है कि वह कहाँ और कब कहा गया। सबूत के लिंक के बिना किसी वादे को "काम जारी", "पूरा" या "टूटा" नहीं कहा जाता। ख़बरों के लिंक हर सुबह अपने-आप जुड़ते हैं।',
      tile_all: 'वादे', st_promised: 'अभी कुछ नहीं दिखा', st_in_progress: 'काम जारी', st_delivered: 'पूरा हुआ', st_broken: 'टूटा',
      list_h: 'वादे', all_people: 'सभी', search_ph: 'वादे खोजें', all_status: 'सभी', loading: 'लोड हो रहा है…',
      news_h: 'ताज़ा ख़बरें',
      news_sub: 'पुरुलिया और ऊपर के लोगों से जुड़ी सुर्ख़ियाँ, हर सुबह Google News से अपने-आप जुटाई गईं। लिंक मूल ख़बर पर ले जाते हैं। हम इन्हें नहीं जाँचते, और ये अपने-आप किसी वादे की स्थिति नहीं बदलतीं।',
      news_checked: 'आख़िरी बार देखा गया {d}।', news_none: 'अभी कोई सुर्ख़ी नहीं। पहली रोज़ की जाँच में जुड़ेंगी।',
      none: 'कोई वादा नहीं मिला।', none_yet: 'अभी कोई वादा प्रकाशित नहीं हुआ। नीचे जोड़ें।', load_err: 'वादे लोड नहीं हो सके। कनेक्शन देखकर फिर लोड करें।',
      said_on: 'कहा गया {d}', source: 'स्रोत', due: '{d} तक', overdue: 'समय निकल गया', status_on: '{s}, {d}', evidence: 'सबूत',
      in_news: 'ख़बरों में', suggest_update: 'अपडेट बताएँ',
      form_h: 'वादा या अपडेट जोड़ें',
      form_sub: 'किसी भाषण, अख़बार या सरकारी पोस्ट में वादा सुना? जहाँ कहा गया उसका लिंक देकर जोड़ें। कोई वादा पूरा होते, शुरू होते या छूटते देखा? उस वादे पर "अपडेट बताएँ" दबाएँ और सबूत का लिंक दें। कुछ भी दिखने से पहले एक मॉडरेटर हर लिंक जाँचता है।',
      upd_for: 'अपडेट: {p}', upd_cancel: 'इसके बजाय नया वादा जोड़ें',
      f_who: 'वादा किसने किया', f_who_ph: 'नाम', f_role: 'उनका पद', f_role_ph: 'जैसे विधायक, पुरुलिया', f_promise: 'क्या वादा किया गया',
      f_made_on: 'कब कहा गया', f_due_by: 'कब तक (अगर तारीख़ बताई गई)', f_source: 'जहाँ कहा गया उसका लिंक', f_source_name: 'अख़बार या चैनल (वैकल्पिक)',
      f_status: 'उसके बाद क्या हुआ', f_status_date: 'उस ख़बर की तारीख़', f_status_url: 'सबूत का लिंक ("अभी कुछ नहीं दिखा" के सिवा ज़रूरी)',
      f_status_note: 'लिंक में क्या दिखता है (वैकल्पिक)', f_note: 'मॉडरेटर के लिए नोट (वैकल्पिक)', f_submit: 'जाँच के लिए भेजें', f_sending: 'भेजा जा रहा है…',
      f_thanks: 'धन्यवाद। यहाँ दिखने से पहले एक मॉडरेटर लिंक जाँचेगा।',
      e_who: 'वादा किसने किया, लिखें।', e_promise: 'वादा लिखें (कम से कम 10 अक्षर)।', e_date: 'कब कहा गया, तारीख़ दें।',
      e_url: 'http:// या https:// से शुरू होने वाला लिंक दें।', e_evidence: 'प्रगति, पूरा होने या नाकामी का लिंक और तारीख़ दें।', e_update: 'क्या हुआ चुनें, और सबूत का लिंक और तारीख़ दें।',
      rules_h: 'यह पेज निष्पक्ष कैसे रहता है',
      rule_1: 'हर वादे के साथ लिंक और तारीख़ है कि वह कहाँ कहा गया। लिंक नहीं, तो एंट्री नहीं।',
      rule_2: '"काम जारी", "पूरा हुआ" और "टूटा" — हर एक के लिए अलग लिंक और तारीख़ चाहिए। वरना वादा "अभी कुछ नहीं दिखा" पर रहता है।',
      rule_3: 'प्रकाशित होने से पहले एक स्वयंसेवी मॉडरेटर हर लिंक जाँचता है। ख़बरों की सुर्ख़ियाँ एक मुफ़्त रोज़ाना काम से जुटती हैं; वे सिर्फ़ लिंक हैं, फ़ैसला नहीं।',
      rule_4: 'जिनका नाम यहाँ है वे <a href="grievance.html">शिकायत अधिकारी</a> के ज़रिए जवाब या सुधार भेज सकते हैं। नगरपालिका कौन चलाता है और पैसा कहाँ जाता है, देखें <a href="municipality.html">नगरपालिका कौन चलाता है</a>।'
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
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = (u) => /^https?:\/\//i.test(u || '') ? u : '#';
  const locale = () => ({ bn: 'bn-IN', hi: 'hi-IN' }[lang] || 'en-IN');
  const fmtDate = (d) => {
    if (!d) return '';
    const x = new Date(d.length === 10 ? d + 'T00:00:00' : d);
    return isNaN(+x) ? '' : x.toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const state = { promises: [], news: [], checked: null, who: '', status: '', q: '', updateOf: null, loaded: false, failed: false };

  function applyStatic(){
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-t]').forEach(el => { el.textContent = t(el.dataset.t); });
    document.querySelectorAll('[data-t-html]').forEach(el => { el.innerHTML = t(el.dataset.tHtml); });
    document.querySelectorAll('[data-t-ph]').forEach(el => { el.placeholder = t(el.dataset.tPh); });
    document.querySelectorAll('.pr-lang button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
  }

  async function rpc(name, body){
    const res = await fetch(`${URL_}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error((data && (data.details || data.message)) || `HTTP ${res.status}`);
    return data;
  }

  function newsFor(who){
    const w = who.toLowerCase();
    return state.news.filter(n => (n.who && n.who === who) || (n.title || '').toLowerCase().includes(w)).slice(0, 3);
  }

  function renderTiles(){
    const c = { promised: 0, in_progress: 0, delivered: 0, broken: 0 };
    state.promises.forEach(p => { c[p.status] = (c[p.status] || 0) + 1; });
    document.getElementById('pr-n-all').textContent = state.promises.length;
    for (const k of Object.keys(c)) document.getElementById('pr-n-' + k).textContent = c[k];
  }

  function renderWho(){
    const sel = document.getElementById('pr-who');
    const people = [...new Set(state.promises.map(p => p.who))].sort((a, b) => a.localeCompare(b));
    sel.innerHTML = `<option value="">${esc(t('all_people'))}</option>` +
      people.map(p => `<option value="${esc(p)}"${p === state.who ? ' selected' : ''}>${esc(p)}</option>`).join('');
  }

  function renderList(){
    const el = document.getElementById('pr-list');
    if (state.failed){ el.innerHTML = `<li class="an-empty">${esc(t('load_err'))}</li>`; return; }
    if (!state.loaded) return;
    if (!state.promises.length){ el.innerHTML = `<li class="an-empty">${esc(t('none_yet'))}</li>`; return; }
    const q = state.q.toLowerCase();
    const rows = state.promises.filter(p => (!state.who || p.who === state.who) && (!state.status || p.status === state.status) &&
      (!q || [p.who, p.role, p.promise, p.area].join(' ').toLowerCase().includes(q)));
    if (!rows.length){ el.innerHTML = `<li class="an-empty">${esc(t('none'))}</li>`; return; }
    const today = new Date().toISOString().slice(0, 10);
    el.innerHTML = rows.map(p => {
      const news = newsFor(p.who);
      const late = p.due_by && p.due_by < today && p.status !== 'delivered';
      return `<li class="pr-item" id="p-${esc(p.id)}">
        <span class="pr-status pr-s-${esc(p.status)}">${esc(t('st_' + p.status))}</span>
        <div class="pr-who">${esc(p.who)}</div>
        ${p.role || p.area ? `<div class="pr-role">${esc([p.role, p.area].filter(Boolean).join(' · '))}</div>` : ''}
        <div class="pr-text">${esc(p.promise)}</div>
        <div class="pr-meta">
          ${esc(t('said_on', { d: fmtDate(p.made_on) }))} · <a href="${esc(safeUrl(p.source_url))}" target="_blank" rel="noopener nofollow">${esc(p.source_name || t('source'))} ↗</a>
          ${p.due_by ? ` · ${esc(t('due', { d: fmtDate(p.due_by) }))}${late ? ` (${esc(t('overdue'))})` : ''}` : ''}
          ${p.status !== 'promised' && p.status_source_url ? `<br>${esc(t('status_on', { s: t('st_' + p.status), d: fmtDate(p.status_date) }))} · <a href="${esc(safeUrl(p.status_source_url))}" target="_blank" rel="noopener nofollow">${esc(t('evidence'))} ↗</a>${p.status_note ? ` · ${esc(p.status_note)}` : ''}` : ''}
        </div>
        ${news.length ? `<div class="pr-news"><span class="pr-meta">${esc(t('in_news'))}</span>${news.map(n =>
          `<a href="${esc(safeUrl(n.url))}" target="_blank" rel="noopener nofollow">${esc(n.title)}${n.source ? ` — ${esc(n.source)}` : ''}</a>`).join('')}</div>` : ''}
        <button type="button" class="pr-upd" data-upd="${esc(p.id)}">${esc(t('suggest_update'))}</button>
      </li>`;
    }).join('');
  }

  function renderNews(){
    const el = document.getElementById('pr-feed');
    document.getElementById('pr-news-checked').textContent = state.checked ? t('news_checked', { d: fmtDate(state.checked) }) : '';
    if (state.failed){ el.innerHTML = `<li class="an-empty">${esc(t('load_err'))}</li>`; return; }
    if (!state.loaded) return;
    if (!state.news.length){ el.innerHTML = `<li class="an-empty">${esc(t('news_none'))}</li>`; return; }
    el.innerHTML = state.news.slice(0, 25).map(n => `<li><a href="${esc(safeUrl(n.url))}" target="_blank" rel="noopener nofollow">${esc(n.title)}</a>
      <small>${esc([n.source, fmtDate(n.published_at)].filter(Boolean).join(' · '))}</small></li>`).join('');
  }

  function renderForm(){
    const p = state.updateOf && state.promises.find(x => x.id === state.updateOf);
    const lab = document.getElementById('pr-upd-for');
    document.querySelectorAll('#pr-form [data-new]').forEach(el => { el.hidden = !!p; });
    if (p){
      lab.hidden = false;
      lab.innerHTML = `${esc(t('upd_for', { p: `${p.who}: ${p.promise.slice(0, 120)}${p.promise.length > 120 ? '…' : ''}` }))}
        <button type="button" class="pr-upd" id="pr-upd-cancel">${esc(t('upd_cancel'))}</button>`;
      document.getElementById('pr-upd-cancel').addEventListener('click', () => { state.updateOf = null; renderForm(); });
    } else lab.hidden = true;
  }

  function renderAll(){ applyStatic(); renderTiles(); renderWho(); renderList(); renderNews(); renderForm(); }

  async function load(){
    try {
      const d = await rpc('kasa_promises');
      state.promises = (d && d.promises) || [];
      state.news = (d && d.news) || [];
      state.checked = d && d.news_checked_at;
      state.loaded = true;
    } catch (e){ state.failed = true; }
    renderAll();
    if (location.hash.startsWith('#p-')){ const el = document.querySelector(location.hash); if (el) el.scrollIntoView(); }
  }

  document.querySelectorAll('.pr-lang button').forEach(b => b.addEventListener('click', () => {
    lang = b.dataset.lang;
    try { localStorage.setItem('kasa_lang', lang); } catch (e) {}
    renderAll();
  }));
  document.getElementById('pr-who').addEventListener('change', e => { state.who = e.target.value; renderList(); });
  document.getElementById('pr-q').addEventListener('input', e => { state.q = e.target.value; renderList(); });
  document.querySelectorAll('#pr-status-chips .pr-chip').forEach(b => b.addEventListener('click', () => {
    state.status = b.dataset.status;
    document.querySelectorAll('#pr-status-chips .pr-chip').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    renderList();
  }));
  document.getElementById('pr-list').addEventListener('click', e => {
    const b = e.target.closest('[data-upd]');
    if (!b) return;
    state.updateOf = b.dataset.upd;
    renderForm();
    const f = document.getElementById('pr-form');
    f.status.value = 'delivered';
    document.getElementById('pr-suggest').scrollIntoView({ behavior: 'smooth' });
  });

  document.getElementById('pr-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target, msg = document.getElementById('pr-msg'), btn = document.getElementById('pr-submit');
    const v = (n) => (f[n].value || '').trim();
    const isUrl = (u) => /^https?:\/\/\S+$/i.test(u);
    const fail = (k) => { msg.className = 'pr-msg err'; msg.textContent = t(k); };
    const status = v('status');
    if (state.updateOf){
      if (status === 'promised' || !isUrl(v('status_source_url')) || !v('status_date')) return fail('e_update');
    } else {
      if (v('who').length < 2) return fail('e_who');
      if (v('promise').length < 10) return fail('e_promise');
      if (!v('made_on')) return fail('e_date');
      if (!isUrl(v('source_url'))) return fail('e_url');
      if (status !== 'promised' && (!isUrl(v('status_source_url')) || !v('status_date'))) return fail('e_evidence');
    }
    btn.disabled = true; btn.textContent = t('f_sending'); msg.className = 'pr-msg'; msg.textContent = '';
    try {
      await rpc('kasa_promise_suggest', {
        p_who: v('who') || null, p_role: v('role') || null, p_promise: v('promise') || null, p_made_on: v('made_on') || null,
        p_source_url: v('source_url') || null, p_source_name: v('source_name') || null, p_status: status,
        p_status_source_url: v('status_source_url') || null, p_status_date: v('status_date') || null,
        p_status_note: v('status_note') || null, p_update_of: state.updateOf, p_note: v('note') || null,
        p_due_by: v('due_by') || null
      });
      f.reset(); state.updateOf = null; renderForm();
      msg.textContent = t('f_thanks');
    } catch (err){
      msg.className = 'pr-msg err'; msg.textContent = err.message;
    } finally {
      btn.disabled = false; btn.textContent = t('f_submit');
    }
  });

  applyStatic();
  if (!URL_ || !KEY){ state.failed = true; renderAll(); } else load();
})();
