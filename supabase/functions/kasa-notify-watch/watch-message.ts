// Notification text for "watch this report" status-change alerts, in the
// watcher's language. Kept free of Deno/npm imports so it can be unit-tested
// with Node, same as kasa-notify/message.ts.

const TEXT = {
  en: {
    claimed: 'Someone says this is fixed — confirm or dispute',
    quorum_reached: 'Confirmed — waiting out the challenge window',
    resolved: 'Fixed. Tap to see the photo.',
    claim_rejected: 'Back to open — the claimed fix wasn’t confirmed',
    claim_expired: 'Back to open — the claimed fix wasn’t confirmed',
    disputed: 'A neighbour disputed the fix',
    sla_warning: 'Close to its fix deadline — tap for the countdown',
    sla_breached: 'Past its fix deadline and still open',
  },
  bn: {
    claimed: 'একজন বলছেন এটি ঠিক হয়েছে — নিশ্চিত করুন বা বিরোধিতা করুন',
    quorum_reached: 'নিশ্চিত হয়েছে — চ্যালেঞ্জ উইন্ডোর শেষ হওয়ার অপেক্ষায়',
    resolved: 'ঠিক হয়েছে। ছবি দেখতে ট্যাপ করুন।',
    claim_rejected: 'আবার খোলা — দাবিকৃত সমাধান নিশ্চিত হয়নি',
    claim_expired: 'আবার খোলা — দাবিকৃত সমাধান নিশ্চিত হয়নি',
    disputed: 'একজন প্রতিবেশী সমাধানকে বিরোধিতা করেছেন',
    sla_warning: 'সমাধানের সময়সীমার কাছাকাছি — গণনা দেখতে ট্যাপ করুন',
    sla_breached: 'সমাধানের সময়সীমা পার হয়েছে, এখনও খোলা',
  },
  hi: {
    claimed: 'किसी ने कहा कि यह ठीक हो गया — पुष्टि या आपत्ति करें',
    quorum_reached: 'पुष्टि हो गई — चुनौती विंडो खत्म होने की प्रतीक्षा',
    resolved: 'ठीक हो गया। फ़ोटो देखने के लिए टैप करें।',
    claim_rejected: 'फिर खुला — दावा किया गया समाधान पुष्ट नहीं हुआ',
    claim_expired: 'फिर खुला — दावा किया गया समाधान पुष्ट नहीं हुआ',
    disputed: 'एक पड़ोसी ने समाधान पर आपत्ति जताई',
    sla_warning: 'फिक्स की समय-सीमा नज़दीक — गिनती देखने के लिए टैप करें',
    sla_breached: 'फिक्स की समय-सीमा निकल गई, अभी भी खुला',
  },
};

const TITLE = { en: 'Report update', bn: 'রিপোর্ট আপডেট', hi: 'रिपोर्ट अपडेट' };

export interface WatchEvent { report_id: string; kind: string; image?: string | null }

export function buildMessage(ev: WatchEvent, lang: string, pageUrl: string) {
  const key = (lang in TEXT ? lang : 'en') as keyof typeof TEXT;
  const body = TEXT[key][ev.kind as keyof (typeof TEXT)['en']] ?? TEXT.en[ev.kind as keyof typeof TEXT.en] ?? TEXT.en.claimed;
  const isSla = ev.kind === 'sla_warning' || ev.kind === 'sla_breached';
  return {
    title: TITLE[key] ?? TITLE.en,
    body,
    url: `${pageUrl}?report=${encodeURIComponent(ev.report_id)}`,
    // SLA alerts get their own tag so they don't replace, or get replaced by,
    // a status-change notification for the same report in the phone's tray.
    tag: isSla ? `kasa-sla-${ev.report_id}` : `kasa-watch-${ev.report_id}`,
    // The after photo, shown in the notification where the phone supports it.
    ...(ev.kind === 'resolved' && ev.image ? { image: ev.image } : {}),
  };
}

/** Push services answer 404/410 when a subscription is gone for good. */
export function isGone(statusCode: number | undefined): boolean {
  return statusCode === 404 || statusCode === 410;
}
