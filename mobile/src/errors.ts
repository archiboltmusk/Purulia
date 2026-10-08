// Server error wording, copied from kasa-i18n.js so the app and the site say the same thing.
import type { Lang } from "./i18n";

export const ERRORS: Record<Lang, Record<string, string>> = {
  "en": {
    "generic": "Something went wrong. Please try again.",
    "upload": "Photo upload failed. Check your connection.",
    "session": "Couldn't start a secure session. Try again in a moment.",
    "KASA_GPS_WEAK": "GPS too weak (±{a} m). Step into the open and retry.",
    "KASA_GPS_REQUIRED": "Turn on location — you need to be at the spot.",
    "KASA_PHOTO_REUSED": "This photo has already been used. Take a new one.",
    "KASA_PHOTO_ELSEWHERE": "This photo matches one taken at a different place.",
    "KASA_PHOTO_STALE": "Take a new photo now — older uploads can’t be used.",
    "KASA_PHOTO_UNSAFE": "This photo can't be published.",
    "KASA_PHOTO_UNCHECKED": "Photo verification is busy. Try again in a minute.",
    "KASA_PHOTO_MISSING": "The photo did not upload. Try again.",
    "KASA_RATE_LIMIT": "Too many actions for now. Try again in an hour.",
    "KASA_OUTSIDE_AREA": "This location is outside West Bengal.",
    "KASA_BLOCKED": "This device has been blocked for abuse.",
    "KASA_PHOTO_OLD": "This photo was taken {ago}. Take a new one at the spot now.",
    "KASA_PHOTO_AI_EDITED": "This photo says it was made or edited with AI, so it can't be evidence. Take a new photo with the camera."
  },
  "bn": {
    "generic": "কিছু ভুল হয়েছে। আবার চেষ্টা করুন।",
    "upload": "ছবি আপলোড হলো না। সংযোগ দেখুন।",
    "session": "নিরাপদ সেশন শুরু করা গেল না। একটু পরে চেষ্টা করুন।",
    "KASA_GPS_WEAK": "GPS দুর্বল (±{a} মি)। খোলা জায়গায় গিয়ে চেষ্টা করুন।",
    "KASA_GPS_REQUIRED": "লোকেশন চালু করুন — আপনাকে ঘটনাস্থলে থাকতে হবে।",
    "KASA_PHOTO_REUSED": "এই ছবি আগেই ব্যবহার হয়েছে। নতুন ছবি তুলুন।",
    "KASA_PHOTO_ELSEWHERE": "এই ছবি অন্য জায়গায় তোলা একটি ছবির সঙ্গে মেলে।",
    "KASA_PHOTO_STALE": "এখনই নতুন ছবি তুলুন — পুরোনো আপলোড চলবে না।",
    "KASA_PHOTO_UNSAFE": "এই ছবি প্রকাশ করা যাবে না।",
    "KASA_PHOTO_UNCHECKED": "ছবি যাচাই ব্যস্ত। এক মিনিট পরে চেষ্টা করুন।",
    "KASA_PHOTO_MISSING": "ছবি আপলোড হয়নি। আবার চেষ্টা করুন।",
    "KASA_RATE_LIMIT": "এখন অনেক বেশি কাজ হয়ে গেছে। এক ঘণ্টা পরে চেষ্টা করুন।",
    "KASA_OUTSIDE_AREA": "জায়গাটি পশ্চিমবঙ্গের বাইরে।",
    "KASA_BLOCKED": "অপব্যবহারের জন্য এই ডিভাইস ব্লক করা হয়েছে।",
    "KASA_PHOTO_OLD": "এই ছবি তোলা হয়েছে {ago}। ঘটনাস্থলে এখনই নতুন ছবি তুলুন।",
    "KASA_PHOTO_AI_EDITED": "এই ছবিতে লেখা আছে এটি AI দিয়ে তৈরি বা বদলানো, তাই প্রমাণ হিসেবে চলবে না। ক্যামেরা দিয়ে নতুন ছবি তুলুন।"
  },
  "hi": {
    "generic": "कुछ गड़बड़ हुई। फिर कोशिश करें।",
    "upload": "फ़ोटो अपलोड नहीं हुई। कनेक्शन देखें।",
    "session": "सुरक्षित सत्र शुरू नहीं हो सका। थोड़ी देर में कोशिश करें।",
    "KASA_GPS_WEAK": "GPS कमज़ोर (±{a} मी)। खुली जगह में जाकर कोशिश करें।",
    "KASA_GPS_REQUIRED": "लोकेशन चालू करें — आपको मौके पर होना चाहिए।",
    "KASA_PHOTO_REUSED": "यह फ़ोटो पहले इस्तेमाल हो चुकी है। नई फ़ोटो लें।",
    "KASA_PHOTO_ELSEWHERE": "यह फ़ोटो किसी दूसरी जगह ली गई फ़ोटो से मिलती है।",
    "KASA_PHOTO_STALE": "अभी नई फ़ोटो लें — पुराने अपलोड नहीं चलेंगे।",
    "KASA_PHOTO_UNSAFE": "यह फ़ोटो प्रकाशित नहीं की जा सकती।",
    "KASA_PHOTO_UNCHECKED": "फ़ोटो जाँच व्यस्त है। एक मिनट बाद कोशिश करें।",
    "KASA_PHOTO_MISSING": "फ़ोटो अपलोड नहीं हुई। फिर कोशिश करें।",
    "KASA_RATE_LIMIT": "अभी बहुत ज़्यादा गतिविधि हो गई। एक घंटे बाद कोशिश करें।",
    "KASA_OUTSIDE_AREA": "यह जगह पश्चिम बंगाल से बाहर है।",
    "KASA_BLOCKED": "दुरुपयोग के कारण यह डिवाइस ब्लॉक है।",
    "KASA_PHOTO_OLD": "यह फ़ोटो {ago} ली गई थी। मौके पर अभी नई फ़ोटो लें।",
    "KASA_PHOTO_AI_EDITED": "इस फ़ोटो में लिखा है कि यह AI से बनी या बदली गई है, इसलिए यह सबूत नहीं बन सकती। कैमरे से नई फ़ोटो लें।"
  }
};
