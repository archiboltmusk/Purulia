/* ══════════════════════════════════════════════════════════
   PURULIA — noticeboard.html: public demands to named leaders
   Reads kasa_demands (published demands, leaders' replies, linked
   promises) and kasa_promises (for each leader's page, ?leader=Name).
   New demands and replies wait for a moderator. A +1 needs the report
   map's anonymous sign-in and counts once per visitor.
   ══════════════════════════════════════════════════════════ */
(() => {
  const CFG = window.KASA_CONFIG || {};
  const CITY = window.KASA_CITY || {};
  const URL_ = CFG.SUPABASE_URL, KEY = CFG.SUPABASE_ANON_KEY;

  const T = {
    en: {
      sub_d: 'Public demands from {d} to its MLAs, MPs and other officials: things the whole area needs. Add your +1 to the ones you agree with. When a leader answers or makes a promise, it is shown here with a link to where they said it.',
      empty_d: 'No demand from {d} yet. Be the first: ask for something the whole area needs below.',
      nav_home: 'Home', nav_promises: 'Promises',
      title: 'Ask your <em>leaders</em>',
      sub: 'Public demands from Purulia to its municipality chairman, ward councillors, MLAs and MPs: things the whole area needs. Add your +1 to the ones you agree with. When a leader answers or makes a promise, it is shown here with a link to where they said it.',
      tile_all: 'Demands', tile_supports: '+1s', tile_answered: 'Answered', tile_promised: 'Promised',
      rules_h: 'What belongs here',
      rule_1: 'Ask for something the whole ward, village or town needs: a road, streetlights, a drain, water, a school teacher, a bus stop.',
      rule_2: 'Not for yourself or your family. For your own pension, certificate, house or job, use the <a href="grievance.html">Grievance page</a> or the municipality helpline.',
      rule_3: 'Name the leader and say why it helps everyone. No insults, no party slogans, no names of private people. A volunteer moderator checks every demand before it appears.',
      list_h: 'Demands', all: 'All', r_chairman: 'Chairman', r_councillor: 'Councillor', r_mla: 'MLA', r_mp: 'MP', r_other: 'Other',
      sort_top: 'Most support', sort_new: 'Newest', search_ph: 'Search demands', loading: 'Loading…',
      none: 'No demands match.', none_yet: 'No demands published yet. Post the first one below.',
      load_err: 'Could not load the noticeboard. Check your connection and reload.',
      to: 'To', support: '+1 Support', supported: '✓ You support this', supports: '{n} support this', share: 'Share',
      at: 'Where: {p}', posted: 'Posted {d}',
      st_open: 'Waiting for an answer', st_answered: 'Answered', st_promised: 'Promised',
      reply_h: 'Their reply', said_on: 'Said on {d}', source: 'source',
      promise_link: 'Now a promise: {s}. See it on Promises',
      ps_promised: 'nothing shown yet', ps_in_progress: 'in progress', ps_delivered: 'delivered', ps_broken: 'broken',
      add_reply: 'Add their reply',
      form_h: 'Post a demand',
      form_sub: 'Keep it short and specific: what is needed, where, and who it helps. It appears here once a moderator has checked it.',
      f_leader: 'Who are you asking?', f_pick: 'Pick a leader',
      g_chair: 'Municipality', g_councillor: 'Ward councillor (town)', g_mla: 'MLA', g_mp: 'MP', g_zp: 'Zilla Parishad', g_other: 'Someone else',
      o_councillor: 'My ward councillor', o_other: 'Another official or leader',
      f_ward: 'Ward', f_ward_pick: 'Pick your ward', ward_n: 'Ward {n}', ward_councillor: 'Councillor, ward {n}',
      f_other_name: 'Their name', f_other_role: 'Their position', f_other_role_ph: 'e.g. BDO, Jhalda I',
      f_title: 'What do you want? (one line)', f_title_ph: 'e.g. Streetlights on Ranchi Road, ward 3 to 5',
      f_details: 'Why it helps everyone', f_details_ph: 'Who uses it, what goes wrong today, how many people it affects',
      f_place: 'Where (optional)', f_place_ph: 'Ward, village or road',
      f_community: 'This is for everyone in the area, not for me or my family.',
      f_note: 'Note for the moderator (optional, not shown)', f_submit: 'Send for checking', f_sending: 'Sending…',
      f_thanks: 'Thank you. A moderator will check it before it appears here.',
      e_leader: 'Pick who you are asking.', e_ward: 'Pick the ward.', e_other: 'Add the name and position of the person you are asking.',
      e_title: 'Write what you want in one line (at least 10 letters).', e_details: 'Say why it helps everyone (at least 30 letters).',
      e_community: 'Tick the box to confirm it is for everyone. For a problem of your own, use the Grievance page.',
      rf_h: 'Add a leader\'s reply', rf_for: 'Reply to: {t}',
      rf_sub: 'Did the leader answer this in a speech, a letter, a newspaper or an official post? Add what they said and a link to it. A moderator checks the link first.',
      rf_reply: 'What they said', rf_date: 'Date they said it', rf_url: 'Link to where they said it', rf_source: 'Newspaper, page or channel (optional)',
      rf_submit: 'Send for checking', rf_cancel: 'Cancel',
      e_reply: 'Write what they said (at least 10 letters).', e_date: 'Add the date.', e_url: 'Add a link starting with http:// or https://.',
      leaders_h: 'Leaders', leaders_sub: 'Tap a leader to see what people asked them for, what they answered, and what they promised.',
      lc_line: '{a} asked · {r} answered · {p} promises · {d} delivered',
      back: '← All demands', lv_asked: 'Demands to them', lv_answered: 'Answered', lv_promises: 'Promises made', lv_delivered: 'Delivered',
      lv_demands_h: 'What people asked them for', lv_promises_h: 'What they promised', lv_none_d: 'No demands to them yet.',
      lv_none_p: 'No promises by them on the Promises page yet.', lv_promise_more: 'On Promises',
      view_list: 'List', view_map: 'Map', map_none: 'No demands with a map pin yet.', map_err: 'The map could not load.',
      f_pin: 'Map pin (optional)', f_pin_add: 'Add a pin on the map', f_pin_me: 'Use my location', f_pin_clear: 'Remove pin',
      f_pin_hint: 'Tap the map where it is needed.', f_pin_set: 'Pin set.', f_pin_geo_err: 'Could not get your location.',
      sign_err: 'Could not count your +1. Please reload and try again.', captcha_title: "Quick check that you're a person",
      share_text: 'Demand to {w}: {t}. Add your +1:'
    },
    bn: {
      sub_d: '{d}-এর বিধায়ক, সাংসদ ও অন্য আধিকারিকদের কাছে গোটা এলাকার দরকারি জিনিসের দাবি। যেগুলিতে আপনি একমত, সেখানে +1 দিন। কোনও নেতা উত্তর দিলে বা প্রতিশ্রুতি দিলে, কোথায় বলেছেন তার লিঙ্কসহ এখানে দেখানো হয়।',
      empty_d: '{d} থেকে এখনও কোনও দাবি নেই। প্রথম হন: নিচে গোটা এলাকার দরকারি কিছু চান।',
      nav_home: 'হোম', nav_promises: 'প্রতিশ্রুতি',
      title: 'নেতাদের কাছে <em>দাবি</em>',
      sub: 'পুরুলিয়ার পুরপ্রধান, কাউন্সিলর, বিধায়ক ও সাংসদের কাছে গোটা এলাকার দরকারি জিনিসের দাবি। যেগুলিতে আপনি একমত, সেখানে +1 দিন। কোনও নেতা উত্তর দিলে বা প্রতিশ্রুতি দিলে, কোথায় বলেছেন তার লিঙ্কসহ এখানে দেখানো হয়।',
      tile_all: 'দাবি', tile_supports: '+1', tile_answered: 'উত্তর এসেছে', tile_promised: 'প্রতিশ্রুতি মিলেছে',
      rules_h: 'এখানে কী লেখা যায়',
      rule_1: 'গোটা ওয়ার্ড, গ্রাম বা শহরের যা দরকার তা চান: রাস্তা, আলো, নর্দমা, জল, স্কুলে শিক্ষক, বাস স্টপ।',
      rule_2: 'নিজের বা পরিবারের জন্য নয়। নিজের পেনশন, সার্টিফিকেট, বাড়ি বা চাকরির জন্য <a href="grievance.html">অভিযোগ পাতা</a> বা পুরসভার হেল্পলাইন ব্যবহার করুন।',
      rule_3: 'নেতার নাম দিন আর লিখুন কেন এটা সবার কাজে লাগবে। অপমান, দলীয় স্লোগান বা সাধারণ মানুষের নাম নয়। প্রকাশের আগে একজন স্বেচ্ছাসেবী মডারেটর প্রতিটি দাবি দেখে নেন।',
      list_h: 'দাবি', all: 'সব', r_chairman: 'পুরপ্রধান', r_councillor: 'কাউন্সিলর', r_mla: 'বিধায়ক', r_mp: 'সাংসদ', r_other: 'অন্যান্য',
      sort_top: 'সবচেয়ে বেশি সমর্থন', sort_new: 'নতুন', search_ph: 'দাবি খুঁজুন', loading: 'লোড হচ্ছে…',
      none: 'কোনও দাবি মেলেনি।', none_yet: 'এখনও কোনও দাবি প্রকাশ হয়নি। নিচে প্রথমটি লিখুন।',
      load_err: 'নোটিসবোর্ড লোড করা গেল না। সংযোগ দেখে আবার লোড করুন।',
      to: 'প্রতি', support: '+1 সমর্থন', supported: '✓ আপনি সমর্থন করেছেন', supports: '{n} জন সমর্থন করেছেন', share: 'শেয়ার',
      at: 'কোথায়: {p}', posted: 'লেখা হয়েছে {d}',
      st_open: 'উত্তরের অপেক্ষায়', st_answered: 'উত্তর এসেছে', st_promised: 'প্রতিশ্রুতি মিলেছে',
      reply_h: 'তাঁর উত্তর', said_on: 'বলেছেন {d}', source: 'সূত্র',
      promise_link: 'এখন প্রতিশ্রুতি: {s}। প্রতিশ্রুতি পাতায় দেখুন',
      ps_promised: 'এখনও কিছু দেখা যায়নি', ps_in_progress: 'কাজ চলছে', ps_delivered: 'পূরণ হয়েছে', ps_broken: 'ভাঙা',
      add_reply: 'তাঁর উত্তর যোগ করুন',
      form_h: 'দাবি লিখুন',
      form_sub: 'ছোট ও নির্দিষ্ট রাখুন: কী দরকার, কোথায়, আর কাদের কাজে লাগবে। মডারেটর দেখে নেওয়ার পর এখানে দেখা যাবে।',
      f_leader: 'কার কাছে চাইছেন?', f_pick: 'নেতা বেছে নিন',
      g_chair: 'পুরসভা', g_councillor: 'ওয়ার্ড কাউন্সিলর (শহর)', g_mla: 'বিধায়ক', g_mp: 'সাংসদ', g_zp: 'জেলা পরিষদ', g_other: 'অন্য কেউ',
      o_councillor: 'আমার ওয়ার্ডের কাউন্সিলর', o_other: 'অন্য আধিকারিক বা নেতা',
      f_ward: 'ওয়ার্ড', f_ward_pick: 'ওয়ার্ড বেছে নিন', ward_n: 'ওয়ার্ড {n}', ward_councillor: 'কাউন্সিলর, ওয়ার্ড {n}',
      f_other_name: 'তাঁর নাম', f_other_role: 'তাঁর পদ', f_other_role_ph: 'যেমন বিডিও, ঝালদা ১',
      f_title: 'কী চান? (এক লাইনে)', f_title_ph: 'যেমন রাঁচি রোডে ৩ থেকে ৫ নম্বর ওয়ার্ড পর্যন্ত রাস্তার আলো',
      f_details: 'কেন এটা সবার কাজে লাগবে', f_details_ph: 'কারা ব্যবহার করেন, এখন কী সমস্যা, কতজন মানুষ ভোগেন',
      f_place: 'কোথায় (ঐচ্ছিক)', f_place_ph: 'ওয়ার্ড, গ্রাম বা রাস্তা',
      f_community: 'এটা এলাকার সবার জন্য, আমার বা আমার পরিবারের জন্য নয়।',
      f_note: 'মডারেটরের জন্য নোট (ঐচ্ছিক, দেখানো হবে না)', f_submit: 'যাচাইয়ের জন্য পাঠান', f_sending: 'পাঠানো হচ্ছে…',
      f_thanks: 'ধন্যবাদ। এখানে দেখানোর আগে একজন মডারেটর দেখে নেবেন।',
      e_leader: 'কার কাছে চাইছেন বেছে নিন।', e_ward: 'ওয়ার্ড বেছে নিন।', e_other: 'যাঁর কাছে চাইছেন তাঁর নাম ও পদ লিখুন।',
      e_title: 'কী চান এক লাইনে লিখুন (অন্তত ১০ অক্ষর)।', e_details: 'কেন সবার কাজে লাগবে লিখুন (অন্তত ৩০ অক্ষর)।',
      e_community: 'এটা সবার জন্য তা নিশ্চিত করতে বাক্সে টিক দিন। নিজের সমস্যার জন্য অভিযোগ পাতা ব্যবহার করুন।',
      rf_h: 'নেতার উত্তর যোগ করুন', rf_for: 'উত্তর: {t}',
      rf_sub: 'নেতা কি ভাষণে, চিঠিতে, খবরের কাগজে বা সরকারি পোস্টে এর উত্তর দিয়েছেন? কী বলেছেন আর তার লিঙ্ক দিন। মডারেটর আগে লিঙ্কটি দেখে নেবেন।',
      rf_reply: 'কী বলেছেন', rf_date: 'কবে বলেছেন', rf_url: 'যেখানে বলেছেন তার লিঙ্ক', rf_source: 'খবরের কাগজ, পেজ বা চ্যানেল (ঐচ্ছিক)',
      rf_submit: 'যাচাইয়ের জন্য পাঠান', rf_cancel: 'বাতিল',
      e_reply: 'কী বলেছেন লিখুন (অন্তত ১০ অক্ষর)।', e_date: 'তারিখ দিন।', e_url: 'http:// বা https:// দিয়ে শুরু লিঙ্ক দিন।',
      leaders_h: 'নেতারা', leaders_sub: 'কোনও নেতার নাম চাপুন: মানুষ তাঁর কাছে কী চেয়েছেন, তিনি কী উত্তর দিয়েছেন, কী প্রতিশ্রুতি দিয়েছেন।',
      lc_line: '{a} দাবি · {r} উত্তর · {p} প্রতিশ্রুতি · {d} পূরণ',
      back: '← সব দাবি', lv_asked: 'তাঁর কাছে দাবি', lv_answered: 'উত্তর দিয়েছেন', lv_promises: 'প্রতিশ্রুতি', lv_delivered: 'পূরণ হয়েছে',
      lv_demands_h: 'মানুষ তাঁর কাছে কী চেয়েছেন', lv_promises_h: 'তিনি কী প্রতিশ্রুতি দিয়েছেন', lv_none_d: 'এখনও তাঁর কাছে কোনও দাবি নেই।',
      lv_none_p: 'প্রতিশ্রুতি পাতায় এখনও তাঁর কোনও প্রতিশ্রুতি নেই।', lv_promise_more: 'প্রতিশ্রুতি পাতায়',
      view_list: 'তালিকা', view_map: 'ম্যাপ', map_none: 'এখনও ম্যাপে পিন দেওয়া কোনও দাবি নেই।', map_err: 'ম্যাপ লোড করা গেল না।',
      f_pin: 'ম্যাপে পিন (ঐচ্ছিক)', f_pin_add: 'ম্যাপে পিন দিন', f_pin_me: 'আমার লোকেশন', f_pin_clear: 'পিন সরান',
      f_pin_hint: 'যেখানে দরকার ম্যাপে সেখানে চাপুন।', f_pin_set: 'পিন দেওয়া হয়েছে।', f_pin_geo_err: 'আপনার লোকেশন পাওয়া গেল না।',
      sign_err: 'আপনার +1 গোনা গেল না। পাতা আবার লোড করে চেষ্টা করুন।', captcha_title: 'আপনি মানুষ কিনা একটু দেখে নিচ্ছি',
      share_text: '{w}-এর কাছে দাবি: {t}। আপনার +1 দিন:'
    },
    hi: {
      sub_d: '{d} के विधायकों, सांसदों और दूसरे अधिकारियों से पूरे इलाक़े की ज़रूरतों की सार्वजनिक माँगें। जिनसे आप सहमत हैं उन पर +1 दें। कोई नेता जवाब दे या वादा करे, तो कहाँ कहा उसके लिंक के साथ यहाँ दिखता है।',
      empty_d: '{d} से अभी कोई माँग नहीं। पहले बनें: नीचे पूरे इलाक़े की कोई ज़रूरत माँगें।',
      nav_home: 'होम', nav_promises: 'वादे',
      title: 'अपने <em>नेताओं</em> से माँगें',
      sub: 'पुरुलिया के नगरपालिका अध्यक्ष, वार्ड पार्षदों, विधायकों और सांसदों से पूरे इलाक़े की ज़रूरतों की सार्वजनिक माँगें। जिनसे आप सहमत हैं उन पर +1 दें। कोई नेता जवाब दे या वादा करे, तो कहाँ कहा उसके लिंक के साथ यहाँ दिखता है।',
      tile_all: 'माँगें', tile_supports: '+1', tile_answered: 'जवाब मिला', tile_promised: 'वादा मिला',
      rules_h: 'यहाँ क्या लिखें',
      rule_1: 'वह माँगें जो पूरे वार्ड, गाँव या शहर को चाहिए: सड़क, स्ट्रीटलाइट, नाली, पानी, स्कूल में शिक्षक, बस स्टॉप।',
      rule_2: 'अपने या परिवार के लिए नहीं। अपनी पेंशन, प्रमाणपत्र, घर या नौकरी के लिए <a href="grievance.html">शिकायत पेज</a> या नगरपालिका हेल्पलाइन का इस्तेमाल करें।',
      rule_3: 'नेता का नाम दें और बताएँ कि इससे सबको क्या फ़ायदा है। अपमान, पार्टी के नारे या आम लोगों के नाम नहीं। प्रकाशित होने से पहले एक स्वयंसेवी मॉडरेटर हर माँग जाँचता है।',
      list_h: 'माँगें', all: 'सभी', r_chairman: 'अध्यक्ष', r_councillor: 'पार्षद', r_mla: 'विधायक', r_mp: 'सांसद', r_other: 'अन्य',
      sort_top: 'सबसे ज़्यादा समर्थन', sort_new: 'नई', search_ph: 'माँगें खोजें', loading: 'लोड हो रहा है…',
      none: 'कोई माँग नहीं मिली।', none_yet: 'अभी कोई माँग प्रकाशित नहीं हुई। नीचे पहली लिखें।',
      load_err: 'नोटिसबोर्ड लोड नहीं हो सका। कनेक्शन देखकर फिर लोड करें।',
      to: 'किससे', support: '+1 समर्थन', supported: '✓ आपने समर्थन किया', supports: '{n} लोग समर्थन करते हैं', share: 'शेयर',
      at: 'कहाँ: {p}', posted: 'लिखा गया {d}',
      st_open: 'जवाब का इंतज़ार', st_answered: 'जवाब मिला', st_promised: 'वादा मिला',
      reply_h: 'उनका जवाब', said_on: 'कहा {d}', source: 'स्रोत',
      promise_link: 'अब एक वादा: {s}। वादे पेज पर देखें',
      ps_promised: 'अभी कुछ नहीं दिखा', ps_in_progress: 'काम जारी', ps_delivered: 'पूरा हुआ', ps_broken: 'टूटा',
      add_reply: 'उनका जवाब जोड़ें',
      form_h: 'माँग लिखें',
      form_sub: 'छोटा और साफ़ रखें: क्या चाहिए, कहाँ, और किसके काम आएगा। मॉडरेटर के जाँचने के बाद यहाँ दिखेगी।',
      f_leader: 'किससे माँग रहे हैं?', f_pick: 'नेता चुनें',
      g_chair: 'नगरपालिका', g_councillor: 'वार्ड पार्षद (शहर)', g_mla: 'विधायक', g_mp: 'सांसद', g_zp: 'ज़िला परिषद', g_other: 'कोई और',
      o_councillor: 'मेरे वार्ड के पार्षद', o_other: 'कोई दूसरा अधिकारी या नेता',
      f_ward: 'वार्ड', f_ward_pick: 'वार्ड चुनें', ward_n: 'वार्ड {n}', ward_councillor: 'पार्षद, वार्ड {n}',
      f_other_name: 'उनका नाम', f_other_role: 'उनका पद', f_other_role_ph: 'जैसे बीडीओ, झालदा I',
      f_title: 'क्या चाहिए? (एक लाइन में)', f_title_ph: 'जैसे राँची रोड पर वार्ड 3 से 5 तक स्ट्रीटलाइट',
      f_details: 'इससे सबको क्या फ़ायदा', f_details_ph: 'कौन इस्तेमाल करता है, अभी क्या दिक़्क़त है, कितने लोगों पर असर है',
      f_place: 'कहाँ (वैकल्पिक)', f_place_ph: 'वार्ड, गाँव या सड़क',
      f_community: 'यह इलाक़े के सभी लोगों के लिए है, मेरे या मेरे परिवार के लिए नहीं।',
      f_note: 'मॉडरेटर के लिए नोट (वैकल्पिक, दिखेगा नहीं)', f_submit: 'जाँच के लिए भेजें', f_sending: 'भेजा जा रहा है…',
      f_thanks: 'धन्यवाद। यहाँ दिखने से पहले एक मॉडरेटर इसे जाँचेगा।',
      e_leader: 'किससे माँग रहे हैं, चुनें।', e_ward: 'वार्ड चुनें।', e_other: 'जिनसे माँग रहे हैं उनका नाम और पद लिखें।',
      e_title: 'क्या चाहिए एक लाइन में लिखें (कम से कम 10 अक्षर)।', e_details: 'सबको क्या फ़ायदा है, लिखें (कम से कम 30 अक्षर)।',
      e_community: 'यह सबके लिए है, इसकी पुष्टि के लिए बॉक्स पर टिक करें। अपनी समस्या के लिए शिकायत पेज इस्तेमाल करें।',
      rf_h: 'नेता का जवाब जोड़ें', rf_for: 'जवाब: {t}',
      rf_sub: 'क्या नेता ने किसी भाषण, चिट्ठी, अख़बार या सरकारी पोस्ट में इसका जवाब दिया? उन्होंने क्या कहा और उसका लिंक दें। मॉडरेटर पहले लिंक जाँचेगा।',
      rf_reply: 'उन्होंने क्या कहा', rf_date: 'कब कहा', rf_url: 'जहाँ कहा उसका लिंक', rf_source: 'अख़बार, पेज या चैनल (वैकल्पिक)',
      rf_submit: 'जाँच के लिए भेजें', rf_cancel: 'रद्द करें',
      e_reply: 'उन्होंने क्या कहा लिखें (कम से कम 10 अक्षर)।', e_date: 'तारीख़ दें।', e_url: 'http:// या https:// से शुरू होने वाला लिंक दें।',
      leaders_h: 'नेता', leaders_sub: 'किसी नेता पर टैप करें: लोगों ने उनसे क्या माँगा, उन्होंने क्या जवाब दिया, क्या वादा किया।',
      lc_line: '{a} माँगें · {r} जवाब · {p} वादे · {d} पूरे',
      back: '← सभी माँगें', lv_asked: 'उनसे माँगें', lv_answered: 'जवाब दिया', lv_promises: 'वादे किए', lv_delivered: 'पूरे हुए',
      lv_demands_h: 'लोगों ने उनसे क्या माँगा', lv_promises_h: 'उन्होंने क्या वादा किया', lv_none_d: 'अभी उनसे कोई माँग नहीं।',
      lv_none_p: 'वादे पेज पर अभी उनका कोई वादा नहीं।', lv_promise_more: 'वादे पेज पर',
      view_list: 'सूची', view_map: 'मैप', map_none: 'अभी मैप पिन वाली कोई माँग नहीं।', map_err: 'मैप लोड नहीं हो सका।',
      f_pin: 'मैप पिन (वैकल्पिक)', f_pin_add: 'मैप पर पिन लगाएँ', f_pin_me: 'मेरी लोकेशन', f_pin_clear: 'पिन हटाएँ',
      f_pin_hint: 'जहाँ ज़रूरत है, मैप पर वहाँ टैप करें।', f_pin_set: 'पिन लग गया।', f_pin_geo_err: 'आपकी लोकेशन नहीं मिल सकी।',
      sign_err: 'आपका +1 गिना नहीं जा सका। पेज फिर लोड करके कोशिश करें।', captcha_title: 'एक छोटी जाँच कि आप इंसान हैं',
      share_text: '{w} से माँग: {t}। अपना +1 दें:'
    }
  };

  let lang = 'en';
  try { lang = localStorage.getItem('kasa_lang') || 'en'; } catch (e) {}
  if (!T[lang]) lang = 'en';
  // Outside Purulia, keys with a '_d' twin use it, with {d} = the district's name.
  const place = { slug: 'purulia', name: '', name_bn: '', at: null };
  const t = (k, vars) => {
    if (place.slug !== 'purulia' && T.en[k + '_d']) k += '_d';
    vars = { d: lang === 'bn' && place.name_bn ? place.name_bn : place.name, ...vars };
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
  const store = {
    get(k){ try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v){ try { localStorage.setItem(k, v); } catch (e) {} }
  };

  // The report map's anonymous sign-in (same saved session), checked by Turnstile when a
  // site key is configured, so a +1 needs a real session rather than a fresh browser id.
  let sb = null;
  const client = () => sb || (window.supabase && URL_ && KEY ? (sb = window.supabase.createClient(URL_, KEY,
    { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } })) : null);
  function captchaToken(){
    if (!CFG.TURNSTILE_SITE_KEY) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      const go = () => {
        const box = document.getElementById('nb-captcha'), slot = document.getElementById('nb-captcha-widget');
        slot.innerHTML = '';
        box.hidden = false;
        window.turnstile.render(slot, { sitekey: CFG.TURNSTILE_SITE_KEY, action: 'kasa', appearance: 'interaction-only',
          callback: tok => { box.hidden = true; resolve(tok); }, 'error-callback': () => { box.hidden = true; reject(new Error(t('sign_err'))); } });
      };
      if (window.turnstile) return go();
      const sc = document.createElement('script');
      sc.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      sc.onload = go; sc.onerror = () => reject(new Error(t('sign_err')));
      document.head.appendChild(sc);
    });
  }
  async function ensureSession(){
    const c = client();
    if (!c) throw new Error(t('sign_err'));
    const { data: { session } } = await c.auth.getSession();
    if (session) return c;
    const tok = await captchaToken();
    const { error } = await c.auth.signInAnonymously(tok ? { options: { captchaToken: tok } } : undefined);
    if (error) throw new Error(t('sign_err'));
    return c;
  }
  let supported = new Set();
  try { supported = new Set(JSON.parse(store.get('kasa_demand_supported') || '[]')); } catch (e) {}
  const saveSupported = () => store.set('kasa_demand_supported', JSON.stringify([...supported].slice(-500)));

  // Leaders the form offers, from city.js (the same names as the report map).
  function leaders(){
    const reps = CITY.reps || {};
    const out = [];
    if (reps.chairman) out.push({ key: 'chairman', role: 'chairman', name: reps.chairman.name, area: CITY.name ? `${CITY.name} Municipality` : 'Municipality', group: 'g_chair' });
    for (const [seat, v] of Object.entries(CITY.lokSabha || {})) {
      const mp = typeof v.mp === 'string' ? reps[v.mp] : v.mp;
      if (mp && mp.name) out.push({ key: 'mp:' + seat, role: 'mp', name: mp.name, area: `${seat} (Lok Sabha)`, group: 'g_mp' });
    }
    for (const c of CITY.constituencies || []) {
      if (c.mla && c.mla.name) out.push({ key: 'mla:' + c.no, role: 'mla', name: c.mla.name, area: c.name, group: 'g_mla' });
    }
    // The district's other municipalities, and the Zilla Parishad for the villages.
    for (const m of CITY.municipalities || []) {
      const chair = typeof m.chair === 'string' ? reps[m.chair] : m.chair;
      if (!m.town && chair && chair.name) out.push({ key: 'chair:' + m.name, role: 'chairman', name: chair.name, area: `${m.name} Municipality`, group: 'g_chair' });
    }
    if (CITY.zillaParishad && CITY.zillaParishad.name) out.push({ key: 'zp', role: 'other', name: CITY.zillaParishad.name, area: 'Purulia Zilla Parishad', group: 'g_zp' });
    return out;
  }
  let LEADERS = leaders();
  const ROLE_OF = { chairman: 'r_chairman', councillor: 'r_councillor', mla: 'r_mla', mp: 'r_mp', other: 'r_other' };
  const norm = (n) => String(n || '').trim().toLowerCase();
  const photoOf = (name) => Object.values(CITY.reps || {}).find(r => norm(r.name) === norm(name));

  const params = new URLSearchParams(location.search);
  const state = { demands: [], promises: [], wards: [], role: '', sort: 'top', q: '', replyTo: null, loaded: false, failed: false,
                  leader: params.get('leader') || '', view: 'list', pin: null };
  const statusOf = (d) => d.promise ? 'promised' : (d.replies && d.replies.length ? 'answered' : 'open');

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

  function renderTiles(){
    const d = state.demands;
    document.getElementById('nb-n-all').textContent = d.length;
    document.getElementById('nb-n-supports').textContent = d.reduce((a, x) => a + (x.supports || 0), 0);
    document.getElementById('nb-n-answered').textContent = d.filter(x => statusOf(x) !== 'open').length;
    document.getElementById('nb-n-promised').textContent = d.filter(x => x.promise).length;
  }

  function renderLeaderSelect(){
    const sel = document.getElementById('nb-leader');
    const cur = sel.value;
    const groups = {};
    LEADERS.forEach(l => { (groups[l.group] = groups[l.group] || []).push(l); });
    const opt = (v, label) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(label)}</option>`;
    sel.innerHTML = opt('', t('f_pick')) +
      (groups.g_chair ? `<optgroup label="${esc(t('g_chair'))}">${groups.g_chair.map(l => opt(l.key, `${l.area}: ${l.name}`)).join('')}</optgroup>` : '') +
      (place.slug === 'purulia' ? `<optgroup label="${esc(t('g_councillor'))}">${opt('councillor', t('o_councillor'))}</optgroup>` : '') +
      (groups.g_mla ? `<optgroup label="${esc(t('g_mla'))}">${groups.g_mla.map(l => opt(l.key, `${l.area}: ${l.name}`)).join('')}</optgroup>` : '') +
      (groups.g_mp ? `<optgroup label="${esc(t('g_mp'))}">${groups.g_mp.map(l => opt(l.key, `${l.area}: ${l.name}`)).join('')}</optgroup>` : '') +
      (groups.g_zp ? `<optgroup label="${esc(t('g_zp'))}">${groups.g_zp.map(l => opt(l.key, `${l.area}: ${l.name}`)).join('')}</optgroup>` : '') +
      `<optgroup label="${esc(t('g_other'))}">${opt('other', t('o_other'))}</optgroup>`;
    const wsel = document.getElementById('nb-ward');
    const wcur = wsel.value;
    wsel.innerHTML = `<option value="">${esc(t('f_ward_pick'))}</option>` + state.wards.map(w =>
      `<option value="${esc(w.ward_no)}"${String(w.ward_no) === wcur ? ' selected' : ''}>${esc(t('ward_n', { n: w.ward_no }))}${w.councillor_name ? ': ' + esc(w.councillor_name) : ''}</option>`).join('');
    toggleLeaderFields();
  }

  function toggleLeaderFields(){
    const v = document.getElementById('nb-leader').value;
    document.getElementById('nb-ward-row').hidden = v !== 'councillor';
    document.getElementById('nb-other-row').hidden = v !== 'other';
  }

  function renderList(){
    const el = document.getElementById('nb-list');
    if (state.failed){ el.innerHTML = `<li class="an-empty">${esc(t('load_err'))}</li>`; return; }
    if (!state.loaded) return;
    if (!state.demands.length || (state.leader && !state.demands.some(d => norm(d.leader_name) === norm(state.leader)))){
      el.innerHTML = `<li class="an-empty">${esc(t(state.leader ? 'lv_none_d' : place.slug === 'purulia' ? 'none_yet' : 'empty_d'))}</li>`; return;
    }
    const q = state.q.toLowerCase();
    const rows = state.demands.filter(d => (!state.role || d.leader_role === state.role) &&
      (!state.leader || norm(d.leader_name) === norm(state.leader)) &&
      (!q || [d.leader_name, d.leader_area, d.title, d.details, d.place].join(' ').toLowerCase().includes(q)));
    if (state.sort === 'new') rows.sort((a, b) => String(b.published_at || b.created_at).localeCompare(String(a.published_at || a.created_at)));
    else rows.sort((a, b) => (b.supports || 0) - (a.supports || 0) || String(b.published_at).localeCompare(String(a.published_at)));
    if (!rows.length){ el.innerHTML = `<li class="an-empty">${esc(t('none'))}</li>`; return; }
    el.innerHTML = rows.map(d => {
      const st = statusOf(d), mine = supported.has(d.id);
      return `<li class="pr-item nb-item" id="d-${esc(d.id)}">
        <div class="nb-top">
          <span class="pr-status nb-s-${st}">${esc(t('st_' + st))}</span>
          <span class="nb-to">${esc(t('to'))}: <a href="${esc(leaderHref(d.leader_name))}"><strong>${esc(t('r_' + d.leader_role))} ${esc(d.leader_name)}</strong></a>${d.leader_area ? ` · ${esc(d.leader_area)}` : ''}</span>
        </div>
        <div class="pr-who nb-title">${esc(d.title)}</div>
        <div class="pr-text">${esc(d.details)}</div>
        <div class="pr-meta">${d.place ? esc(t('at', { p: d.place })) + ' · ' : ''}${esc(t('posted', { d: fmtDate(d.published_at || d.created_at) }))}</div>
        ${d.promise ? `<div class="nb-promise"><a href="promises.html#p-${esc(d.promise.id)}">${esc(t('promise_link', { s: t('ps_' + d.promise.status) }))} ↗</a></div>` : ''}
        ${(d.replies || []).map(r => `<div class="nb-reply"><span class="pr-meta">${esc(t('reply_h'))}</span>
          <div>${esc(r.reply)}</div>
          <div class="pr-meta">${esc(t('said_on', { d: fmtDate(r.said_on) }))} · <a href="${esc(safeUrl(r.source_url))}" target="_blank" rel="noopener nofollow">${esc(r.source_name || t('source'))} ↗</a></div></div>`).join('')}
        <div class="nb-actions">
          <button type="button" class="nb-plus" data-support="${esc(d.id)}" aria-pressed="${mine}"${mine ? ' disabled' : ''}>${esc(mine ? t('supported') : t('support'))}</button>
          <span class="nb-count">${esc(t('supports', { n: d.supports || 0 }))}</span>
          <button type="button" class="pr-upd" data-share="${esc(d.id)}">${esc(t('share'))}</button>
          <button type="button" class="pr-upd" data-reply="${esc(d.id)}">${esc(t('add_reply'))}</button>
        </div>
      </li>`;
    }).join('');
  }

  // Everyone with something on the board: the leaders from city.js, anyone a demand was
  // addressed to, and anyone with a published promise.
  function leaderCards(){
    const m = new Map();
    const add = (name, role, area) => {
      const k = norm(name);
      if (!m.has(k)) m.set(k, { name, role, area, asked: 0, answered: 0, supports: 0, promises: 0, delivered: 0 });
      return m.get(k);
    };
    LEADERS.forEach(l => add(l.name, t(ROLE_OF[l.role]), l.area));
    state.demands.forEach(d => {
      const c = add(d.leader_name, t(ROLE_OF[d.leader_role] || 'r_other'), d.leader_area);
      c.asked++; c.supports += d.supports || 0; if (statusOf(d) !== 'open') c.answered++;
    });
    state.promises.forEach(p => {
      const c = add(p.who, p.role || '', p.area || '');
      c.promises++; if (p.status === 'delivered') c.delivered++;
    });
    return [...m.values()].sort((a, b) => (b.asked + b.promises) - (a.asked + a.promises) || a.name.localeCompare(b.name));
  }
  const leaderHref = (name) => `noticeboard.html?leader=${encodeURIComponent(name)}`;

  function renderLeaders(){
    const el = document.getElementById('nb-leaders');
    el.innerHTML = leaderCards().map(c => `<a class="nb-lcard" href="${esc(leaderHref(c.name))}">
      <strong>${esc(c.name)}</strong><small>${esc([c.role, c.area].filter(Boolean).join(' · '))}</small>
      <span>${esc(t('lc_line', { a: c.asked, r: c.answered, p: c.promises, d: c.delivered }))}</span></a>`).join('');
  }

  function renderLeaderView(){
    const on = !!state.leader;
    document.getElementById('nb-leader-view').hidden = !on;
    document.querySelectorAll('[data-overview]').forEach(el => { el.hidden = on; });
    document.querySelector('#nb-demands h2').textContent = t(on ? 'lv_demands_h' : 'list_h');
    document.getElementById('nb-role-chips').hidden = on;
    if (!on) return;
    const pre = LEADERS.find(l => norm(l.name) === norm(state.leader));
    const sel = document.getElementById('nb-leader');
    if (pre && !sel.value){ sel.value = pre.key; toggleLeaderFields(); }
    const c = leaderCards().find(x => norm(x.name) === norm(state.leader)) ||
      { name: state.leader, role: '', area: '', asked: 0, answered: 0, supports: 0, promises: 0, delivered: 0 };
    const ph = photoOf(c.name);
    document.getElementById('nb-lv-head').innerHTML = `
      ${ph && ph.photo ? `<img class="nb-lv-photo" src="${esc(ph.photo)}" alt="" style="object-position:${esc(ph.photoPos || '50% 30%')}">` : ''}
      <div><h2 class="an-title nb-lv-name">${esc(c.name)}</h2><p class="an-sub">${esc([c.role, c.area].filter(Boolean).join(' · '))}</p></div>`;
    const tiles = [['lv_asked', c.asked], ['tile_supports', c.supports], ['lv_answered', c.answered], ['lv_promises', c.promises], ['lv_delivered', c.delivered]];
    document.getElementById('nb-lv-tiles').innerHTML = tiles.map(([k, n]) =>
      `<div class="an-tile"><div class="an-tile-n">${n}</div><div class="an-tile-l">${esc(t(k))}</div></div>`).join('');
    const ps = state.promises.filter(p => norm(p.who) === norm(c.name));
    document.getElementById('nb-lv-promises').innerHTML = ps.length ? ps.map(p => `<li class="pr-item">
        <span class="pr-status nb-ps-${esc(p.status)}">${esc(t('ps_' + p.status))}</span>
        <div class="pr-text">${esc(p.promise)}</div>
        <div class="pr-meta">${esc(t('said_on', { d: fmtDate(p.made_on) }))} · <a href="${esc(safeUrl(p.source_url))}" target="_blank" rel="noopener nofollow">${esc(p.source_name || t('source'))} ↗</a>
          · <a href="promises.html#p-${esc(p.id)}">${esc(t('lv_promise_more'))} ↗</a></div></li>`).join('')
      : `<li class="an-empty">${esc(t('lv_none_p'))}</li>`;
    document.title = `${c.name} — Ask your leaders — Parishkar ${place.slug === 'purulia' ? 'Purulia' : 'Bengal'}`;
  }

  function renderReplyForm(){
    const sec = document.getElementById('nb-reply-sec');
    const d = state.replyTo && state.demands.find(x => x.id === state.replyTo);
    sec.hidden = !d;
    if (d) document.getElementById('nb-reply-for').textContent = t('rf_for', { t: `${d.leader_name}: ${d.title}` });
  }

  // ── Map: demands with a pin, and the pin picker in the form ──────────
  const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
  let mapLib = null, boardMap = null, boardMarkers = [], pickMap = null, pickMarker = null;
  function loadMapLib(){
    if (window.maplibregl) return Promise.resolve();
    return mapLib ||= new Promise((resolve, reject) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet'; css.href = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css';
      document.head.appendChild(css);
      const sc = document.createElement('script');
      sc.src = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js';
      sc.onload = resolve; sc.onerror = () => { mapLib = null; reject(new Error('map')); };
      document.head.appendChild(sc);
    });
  }
  const center = () => place.at || CITY.mapCenter || [86.3654, 23.3320];
  const zoom = () => place.slug === 'purulia' ? CITY.mapZoom || 12 : 10;

  async function renderMap(){
    const note = document.getElementById('nb-map-note');
    const pins = state.demands.filter(d => d.lat != null && d.lng != null &&
      (!state.role || d.leader_role === state.role) && (!state.leader || norm(d.leader_name) === norm(state.leader)));
    note.textContent = pins.length ? '' : t('map_none');
    try { await loadMapLib(); } catch (e){ note.textContent = t('map_err'); return; }
    if (!boardMap){
      boardMap = new maplibregl.Map({ container: 'nb-map', style: MAP_STYLE, center: center(), zoom: zoom(), attributionControl: { compact: true } });
      boardMap.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    }
    boardMarkers.forEach(m => m.remove());
    boardMarkers = pins.map(d => new maplibregl.Marker({ color: '#d4882a' }).setLngLat([d.lng, d.lat])
      .setPopup(new maplibregl.Popup({ offset: 24 }).setHTML(`<strong>${esc(d.title)}</strong><br>${esc(t('to'))}: ${esc(d.leader_name)}<br>
        ${esc(t('supports', { n: d.supports || 0 }))}<br><a href="#d-${esc(d.id)}" data-goto="${esc(d.id)}">${esc(t('view_list'))} →</a>`))
      .addTo(boardMap));
    if (pins.length > 1){
      const b = new maplibregl.LngLatBounds();
      pins.forEach(d => b.extend([d.lng, d.lat]));
      boardMap.fitBounds(b, { padding: 50, maxZoom: 15, duration: 0 });
    } else if (pins.length) boardMap.jumpTo({ center: [pins[0].lng, pins[0].lat], zoom: 15 });
    boardMap.resize();
  }

  function setView(v){
    state.view = v;
    document.querySelectorAll('#nb-views .pr-chip').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
    document.getElementById('nb-list').hidden = v !== 'list';
    document.getElementById('nb-map-wrap').hidden = v !== 'map';
    if (v === 'map') renderMap();
  }

  function setPin(lng, lat){
    state.pin = lat == null ? null : { lat: +lat.toFixed(6), lng: +lng.toFixed(6) };
    document.getElementById('nb-pin-clear').hidden = !state.pin;
    document.getElementById('nb-pin-msg').textContent = state.pin ? `${t('f_pin_set')} ${state.pin.lat}, ${state.pin.lng}` : '';
    if (!pickMap) return;
    if (!state.pin){ if (pickMarker){ pickMarker.remove(); pickMarker = null; } return; }
    if (!pickMarker) pickMarker = new maplibregl.Marker({ color: '#d4882a', draggable: true }).setLngLat([state.pin.lng, state.pin.lat]).addTo(pickMap)
      .on('dragend', () => { const p = pickMarker.getLngLat(); setPin(p.lng, p.lat); });
    else pickMarker.setLngLat([state.pin.lng, state.pin.lat]);
  }

  async function openPicker(){
    const wrap = document.getElementById('nb-pick-wrap');
    wrap.hidden = false;
    if (!state.pin) document.getElementById('nb-pin-msg').textContent = t('f_pin_hint');
    try { await loadMapLib(); } catch (e){ document.getElementById('nb-pin-msg').textContent = t('map_err'); return; }
    if (!pickMap){
      pickMap = new maplibregl.Map({ container: 'nb-pick', style: MAP_STYLE, center: center(), zoom: zoom(), attributionControl: { compact: true } });
      pickMap.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
      pickMap.on('click', e => setPin(e.lngLat.lng, e.lngLat.lat));
    }
    pickMap.resize();
  }

  function renderAll(){
    applyStatic(); renderTiles(); renderLeaderSelect(); renderLeaders(); renderLeaderView(); renderList(); renderReplyForm();
    if (state.view === 'map') renderMap();
  }

  // The board follows the district chosen on the map (place-facts.js): its MPs and MLAs
  // (Wikipedia results), and only demands and promises about it.
  async function followPlace(){
    const PF = window.PlaceFacts;
    if (!PF) return null;
    await PF.load().catch(() => null);
    if (!PF.data) return null;
    const slug = PF.current(), D = PF.data.districts[slug];
    Object.assign(place, { slug, name: D.name, name_bn: D.name_bn || '' });
    if (slug !== 'purulia'){
      const [reps, bodies] = await Promise.all([PF.reps(slug), PF.bodies(slug)]);
      LEADERS = reps.map(r => ({ key: r.key, role: r.role, name: r.name, area: r.role === 'mp' ? `${r.seat} (Lok Sabha)` : r.seat, group: 'g_' + r.role }));
      const hq = bodies.find(b => b.name === D.hq) || bodies[0];
      place.at = hq && hq.at;
    }
    const about = await PF.textFilter(slug);
    const mine = new Set(LEADERS.map(l => norm(l.name)));
    return {
      demand: d => mine.has(norm(d.leader_name)) || about([d.place, d.leader_area].filter(Boolean).join(' ')),
      promise: p => { const x = [p.area, p.role].filter(Boolean).join(' '); return PF.statewide(x) || mine.has(norm(p.who)) || about(x); }
    };
  }

  async function load(){
    try {
      const [d, p, keep] = await Promise.all([rpc('kasa_demands'), rpc('kasa_promises').catch(() => null), followPlace().catch(() => null)]);
      state.demands = (d || []).filter(keep ? keep.demand : () => true);
      state.promises = ((p && p.promises) || []).filter(keep ? keep.promise : () => true);
      state.loaded = true;
    } catch (e){ state.failed = true; }
    renderAll();
    loadMine();
    if (location.hash.startsWith('#d-')){ const el = document.getElementById(location.hash.slice(1)); if (el) el.scrollIntoView(); }
  }

  // A visitor who already has a session sees their own +1s on any device they use it on.
  async function loadMine(){
    try {
      const c = client();
      if (!c) return;
      const { data: { session } } = await c.auth.getSession();
      if (!session) return;
      const { data } = await c.rpc('kasa_my_demand_supports');
      if (Array.isArray(data)){ data.forEach(id => supported.add(String(id))); saveSupported(); renderList(); }
    } catch (e) {}
  }

  async function loadWards(){
    try {
      const res = await fetch(`${URL_}/rest/v1/wards?select=ward_no,councillor_name&order=ward_no`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
      if (res.ok){ state.wards = await res.json(); renderLeaderSelect(); }
    } catch (e) {}
  }

  document.querySelectorAll('.pr-lang button').forEach(b => b.addEventListener('click', () => {
    lang = b.dataset.lang;
    store.set('kasa_lang', lang);
    renderAll();
  }));
  document.getElementById('nb-q').addEventListener('input', e => { state.q = e.target.value; renderList(); });
  document.getElementById('nb-sort').addEventListener('change', e => { state.sort = e.target.value; renderList(); });
  document.querySelectorAll('#nb-role-chips .pr-chip').forEach(b => b.addEventListener('click', () => {
    state.role = b.dataset.role;
    document.querySelectorAll('#nb-role-chips .pr-chip').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    renderList();
  }));
  document.getElementById('nb-leader').addEventListener('change', toggleLeaderFields);
  document.querySelectorAll('#nb-views .pr-chip').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
  document.getElementById('nb-map').addEventListener('click', e => {
    const g = e.target.closest('[data-goto]');
    if (!g) return;
    e.preventDefault();
    setView('list');
    const el = document.getElementById('d-' + g.dataset.goto);
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  });
  document.getElementById('nb-pin-add').addEventListener('click', openPicker);
  document.getElementById('nb-pin-clear').addEventListener('click', () => setPin(null, null));
  document.getElementById('nb-pin-me').addEventListener('click', () => {
    if (!navigator.geolocation){ document.getElementById('nb-pin-msg').textContent = t('f_pin_geo_err'); return; }
    navigator.geolocation.getCurrentPosition(async pos => {
      await openPicker();
      setPin(pos.coords.longitude, pos.coords.latitude);
      if (pickMap) pickMap.jumpTo({ center: [state.pin.lng, state.pin.lat], zoom: 16 });
    }, () => { document.getElementById('nb-pin-msg').textContent = t('f_pin_geo_err'); }, { enableHighAccuracy: true, timeout: 15000 });
  });

  document.getElementById('nb-list').addEventListener('click', async e => {
    const sup = e.target.closest('[data-support]');
    const shr = e.target.closest('[data-share]');
    const rep = e.target.closest('[data-reply]');
    if (sup){
      const id = sup.dataset.support;
      sup.disabled = true;
      try {
        const c = await ensureSession();
        const { data: r, error } = await c.rpc('kasa_demand_support', { p_id: id });
        if (error) throw new Error(error.details || error.message);
        const d = state.demands.find(x => x.id === id);
        if (d && r && typeof r.supports === 'number') d.supports = r.supports;
        supported.add(id); saveSupported();
        renderTiles(); renderList();
      } catch (err){ sup.disabled = false; alert(err.message); }
    } else if (shr){
      const d = state.demands.find(x => x.id === shr.dataset.share);
      if (!d) return;
      const url = location.href.split('#')[0] + '#d-' + d.id;
      const text = t('share_text', { w: d.leader_name, t: d.title });
      if (navigator.share) navigator.share({ title: d.title, text, url }).catch(() => {});
      else window.open('https://wa.me/?text=' + encodeURIComponent(text + ' ' + url), '_blank', 'noopener');
    } else if (rep){
      state.replyTo = rep.dataset.reply;
      renderReplyForm();
      document.getElementById('nb-reply-sec').scrollIntoView({ behavior: 'smooth' });
    }
  });

  document.getElementById('nb-reply-cancel').addEventListener('click', () => { state.replyTo = null; renderReplyForm(); });

  const isUrl = (u) => /^https?:\/\/\S+$/i.test(u);

  document.getElementById('nb-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target, msg = document.getElementById('nb-msg'), btn = document.getElementById('nb-submit');
    const v = (n) => (f[n].value || '').trim();
    const fail = (k) => { msg.className = 'pr-msg err'; msg.textContent = t(k); };
    const key = v('leader');
    let role, name, area;
    if (!key) return fail('e_leader');
    if (key === 'councillor'){
      const w = state.wards.find(x => String(x.ward_no) === v('ward'));
      if (!v('ward')) return fail('e_ward');
      role = 'councillor'; name = (w && w.councillor_name) || T.en.ward_councillor.replace('{n}', v('ward')); area = 'Ward ' + v('ward');
    } else if (key === 'other'){
      if (v('other_name').length < 2 || !v('other_role')) return fail('e_other');
      role = 'other'; name = v('other_name'); area = v('other_role');
    } else {
      const l = LEADERS.find(x => x.key === key);
      if (!l) return fail('e_leader');
      role = l.role; name = l.name; area = l.area;
    }
    if (v('title').length < 10) return fail('e_title');
    if (v('details').length < 30) return fail('e_details');
    if (!f.community.checked) return fail('e_community');
    btn.disabled = true; btn.textContent = t('f_sending'); msg.className = 'pr-msg'; msg.textContent = '';
    try {
      await rpc('kasa_demand_submit', {
        p_leader_role: role, p_leader_name: name, p_leader_area: area, p_title: v('title'), p_details: v('details'),
        p_place: [v('place'), place.slug === 'purulia' ? '' : place.name].filter(Boolean).join(', ') || null, p_for_community: true, p_note: v('note') || null,
        p_lat: state.pin ? state.pin.lat : null, p_lng: state.pin ? state.pin.lng : null
      });
      f.reset(); toggleLeaderFields(); setPin(null, null); document.getElementById('nb-pick-wrap').hidden = true;
      msg.textContent = t('f_thanks');
    } catch (err){
      msg.className = 'pr-msg err'; msg.textContent = err.message;
    } finally {
      btn.disabled = false; btn.textContent = t('f_submit');
    }
  });

  document.getElementById('nb-reply-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target, msg = document.getElementById('nb-reply-msg'), btn = document.getElementById('nb-reply-submit');
    const v = (n) => (f[n].value || '').trim();
    const fail = (k) => { msg.className = 'pr-msg err'; msg.textContent = t(k); };
    if (v('reply').length < 10) return fail('e_reply');
    if (!v('said_on')) return fail('e_date');
    if (!isUrl(v('source_url'))) return fail('e_url');
    btn.disabled = true; msg.className = 'pr-msg'; msg.textContent = '';
    try {
      await rpc('kasa_demand_reply_suggest', {
        p_demand: state.replyTo, p_reply: v('reply'), p_said_on: v('said_on'), p_source_url: v('source_url'), p_source_name: v('source_name') || null
      });
      f.reset();
      msg.textContent = t('f_thanks');
    } catch (err){
      msg.className = 'pr-msg err'; msg.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });

  applyStatic();
  renderLeaderSelect();
  if (!URL_ || !KEY){ state.failed = true; renderAll(); } else { load(); loadWards(); }
})();
