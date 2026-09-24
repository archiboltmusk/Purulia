// Supabase Edge Function: alerts people near a new report ("Is it real?").
//
// The page calls this right after a report is filed. The database hands out
// each report exactly once (kasa_notify_targets), only while it is fresh,
// public and not a duplicate, and only to devices whose owner chose an area
// that covers it. The subscriber list never reaches a browser.
//
// Deploy:  supabase functions deploy kasa-notify
// Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:...),
//          KASA_PAGE_URL (e.g. https://your-site/kasa.html)
//          Generate keys once with:  npx web-push generate-vapid-keys

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import webpush from 'npm:web-push@3.6.7';
import { buildMessage, isGone } from './message.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PAGE_URL = Deno.env.get('KASA_PAGE_URL') ?? '';
const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

interface Target { id: string; endpoint: string; p256dh: string; auth: string; lang: string; distance_m: number }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });
  if (!VAPID_PUBLIC || !VAPID_PRIVATE || !VAPID_SUBJECT || !PAGE_URL) return reply(503, { error: 'alerts not configured' });

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const asUser = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
  const { data: { user } } = await asUser.auth.getUser(jwt);
  if (!user) return reply(401, { error: 'sign-in required' });

  let reportId = '';
  try { reportId = String((await req.json()).report_id ?? ''); } catch (_) { /* fallthrough */ }
  if (!reportId) return reply(400, { error: 'report_id required' });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data, error } = await admin.rpc('kasa_notify_targets', { p_report_id: reportId });
  if (error) return reply(500, { error: error.message });
  if (!data?.report) return reply(200, { sent: 0 });

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
  const targets: Target[] = data.targets ?? [];
  let sent = 0;
  for (let i = 0; i < targets.length; i += 20) {
    await Promise.all(targets.slice(i, i + 20).map(async (t) => {
      const msg = buildMessage(data.report, t.lang, t.distance_m, PAGE_URL);
      let ok = false, gone = false;
      try {
        await webpush.sendNotification({ endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } },
          JSON.stringify(msg), { TTL: 3 * 3600, urgency: 'normal' });
        ok = true;
        sent++;
      } catch (e) {
        gone = isGone((e as { statusCode?: number }).statusCode);
      }
      await admin.rpc('kasa_push_result', { p_sub_id: t.id, p_ok: ok, p_gone: gone });
    }));
  }
  return reply(200, { sent, targets: targets.length });
});
