import { getLocales } from 'expo-localization';
import AsyncStorage from 'expo-sqlite/kv-store';
import { ERRORS } from './errors';
import { SITE } from './siteText';

export type Lang = 'en' | 'bn' | 'hi';
export const LANGS: Lang[] = ['bn', 'hi', 'en'];
export const LANG_NAMES: Record<Lang, string> = { en: 'English', bn: 'বাংলা', hi: 'हिन्दी' };

// Category and flag labels match kasa-i18n.js.
const en = {
  perm_title: 'Camera and location',
  perm_body: 'A report needs a photo taken now and your real location. Nothing else on your phone is read.',
  perm_allow: 'Allow',
  perm_settings: 'Open settings',
  gps_waiting: 'Finding your location…',
  gps_ok: 'GPS ±{a} m',
  gps_weak: 'GPS too weak (±{a} m). Step into the open.',
  gps_off: 'Turn on location. You need to be at the spot.',
  gps_mocked: 'A fake-location app is on. Turn it off to report.',
  shutter_hint: 'Point at the problem and tap',
  what: "What's the problem?",
  cat_garbage: 'Garbage / dumping',
  cat_drain: 'Blocked drain / sewage',
  cat_road: 'Pothole / broken road',
  cat_streetlight: 'Streetlight not working',
  cat_water: 'Water supply / leak',
  cat_toilet: 'Public toilet — locked, unusable or unclean',
  cat_other: 'Other civic problem',
  note: 'Add a note (optional)',
  slide: 'Slide to send',
  sending: 'Sending…',
  retake: 'Retake',
  queued: "Saved on this phone. It will send when you're back online.",
  queue_n: '{n} waiting to send',
  queue_failed: 'One saved report was refused: {e}',
  res_title: 'Report filed',
  res_live: "It's on the map now.",
  res_review: 'A moderator checks it before it shows on the map.',
  res_dup: 'Someone reported this already. You are counted as a witness.',
  res_recur: 'This spot was marked fixed before. Logged as a repeat.',
  res_ward: 'Ward {n}',
  res_status: 'Status: {s}',
  works_none: 'No work on record for this spot.',
  open_site: 'Open on the website',
  done: 'Done',
  status_open: 'Unresolved',
  status_claimed: 'Verifying',
  status_resolved: 'Resolved',
  nearby: 'Recent reports',
  nearby_empty: 'No reports to show.',
  flag: 'Report',
  hide: 'Hide',
  flag_title: "What's wrong with this report?",
  fr_not_an_issue: 'Not a real problem',
  fr_wrong_location: 'Wrong location',
  fr_duplicate: 'Duplicate of another report',
  fr_inappropriate: 'Inappropriate photo',
  fr_fake_or_old_photo: 'Fake or old photo',
  fr_other: 'Something else',
  flag_sent: 'Thanks. A moderator will look at it.',
  hidden: 'Hidden on this phone.',
  cancel: 'Cancel',
  close: 'Close',
  terms_title: 'Before you start',
  terms_body:
    'Report only real public problems, photographed now, where you stand.\n\nNo faces, number plates or personal details in photos or notes. Abusive, false or objectionable reports are removed by moderators, and accounts that post them are blocked.\n\nUse "Report" on any report you think is wrong; you can also hide it on your phone.',
  terms_read: 'Read the full terms',
  terms_agree: 'I agree',
  lang: 'Language',
  works_until: "Under warranty until {d}. The builder must fix defects free.",
  works_contractor: "Contractor: {c}",
  works_checked: "From a site board checked by a moderator.",
  more: "More",
  grp_places: "Map and places",
  grp_account: "Accountability",
  grp_services: "Services",
  grp_part: "Take part",
  grp_about: "About",
  sec_kasa: "Full report map",
  sec_ward: "Your ward",
  sec_districts: "Districts",
  sec_data: "Ground truth",
  sec_works: "Public works warranty",
  sec_promises: "Promises",
  sec_noticeboard: "Ask your leaders",
  sec_municipality: "Municipality and money",
  sec_analytics: "Public analytics",
  sec_digest: "Weekly ward digest",
  sec_schools: "Schools",
  sec_toilets: "Public toilets",
  sec_waste: "Where the waste goes",
  sec_snakes: "Snakes and rescuers",
  sec_dogs: "Community dogs",
  sec_pandals: "Swachh Pandal",
  sec_adopt: "Adopt a spot",
  sec_communities: "Volunteer groups",
  sec_routes: "Walk, run, cycle",
  sec_assistant: "Ask Parishkar",
  sec_addtown: "Put your town on the map",
  sec_suggest: "Suggest a feature",
  sec_join: "Join",
  sec_circle: "The circle",
  sec_blueprint: "The blueprint",
  sec_methodology: "How it works",
  sec_rules: "Rules",
  sec_privacy: "Privacy",
  sec_terms: "Terms",
  sec_grievance: "Grievance officer",
  sec_changelog: "What's new",
  grp_here: "At this spot",
  school_check: "Check a school",
  add_photo: "+ Add another photo ({n} of {max})",
  adding_hint: "Take one more photo of the same problem",
  adding_done: "Back to the report",
  issue_more: "Say exactly what's wrong (optional)",
  open_report: "Open the report",
  who_site: "Who's responsible and how to escalate",
  rules_gps: "Your GPS: ±{a} m",
  ev_need_photo: "Take the photo with the camera below",
  loading: "Loading…",
};

type Dict = typeof en;

const bn: Dict = {
  perm_title: 'ক্যামেরা আর লোকেশন',
  perm_body: 'রিপোর্টে এখনই তোলা ছবি আর আপনার আসল লোকেশন লাগে। ফোনের আর কিছু পড়া হয় না।',
  perm_allow: 'অনুমতি দিন',
  perm_settings: 'সেটিংস খুলুন',
  gps_waiting: 'আপনার লোকেশন খোঁজা হচ্ছে…',
  gps_ok: 'GPS ±{a} মি',
  gps_weak: 'GPS খুব দুর্বল (±{a} মি)। খোলা জায়গায় দাঁড়ান।',
  gps_off: 'লোকেশন চালু করুন। আপনাকে জায়গাটিতে থাকতে হবে।',
  gps_mocked: 'নকল লোকেশনের অ্যাপ চালু আছে। রিপোর্ট করতে সেটি বন্ধ করুন।',
  shutter_hint: 'সমস্যার দিকে ধরে চাপুন',
  what: 'সমস্যাটা কী?',
  cat_garbage: 'আবর্জনা / ময়লা ফেলা',
  cat_drain: 'বন্ধ নর্দমা / নোংরা জল',
  cat_road: 'গর্ত / ভাঙা রাস্তা',
  cat_streetlight: 'রাস্তার আলো জ্বলছে না',
  cat_water: 'জল সরবরাহ / লিক',
  cat_toilet: 'সরকারি শৌচাগার — তালাবন্ধ, অকেজো বা নোংরা',
  cat_other: 'অন্য নাগরিক সমস্যা',
  note: 'একটা নোট লিখুন (ইচ্ছে হলে)',
  slide: 'পাঠাতে টানুন',
  sending: 'পাঠানো হচ্ছে…',
  retake: 'আবার তুলুন',
  queued: 'ফোনে রাখা হলো। নেট ফিরলে নিজে থেকেই যাবে।',
  queue_n: '{n}টি পাঠানোর অপেক্ষায়',
  queue_failed: 'রাখা একটি রিপোর্ট নেওয়া হয়নি: {e}',
  res_title: 'রিপোর্ট জমা হয়েছে',
  res_live: 'এখন ম্যাপে দেখা যাচ্ছে।',
  res_review: 'ম্যাপে দেখানোর আগে একজন মডারেটর দেখে নেবেন।',
  res_dup: 'এটা আগেই কেউ জানিয়েছেন। আপনাকে সাক্ষী হিসেবে গোনা হলো।',
  res_recur: 'এই জায়গা আগে ঠিক হয়েছে বলা হয়েছিল। আবার হয়েছে বলে লেখা হলো।',
  res_ward: 'ওয়ার্ড {n}',
  res_status: 'অবস্থা: {s}',
  works_none: 'এই জায়গায় কোনো কাজের রেকর্ড নেই।',
  open_site: 'ওয়েবসাইটে খুলুন',
  done: 'হয়ে গেছে',
  status_open: 'সমাধান বাকি',
  status_claimed: 'যাচাই চলছে',
  status_resolved: 'সমাধান হয়েছে',
  nearby: 'সাম্প্রতিক রিপোর্ট',
  nearby_empty: 'দেখানোর মতো রিপোর্ট নেই।',
  flag: 'জানান',
  hide: 'লুকান',
  flag_title: 'এই রিপোর্টে কী ভুল?',
  fr_not_an_issue: 'আসল সমস্যা নয়',
  fr_wrong_location: 'ভুল জায়গা',
  fr_duplicate: 'অন্য রিপোর্টের পুনরাবৃত্তি',
  fr_inappropriate: 'আপত্তিকর ছবি',
  fr_fake_or_old_photo: 'ভুয়ো বা পুরোনো ছবি',
  fr_other: 'অন্য কিছু',
  flag_sent: 'ধন্যবাদ। একজন মডারেটর দেখবেন।',
  hidden: 'এই ফোনে লুকানো হলো।',
  cancel: 'বাতিল',
  close: 'বন্ধ',
  terms_title: 'শুরু করার আগে',
  terms_body:
    'শুধু আসল সরকারি সমস্যা জানান, এখনই, যেখানে দাঁড়িয়ে আছেন সেখান থেকে তোলা ছবিতে।\n\nছবি বা নোটে কারও মুখ, গাড়ির নম্বর বা ব্যক্তিগত তথ্য নয়। গালিগালাজ, মিথ্যে বা আপত্তিকর রিপোর্ট মডারেটররা সরিয়ে দেন, আর যে অ্যাকাউন্ট সেগুলো দেয় তা আটকে দেওয়া হয়।\n\nকোনো রিপোর্ট ভুল মনে হলে "জানান" চাপুন; নিজের ফোনে লুকিয়েও রাখতে পারেন।',
  terms_read: 'পুরো শর্তাবলি পড়ুন',
  terms_agree: 'আমি রাজি',
  lang: 'ভাষা',
  works_until: "ওয়ারেন্টি {d} পর্যন্ত। ঠিকাদারকে বিনা খরচে ত্রুটি সারাতে হবে।",
  works_contractor: "ঠিকাদার: {c}",
  works_checked: "মডারেটরের যাচাই করা সাইট বোর্ড থেকে।",
  more: "আরও",
  grp_places: "ম্যাপ আর এলাকা",
  grp_account: "জবাবদিহি",
  grp_services: "পরিষেবা",
  grp_part: "অংশ নিন",
  grp_about: "পরিচিতি",
  sec_kasa: "পুরো রিপোর্ট ম্যাপ",
  sec_ward: "আপনার ওয়ার্ড",
  sec_districts: "জেলা",
  sec_data: "মাটির সত্য",
  sec_works: "সরকারি কাজের ওয়ারেন্টি",
  sec_promises: "প্রতিশ্রুতি",
  sec_noticeboard: "নেতাদের প্রশ্ন করুন",
  sec_municipality: "পৌরসভা আর টাকা",
  sec_analytics: "সবার জন্য হিসেব",
  sec_digest: "সাপ্তাহিক ওয়ার্ড খবর",
  sec_schools: "স্কুল",
  sec_toilets: "সরকারি শৌচাগার",
  sec_waste: "আবর্জনা কোথায় যায়",
  sec_snakes: "সাপ আর উদ্ধারকারী",
  sec_dogs: "পাড়ার কুকুর",
  sec_pandals: "স্বচ্ছ প্যান্ডেল",
  sec_adopt: "একটা জায়গা দত্তক নিন",
  sec_communities: "স্বেচ্ছাসেবী দল",
  sec_routes: "হাঁটা, দৌড়, সাইকেল",
  sec_assistant: "পরিষ্কারকে জিজ্ঞেস করুন",
  sec_addtown: "আপনার শহর ম্যাপে তুলুন",
  sec_suggest: "নতুন কিছু চান? বলুন",
  sec_join: "যোগ দিন",
  sec_circle: "চক্র",
  sec_blueprint: "নকশা",
  sec_methodology: "কীভাবে কাজ করে",
  sec_rules: "নিয়ম",
  sec_privacy: "গোপনীয়তা",
  sec_terms: "শর্তাবলি",
  sec_grievance: "অভিযোগ আধিকারিক",
  sec_changelog: "নতুন কী",
  grp_here: "এই জায়গা থেকে",
  school_check: "স্কুল যাচাই করুন",
  add_photo: "+ আরেকটা ছবি ({n}/{max})",
  adding_hint: "একই সমস্যার আরেকটা ছবি তুলুন",
  adding_done: "রিপোর্টে ফিরুন",
  issue_more: "ঠিক কী সমস্যা বলুন (ঐচ্ছিক)",
  open_report: "রিপোর্ট খুলুন",
  who_site: "কে দায়ী, কোথায় জানাবেন",
  rules_gps: "আপনার জিপিএস: ±{a} মি",
  ev_need_photo: "নিচের ক্যামেরায় ছবি তুলুন",
  loading: "লোড হচ্ছে…",
};

const hi: Dict = {
  perm_title: 'कैमरा और लोकेशन',
  perm_body: 'रिपोर्ट के लिए अभी ली गई फ़ोटो और आपकी असली लोकेशन चाहिए। फ़ोन की और कोई चीज़ नहीं पढ़ी जाती।',
  perm_allow: 'अनुमति दें',
  perm_settings: 'सेटिंग्स खोलें',
  gps_waiting: 'आपकी लोकेशन खोजी जा रही है…',
  gps_ok: 'GPS ±{a} मी',
  gps_weak: 'GPS बहुत कमज़ोर (±{a} मी)। खुली जगह में जाएँ।',
  gps_off: 'लोकेशन चालू करें। आपको उसी जगह पर होना चाहिए।',
  gps_mocked: 'नकली लोकेशन वाला ऐप चालू है। रिपोर्ट करने के लिए उसे बंद करें।',
  shutter_hint: 'समस्या की ओर कैमरा करके दबाएँ',
  what: 'समस्या क्या है?',
  cat_garbage: 'कचरा / डंपिंग',
  cat_drain: 'जाम नाली / सीवेज',
  cat_road: 'गड्ढा / टूटी सड़क',
  cat_streetlight: 'स्ट्रीटलाइट बंद',
  cat_water: 'पानी की आपूर्ति / रिसाव',
  cat_toilet: 'सार्वजनिक शौचालय — बंद, अनुपयोगी या गंदा',
  cat_other: 'अन्य नागरिक समस्या',
  note: 'नोट जोड़ें (चाहें तो)',
  slide: 'भेजने के लिए खिसकाएँ',
  sending: 'भेजा जा रहा है…',
  retake: 'फिर से लें',
  queued: 'फ़ोन में रख लिया। नेट लौटते ही अपने-आप चला जाएगा।',
  queue_n: '{n} भेजने के लिए बाकी',
  queue_failed: 'रखी गई एक रिपोर्ट नहीं ली गई: {e}',
  res_title: 'रिपोर्ट दर्ज हुई',
  res_live: 'अब यह मैप पर दिख रही है।',
  res_review: 'मैप पर दिखने से पहले एक मॉडरेटर इसे देखेगा।',
  res_dup: 'यह पहले ही किसी ने बताया है। आपको गवाह के रूप में गिना गया।',
  res_recur: 'यह जगह पहले ठीक बताई गई थी। दोबारा होने के रूप में दर्ज हुई।',
  res_ward: 'वार्ड {n}',
  res_status: 'स्थिति: {s}',
  works_none: 'इस जगह पर किसी काम का रिकॉर्ड नहीं है।',
  open_site: 'वेबसाइट पर खोलें',
  done: 'हो गया',
  status_open: 'अनसुलझी',
  status_claimed: 'पुष्टि जारी',
  status_resolved: 'सुलझ गई',
  nearby: 'हाल की रिपोर्टें',
  nearby_empty: 'दिखाने के लिए कोई रिपोर्ट नहीं।',
  flag: 'शिकायत',
  hide: 'छिपाएँ',
  flag_title: 'इस रिपोर्ट में क्या गलत है?',
  fr_not_an_issue: 'असली समस्या नहीं',
  fr_wrong_location: 'ग़लत जगह',
  fr_duplicate: 'दूसरी रिपोर्ट की नकल',
  fr_inappropriate: 'आपत्तिजनक फ़ोटो',
  fr_fake_or_old_photo: 'फ़र्ज़ी या पुरानी फ़ोटो',
  fr_other: 'कुछ और',
  flag_sent: 'धन्यवाद। एक मॉडरेटर इसे देखेगा।',
  hidden: 'इस फ़ोन पर छिपा दिया।',
  cancel: 'रद्द करें',
  close: 'बंद करें',
  terms_title: 'शुरू करने से पहले',
  terms_body:
    'सिर्फ़ असली सार्वजनिक समस्याएँ बताएँ, अभी, जहाँ आप खड़े हैं वहीं ली गई फ़ोटो के साथ।\n\nफ़ोटो या नोट में किसी का चेहरा, गाड़ी का नंबर या निजी जानकारी नहीं। गाली-गलौज, झूठी या आपत्तिजनक रिपोर्टें मॉडरेटर हटा देते हैं, और ऐसी रिपोर्ट डालने वाले खाते रोक दिए जाते हैं।\n\nकोई रिपोर्ट गलत लगे तो "शिकायत" दबाएँ; आप उसे अपने फ़ोन पर छिपा भी सकते हैं।',
  terms_read: 'पूरी शर्तें पढ़ें',
  terms_agree: 'मैं सहमत हूँ',
  lang: 'भाषा',
  works_until: "वारंटी {d} तक। ठेकेदार को मुफ़्त में खराबी ठीक करनी होगी।",
  works_contractor: "ठेकेदार: {c}",
  works_checked: "मॉडरेटर द्वारा जाँचे गए साइट बोर्ड से।",
  more: "और",
  grp_places: "मैप और इलाक़े",
  grp_account: "जवाबदेही",
  grp_services: "सेवाएँ",
  grp_part: "भाग लें",
  grp_about: "परिचय",
  sec_kasa: "पूरा रिपोर्ट मैप",
  sec_ward: "आपका वार्ड",
  sec_districts: "ज़िले",
  sec_data: "ज़मीनी सच",
  sec_works: "सरकारी काम की वारंटी",
  sec_promises: "वादे",
  sec_noticeboard: "नेताओं से पूछें",
  sec_municipality: "नगरपालिका और पैसा",
  sec_analytics: "सार्वजनिक आँकड़े",
  sec_digest: "साप्ताहिक वार्ड सार",
  sec_schools: "स्कूल",
  sec_toilets: "सार्वजनिक शौचालय",
  sec_waste: "कचरा कहाँ जाता है",
  sec_snakes: "साँप और बचावकर्ता",
  sec_dogs: "मोहल्ले के कुत्ते",
  sec_pandals: "स्वच्छ पंडाल",
  sec_adopt: "एक जगह गोद लें",
  sec_communities: "स्वयंसेवी समूह",
  sec_routes: "पैदल, दौड़, साइकिल",
  sec_assistant: "परिष्कार से पूछें",
  sec_addtown: "अपना शहर मैप पर लाएँ",
  sec_suggest: "नया फ़ीचर सुझाएँ",
  sec_join: "जुड़ें",
  sec_circle: "चक्र",
  sec_blueprint: "खाका",
  sec_methodology: "यह कैसे काम करता है",
  sec_rules: "नियम",
  sec_privacy: "निजता",
  sec_terms: "शर्तें",
  sec_grievance: "शिकायत अधिकारी",
  sec_changelog: "नया क्या है",
  grp_here: "इसी जगह से",
  school_check: "स्कूल की जाँच करें",
  add_photo: "+ एक और फ़ोटो ({n}/{max})",
  adding_hint: "उसी समस्या की एक और फ़ोटो लें",
  adding_done: "रिपोर्ट पर लौटें",
  issue_more: "ठीक-ठीक क्या समस्या है (वैकल्पिक)",
  open_report: "रिपोर्ट खोलें",
  who_site: "कौन ज़िम्मेदार है, कहाँ शिकायत करें",
  rules_gps: "आपका जीपीएस: ±{a} मी",
  ev_need_photo: "नीचे कैमरे से फ़ोटो लें",
  loading: "लोड हो रहा है…",
};

const DICTS: Record<Lang, Dict> = { en, bn, hi };
export type Key = keyof Dict;

let current: Lang = pickDefault();
const listeners = new Set<() => void>();

function pickDefault(): Lang {
  const code = getLocales()[0]?.languageCode;
  return code === 'bn' || code === 'hi' ? code : 'en';
}

export async function loadLang() {
  const saved = await AsyncStorage.getItem('lang');
  if (saved === 'en' || saved === 'bn' || saved === 'hi') current = saved;
  listeners.forEach((f) => f());
}

export function getLang() { return current; }

export function setLang(l: Lang) {
  current = l;
  AsyncStorage.setItem('lang', l).catch(() => {});
  listeners.forEach((f) => f());
}

export function onLang(f: () => void) {
  listeners.add(f);
  return () => { listeners.delete(f); };
}

function fill(s: string, vars: Record<string, string | number>) {
  return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : ''));
}

export function t(key: Key, vars: Record<string, string | number> = {}) {
  return fill(DICTS[current][key] ?? en[key] ?? key, vars);
}

/* Wording shared with kasa.html (siteText.ts), for the report sheet, evidence and sub-types. */
export function st(key: string, vars: Record<string, string | number> = {}) {
  return fill(SITE[current][key] ?? SITE.en[key] ?? key, vars);
}

/* The app's own short category names first, then the site's for every other category. */
export function catLabel(cat: string) {
  return hasKey('cat_' + cat) ? t(('cat_' + cat) as Key) : st('cat_' + cat);
}

export function ago(iso: string) {
  const m = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 1) return st('ago_now');
  if (m < 60) return st('ago_m', { n: m });
  if (m < 1440) return st('ago_h', { n: Math.floor(m / 60) });
  return st('ago_d', { n: Math.floor(m / 1440) });
}

export function duration(m: number) {
  if (m < 60) return st('dur_m', { n: Math.round(m) });
  if (m < 1440) return st('dur_h', { n: Math.floor(m / 60) });
  return st('dur_d', { n: Math.floor(m / 1440) });
}

export function fmtDate(d: string | number | Date) {
  return new Date(d).toLocaleDateString({ en: 'en-IN', bn: 'bn-IN', hi: 'hi-IN' }[current], { day: 'numeric', month: 'short', year: 'numeric' });
}

export function hasKey(key: string): key is Key {
  return key in en;
}

/* Server rejections arrive as KASA_* codes with optional JSON in hint, like on the site. */
export function errorText(key: string, vars: Record<string, string | number> = {}) {
  const s = ERRORS[current][key] ?? ERRORS.en[key] ?? ERRORS[current].generic ?? ERRORS.en.generic;
  return fill(s, vars);
}
