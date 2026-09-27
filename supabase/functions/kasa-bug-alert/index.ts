// Supabase Edge Function: emails the moderation team when someone uses "Report a bug".
//
// The database calls this after every new bug report. It only sends bug reports the
// database hands out (saved and not yet emailed), all in one email, so calling it
// directly can't invent a report or send anything twice.
//
// Deploy:  supabase functions deploy kasa-bug-alert
// Secrets: RESEND_API_KEY   (shared with kasa-flag-alert and p2040-signup-alert)
//          FLAG_ALERT_FROM  (optional; same sender as the flag alerts)
//          SITE_URL         (optional; default https://archiboltmusk.github.io/Purulia)

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const FROM = Deno.env.get('FLAG_ALERT_FROM') || 'Parishkar Purulia <onboarding@resend.dev>';
const SITE = (Deno.env.get('SITE_URL') || 'https://archiboltmusk.github.io/Purulia').replace(/\/$/, '');

interface Bug { id: string; what: string; email: string | null; page_url: string | null; user_agent: string | null; errors: number; at: string }

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function render(bugs: Bug[]): { subject: string; text: string } {
  const lines = bugs.map(b => [
    `• ${b.what.length > 400 ? b.what.slice(0, 400) + '…' : b.what}`,
    `  Page: ${b.page_url || 'unknown'}`,
    `  Browser: ${(b.user_agent || 'unknown').slice(0, 160)}${b.errors ? ` · ${b.errors} error message${b.errors === 1 ? '' : 's'} attached` : ''}`,
    b.email ? `  Reply to: ${b.email}` : '',
  ].filter(Boolean).join('\n'));
  return {
    subject: `${bugs.length} new bug report${bugs.length === 1 ? '' : 's'} — Parishkar Purulia`,
    text: ['New website bug reports:', '', ...lines, '',
      `See the details and close them: ${SITE}/admin.html`, '',
      'You get this because you are on the Parishkar moderation team.'].join('\n'),
  };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });
  if (!RESEND_KEY) return reply(503, { error: 'email not configured (set RESEND_API_KEY)' });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data, error } = await admin.rpc('kasa_bug_alerts_claim', { p_limit: 50 });
  if (error) return reply(500, { error: error.message });
  const bugs = (data?.bugs ?? []) as Bug[];
  const to = (data?.to ?? []) as string[];
  if (!bugs.length) return reply(200, { sent: 0 });
  const ids = bugs.map(b => b.id);
  if (!to.length){
    await admin.rpc('kasa_bug_alerts_done', { p_ids: ids, p_error: 'no team member has an email' });
    return reply(200, { sent: 0, reason: 'no recipients' });
  }

  const { subject, text } = render(bugs);
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json',
               'Idempotency-Key': `kasa-bugs-${ids.join(',').slice(0, 200)}` },
    body: JSON.stringify({ from: FROM, to, subject, text }),
  }).catch(e => ({ ok: false, status: 0, text: async () => String(e) }) as Response);
  const err = res.ok ? null : `Resend ${res.status}: ${(await res.text()).slice(0, 200)}`;
  await admin.rpc('kasa_bug_alerts_done', { p_ids: ids, p_error: err });
  return reply(err ? 502 : 200, err ? { error: err } : { sent: bugs.length, to: to.length });
});
