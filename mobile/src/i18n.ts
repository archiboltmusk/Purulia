import { getLocales } from 'expo-localization';
import AsyncStorage from 'expo-sqlite/kv-store';
import { ERRORS } from './errors';

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

export function hasKey(key: string): key is Key {
  return key in en;
}

/* Server rejections arrive as KASA_* codes with optional JSON in hint, like on the site. */
export function errorText(key: string, vars: Record<string, string | number> = {}) {
  const s = ERRORS[current][key] ?? ERRORS.en[key] ?? ERRORS[current].generic ?? ERRORS.en.generic;
  return fill(s, vars);
}
