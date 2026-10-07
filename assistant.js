/* ══════════════════════════════════════════════════════════
   assistant.html: civic help chat in Bengali, Hindi or English.
   Questions go to the kasa-assistant edge function (Sarvam AI) with
   the report map's anonymous sign-in; it allows a few a day per visitor.
   The chat lives only in this tab; nothing is saved here.
   ══════════════════════════════════════════════════════════ */
(() => {
  const CFG = window.KASA_CONFIG || {};
  const T = {
    en: {
      nav_home: 'Home', title: 'Ask <em>Parishkar</em>',
      sub: 'Ask in Bengali, Hindi or English: how to report a problem, who is responsible for it, or how to file a complaint or RTI.',
      ph: 'Type your question', send: 'Ask', thinking: 'Thinking…',
      note: 'Answers come from Sarvam AI, an Indian AI model, and can be wrong. Check sourced facts on the site\'s own pages. Don\'t type personal details; questions are sent to Sarvam and not saved by us. <a href="privacy.html">Privacy</a>',
      s1: 'How do I report garbage on my road?', s2: 'Who fixes a broken streetlight in a gram panchayat?',
      s3: 'How do I file an RTI about a stalled road?', s4: 'My report was ignored. What next?',
      e_off: 'The assistant isn\'t switched on yet. Please try again later.',
      e_limit: 'You\'ve reached today\'s question limit. Please come back tomorrow.',
      e_sign: 'Could not start a session. Check your connection and try again.',
      e_net: 'No answer came back. Check your connection and try again.'
    },
    bn: {
      nav_home: 'হোম', title: '<em>পরিষ্কার</em>-কে জিজ্ঞাসা করুন',
      sub: 'বাংলা, হিন্দি বা ইংরেজিতে জিজ্ঞাসা করুন: সমস্যা কীভাবে জানাবেন, কে দায়িত্বে, বা কীভাবে অভিযোগ বা RTI করবেন।',
      ph: 'আপনার প্রশ্ন লিখুন', send: 'জিজ্ঞাসা', thinking: 'ভাবছি…',
      note: 'উত্তর দেয় Sarvam AI, একটি ভারতীয় AI মডেল; ভুল হতে পারে। তথ্যসূত্র-সহ তথ্য সাইটের নিজের পাতায় মিলিয়ে নিন। ব্যক্তিগত তথ্য লিখবেন না; প্রশ্ন Sarvam-এ পাঠানো হয়, আমরা সংরক্ষণ করি না। <a href="privacy.html">গোপনীয়তা</a>',
      s1: 'আমার রাস্তায় আবর্জনা পড়ে আছে, কীভাবে জানাব?', s2: 'গ্রাম পঞ্চায়েতে ভাঙা পথবাতি কে সারায়?',
      s3: 'আটকে থাকা রাস্তার কাজ নিয়ে RTI কীভাবে করব?', s4: 'আমার রিপোর্টে কেউ সাড়া দেয়নি। এরপর কী করব?',
      e_off: 'সহায়ক এখনও চালু হয়নি। পরে আবার চেষ্টা করুন।',
      e_limit: 'আজকের প্রশ্নের সীমা শেষ। কাল আবার আসুন।',
      e_sign: 'সেশন শুরু করা গেল না। সংযোগ দেখে আবার চেষ্টা করুন।',
      e_net: 'উত্তর আসেনি। সংযোগ দেখে আবার চেষ্টা করুন।'
    },
    hi: {
      nav_home: 'होम', title: '<em>परिष्कार</em> से पूछें',
      sub: 'बांग्ला, हिंदी या अंग्रेज़ी में पूछें: समस्या कैसे दर्ज करें, कौन ज़िम्मेदार है, या शिकायत या RTI कैसे करें।',
      ph: 'अपना सवाल लिखें', send: 'पूछें', thinking: 'सोच रहा है…',
      note: 'जवाब Sarvam AI, एक भारतीय AI मॉडल, देता है और गलत हो सकता है। स्रोत वाले तथ्य साइट के अपने पन्नों पर जाँचें। निजी जानकारी न लिखें; सवाल Sarvam को भेजे जाते हैं, हम सहेजते नहीं। <a href="privacy.html">गोपनीयता</a>',
      s1: 'मेरी सड़क पर कचरा है, कैसे दर्ज करूँ?', s2: 'ग्राम पंचायत में खराब स्ट्रीटलाइट कौन ठीक करता है?',
      s3: 'रुके हुए सड़क काम पर RTI कैसे करूँ?', s4: 'मेरी रिपोर्ट पर कोई जवाब नहीं आया। अब क्या करूँ?',
      e_off: 'सहायक अभी चालू नहीं है। बाद में फिर कोशिश करें।',
      e_limit: 'आज के सवालों की सीमा पूरी हो गई। कल फिर आएँ।',
      e_sign: 'सत्र शुरू नहीं हो सका। कनेक्शन देखकर फिर कोशिश करें।',
      e_net: 'जवाब नहीं आया। कनेक्शन देखकर फिर कोशिश करें।'
    }
  };
  const store = {
    get(k){ try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v){ try { localStorage.setItem(k, v); } catch (e) {} }
  };
  let lang = store.get('kasa_lang') || 'en';
  if (!T[lang]) lang = 'en';
  const t = k => (T[lang] && T[lang][k]) || T.en[k] || k;
  const $ = id => document.getElementById(id);
  const log = $('as-log'), form = $('as-form'), input = $('as-input'), send = $('as-send'), starters = $('as-starters');
  const history = [];

  function applyLang(){
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-t]').forEach(el => { el.textContent = t(el.dataset.t); });
    document.querySelectorAll('[data-t-html]').forEach(el => { el.innerHTML = t(el.dataset.tHtml); });
    document.querySelectorAll('[data-t-ph]').forEach(el => { el.placeholder = t(el.dataset.tPh); });
    document.querySelectorAll('.cm-lang button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
    starters.innerHTML = '';
    for (const k of ['s1', 's2', 's3', 's4']){
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = t(k);
      b.addEventListener('click', () => ask(t(k)));
      starters.appendChild(b);
    }
  }

  const esc = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Escaped text, with the site's own page names and https links made clickable.
  const linkify = s => esc(s)
    .replace(/https:\/\/[^\s<)]+[^\s<).,;:!?]/g, u => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`)
    .replace(/(^|[\s(])([a-z-]+\.html)(?=[\s).,;:!?]|$)/g, (m, pre, f) => `${pre}<a href="${f}">${f}</a>`)
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');

  function bubble(cls, text){
    const d = document.createElement('div');
    d.className = 'as-msg ' + cls;
    if (cls === 'bot') d.innerHTML = linkify(text); else d.textContent = text;
    log.appendChild(d);
    d.scrollIntoView({ block: 'nearest' });
    return d;
  }

  let sb = null;
  const client = () => sb || (window.supabase && CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY
    ? (sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY,
        { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } })) : null);
  function captchaToken(){
    if (!CFG.TURNSTILE_SITE_KEY) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      const go = () => {
        const box = $('as-captcha'), slot = $('as-captcha-widget');
        slot.innerHTML = ''; box.hidden = false;
        window.turnstile.render(slot, { sitekey: CFG.TURNSTILE_SITE_KEY, action: 'kasa', appearance: 'interaction-only',
          callback: tok => { box.hidden = true; resolve(tok); }, 'error-callback': () => { box.hidden = true; reject(new Error(t('e_sign'))); } });
      };
      if (window.turnstile) return go();
      const sc = document.createElement('script');
      sc.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      sc.onload = go; sc.onerror = () => reject(new Error(t('e_sign')));
      document.head.appendChild(sc);
    });
  }
  async function ensureSession(){
    const c = client();
    if (!c) throw new Error(t('e_sign'));
    const { data: { session } } = await c.auth.getSession();
    if (session) return c;
    const tok = await captchaToken();
    const { error } = await c.auth.signInAnonymously(tok ? { options: { captchaToken: tok } } : undefined);
    if (error) throw new Error(t('e_sign'));
    return c;
  }

  let busy = false;
  async function ask(q){
    q = (q || '').trim().slice(0, 1200);
    if (!q || busy) return;
    busy = true; send.disabled = true;
    starters.remove();
    bubble('user', q);
    history.push({ role: 'user', content: q });
    input.value = '';
    const wait = bubble('bot wait', t('thinking'));
    try {
      const c = await ensureSession();
      const { data, error } = await c.functions.invoke('kasa-assistant', { body: { messages: history.slice(-8), lang } });
      if (error){
        const st = error.context && error.context.status;
        throw new Error(st === 503 ? t('e_off') : st === 429 ? t('e_limit') : t('e_net'));
      }
      if (!data || !data.answer) throw new Error(t('e_net'));
      wait.remove();
      bubble('bot', data.answer);
      history.push({ role: 'assistant', content: data.answer });
    } catch (e) {
      wait.remove();
      history.pop();
      bubble('err', e.message || t('e_net'));
    } finally {
      busy = false; send.disabled = false; input.focus();
    }
  }

  form.addEventListener('submit', e => { e.preventDefault(); ask(input.value); });
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); ask(input.value); } });
  document.querySelectorAll('.cm-lang button').forEach(b => b.addEventListener('click', () => {
    lang = b.dataset.lang; store.set('kasa_lang', lang); applyLang();
  }));
  applyLang();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
