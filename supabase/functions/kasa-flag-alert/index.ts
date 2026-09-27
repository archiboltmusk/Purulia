// Supabase Edge Function: tells the moderation team when reports are flagged, by
// email and/or Telegram (whichever is configured).
//
// The database calls this after every new flag. It only sends flags the
// database hands out (saved and not yet emailed), all in one email, so calling
// it directly can't invent a flag or send anything twice. Never includes who
// flagged or their note — only what and where, and a link to the admin page.
//
// Deploy:  supabase functions deploy kasa-flag-alert
// Secrets: RESEND_API_KEY     (email; shared with p2040-signup-alert)
//          TELEGRAM_BOT_TOKEN (Telegram; from @BotFather)
//          TELEGRAM_CHAT_ID   (Telegram; the moderators' group or channel id, e.g. -1001234567890)
//          At least one of email or Telegram must be set.
//          FLAG_ALERT_FROM    (optional; default "Parishkar Purulia <onboarding@resend.dev>",
//                              which only delivers to your own Resend address until you verify a domain)
//          SITE_URL           (optional; default https://archiboltmusk.github.io/Purulia)

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const FROM = Deno.env.get('FLAG_ALERT_FROM') || 'Parishkar Purulia <onboarding@resend.dev>';
const TG_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
const TG_CHAT = Deno.env.get('TELEGRAM_CHAT_ID') ?? '';
const SITE = (Deno.env.get('SITE_URL') || 'https://archiboltmusk.github.io/Purulia').replace(/\/$/, '');

interface Flag { report_id: string; user_id: string; reason: string; suggested_category: string | null; at: string;
  category: string; ward_no: number | null; block_name: string | null; landmark: string | null;
  moderation_status: string; flags: number }

const REASONS: Record<string, string> = {
  not_an_issue: 'not a real problem', wrong_category: 'wrong category', wrong_location: 'wrong location',
  duplicate: 'duplicate', inappropriate: 'inappropriate', fake_or_old_photo: 'fake or old photo', other: 'other',
};

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function render(flags: Flag[]): { subject: string; text: string } {
  const reports = new Set(flags.map(f => f.report_id)).size;
  const lines = flags.map(f => {
    const place = f.ward_no ? `Ward ${f.ward_no}` : f.block_name ? `${f.block_name} block` : 'place unknown';
    const why = REASONS[f.reason] ?? f.reason;
    const hidden = f.moderation_status === 'flagged' ? ' — now hidden pending review' : '';
    return `• ${f.category.replace(/_/g, ' ')} · ${place}${f.landmark ? ' · ' + f.landmark : ''}\n`
      + `  Flagged: ${why}${f.suggested_category ? ' (should be ' + f.suggested_category.replace(/_/g, ' ') + ')' : ''}`
      + ` · ${f.flags} flag${f.flags === 1 ? '' : 's'} so far${hidden}\n  ${SITE}/kasa.html?report=${encodeURIComponent(f.report_id)}`;
  });
  return {
    subject: `${flags.length} new flag${flags.length === 1 ? '' : 's'} on ${reports} report${reports === 1 ? '' : 's'} — Parishkar Purulia`,
    text: [`New flags waiting in the moderation queue:`, '', ...lines, '',
      `Review them: ${SITE}/admin.html`, '',
      'You get this because you are on the Parishkar moderation team.'].join('\n'),
  };
}

async function sendEmail(to: string[], keys: { report_id: string; user_id: string }[], subject: string, text: string): Promise<string | null> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json',
               'Idempotency-Key': `kasa-flags-${keys.map(k => k.report_id + k.user_id).join(',').slice(0, 200)}` },
    body: JSON.stringify({ from: FROM, to, subject, text }),
  }).catch(e => ({ ok: false, status: 0, text: async () => String(e) }) as Response);
  return res.ok ? null : `Resend ${res.status}: ${(await res.text()).slice(0, 200)}`;
}

async function sendTelegram(subject: string, text: string): Promise<string | null> {
  const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    // Plain text (no parse_mode) so landmarks can't break formatting; Telegram caps a message at 4096 characters.
    body: JSON.stringify({ chat_id: TG_CHAT, text: `${subject}\n\n${text}`.slice(0, 4000), disable_web_page_preview: true }),
  }).catch(e => ({ ok: false, status: 0, text: async () => String(e) }) as Response);
  return res.ok ? null : `Telegram ${res.status}: ${(await res.text()).slice(0, 200)}`;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });
  const telegram = !!(TG_TOKEN && TG_CHAT);
  if (!RESEND_KEY && !telegram) return reply(503, { error: 'alerts not configured (set RESEND_API_KEY and/or TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID)' });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data, error } = await admin.rpc('kasa_flag_alerts_claim', { p_limit: 50 });
  if (error) return reply(500, { error: error.message });
  const flags = (data?.flags ?? []) as Flag[];
  const to = RESEND_KEY ? (data?.to ?? []) as string[] : [];
  if (!flags.length) return reply(200, { sent: 0 });
  const keys = flags.map(f => ({ report_id: f.report_id, user_id: f.user_id }));
  if (!to.length && !telegram){
    await admin.rpc('kasa_flag_alerts_done', { p_keys: keys, p_error: 'no team member has an email' });
    return reply(200, { sent: 0, reason: 'no recipients' });
  }

  const { subject, text } = render(flags);
  const [emailErr, tgErr] = await Promise.all([
    to.length ? sendEmail(to, keys, subject, text) : null,
    telegram ? sendTelegram(subject, text) : null,
  ]);
  // Retry later only if nothing got through; one working channel is enough, and retrying would repeat it.
  const delivered = (to.length && !emailErr) || (telegram && !tgErr);
  const err = [emailErr, tgErr].filter(Boolean).join('; ') || null;
  await admin.rpc('kasa_flag_alerts_done', { p_keys: keys, p_error: delivered ? null : err });
  return reply(delivered ? 200 : 502, delivered ? { sent: flags.length, to: to.length, telegram, warning: err } : { error: err });
});
