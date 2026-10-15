// Public values only, the same ones the website ships in config.js.
export const SUPABASE_URL = 'https://cnmikcyvyamplbldiivp.supabase.co';
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNubWlrY3l2eWFtcGxibGRpaXZwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyMzY0MDEsImV4cCI6MjEwNTgxMjQwMX0.h4nOvb0GWz92A_GuH-RPX90wUIRvza4RvsD9TA-XiM0';
export const SITE_URL = 'https://archiboltmusk.github.io/Purulia/';
// Cloudflare worker (worker.js) that serves report links with a photo preview.
export const SHARE_URL = 'https://purulia.mahatoanupam002.workers.dev';
export const reportLink = (id: string) => `${SHARE_URL}/r/${encodeURIComponent(id)}`;
export const MAX_EXTRA_PHOTOS = 2;

// Same as the site's max_gps_accuracy_m default: a fix looser than this is not "at the spot".
export const MAX_GPS_ACCURACY_M = 60;
// Server tokens last capture_token_minutes (30); refresh a little early.
export const CAPTURE_TOKEN_TTL_MS = 25 * 60 * 1000;
