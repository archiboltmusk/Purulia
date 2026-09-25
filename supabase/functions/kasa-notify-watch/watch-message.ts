// Notification text for "watch this report" status-change alerts, in the
// watcher's language. Kept free of Deno/npm imports so it can be unit-tested
// with Node, same as kasa-notify/message.ts.

const TEXT = {
  en: {
    claimed: 'Someone says this is fixed — confirm or dispute',
    quorum_reached: 'Confirmed — waiting out the challenge window',
    resolved: 'Marked fixed and confirmed',
    claim_rejected: 'Back to open — the claimed fix wasn’t confirmed',
    claim_expired: 'Back to open — the claimed fix wasn’t confirmed',
    disputed: 'A neighbour disputed the fix',
  },
  bn: {
    claimed: 'একজন বলছেন এটি ঠিক হয়েছে — নিশ্চিত করুন বা বিরোধিতা করুন',
    quorum_reached: 'নিশ্চিত হয়েছে — চ্যালেঞ্জ উইন্ডোর শেষ হওয়ার অপেক্ষায়',
    resolved: 'ঠিক করা হয়েছে এবং নিশ্চিত হয়েছে',
    claim_rejected: 'আবার খোলা — দাবিকৃত সমাধান নিশ্চিত হয়নি',
    claim_expired: 'আবার খোলা — দাবিকৃত সমাধান নিশ্চিত হয়নি',
    disputed: 'একজন প্রতিবেশী সমাধানকে বিরোধিতা করেছেন',
  },
  hi: {
    claimed: 'किसी ने कहा कि यह ठीक हो गया — पुष्टि या आपत्ति करें',
    quorum_reached: 'पुष्टि हो गई — चुनौती विंडो खत्म होने की प्रतीक्षा',
    resolved: 'ठीक हो गया और पुष्टि हो गई',
    claim_rejected: 'फिर खुला — दावा किया गया समाधान पुष्ट नहीं हुआ',
    claim_expired: 'फिर खुला — दावा किया गया समाधान पुष्ट नहीं हुआ',
    disputed: 'एक पड़ोसी ने समाधान पर आपत्ति जताई',
  },
};

const TITLE = { en: 'Report update', bn: 'রিপোর্ট আপডেট', hi: 'रिपोर्ट अपडेट' };

export interface WatchEvent { report_id: string; kind: string }

export function buildMessage(ev: WatchEvent, lang: string, pageUrl: string) {
  const key = (lang in TEXT ? lang : 'en') as keyof typeof TEXT;
  const body = TEXT[key][ev.kind as keyof (typeof TEXT)['en']] ?? TEXT.en[ev.kind as keyof typeof TEXT.en] ?? TEXT.en.claimed;
  return {
    title: TITLE[key] ?? TITLE.en,
    body,
    url: `${pageUrl}?report=${encodeURIComponent(ev.report_id)}`,
    tag: `kasa-watch-${ev.report_id}`,
  };
}

/** Push services answer 404/410 when a subscription is gone for good. */
export function isGone(statusCode: number | undefined): boolean {
  return statusCode === 404 || statusCode === 410;
}
