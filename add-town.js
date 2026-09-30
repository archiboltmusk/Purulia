/* Put your town on the map (add-town.html).
 *
 * Anyone can send a West Bengal town's ward map, uploaded as GeoJSON or drawn
 * on the map, with who is in charge of cleaning there and where that was found.
 * It goes to kasa_submit_place and waits for a moderator (admin.html).
 * ?fix=<slug> sends corrected wards for a town already on the map;
 * ?district=<name> preselects the district.
 */
(() => {
  const cfg = window.KASA_CONFIG || {};
  const API = cfg.SUPABASE_URL + '/rest/v1/';
  const HEAD = { apikey: cfg.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + cfg.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' };
  const WB = { min_lat: 21.4, max_lat: 27.4, min_lng: 85.7, max_lng: 90.0 };
  const DRAWN_SOURCE = 'Drawn on Parishkar by a resident';
  const $ = id => document.getElementById(id);

  const T = {
    en: {
      title: 'Put your town <em>on the map</em>',
      title_fix: 'Fix <em>{town}</em>’s ward borders',
      sub: 'Any town or panchayat in West Bengal can have its own Parishkar map, like Parishkar Kolkata. Reports there then go to the right ward and the right office.',
      sub_fix: 'Upload or draw only the wards whose borders are wrong. The rest of {town} stays as it is. A moderator checks the fix first.',
      step1: 'Say which town it is and who is in charge of cleaning there first, and where you found that.',
      step2: 'Upload its ward map (a GeoJSON file), or draw the wards on the map below. A rough drawing is fine; borders can be fixed later.',
      step3: 'A moderator checks it before it goes live. Drawn borders are marked as drawn by residents and provisional.',
      f_town: 'Town or panchayat', ph_town: 'e.g. Bankura', f_district: 'District', f_body: 'Local body', ph_body: 'e.g. Bankura Municipality',
      t_muni: 'Municipality or corporation', t_gp: 'Gram panchayat',
      f_incharge: 'Who is in charge of cleaning first', h_incharge: 'The office or officer, with a phone number, email or complaint page if there is one.',
      ph_incharge: 'e.g. Sanitary Inspector, Bankura Municipality, 03242-xxxxxx',
      ph_incharge_src: 'Where you found it (a link, or e.g. the notice board at the municipality office)',
      f_complaint: 'Its own complaint page (optional)', map_title: 'The ward map',
      m_upload: 'Upload a GeoJSON file', m_draw: 'Draw on the map',
      h_upload: 'One outline per ward, each with its ward number in a "ward" property. Other names like WARD or ward_no also work.',
      h_draw: 'Type a ward number, tap "Start ward", then tap around its border on the map. Tap "Finish ward" when you are back where you started.',
      ph_wardno: 'Ward no.', b_start: 'Start ward', b_undo: 'Undo point', b_finish: 'Finish ward',
      f_source: 'Where the ward map comes from', h_source: 'A link, or what you traced it from (e.g. the ward map on the municipality’s notice board).',
      f_contact: 'Your phone or email (optional, private)', h_contact: 'Only so a moderator can ask you about the map. Never shown.',
      send: 'Send for review', sending: 'Sending…',
      review: 'Nothing goes on the map until a moderator checks it. If a border is disputed, anyone can send a fix for just those wards.',
      f_map: 'Report map', f_privacy: 'Privacy', f_grievance: 'Grievance Officer',
      s_wards: '{n} wards ready: tap one to remove it.', s_none: 'No wards yet.', s_drawing: 'Ward {n}: {p} points. Tap the map to add more.',
      s_existing: 'Borders now on the map are shown dashed.',
      e_file: 'That file could not be read as GeoJSON.', e_noward: '{n} outlines have no ward number. Add a "ward" property to each.',
      e_nopoly: 'The file has no ward outlines (polygons).', e_outside: 'Some points are outside West Bengal. Check the file.',
      e_dup: 'Ward {n} is there twice.', simplified: 'The map was very detailed, so it was simplified from {a} to {b} points. Check the outlines, then send.', e_wardno: 'Type a ward number first (1 to 500).', e_points: 'A ward needs at least 3 points.',
      e_town: 'Give the town’s name.', e_district: 'Choose the district.', e_body: 'Name the municipality or panchayat.',
      e_src_incharge: 'Say where you found who is in charge of cleaning.', e_https: 'The complaint link must start with https://',
      e_nomap: 'Upload or draw at least one ward.', e_source: 'Say where the ward map comes from.', e_send: 'Could not send. Please try again.',
      done: 'Thank you. A moderator will check it; once approved, reports there go to the right ward.'
    },
    bn: {
      title: 'আপনার শহর <em>মানচিত্রে তুলুন</em>',
      title_fix: '<em>{town}</em>-এর ওয়ার্ড সীমানা ঠিক করুন',
      sub: 'পশ্চিমবঙ্গের যে কোনো শহর বা পঞ্চায়েতের নিজের পরিষ্কার মানচিত্র হতে পারে, যেমন পরিষ্কার কলকাতা। তখন সেখানকার রিপোর্ট ঠিক ওয়ার্ড আর ঠিক অফিসে যায়।',
      sub_fix: 'শুধু যে ওয়ার্ডগুলোর সীমানা ভুল সেগুলো আপলোড করুন বা আঁকুন। {town}-এর বাকিটা যেমন আছে থাকবে। আগে একজন মডারেটর দেখে নেবেন।',
      step1: 'শহরের নাম, সেখানে পরিষ্কারের প্রথম দায়িত্বে কে, আর সেটা কোথায় পেলেন তা লিখুন।',
      step2: 'ওয়ার্ড মানচিত্র (GeoJSON ফাইল) আপলোড করুন, বা নিচের মানচিত্রে ওয়ার্ড আঁকুন। মোটামুটি আঁকলেই হবে; সীমানা পরে ঠিক করা যায়।',
      step3: 'চালু হওয়ার আগে একজন মডারেটর দেখে নেন। আঁকা সীমানা "বাসিন্দাদের আঁকা, অস্থায়ী" বলে চিহ্নিত থাকে।',
      f_town: 'শহর বা পঞ্চায়েত', f_district: 'জেলা', f_body: 'স্থানীয় সংস্থা', t_muni: 'পৌরসভা বা কর্পোরেশন', t_gp: 'গ্রাম পঞ্চায়েত',
      f_incharge: 'পরিষ্কারের প্রথম দায়িত্বে কে', h_incharge: 'অফিস বা আধিকারিক, ফোন নম্বর, ইমেল বা অভিযোগের পাতা থাকলে সেটাও।',
      ph_incharge_src: 'কোথায় পেলেন (লিংক, বা যেমন পৌরসভার নোটিস বোর্ড)',
      f_complaint: 'তাদের নিজের অভিযোগের পাতা (ঐচ্ছিক)', map_title: 'ওয়ার্ড মানচিত্র',
      m_upload: 'GeoJSON ফাইল আপলোড', m_draw: 'মানচিত্রে আঁকুন',
      h_upload: 'প্রতিটি ওয়ার্ডের একটি সীমারেখা, "ward" প্রপার্টিতে ওয়ার্ড নম্বর সহ। WARD বা ward_no নামও চলবে।',
      h_draw: 'ওয়ার্ড নম্বর লিখে "ওয়ার্ড শুরু" চাপুন, তারপর মানচিত্রে তার সীমানা ধরে ট্যাপ করুন। শুরুর জায়গায় ফিরে "ওয়ার্ড শেষ" চাপুন।',
      ph_wardno: 'ওয়ার্ড নং', b_start: 'ওয়ার্ড শুরু', b_undo: 'বিন্দু মুছুন', b_finish: 'ওয়ার্ড শেষ',
      f_source: 'ওয়ার্ড মানচিত্র কোথা থেকে', h_source: 'লিংক, বা কী দেখে এঁকেছেন (যেমন পৌরসভার নোটিস বোর্ডের ওয়ার্ড মানচিত্র)।',
      f_contact: 'আপনার ফোন বা ইমেল (ঐচ্ছিক, গোপন)', h_contact: 'শুধু মানচিত্র নিয়ে মডারেটর যাতে জিজ্ঞেস করতে পারেন। কখনও দেখানো হয় না।',
      send: 'পর্যালোচনার জন্য পাঠান', sending: 'পাঠানো হচ্ছে…',
      review: 'মডারেটর না দেখা পর্যন্ত কিছুই মানচিত্রে ওঠে না। সীমানা নিয়ে বিবাদ হলে যে কেউ শুধু সেই ওয়ার্ডগুলোর সংশোধন পাঠাতে পারেন।',
      f_map: 'রিপোর্ট মানচিত্র', f_privacy: 'গোপনীয়তা', f_grievance: 'অভিযোগ আধিকারিক',
      s_wards: '{n}টি ওয়ার্ড তৈরি: সরাতে ট্যাপ করুন।', s_none: 'এখনও কোনো ওয়ার্ড নেই।', s_drawing: 'ওয়ার্ড {n}: {p}টি বিন্দু। আরও যোগ করতে মানচিত্রে ট্যাপ করুন।',
      s_existing: 'এখন মানচিত্রে থাকা সীমানা ড্যাশ দিয়ে দেখানো।',
      e_file: 'ফাইলটি GeoJSON হিসেবে পড়া গেল না।', e_noward: '{n}টি সীমারেখায় ওয়ার্ড নম্বর নেই। প্রতিটিতে "ward" প্রপার্টি দিন।',
      e_nopoly: 'ফাইলে কোনো ওয়ার্ডের সীমারেখা (পলিগন) নেই।', e_outside: 'কিছু বিন্দু পশ্চিমবঙ্গের বাইরে। ফাইলটি দেখুন।',
      e_dup: 'ওয়ার্ড {n} দুবার আছে।', simplified: 'মানচিত্রটি খুব বিস্তারিত ছিল, তাই {a} থেকে {b} বিন্দুতে সরল করা হয়েছে। সীমারেখা দেখে পাঠান।', e_wardno: 'আগে ওয়ার্ড নম্বর লিখুন (১ থেকে ৫০০)।', e_points: 'একটি ওয়ার্ডে অন্তত ৩টি বিন্দু লাগে।',
      e_town: 'শহরের নাম দিন।', e_district: 'জেলা বেছে নিন।', e_body: 'পৌরসভা বা পঞ্চায়েতের নাম দিন।',
      e_src_incharge: 'পরিষ্কারের দায়িত্বে কে, তা কোথায় পেলেন লিখুন।', e_https: 'অভিযোগের লিংক https:// দিয়ে শুরু হতে হবে',
      e_nomap: 'অন্তত একটি ওয়ার্ড আপলোড করুন বা আঁকুন।', e_source: 'ওয়ার্ড মানচিত্র কোথা থেকে, লিখুন।', e_send: 'পাঠানো গেল না। আবার চেষ্টা করুন।',
      done: 'ধন্যবাদ। একজন মডারেটর দেখবেন; অনুমোদনের পর সেখানকার রিপোর্ট ঠিক ওয়ার্ডে যাবে।'
    },
    hi: {
      title: 'अपना शहर <em>नक्शे पर लाएँ</em>',
      title_fix: '<em>{town}</em> की वार्ड सीमाएँ ठीक करें',
      sub: 'पश्चिम बंगाल का कोई भी शहर या पंचायत अपना परिष्कार नक्शा पा सकता है, जैसे परिष्कार कोलकाता। तब वहाँ की रिपोर्ट सही वार्ड और सही दफ़्तर तक जाती है।',
      sub_fix: 'सिर्फ़ वे वार्ड अपलोड करें या बनाएँ जिनकी सीमा ग़लत है। {town} का बाक़ी हिस्सा वैसा ही रहेगा। पहले एक मॉडरेटर जाँचेगा।',
      step1: 'शहर का नाम, वहाँ सफ़ाई का पहला ज़िम्मा किसके पास है, और यह आपको कहाँ मिला, लिखें।',
      step2: 'वार्ड नक्शा (GeoJSON फ़ाइल) अपलोड करें, या नीचे नक्शे पर वार्ड बनाएँ। मोटा-मोटा बनाना भी ठीक है; सीमाएँ बाद में सुधारी जा सकती हैं।',
      step3: 'चालू होने से पहले एक मॉडरेटर जाँचता है। बनाई गई सीमाएँ "निवासियों की बनाई, अस्थायी" के रूप में दिखती हैं।',
      f_town: 'शहर या पंचायत', f_district: 'ज़िला', f_body: 'स्थानीय निकाय', t_muni: 'नगरपालिका या निगम', t_gp: 'ग्राम पंचायत',
      f_incharge: 'सफ़ाई का पहला ज़िम्मा किसके पास', h_incharge: 'दफ़्तर या अधिकारी, फ़ोन नंबर, ईमेल या शिकायत पेज हो तो वह भी।',
      ph_incharge_src: 'कहाँ मिला (लिंक, या जैसे नगरपालिका का नोटिस बोर्ड)',
      f_complaint: 'उनका अपना शिकायत पेज (वैकल्पिक)', map_title: 'वार्ड नक्शा',
      m_upload: 'GeoJSON फ़ाइल अपलोड करें', m_draw: 'नक्शे पर बनाएँ',
      h_upload: 'हर वार्ड की एक रूपरेखा, "ward" प्रॉपर्टी में वार्ड नंबर के साथ। WARD या ward_no नाम भी चलेंगे।',
      h_draw: 'वार्ड नंबर लिखकर "वार्ड शुरू" दबाएँ, फिर नक्शे पर उसकी सीमा के साथ टैप करें। शुरुआत की जगह लौटकर "वार्ड पूरा" दबाएँ।',
      ph_wardno: 'वार्ड नं.', b_start: 'वार्ड शुरू', b_undo: 'बिंदु हटाएँ', b_finish: 'वार्ड पूरा',
      f_source: 'वार्ड नक्शा कहाँ से है', h_source: 'लिंक, या किस चीज़ से बनाया (जैसे नगरपालिका के नोटिस बोर्ड का वार्ड नक्शा)।',
      f_contact: 'आपका फ़ोन या ईमेल (वैकल्पिक, निजी)', h_contact: 'सिर्फ़ इसलिए कि मॉडरेटर नक्शे के बारे में पूछ सके। कभी नहीं दिखाया जाता।',
      send: 'जाँच के लिए भेजें', sending: 'भेजा जा रहा है…',
      review: 'मॉडरेटर के जाँचने तक कुछ भी नक्शे पर नहीं आता। सीमा पर विवाद हो तो कोई भी सिर्फ़ उन वार्डों का सुधार भेज सकता है।',
      f_map: 'रिपोर्ट नक्शा', f_privacy: 'गोपनीयता', f_grievance: 'शिकायत अधिकारी',
      s_wards: '{n} वार्ड तैयार: हटाने के लिए टैप करें।', s_none: 'अभी कोई वार्ड नहीं।', s_drawing: 'वार्ड {n}: {p} बिंदु। और जोड़ने के लिए नक्शे पर टैप करें।',
      s_existing: 'अभी नक्शे पर मौजूद सीमाएँ डैश से दिखाई गई हैं।',
      e_file: 'यह फ़ाइल GeoJSON के रूप में पढ़ी नहीं जा सकी।', e_noward: '{n} रूपरेखाओं में वार्ड नंबर नहीं है। हर एक में "ward" प्रॉपर्टी जोड़ें।',
      e_nopoly: 'फ़ाइल में कोई वार्ड रूपरेखा (पॉलीगॉन) नहीं है।', e_outside: 'कुछ बिंदु पश्चिम बंगाल से बाहर हैं। फ़ाइल जाँचें।',
      e_dup: 'वार्ड {n} दो बार है।', simplified: 'नक्शा बहुत विस्तृत था, इसलिए इसे {a} से {b} बिंदुओं में सरल किया गया। रूपरेखा जाँचें, फिर भेजें।', e_wardno: 'पहले वार्ड नंबर लिखें (1 से 500)।', e_points: 'एक वार्ड में कम से कम 3 बिंदु चाहिए।',
      e_town: 'शहर का नाम लिखें।', e_district: 'ज़िला चुनें।', e_body: 'नगरपालिका या पंचायत का नाम लिखें।',
      e_src_incharge: 'सफ़ाई का ज़िम्मा किसके पास है, यह कहाँ मिला, लिखें।', e_https: 'शिकायत लिंक https:// से शुरू होना चाहिए',
      e_nomap: 'कम से कम एक वार्ड अपलोड करें या बनाएँ।', e_source: 'वार्ड नक्शा कहाँ से है, लिखें।', e_send: 'भेजा नहीं जा सका। फिर कोशिश करें।',
      done: 'धन्यवाद। एक मॉडरेटर इसे जाँचेगा; मंज़ूरी के बाद वहाँ की रिपोर्ट सही वार्ड में जाएगी।'
    }
  };
  let lang = 'en';
  try { lang = localStorage.getItem('kasa_lang') || 'en'; } catch (e) {}
  if (!T[lang]) lang = 'en';
  const t = (k, v) => {
    let s = (T[lang] && T[lang][k]) || T.en[k] || k;
    for (const [a, b] of Object.entries(v || {})) s = s.split('{' + a + '}').join(b);
    return s;
  };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const params = new URLSearchParams(location.search);
  const state = {
    wards: new Map(),     // ward number -> { geometry, drawn }
    drawing: null,        // { ward, points: [[lng, lat]…] } while drawing
    mode: 'upload',
    fix: null,            // the town being fixed, from kasa_places
    districts: null
  };

  function applyLang(){
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-t]').forEach(el => { el.textContent = t(el.dataset.t); });
    document.querySelectorAll('[data-t-html]').forEach(el => { el.innerHTML = t(el.dataset.tHtml); });
    document.querySelectorAll('[data-t-ph]').forEach(el => { el.placeholder = t(el.dataset.tPh); });
    $('at-incharge-src').placeholder = t('ph_incharge_src');
    document.querySelectorAll('.at-lang button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
    if (state.fix){
      $('at-title').innerHTML = t('title_fix', { town: esc(state.fix.name) });
      $('at-sub').textContent = t('sub_fix', { town: state.fix.name });
    }
    renderWards();
  }
  document.querySelectorAll('.at-lang button').forEach(b => b.addEventListener('click', () => {
    lang = b.dataset.lang;
    try { localStorage.setItem('kasa_lang', lang); } catch (e) {}
    applyLang();
  }));

  // ── District list ──
  const districtSel = $('at-district');
  Object.values(window.KASA_DISTRICTS || {}).sort().forEach(name => districtSel.add(new Option(name, name)));
  if (params.get('district') && [...districtSel.options].some(o => o.value === params.get('district'))) districtSel.value = params.get('district');

  // ── The map ──
  const map = window.maplibregl ? new maplibregl.Map({
    container: 'at-map', style: 'https://tiles.openfreemap.org/styles/dark', center: [87.9, 23.6], zoom: 6.2,
    attributionControl: { compact: true }
  }) : null;
  const mapReady = new Promise(res => { if (!map) return; map.on('load', res); });
  if (map){
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true } }), 'bottom-right');
  }
  mapReady.then(() => {
    map.addSource('existing', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'existing-line', type: 'line', source: 'existing', paint: { 'line-color': '#9aa0a6', 'line-width': 1, 'line-dasharray': [3, 2] } });
    map.addLayer({ id: 'existing-label', type: 'symbol', source: 'existing', minzoom: 12,
      layout: { 'text-field': ['to-string', ['get', 'ward']], 'text-size': 11, 'text-font': ['Noto Sans Regular'] },
      paint: { 'text-color': '#9aa0a6', 'text-halo-color': '#0a0805', 'text-halo-width': 1 } });
    map.addSource('wards', { type: 'geojson', data: wardsFC() });
    map.addLayer({ id: 'wards-fill', type: 'fill', source: 'wards', paint: { 'fill-color': '#d4882a', 'fill-opacity': .15 } });
    map.addLayer({ id: 'wards-line', type: 'line', source: 'wards', paint: { 'line-color': '#d4882a', 'line-width': 2 } });
    map.addLayer({ id: 'wards-label', type: 'symbol', source: 'wards',
      layout: { 'text-field': ['to-string', ['get', 'ward']], 'text-size': 13, 'text-font': ['Noto Sans Regular'] },
      paint: { 'text-color': '#f0e6d0', 'text-halo-color': '#0a0805', 'text-halo-width': 1 } });
    map.addSource('sketch', { type: 'geojson', data: sketchFC() });
    map.addLayer({ id: 'sketch-line', type: 'line', source: 'sketch', paint: { 'line-color': '#e8a34a', 'line-width': 2, 'line-dasharray': [2, 1] } });
    map.addLayer({ id: 'sketch-pts', type: 'circle', source: 'sketch', filter: ['==', ['geometry-type'], 'Point'],
      paint: { 'circle-radius': 4, 'circle-color': '#e8a34a' } });
    map.on('click', e => {
      if (!state.drawing) return;
      state.drawing.points.push([+e.lngLat.lng.toFixed(6), +e.lngLat.lat.toFixed(6)]);
      redraw();
    });
    zoomToDistrict();
  });

  function wardsFC(){
    return { type: 'FeatureCollection', features: [...state.wards].map(([ward, w]) => ({ type: 'Feature', properties: { ward }, geometry: w.geometry })) };
  }
  function sketchFC(){
    const pts = state.drawing?.points || [];
    return { type: 'FeatureCollection', features: [
      ...(pts.length > 1 ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts } }] : []),
      ...pts.map(p => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: p } }))
    ] };
  }
  function redraw(){
    if (map?.getSource('wards')){ map.getSource('wards').setData(wardsFC()); map.getSource('sketch').setData(sketchFC()); }
    $('at-undo').disabled = !state.drawing?.points.length;
    $('at-finish').disabled = !state.drawing;
    $('at-map').classList.toggle('drawing', !!state.drawing);
    renderWards();
  }
  function renderWards(){
    const list = [...state.wards.keys()].sort((a, b) => a - b);
    $('at-wards').innerHTML = list.map(n => `<button type="button" data-ward="${n}">${n} ✕</button>`).join('');
    $('at-status').textContent = state.drawing ? t('s_drawing', { n: state.drawing.ward, p: state.drawing.points.length })
      : (list.length ? t('s_wards', { n: list.length }) : t('s_none')) + (state.fix ? ' ' + t('s_existing') : '');
  }
  $('at-wards').addEventListener('click', e => {
    const b = e.target.closest('[data-ward]');
    if (!b) return;
    state.wards.delete(Number(b.dataset.ward));
    redraw();
  });

  function fitTo(coords){
    if (!map || !coords.length) return;
    let [x0, y0, x1, y1] = [180, 90, -180, -90];
    for (const [x, y] of coords){ x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    map.fitBounds([[x0, y0], [x1, y1]], { padding: 30, duration: 600, maxZoom: 14 });
  }
  const allPoints = g => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).flat(2);

  async function zoomToDistrict(){
    const name = districtSel.value;
    if (!name || !map || state.wards.size || state.fix) return;
    if (!state.districts){
      try { state.districts = await (await fetch('places/wb_districts.geojson')).json(); } catch (e) { return; }
    }
    const f = state.districts.features.find(f => f.properties.district === name);
    if (f) fitTo(allPoints(f.geometry));
  }
  districtSel.addEventListener('change', () => mapReady.then(zoomToDistrict));

  // ── Mode ──
  document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => {
    state.mode = b.dataset.mode;
    document.querySelectorAll('[data-mode]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    $('at-upload').hidden = state.mode !== 'upload';
    $('at-draw').hidden = state.mode !== 'draw';
    if (state.mode === 'draw' && !$('at-source').value.trim()) $('at-source').value = DRAWN_SOURCE;
  }));

  // ── Upload ──
  const inWB = ([x, y]) => typeof x === 'number' && typeof y === 'number'
    && y >= WB.min_lat && y <= WB.max_lat && x >= WB.min_lng && x <= WB.max_lng;
  const wardOf = p => {
    const v = p && (p.ward ?? p.ward_no ?? p.WARD ?? p.Ward ?? p.WARD_NO ?? p.Ward_No);
    const n = Number(String(v ?? '').trim());
    return /^\d{1,3}$/.test(String(v ?? '').trim()) && n >= 1 && n <= 500 ? n : null;
  };
  /* Reads a FeatureCollection, a Feature or a bare geometry into { ward: geometry }, or throws a message. */
  function readGeojson(j){
    const feats = j?.type === 'FeatureCollection' ? j.features : j?.type === 'Feature' ? [j] : j?.type ? [{ geometry: j, properties: {} }] : null;
    if (!Array.isArray(feats)) throw t('e_file');
    const polys = feats.filter(f => f?.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'));
    if (!polys.length) throw t('e_nopoly');
    const missing = polys.filter(f => wardOf(f.properties) == null).length;
    if (missing) throw t('e_noward', { n: missing });
    const out = new Map();
    for (const f of polys){
      const n = wardOf(f.properties);
      if (out.has(n)) throw t('e_dup', { n });
      if (!allPoints(f.geometry).every(inWB)) throw t('e_outside');
      out.set(n, { type: f.geometry.type, coordinates: f.geometry.coordinates });
    }
    return out;
  }
  /* The server takes at most 60,000 points per town. Detailed files (e.g. KMC's 141 wards, ~64k points) are
     thinned with Douglas-Peucker, raising the tolerance until they fit; rings that would collapse stay as they are. */
  const MAX_POINTS = 50000;
  const round6 = ([x, y]) => [Math.round(x * 1e6) / 1e6, Math.round(y * 1e6) / 1e6];
  function thinRing(ring, tol){
    const keep = new Uint8Array(ring.length); keep[0] = keep[ring.length - 1] = 1;
    const stack = [[0, ring.length - 1]];
    while (stack.length){
      const [a, b] = stack.pop();
      const [ax, ay] = ring[a], [bx, by] = ring[b], dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
      let far = -1, max = tol * tol;
      for (let i = a + 1; i < b; i++){
        const [px, py] = ring[i];
        let u = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
        u = Math.max(0, Math.min(1, u));
        const ex = px - ax - u * dx, ey = py - ay - u * dy, d2 = ex * ex + ey * ey;
        if (d2 > max){ max = d2; far = i; }
      }
      if (far > 0){ keep[far] = 1; stack.push([a, far], [far, b]); }
    }
    const out = ring.filter((_, i) => keep[i]);
    return out.length >= 4 ? out : ring;
  }
  const mapRings = (g, fn) => ({ type: g.type, coordinates: g.type === 'Polygon'
    ? g.coordinates.map(fn) : g.coordinates.map(p => p.map(fn)) });
  const countPoints = m => [...m.values()].reduce((s, g) => s + allPoints(g).length, 0);
  function fitPoints(wards){
    for (const [n, g] of wards) wards.set(n, mapRings(g, r => r.map(round6)));
    const before = countPoints(wards);
    if (before <= MAX_POINTS) return null;
    let thin = wards;
    for (let tol = 1e-6; countPoints(thin) > MAX_POINTS && tol < 0.01; tol *= 1.5){
      thin = new Map([...wards].map(([n, g]) => [n, mapRings(g, r => thinRing(r, tol))]));
    }
    for (const [n, g] of thin) wards.set(n, g);
    return { a: before, b: countPoints(wards) };
  }

  $('at-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    msg('', '');
    try {
      const got = readGeojson(JSON.parse(await file.text()));
      const thinned = fitPoints(got);
      for (const [n, g] of got) state.wards.set(n, { geometry: g, drawn: false });
      redraw();
      mapReady.then(() => fitTo([...got.values()].flatMap(allPoints)));
      if (thinned) msg(t('simplified', { a: thinned.a.toLocaleString(), b: thinned.b.toLocaleString() }), '');
    } catch (err) {
      msg(typeof err === 'string' ? err : t('e_file'), 'bad');
    }
  });

  // ── Draw ──
  $('at-start').addEventListener('click', () => {
    const n = Number($('at-wardno').value);
    if (!Number.isInteger(n) || n < 1 || n > 500) return msg(t('e_wardno'), 'bad');
    msg('', '');
    state.drawing = { ward: n, points: [] };
    map?.doubleClickZoom.disable();
    redraw();
  });
  $('at-undo').addEventListener('click', () => { state.drawing?.points.pop(); redraw(); });
  $('at-finish').addEventListener('click', () => {
    const d = state.drawing;
    if (!d) return;
    if (d.points.length < 3) return msg(t('e_points'), 'bad');
    if (!d.points.every(inWB)) return msg(t('e_outside'), 'bad');
    state.wards.set(d.ward, { geometry: { type: 'Polygon', coordinates: [[...d.points, d.points[0]]] }, drawn: true });
    state.drawing = null;
    map?.doubleClickZoom.enable();
    $('at-wardno').value = String(d.ward + 1);
    msg('', '');
    redraw();
  });

  // ── Fixing a town already on the map ──
  async function loadFix(slug){
    try {
      const places = await (await fetch(API + 'rpc/kasa_places', { method: 'POST', headers: HEAD, body: '{}' })).json();
      const p = Array.isArray(places) && places.find(x => x.slug === slug);
      if (!p) return;
      state.fix = p;
      $('at-town').value = p.name; $('at-town').readOnly = true;
      $('at-body').value = p.body; $('at-body').readOnly = true;
      if (p.district) districtSel.value = p.district;
      districtSel.disabled = true;
      document.querySelector(`[name="at-type"][value="${p.body_type}"]`)?.click();
      if (p.incharge) $('at-incharge').value = p.incharge;
      if (p.incharge_source) $('at-incharge-src').value = p.incharge_source;
      applyLang();
      const wards = await (await fetch(API + 'rpc/kasa_place_wards', { method: 'POST', headers: HEAD, body: JSON.stringify({ p_slug: slug }) })).json();
      await mapReady;
      if (wards?.features){
        map.getSource('existing').setData(wards);
        fitTo(wards.features.flatMap(f => allPoints(f.geometry)));
      }
    } catch (e) {}
  }
  if (params.get('fix')) loadFix(params.get('fix'));

  // ── Send ──
  const msgEl = $('at-msg');
  function msg(text, kind){ msgEl.className = 'at-msg' + (kind ? ' ' + kind : ''); msgEl.textContent = text; return false; }

  $('at-form').addEventListener('submit', async e => {
    e.preventDefault();
    const v = id => $(id).value.trim();
    if (!v('at-town')) return msg(t('e_town'), 'bad');
    if (!districtSel.value) return msg(t('e_district'), 'bad');
    if (!v('at-body')) return msg(t('e_body'), 'bad');
    if (v('at-incharge') && !v('at-incharge-src')) return msg(t('e_src_incharge'), 'bad');
    if (v('at-complaint') && !/^https:\/\/\S+$/i.test(v('at-complaint'))) return msg(t('e_https'), 'bad');
    if (state.drawing) $('at-finish').click();
    if (!state.wards.size) return msg(t('e_nomap'), 'bad');
    if (!v('at-source')) return msg(t('e_source'), 'bad');
    const btn = $('at-send');
    btn.disabled = true; msg(t('sending'), '');
    try {
      const res = await fetch(API + 'rpc/kasa_submit_place', {
        method: 'POST', headers: HEAD,
        body: JSON.stringify({
          p_town: v('at-town'), p_district: districtSel.value, p_body: v('at-body'),
          p_body_type: document.querySelector('[name="at-type"]:checked').value,
          p_incharge: v('at-incharge') || null, p_incharge_source: v('at-incharge-src') || null,
          p_complaint_url: v('at-complaint') || null, p_map_source: v('at-source'),
          p_drawn: [...state.wards.values()].some(w => w.drawn), p_fix_of: state.fix?.slug || null,
          p_geojson: wardsFC(), p_contact: v('at-contact') || null
        })
      });
      if (!res.ok){
        let detail = '';
        try { detail = (await res.json()).details || ''; } catch (e2) {}
        throw new Error(detail || t('e_send'));
      }
      state.wards.clear(); redraw();
      $('at-file').value = '';
      msg(t('done'), 'ok');
    } catch (err) {
      msg(err.message || t('e_send'), 'bad');
    } finally {
      btn.disabled = false;
    }
  });

  applyLang();
})();
