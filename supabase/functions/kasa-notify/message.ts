// Notification text for nearby-report alerts, in the subscriber's language.
// Kept free of Deno/npm imports so it can be unit-tested with Node.

const CATS: Record<string, [string, string, string]> = {
  garbage: ['Garbage', 'আবর্জনা', 'कचरा'],
  drain: ['Blocked drain', 'বন্ধ নর্দমা', 'जाम नाली'],
  road: ['Broken road', 'ভাঙা রাস্তা', 'टूटी सड़क'],
  streetlight: ['Streetlight out', 'রাস্তার আলো নেই', 'स्ट्रीटलाइट बंद'],
  water: ['Water problem', 'জলের সমস্যা', 'पानी की समस्या'],
  missing: ['Broken public property', 'ভাঙা সরকারি সম্পত্তি', 'टूटी सार्वजनिक संपत्ति'],
  encroachment: ['Encroachment', 'দখল', 'अतिक्रमण'],
  illegal_construction: ['Illegal construction', 'বেআইনি নির্মাণ', 'अवैध निर्माण'],
  illegal_mining: ['Illegal mining', 'বেআইনি খনন', 'अवैध खनन'],
  illegal_other: ['Illegal activity', 'বেআইনি কার্যকলাপ', 'अवैध गतिविधि'],
  other: ['Civic problem', 'নাগরিক সমস্যা', 'नागरिक समस्या'],
};

const TEXT = {
  en: { title: 'New report near you', body: '{cat} · {d} m away{ward}. Is it real? Tap to confirm or rate it.', ward: ' · Ward {n}' },
  bn: { title: 'আপনার কাছে নতুন রিপোর্ট', body: '{cat} · {d} মিটার দূরে{ward}। এটা কি সত্যি? নিশ্চিত বা রেটিং দিতে ট্যাপ করুন।', ward: ' · ওয়ার্ড {n}' },
  hi: { title: 'आपके पास नई रिपोर्ट', body: '{cat} · {d} मीटर दूर{ward}। क्या यह सच है? पुष्टि या रेटिंग के लिए टैप करें।', ward: ' · वार्ड {n}' },
};

export interface ReportSummary { id: string; category: string; ward_no: number | null }

export function buildMessage(report: ReportSummary, lang: string, distanceM: number, pageUrl: string) {
  const key = (lang in TEXT ? lang : 'en') as keyof typeof TEXT;
  const i = key === 'bn' ? 1 : key === 'hi' ? 2 : 0;
  const cat = (CATS[report.category] ?? CATS.other)[i];
  const t = TEXT[key];
  const ward = report.ward_no ? t.ward.replace('{n}', String(report.ward_no)) : '';
  const d = Math.max(10, Math.round(distanceM / 10) * 10);
  return {
    title: t.title,
    body: t.body.replace('{cat}', cat).replace('{d}', String(d)).replace('{ward}', ward),
    url: `${pageUrl}?report=${encodeURIComponent(report.id)}`,
    tag: `kasa-${report.id}`,
  };
}

/** Push services answer 404/410 when a subscription is gone for good. */
export function isGone(statusCode: number | undefined): boolean {
  return statusCode === 404 || statusCode === 410;
}
