window.KASA_CONFIG = {
  SUPABASE_URL: 'https://cnmikcyvyamplbldiivp.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNubWlrY3l2eWFtcGxibGRpaXZwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyMzY0MDEsImV4cCI6MjEwNTgxMjQwMX0.h4nOvb0GWz92A_GuH-RPX90wUIRvza4RvsD9TA-XiM0',

  // Cloudflare Turnstile site key (public). Leave empty to disable the check.
  // The matching secret goes in Supabase → Authentication → Attack Protection.
  TURNSTILE_SITE_KEY: '',

  // Web-push public key for "new report near me" alerts and "watch this report". Leave
  // empty to hide both. Generated once with: npx web-push generate-vapid-keys
  // (private key → Supabase Edge Function secret, never committed here).
  VAPID_PUBLIC_KEY: 'BH3hEnOcgE09IJFunauOsatBLFuPdTBER6NwerwlOkrlOgVIXLtggjSaSH93irhxjksJkTJpbWsthBk5KtW5kSo',

  // World Air Quality Index token for the air-quality layer on map.html (free: https://aqicn.org/data-platform/token/).
  // Leave empty to fall back to WAQI's shared "demo" token, which is rate-limited and may return no stations.
  WAQI_API_KEY: '8b116d06bed9fc883f02ff38515f53f4b490547c',

  // Published on the legal pages and used for "Right of reply" requests.
  GRIEVANCE_EMAIL: 'thelosthillproject@gmail.com'
};
