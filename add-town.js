/* Put your town on the map (add-town.html).
 *
 * Anyone can send a West Bengal town's ward map, uploaded as GeoJSON or drawn
 * on the map, with who is in charge of cleaning there and where that was found.
 * It goes to kasa_submit_place and waits for a moderator (admin.html).
 * ?fix=<slug> sends corrected wards for a town already on the map (tap a dashed ward to copy
 * and edit it), or just a note and a pinned spot for the moderator;
 * ?district=<name> preselects the district.
 * A JPG/PNG can be laid under the map to trace over (never uploaded); wards can be reshaped,
 * given a name and notes, and downloaded as GeoJSON.
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
      title_fix_area: 'Fix the border of <em>{town}</em>',
      sub_fix_area: 'Drag its corners to where the border really runs, or just say what is wrong and pin the spot. A moderator checks the fix first.',
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
      s_wards: '{n} wards ready: tap one to edit it.', s_none: 'No wards yet.', s_drawing: 'Ward {n}: {p} points. Tap the map to add more.',
      s_existing: 'Borders now on the map are shown dashed. Tap one to copy it here and edit it.',
      h_img: 'Have a photo or scan of the ward map? Put it under the map, drag its blue corners onto the same places on the map, then trace over it. The picture stays on your device.',
      b_img: 'Background picture (JPG or PNG)', a_opacity: 'Picture opacity', b_lock: 'Lock picture', b_unlock: 'Move picture', b_img_clear: 'Remove picture',
      e_img: 'That picture could not be opened. Use a JPG or PNG.',
      f_e_ward: 'Ward number', f_e_name: 'Ward name (optional)', f_e_note: 'Notes on this ward (optional)',
      ph_e_note: 'e.g. councillor’s office, landmarks on the border',
      b_shape: 'Edit shape', b_shape_done: 'Stop editing shape', b_delpt: 'Delete point', b_delward: 'Delete ward', b_done: 'Done',
      h_shape: 'Drag the white dots to move a corner. A corner shared with the next ward moves both, and dots snap onto nearby borders, so no gaps open. Drag a small orange dot to add a corner there. Tap a corner, then "Delete point" to remove it.',
      e_toomany: 'This ward has {n} corners, too many to edit by hand here. Edit it in a map app like QGIS and upload it.',
      e_taken: 'Ward {n} is already there.', e_minpts: 'A ward needs at least 3 corners.',
      b_export: 'Download GeoJSON',
      f_note: 'Note for the moderator (optional)', f_note_fix: 'What needs fixing (for the moderator)',
      h_note: 'What is wrong or what you changed. You can also pin the spot on the map.',
      b_pin: 'Pin a spot on the map', b_pin_cancel: 'Cancel pin', b_pin_clear: 'Remove pin',
      s_pin_tap: 'Tap the map where the problem is.', s_pinned: 'Pinned at {lat}, {lng}.',
      e_nofix: 'Draw or copy at least one ward, or say what needs fixing.',
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
      title_fix_area: '<em>{town}</em>-এর সীমানা ঠিক করুন',
      sub_fix_area: 'কোণগুলো টেনে আসল সীমানায় আনুন, বা শুধু কী ভুল লিখে জায়গাটা পিন করুন। আগে একজন মডারেটর দেখে নেবেন।',
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
      s_wards: '{n}টি ওয়ার্ড তৈরি: বদলাতে ট্যাপ করুন।', s_none: 'এখনও কোনো ওয়ার্ড নেই।', s_drawing: 'ওয়ার্ড {n}: {p}টি বিন্দু। আরও যোগ করতে মানচিত্রে ট্যাপ করুন।',
      s_existing: 'এখন মানচিত্রে থাকা সীমানা ড্যাশ দিয়ে দেখানো। বদলাতে কোনোটিতে ট্যাপ করে এখানে কপি করুন।',
      h_img: 'ওয়ার্ড মানচিত্রের ছবি বা স্ক্যান আছে? সেটা মানচিত্রের নিচে রাখুন, নীল কোণগুলো মানচিত্রের একই জায়গায় টেনে আনুন, তারপর তার ওপর আঁকুন। ছবিটি আপনার ফোনেই থাকে।',
      b_img: 'পেছনের ছবি (JPG বা PNG)', a_opacity: 'ছবির স্বচ্ছতা', b_lock: 'ছবি আটকে দিন', b_unlock: 'ছবি সরান', b_img_clear: 'ছবি মুছুন',
      e_img: 'ছবিটি খোলা গেল না। JPG বা PNG দিন।',
      f_e_ward: 'ওয়ার্ড নম্বর', f_e_name: 'ওয়ার্ডের নাম (ঐচ্ছিক)', f_e_note: 'এই ওয়ার্ড নিয়ে নোট (ঐচ্ছিক)',
      ph_e_note: 'যেমন কাউন্সিলরের অফিস, সীমানার চিহ্ন',
      b_shape: 'আকার বদলান', b_shape_done: 'আকার বদলানো শেষ', b_delpt: 'বিন্দু মুছুন', b_delward: 'ওয়ার্ড মুছুন', b_done: 'হয়ে গেছে',
      h_shape: 'কোণ সরাতে সাদা বিন্দু টানুন। পাশের ওয়ার্ডের সঙ্গে ভাগ করা কোণ দুটোতেই সরে, আর বিন্দু কাছের সীমানায় বসে যায়, তাই ফাঁক থাকে না। নতুন কোণ যোগ করতে ছোট কমলা বিন্দু টানুন। কোণ মুছতে সেটিতে ট্যাপ করে "বিন্দু মুছুন" চাপুন।',
      e_toomany: 'এই ওয়ার্ডে {n}টি কোণ, এখানে হাতে বদলানোর পক্ষে বেশি। QGIS-এর মতো অ্যাপে বদলে আপলোড করুন।',
      e_taken: 'ওয়ার্ড {n} আগেই আছে।', e_minpts: 'একটি ওয়ার্ডে অন্তত ৩টি কোণ লাগে।',
      b_export: 'GeoJSON ডাউনলোড',
      f_note: 'মডারেটরের জন্য নোট (ঐচ্ছিক)', f_note_fix: 'কী ঠিক করতে হবে (মডারেটরের জন্য)',
      h_note: 'কী ভুল বা কী বদলেছেন। মানচিত্রে জায়গাটা পিন করেও দিতে পারেন।',
      b_pin: 'মানচিত্রে জায়গা পিন করুন', b_pin_cancel: 'পিন বাতিল', b_pin_clear: 'পিন সরান',
      s_pin_tap: 'যেখানে সমস্যা, মানচিত্রে সেখানে ট্যাপ করুন।', s_pinned: '{lat}, {lng}-এ পিন করা হয়েছে।',
      e_nofix: 'অন্তত একটি ওয়ার্ড আঁকুন বা কপি করুন, অথবা কী ঠিক করতে হবে লিখুন।',
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
      title_fix_area: '<em>{town}</em> की सीमा ठीक करें',
      sub_fix_area: 'कोनों को खींचकर असली सीमा पर लाएँ, या बस लिखें कि क्या ग़लत है और जगह पिन करें। पहले एक मॉडरेटर जाँचेगा।',
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
      s_wards: '{n} वार्ड तैयार: बदलने के लिए टैप करें।', s_none: 'अभी कोई वार्ड नहीं।', s_drawing: 'वार्ड {n}: {p} बिंदु। और जोड़ने के लिए नक्शे पर टैप करें।',
      s_existing: 'अभी नक्शे पर मौजूद सीमाएँ डैश से दिखाई गई हैं। बदलने के लिए किसी पर टैप कर उसे यहाँ कॉपी करें।',
      h_img: 'वार्ड नक्शे की फ़ोटो या स्कैन है? उसे नक्शे के नीचे रखें, नीले कोनों को नक्शे पर उन्हीं जगहों पर खींचें, फिर उसके ऊपर बनाएँ। तस्वीर आपके फ़ोन पर ही रहती है।',
      b_img: 'पीछे की तस्वीर (JPG या PNG)', a_opacity: 'तस्वीर की पारदर्शिता', b_lock: 'तस्वीर रोकें', b_unlock: 'तस्वीर खिसकाएँ', b_img_clear: 'तस्वीर हटाएँ',
      e_img: 'तस्वीर खोली नहीं जा सकी। JPG या PNG दें।',
      f_e_ward: 'वार्ड नंबर', f_e_name: 'वार्ड का नाम (वैकल्पिक)', f_e_note: 'इस वार्ड पर नोट (वैकल्पिक)',
      ph_e_note: 'जैसे पार्षद का दफ़्तर, सीमा के निशान',
      b_shape: 'आकार बदलें', b_shape_done: 'आकार बदलना बंद करें', b_delpt: 'बिंदु हटाएँ', b_delward: 'वार्ड हटाएँ', b_done: 'हो गया',
      h_shape: 'कोना खिसकाने के लिए सफ़ेद बिंदु खींचें। पड़ोसी वार्ड के साथ साझा कोना दोनों में खिसकता है, और बिंदु पास की सीमा पर चिपक जाता है, इसलिए कोई खाली जगह नहीं बनती। नया कोना जोड़ने के लिए छोटा नारंगी बिंदु खींचें। कोना हटाने के लिए उस पर टैप कर "बिंदु हटाएँ" दबाएँ।',
      e_toomany: 'इस वार्ड में {n} कोने हैं, यहाँ हाथ से बदलने के लिए बहुत ज़्यादा। QGIS जैसे ऐप में बदलकर अपलोड करें।',
      e_taken: 'वार्ड {n} पहले से है।', e_minpts: 'एक वार्ड में कम से कम 3 कोने चाहिए।',
      b_export: 'GeoJSON डाउनलोड करें',
      f_note: 'मॉडरेटर के लिए नोट (वैकल्पिक)', f_note_fix: 'क्या ठीक करना है (मॉडरेटर के लिए)',
      h_note: 'क्या ग़लत है या आपने क्या बदला। नक्शे पर जगह पिन भी कर सकते हैं।',
      b_pin: 'नक्शे पर जगह पिन करें', b_pin_cancel: 'पिन रद्द करें', b_pin_clear: 'पिन हटाएँ',
      s_pin_tap: 'जहाँ समस्या है, नक्शे पर वहाँ टैप करें।', s_pinned: '{lat}, {lng} पर पिन किया।',
      e_nofix: 'कम से कम एक वार्ड बनाएँ या कॉपी करें, या लिखें कि क्या ठीक करना है।',
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
    wards: new Map(),     // ward number -> { geometry, drawn, name, note }
    selected: null,       // ward number open in the edit panel
    shaping: false,       // its corners are draggable
    selVx: null,          // { r, i }: the tapped corner
    pin: null, pinning: false,
    existing: null,       // the town's wards now on the map (fix mode)
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
    document.querySelectorAll('[data-t-aria]').forEach(el => { el.setAttribute('aria-label', t(el.dataset.tAria)); });
    if (state.fix) document.querySelector('[data-t="f_note"]').textContent = t('f_note_fix');
    $('at-img-lock').textContent = t(img.locked ? 'b_unlock' : 'b_lock');
    renderPin(); drawHandles();
    $('at-incharge-src').placeholder = t('ph_incharge_src');
    document.querySelectorAll('.at-lang button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
    if (state.fix){
      $('at-title').innerHTML = t(state.fix.fc ? 'title_fix_area' : 'title_fix', { town: esc(state.fix.name) });
      $('at-sub').textContent = t(state.fix.fc ? 'sub_fix_area' : 'sub_fix', { town: state.fix.name });
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
    map.addLayer({ id: 'existing-fill', type: 'fill', source: 'existing', paint: { 'fill-color': '#9aa0a6', 'fill-opacity': .04 } });
    map.addLayer({ id: 'existing-line', type: 'line', source: 'existing', paint: { 'line-color': '#9aa0a6', 'line-width': 1, 'line-dasharray': [3, 2] } });
    map.addLayer({ id: 'existing-label', type: 'symbol', source: 'existing', minzoom: 12,
      layout: { 'text-field': ['to-string', ['get', 'ward']], 'text-size': 11, 'text-font': ['Noto Sans Regular'] },
      paint: { 'text-color': '#9aa0a6', 'text-halo-color': '#0a0805', 'text-halo-width': 1 } });
    map.addSource('wards', { type: 'geojson', data: wardsFC() });
    map.addLayer({ id: 'wards-fill', type: 'fill', source: 'wards', paint: { 'fill-color': '#d4882a', 'fill-opacity': .15 } });
    map.addLayer({ id: 'wards-line', type: 'line', source: 'wards', paint: { 'line-color': '#d4882a', 'line-width': 2 } });
    map.addLayer({ id: 'wards-sel', type: 'line', source: 'wards', filter: ['==', ['get', 'ward'], -1], paint: { 'line-color': '#f0e6d0', 'line-width': 3 } });
    map.addLayer({ id: 'wards-label', type: 'symbol', source: 'wards',
      layout: { 'text-field': ['to-string', ['get', 'ward']], 'text-size': 13, 'text-font': ['Noto Sans Regular'] },
      paint: { 'text-color': '#f0e6d0', 'text-halo-color': '#0a0805', 'text-halo-width': 1 } });
    map.addSource('sketch', { type: 'geojson', data: sketchFC() });
    map.addLayer({ id: 'sketch-line', type: 'line', source: 'sketch', paint: { 'line-color': '#e8a34a', 'line-width': 2, 'line-dasharray': [2, 1] } });
    map.addLayer({ id: 'sketch-pts', type: 'circle', source: 'sketch', filter: ['==', ['geometry-type'], 'Point'],
      paint: { 'circle-radius': 4, 'circle-color': '#e8a34a' } });
    map.on('click', e => {
      if (e.originalEvent?.target?.closest?.('.maplibregl-marker')) return;
      const at = round6([e.lngLat.lng, e.lngLat.lat]);
      if (state.drawing){ state.drawing.points.push(snap(at, snapTargets())); return redraw(); }
      if (state.pinning){ state.pin = at; state.pinning = false; return renderPin(); }
      if (state.shaping) return;
      const hit = map.queryRenderedFeatures(e.point, { layers: ['wards-fill'] })[0];
      if (hit) return selectWard(Number(hit.properties.ward));
      const old = state.existing && map.queryRenderedFeatures(e.point, { layers: ['existing-fill'] })[0];
      if (old && copyExisting(Number(old.properties.ward))) return;
      if (state.selected != null) selectWard(null);
    });
    map.on('zoomend', () => { if (state.shaping) drawHandles(); });
    zoomToDistrict();
  });

  const propsOf = (ward, w) => ({ ward, ...(w.name ? { name: w.name } : {}), ...(w.note ? { note: w.note } : {}) });
  function wardsFC(){
    return { type: 'FeatureCollection', features: [...state.wards].map(([ward, w]) => ({ type: 'Feature', properties: propsOf(ward, w), geometry: w.geometry })) };
  }
  function sketchFC(){
    const pts = state.drawing?.points || [];
    return { type: 'FeatureCollection', features: [
      ...(pts.length > 1 ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts } }] : []),
      ...pts.map(p => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: p } }))
    ] };
  }
  function redraw(){
    if (map?.getSource('wards')){
      map.getSource('wards').setData(wardsFC()); map.getSource('sketch').setData(sketchFC());
      map.setFilter('wards-sel', ['==', ['get', 'ward'], state.selected ?? -1]);
      refreshExisting();
    }
    $('at-export').disabled = !state.wards.size;
    $('at-undo').disabled = !state.drawing?.points.length;
    $('at-finish').disabled = !state.drawing;
    $('at-map').classList.toggle('drawing', !!state.drawing || state.pinning);
    renderWards();
  }
  function renderWards(){
    const list = [...state.wards.keys()].sort((a, b) => a - b);
    $('at-wards').innerHTML = list.map(n => `<button type="button" data-ward="${n}" aria-pressed="${n === state.selected}">${n}${
      state.wards.get(n).name ? ' · ' + esc(state.wards.get(n).name) : ''}</button>`).join('');
    $('at-status').textContent = state.drawing ? t('s_drawing', { n: state.drawing.ward, p: state.drawing.points.length })
      : state.pinning ? t('s_pin_tap')
      : (list.length ? t('s_wards', { n: list.length }) : t('s_none')) + (state.fix ? ' ' + t('s_existing') : '');
  }
  $('at-wards').addEventListener('click', e => {
    const b = e.target.closest('[data-ward]');
    if (!b) return;
    const n = Number(b.dataset.ward);
    selectWard(state.selected === n ? null : n);
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
    out.details = new Map();
    for (const f of polys){
      const n = wardOf(f.properties);
      if (out.has(n)) throw t('e_dup', { n });
      if (!allPoints(f.geometry).every(inWB)) throw t('e_outside');
      out.set(n, { type: f.geometry.type, coordinates: f.geometry.coordinates });
      const p = f.properties || {}, name = p.name ?? p.NAME ?? p.Name ?? p.ward_name ?? p.WARD_NAME, note = p.note ?? p.notes;
      out.details.set(n, { name: name == null ? '' : String(name).trim().slice(0, 80), note: note == null ? '' : String(note).trim().slice(0, 300) });
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
      for (const [n, g] of got) state.wards.set(n, { geometry: g, drawn: false, ...got.details.get(n) });
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
    selectWard(null);
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

  /* Copies a ward now on the map into the editable wards and opens it. */
  function copyExisting(n){
    const f = state.existing?.features.find(x => Number(x.properties.ward) === n);
    if (!f) return false;
    if (!state.wards.has(n)) state.wards.set(n, { geometry: JSON.parse(JSON.stringify(f.geometry)), drawn: false, name: f.properties.name || '' });
    selectWard(n);
    return true;
  }

  // ── Editing one ward: number, name, notes, corners ──
  const MAX_EDIT = 600;
  const ringsOf = g => g.type === 'Polygon' ? g.coordinates : g.coordinates.flat(1);
  let handles = [];
  const refreshWards = () => map?.getSource('wards')?.setData(wardsFC());
  function selectWard(n){
    if (state.selected !== n){ state.shaping = false; state.selVx = null; }
    state.selected = n;
    const w = n == null ? null : state.wards.get(n);
    $('at-edit').hidden = !w;
    if (w){ $('at-e-ward').value = n; $('at-e-name').value = w.name || ''; $('at-e-note').value = w.note || ''; }
    drawHandles();
    redraw();
  }
  const handle = (cls, at) => {
    const el = document.createElement('div');
    el.className = cls;
    return new maplibregl.Marker({ element: el, draggable: true }).setLngLat(at).addTo(map);
  };
  // Shared borders: a corner neighbouring wards also use moves with them, so no gap opens.
  const same = (a, b) => Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7;
  const setPt = (ring, i, p) => { ring[i] = p; if (i === 0) ring[ring.length - 1] = [...p]; };
  function refreshExisting(){
    if (!map?.getLayer('existing-fill')) return;
    const f = ['!', ['in', ['to-number', ['get', 'ward']], ['literal', [...state.wards.keys()]]]];
    ['existing-fill', 'existing-line', 'existing-label'].forEach(id => map.setFilter(id, f));
  }
  function twins(n, pt){     // other wards' corners at pt; a neighbour now on the map is copied in to move with it
    let copied = false;
    state.existing?.features.forEach(f => {
      const m = Number(f.properties.ward);
      if (m === n || state.wards.has(m) || !ringsOf(f.geometry).some(r => r.some(q => same(q, pt)))) return;
      state.wards.set(m, { geometry: JSON.parse(JSON.stringify(f.geometry)), drawn: false, name: f.properties.name || '' });
      copied = true;
    });
    if (copied){ refreshExisting(); renderWards(); }
    const out = [];
    state.wards.forEach((w, m) => { if (m !== n) ringsOf(w.geometry).forEach(ring => {
      for (let i = 0; i < ring.length - 1; i++) if (same(ring[i], pt)) out.push({ n: m, ring, i });
    }); });
    return out;
  }
  // Snapping: a dragged or drawn corner jumps onto a nearby corner or border of any ward.
  const SNAP_PX = 12;
  function snapTargets(skip = () => false){
    const b = map.getBounds(), pts = [], segs = [];
    const inView = p => p[0] >= b.getWest() && p[0] <= b.getEast() && p[1] >= b.getSouth() && p[1] <= b.getNorth();
    const scan = g => ringsOf(g).forEach(ring => ring.forEach((p, i) => {
      if (i < ring.length - 1 && !skip(p) && inView(p)) pts.push(p);
      const q = ring[i + 1];
      if (q && !skip(p) && !skip(q) && (inView(p) || inView(q))) segs.push([p, q]);
    }));
    state.wards.forEach(w => scan(w.geometry));
    state.existing?.features.forEach(f => { if (!state.wards.has(Number(f.properties.ward))) scan(f.geometry); });
    return { pts: pts.map(p => [...p]), segs: segs.map(([p, q]) => [[...p], [...q]]) };
  }
  function snap(p, tg){
    const s = map.project(p);
    let best = null, bd = SNAP_PX;
    tg.pts.forEach(q => { const d = s.dist(map.project(q)); if (d < bd){ bd = d; best = q; } });
    if (best) return [...best];
    bd = SNAP_PX * .75;
    tg.segs.forEach(([a, c]) => {
      const A = map.project(a), C = map.project(c), dx = C.x - A.x, dy = C.y - A.y, len = dx * dx + dy * dy;
      if (!len) return;
      const k = Math.max(0, Math.min(1, ((s.x - A.x) * dx + (s.y - A.y) * dy) / len));
      const d = Math.hypot(A.x + k * dx - s.x, A.y + k * dy - s.y);
      if (d < bd){ bd = d; best = round6([a[0] + k * (c[0] - a[0]), a[1] + k * (c[1] - a[1])]); }
    });
    return best || p;
  }
  const MID_PX = 36;         // no add-corner dot on a side shorter than this on screen
  // A marker's dragend can be lost when the pointer is released over another handle; the window hears it anyway.
  function onDrag(m, start, end){
    let live = false;
    const stop = () => { if (!live) return; live = false; end(); };
    m.on('dragstart', () => { live = true; start(); addEventListener('pointerup', stop, { once: true }); });
    m.on('dragend', stop);
  }
  function drawHandles(){
    handles.forEach(m => m.remove()); handles = [];
    const w = state.shaping && state.wards.get(state.selected);
    $('at-e-hint').hidden = !w;
    $('at-e-shape').textContent = t(w ? 'b_shape_done' : 'b_shape');
    $('at-e-delpt').disabled = !(w && state.selVx);
    if (!w || !map) return;
    const n = state.selected;
    ringsOf(w.geometry).forEach((ring, r) => {
      const last = ring.length - 1;               // a closed ring repeats its first corner at the end
      for (let i = 0; i < last; i++){
        const sel = state.selVx?.r === r && state.selVx.i === i;
        const m = handle('at-vx' + (sel ? ' sel' : ''), ring[i]);
        let tw = [], tg = null;
        onDrag(m, () => { const o = ring[i]; tw = twins(n, o); tg = snapTargets(p => same(p, o)); },
          () => { w.drawn = true; tw.forEach(x => { state.wards.get(x.n).drawn = true; }); drawHandles(); renderWards(); });
        m.on('drag', () => {
          const { lng, lat } = m.getLngLat();
          const p = snap(round6([lng, lat]), tg);
          setPt(ring, i, p); tw.forEach(x => setPt(x.ring, x.i, [...p]));
          refreshWards();
        });
        m.getElement().addEventListener('click', ev => { ev.stopPropagation(); state.selVx = { r, i }; drawHandles(); });
        const [a, b] = [ring[i], ring[i + 1]];
        if (map.project(a).dist(map.project(b)) < MID_PX) { handles.push(m); continue; }
        const mid = handle('at-vx mid', [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
        let added = null;
        onDrag(mid, () => { tg = snapTargets(p => same(p, a) || same(p, b)); }, () => {
          w.drawn = true; (added || []).forEach(x => { if (x.n != null) state.wards.get(x.n).drawn = true; });
          state.selVx = null; drawHandles(); renderWards();
        });
        mid.on('drag', () => {
          const { lng, lat } = mid.getLngLat();
          const p = snap(round6([lng, lat]), tg);
          if (!added){
            // The neighbour on the other side of this border gets the new corner too.
            added = [{ ring, at: i + 1 }];
            twins(n, a).forEach(x => {
              const L = x.ring.length - 1;
              if (same(x.ring[(x.i + 1) % L], b)) added.push({ ring: x.ring, at: x.i + 1, n: x.n });
              else if (same(x.ring[(x.i - 1 + L) % L], b)) added.push({ ring: x.ring, at: x.i === 0 ? L : x.i, n: x.n });
            });
            added.forEach(x => x.ring.splice(x.at, 0, null));
          }
          added.forEach(x => { x.ring[x.at] = [...p]; });
          refreshWards();
        });
        handles.push(m, mid);
      }
    });
  }
  $('at-e-shape').addEventListener('click', () => {
    const w = state.wards.get(state.selected);
    if (!w) return;
    const n = allPoints(w.geometry).length;
    if (!state.shaping && n > MAX_EDIT) return msg(t('e_toomany', { n: n.toLocaleString() }), 'bad');
    msg('', '');
    state.shaping = !state.shaping; state.selVx = null;
    drawHandles();
  });
  $('at-e-delpt').addEventListener('click', () => {
    const w = state.wards.get(state.selected), v = state.selVx;
    if (!w || !v) return;
    const ring = ringsOf(w.geometry)[v.r];
    if (ring.length <= 4) return msg(t('e_minpts'), 'bad');
    const tw = twins(state.selected, ring[v.i]).filter(x => x.ring.length > 4).sort((p, q) => q.i - p.i);
    [...tw, { ring, i: v.i }].forEach(x => {
      x.ring.splice(x.i, 1);
      if (x.i === 0) x.ring[x.ring.length - 1] = [...x.ring[0]];
      if (x.n != null) state.wards.get(x.n).drawn = true;
    });
    w.drawn = true; state.selVx = null;
    drawHandles(); refreshWards();
  });
  $('at-e-del').addEventListener('click', () => { state.wards.delete(state.selected); selectWard(null); });
  $('at-e-done').addEventListener('click', () => selectWard(null));
  $('at-e-name').addEventListener('input', e => { const w = state.wards.get(state.selected); if (w){ w.name = e.target.value.trim(); renderWards(); } });
  $('at-e-note').addEventListener('input', e => { const w = state.wards.get(state.selected); if (w) w.note = e.target.value.trim(); });
  $('at-e-ward').addEventListener('change', e => {
    const from = state.selected, to = Number(e.target.value);
    if (from == null || to === from) return;
    if (!Number.isInteger(to) || to < 1 || to > 500){ e.target.value = from; return msg(t('e_wardno'), 'bad'); }
    if (state.wards.has(to)){ e.target.value = from; return msg(t('e_taken', { n: to }), 'bad'); }
    msg('', '');
    state.wards.set(to, state.wards.get(from)); state.wards.delete(from);
    state.selected = to;
    redraw();
  });

  // ── Background picture to trace over. It never leaves the device. ──
  const img = { url: null, coords: null, locked: false, handles: [] };
  const setImgCoords = () => map.getSource('bg')?.setCoordinates(img.coords);
  function imgHandles(){
    img.handles.forEach(m => m.remove()); img.handles = [];
    if (!img.url || img.locked) return;
    const centre = () => [0, 1].map(k => img.coords.reduce((s, c) => s + c[k], 0) / 4);
    const move = handle('at-corner move', centre());
    img.coords.forEach((c, k) => {
      const m = handle('at-corner', c);
      m.on('drag', () => { const { lng, lat } = m.getLngLat(); img.coords[k] = [lng, lat]; setImgCoords(); move.setLngLat(centre()); });
      img.handles.push(m);
    });
    let start = null;
    move.on('dragstart', () => { start = { at: move.getLngLat(), coords: img.coords.map(c => [...c]) }; });
    move.on('drag', () => {
      const { lng, lat } = move.getLngLat(), dx = lng - start.at.lng, dy = lat - start.at.lat;
      img.coords = start.coords.map(([x, y]) => [x + dx, y + dy]);
      setImgCoords();
      img.coords.forEach((c, k) => img.handles[k].setLngLat(c));
    });
    img.handles.push(move);
  }
  function clearImage(){
    if (map?.getLayer('bg')) map.removeLayer('bg');
    if (map?.getSource('bg')) map.removeSource('bg');
    if (img.url) URL.revokeObjectURL(img.url);
    img.url = null; img.locked = false; imgHandles();
    ['at-opacity', 'at-img-lock', 'at-img-clear'].forEach(id => { $(id).disabled = true; });
    $('at-img-lock').textContent = t('b_lock');
  }
  /* Big phone photos are scaled down so the map can draw them. */
  async function loadImage(file){
    const url = URL.createObjectURL(file);
    const el = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const k = Math.min(1, 2048 / Math.max(el.naturalWidth, el.naturalHeight));
    if (k === 1) return { url, w: el.naturalWidth, h: el.naturalHeight };
    const c = document.createElement('canvas');
    c.width = Math.round(el.naturalWidth * k); c.height = Math.round(el.naturalHeight * k);
    c.getContext('2d').drawImage(el, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    const blob = await new Promise(res => c.toBlob(res, file.type));
    return { url: URL.createObjectURL(blob), w: c.width, h: c.height };
  }
  $('at-img').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file || !map) return;
    let got;
    try {
      if (!/^image\/(jpeg|png)$/.test(file.type)) throw 0;
      got = await loadImage(file);
    } catch (err) { return msg(t('e_img'), 'bad'); }
    await mapReady;
    clearImage();
    msg('', '');
    const box = map.getContainer(), W = box.clientWidth, H = box.clientHeight;
    const k = Math.min(W * .7 / got.w, H * .7 / got.h), w = got.w * k, h = got.h * k, x0 = (W - w) / 2, y0 = (H - h) / 2;
    img.coords = [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]].map(p => { const ll = map.unproject(p); return [ll.lng, ll.lat]; });
    img.url = got.url;
    map.addSource('bg', { type: 'image', url: img.url, coordinates: img.coords });
    map.addLayer({ id: 'bg', type: 'raster', source: 'bg', paint: { 'raster-opacity': $('at-opacity').value / 100, 'raster-fade-duration': 0 } }, 'existing-fill');
    ['at-opacity', 'at-img-lock', 'at-img-clear'].forEach(id => { $(id).disabled = false; });
    imgHandles();
  });
  $('at-opacity').addEventListener('input', e => { if (map?.getLayer('bg')) map.setPaintProperty('bg', 'raster-opacity', e.target.value / 100); });
  $('at-img-lock').addEventListener('click', () => {
    img.locked = !img.locked;
    $('at-img-lock').textContent = t(img.locked ? 'b_unlock' : 'b_lock');
    imgHandles();
  });
  $('at-img-clear').addEventListener('click', clearImage);

  // ── A pinned spot for the moderator ──
  let pinMarker = null;
  function renderPin(){
    pinMarker?.remove(); pinMarker = null;
    if (state.pin && map){
      const el = document.createElement('div'); el.className = 'at-pin';
      pinMarker = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat(state.pin).addTo(map);
    }
    $('at-pin').textContent = t(state.pin ? 'b_pin_clear' : state.pinning ? 'b_pin_cancel' : 'b_pin');
    $('at-pin-at').textContent = state.pin ? t('s_pinned', { lat: state.pin[1], lng: state.pin[0] }) : '';
    $('at-map').classList.toggle('drawing', !!state.drawing || state.pinning);
    renderWards();
  }
  $('at-pin').addEventListener('click', () => {
    if (state.pin) state.pin = null;
    else state.pinning = !state.pinning;
    renderPin();
  });

  // ── Download as GeoJSON: 6-decimal coordinates, with a bbox on each ward and on the whole map ──
  const bboxOf = pts => pts.reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [180, 90, -180, -90]);
  function exportFC(){
    const features = [...state.wards].sort((a, b) => a[0] - b[0]).map(([ward, w]) => {
      const geometry = mapRings(w.geometry, r => r.map(round6));
      return { type: 'Feature', bbox: bboxOf(allPoints(geometry)), properties: propsOf(ward, w), geometry };
    });
    return { type: 'FeatureCollection', bbox: bboxOf(features.flatMap(f => allPoints(f.geometry))), features };
  }
  $('at-export').addEventListener('click', () => {
    if (!state.wards.size) return;
    const name = ($('at-town').value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'wards') + '.geojson';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(exportFC())], { type: 'application/geo+json' }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  // ── Fixing a town already on the map ──
  /* Purulia's own wards are not a town in kasa_places; its fixes go to moderators, who update purulia_wards.geojson. */
  const PURULIA = { slug: 'purulia', name: 'Purulia', body: 'Purulia Municipality', body_type: 'municipality', district: 'Purulia',
                    wards: 'purulia_wards.geojson' };
  /* ?fix=area&level=district|block|gp&district=<slug>&block=&gp=: a district, block or gram panchayat outline from
     the map's own files, edited as one shape ("ward" 1). Its fix goes to moderators, who update the file. */
  async function loadArea(){
    const level = params.get('level'), dslug = params.get('district') || '', block = params.get('block') || '', gp = params.get('gp') || '';
    const dname = (window.KASA_DISTRICTS || {})[dslug];
    if (!['district', 'block', 'gp'].includes(level) || !dname || (level !== 'district' && !block) || (level === 'gp' && !gp)) return null;
    const file = level === 'district' ? 'places/wb_districts.geojson'
      : dslug === 'purulia' ? (level === 'gp' ? 'purulia_gps.geojson' : 'purulia_blocks.geojson') : 'places/wb/' + dslug + '.geojson';
    const fc = await (await fetch(file)).json();
    const f = fc.features.find(x => level === 'district' ? x.properties.slug === dslug
      : (x.properties.kind || level) === level && x.properties.block === block && (level === 'block' || x.properties.gp === gp));
    if (!f) return null;
    const name = level === 'district' ? dname : level === 'block' ? block : gp;
    return { slug: ['area', level, dslug, block, gp].filter(Boolean).join(':'), name, district: dname, body_type: 'gram_panchayat',
      body: level === 'district' ? `${dname} district` : level === 'block' ? `${block} block, ${dname} district` : `${gp} gram panchayat, ${block} block`,
      fc: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { ward: 1, name }, geometry: f.geometry }] } };
  }
  async function loadFix(slug){
    try {
      const places = slug === 'purulia' ? [PURULIA] : slug === 'area' ? [await loadArea()]
        : await (await fetch(API + 'rpc/kasa_places', { method: 'POST', headers: HEAD, body: '{}' })).json();
      const p = Array.isArray(places) && places.find(x => x && (x.slug === slug || slug === 'area'));
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
      const wards = p.fc || (p.wards ? await (await fetch(p.wards)).json()
        : await (await fetch(API + 'rpc/kasa_place_wards', { method: 'POST', headers: HEAD, body: JSON.stringify({ p_slug: slug }) })).json());
      await mapReady;
      if (wards?.features){
        state.existing = wards;
        map.getSource('existing').setData(wards);
        // ?ward=<n>: open that ward ready to edit.
        const n = Number(params.get('ward')) || (p.fc ? 1 : 0);
        const one = n && wards.features.find(f => Number(f.properties.ward) === n);
        fitTo((one ? [one] : wards.features).flatMap(f => allPoints(f.geometry)));
        if (one) copyExisting(n);
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
    const suggestOnly = !state.wards.size && state.fix && v('at-note');
    if (!state.wards.size && !suggestOnly) return msg(t(state.fix ? 'e_nofix' : 'e_nomap'), 'bad');
    if (!suggestOnly && !v('at-source')) return msg(t('e_source'), 'bad');
    if (![...state.wards.values()].every(w => allPoints(w.geometry).every(inWB))) return msg(t('e_outside'), 'bad');
    const btn = $('at-send');
    btn.disabled = true; msg(t('sending'), '');
    try {
      const res = await fetch(API + 'rpc/kasa_submit_place', {
        method: 'POST', headers: HEAD,
        body: JSON.stringify({
          p_town: v('at-town'), p_district: districtSel.value, p_body: v('at-body'),
          p_body_type: document.querySelector('[name="at-type"]:checked').value,
          p_incharge: v('at-incharge') || null, p_incharge_source: v('at-incharge-src') || null,
          p_complaint_url: v('at-complaint') || null, p_map_source: v('at-source') || null,
          p_drawn: [...state.wards.values()].some(w => w.drawn), p_fix_of: state.fix?.slug || null,
          p_geojson: state.wards.size ? wardsFC() : null, p_contact: v('at-contact') || null,
          p_note: v('at-note') || null, p_pin: state.pin
        })
      });
      if (!res.ok){
        let detail = '';
        try { detail = (await res.json()).details || ''; } catch (e2) {}
        throw new Error(detail || t('e_send'));
      }
      state.wards.clear(); selectWard(null);
      state.pin = null; state.pinning = false; renderPin();
      $('at-file').value = ''; $('at-note').value = '';
      msg(t('done'), 'ok');
    } catch (err) {
      msg(err.message || t('e_send'), 'bad');
    } finally {
      btn.disabled = false;
    }
  });

  applyLang();
})();
