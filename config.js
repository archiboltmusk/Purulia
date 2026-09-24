window.KASA_CONFIG = {
  SUPABASE_URL: 'https://cnmikcyvyamplbldiivp.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNubWlrY3l2eWFtcGxibGRpaXZwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyMzY0MDEsImV4cCI6MjEwNTgxMjQwMX0.h4nOvb0GWz92A_GuH-RPX90wUIRvza4RvsD9TA-XiM0',

  // Cloudflare Turnstile site key (public). Leave empty to disable the check.
  // The matching secret goes in Supabase → Authentication → Attack Protection.
  TURNSTILE_SITE_KEY: '',

  // Web-push public key for "new report near me" alerts. Leave empty to hide alerts.
  // Generate once with: npx web-push generate-vapid-keys (private key → Supabase secret)
  VAPID_PUBLIC_KEY: '',

  // Published on the legal pages and used for "Right of reply" requests.
  GRIEVANCE_EMAIL: 'grievance@puruliakasa.in'
};
