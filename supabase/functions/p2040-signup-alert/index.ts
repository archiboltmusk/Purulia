// Supabase Edge Function: emails new Purulia 2040 Join / Follow sign-ups via Resend.
//
// The database calls this after every sign-up. It sends only sign-ups the
// database hands out (saved and not yet emailed), so calling it directly
// can't send anything that wasn't really submitted, or send anything twice.
//
// Deploy:  supabase functions deploy p2040-signup-alert
// Secrets: RESEND_API_KEY                 (required; from resend.com → API Keys)
//          SIGNUP_ALERT_TO                (optional; default thelosthillproject@gmail.com)
//          SIGNUP_ALERT_FROM              (optional; default "Purulia 2040 <onboarding@resend.dev>",
//                                          which only delivers to your own Resend account's address
//                                          until you verify a domain in Resend)

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const TO = Deno.env.get('SIGNUP_ALERT_TO') || 'thelosthillproject@gmail.com';
const FROM = Deno.env.get('SIGNUP_ALERT_FROM') || 'Purulia 2040 <onboarding@resend.dev>';

interface Signup { id: string; kind: 'join' | 'follow'; name: string | null; role: string | null; location: string | null;
  contact: string; message: string | null; created_at: string }

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function render(s: Signup): { subject: string; text: string } {
  const when = new Date(s.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  if (s.kind === 'follow') {
    return { subject: `New follower: ${s.contact}`, text: `New follow sign-up on Purulia 2040\n\nEmail: ${s.contact}\nWhen: ${when} IST\n` };
  }
  const lines = [
    'New Join sign-up on Purulia 2040', '',
    `Name: ${s.name ?? ''}`, `Role: ${s.role ?? ''}`, `Location: ${s.location ?? 'Not provided'}`,
    `Contact: ${s.contact}`, `When: ${when} IST`, '', 'Message:', s.message ?? '(none)', '',
    'All sign-ups: https://archiboltmusk.github.io/Purulia/admin.html',
  ];
  return { subject: `New Join sign-up: ${s.name ?? s.contact} (${s.role ?? 'no role'})`, text: lines.join('\n') };
}

async function send(s: Signup): Promise<string | null> {
  const { subject, text } = render(s);
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json',
               'Idempotency-Key': `p2040-signup-${s.id}` },
    body: JSON.stringify({ from: FROM, to: [TO], subject, text,
      ...(s.contact.includes('@') ? { reply_to: s.contact } : {}) }),
  });
  return res.ok ? null : `Resend ${res.status}: ${(await res.text()).slice(0, 200)}`;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });
  if (!RESEND_KEY) return reply(503, { error: 'email alerts not configured (RESEND_API_KEY missing)' });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data, error } = await admin.rpc('kasa_signup_alerts_claim', { p_limit: 20 });
  if (error) return reply(500, { error: error.message });

  let sent = 0, failed = 0;
  for (const s of (data ?? []) as Signup[]) {
    const err = await send(s).catch(e => String(e));
    await admin.rpc('kasa_signup_alerts_done', { p_ids: [s.id], p_error: err });
    err ? failed++ : sent++;
  }
  return reply(200, { sent, failed });
});
