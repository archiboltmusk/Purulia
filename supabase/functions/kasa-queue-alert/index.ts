// Supabase Edge Function: once a day, emails the moderation team if anything has waited
// more than 72 hours in a queue (counts only, no names or content).
//
// Runs daily from pg_cron. It only sends what the database hands out: nothing waiting means
// no email, and calling it again the same day sends nothing twice.
//
// Deploy:  supabase functions deploy kasa-queue-alert
// Secrets: RESEND_API_KEY   (shared with the other alerts)
//          FLAG_ALERT_FROM  (sender; must be on a domain verified in Resend)
//          SITE_URL         (optional; default https://archiboltmusk.github.io/Purulia)

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const FROM = Deno.env.get('FLAG_ALERT_FROM') || 'Parishkar Purulia <onboarding@resend.dev>';
const SITE = (Deno.env.get('SITE_URL') || 'https://archiboltmusk.github.io/Purulia').replace(/\/$/, '');

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });
  if (!RESEND_KEY) return reply(503, { error: 'email not configured (set RESEND_API_KEY)' });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data, error } = await admin.rpc('kasa_queue_alert_claim');
  if (error) return reply(500, { error: error.message });
  const items = (data?.items ?? {}) as Record<string, number>;
  const to = (data?.to ?? []) as string[];
  const total = Object.values(items).reduce((a, n) => a + n, 0);
  if (!total || !to.length) return reply(200, { sent: false, waiting: total });

  const text = ['These have waited more than 3 days for a moderator:', '',
    ...Object.entries(items).map(([q, n]) => `- ${q}: ${n}`), '',
    `Open the queues: ${SITE}/admin.html`, '',
    "If you can't get to them, hand them to another moderator so nothing sits. You get this because you are on the Parishkar moderation team; it comes at most once a day, only when something is waiting."].join('\n');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `kasa-queue-${data.day}` },
    body: JSON.stringify({ from: FROM, to, subject: `${total} item${total === 1 ? '' : 's'} waiting over 3 days for a moderator`, text }),
  }).catch(e => ({ ok: false, status: 0, text: async () => String(e) }) as Response);
  const err = res.ok ? null : `Resend ${res.status}: ${(await res.text()).slice(0, 200)}`;
  await admin.rpc('kasa_queue_alert_done', { p_day: data.day, p_error: err });
  return reply(err ? 502 : 200, { sent: !err, waiting: total, error: err });
});
