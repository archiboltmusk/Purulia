// Supabase Edge Function: the Monday ward digest by email.
//
// pg_cron calls this on Monday mornings. It asks the database for last week's
// numbers (public data only), at most once per week, and emails them:
// to `weekly_digest_to` (e.g. the municipality) with the team copied, or —
// while that setting is empty — to the team only, as a preview.
//
// Deploy:  supabase functions deploy kasa-weekly-digest
// Secrets: RESEND_API_KEY      (required; shared with the other alerts)
//          DIGEST_FROM         (optional; default "Parishkar Purulia <onboarding@resend.dev>")
//          SITE_URL            (optional; default https://archiboltmusk.github.io/Purulia)

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const FROM = Deno.env.get('DIGEST_FROM') || 'Parishkar Purulia <onboarding@resend.dev>';
const SITE = (Deno.env.get('SITE_URL') || 'https://archiboltmusk.github.io/Purulia').replace(/\/$/, '');

interface Ward { ward: number; councillor: string | null; new: number; fixed: number; open: number; overdue: number;
  oldest: { id: string; category: string; landmark: string | null; days: number }[] }
interface Digest { week_start: string; week_end: string; to: string[]; team: string[]; wards: Ward[] }

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const day = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const label = (c: string) => c.replace(/_/g, ' ');

function render(d: Digest, preview: boolean): { subject: string; text: string } {
  const week = `${day(d.week_start)} – ${day(d.week_end)}`;
  const sum = (k: 'new' | 'fixed' | 'open' | 'overdue') => d.wards.reduce((n, w) => n + w[k], 0);
  const lines: string[] = [];
  if (preview) lines.push('PREVIEW — sent only to the Parishkar team. Set weekly_digest_to to send it to the municipality.', '');
  lines.push(`Parishkar Purulia — ward digest for ${week}`, '',
    `Across Purulia town: ${sum('new')} new reports, ${sum('fixed')} verified fixed (confirmed by neighbours on the spot), `
    + `${sum('open')} still unresolved, of which ${sum('overdue')} are past their deadline.`, '');
  if (!d.wards.length) lines.push('No reports in any ward this week.');
  for (const w of d.wards) {
    lines.push(`Ward ${w.ward}${w.councillor ? ` (Councillor ${w.councillor})` : ''}: `
      + `${w.new} new · ${w.fixed} fixed · ${w.open} unresolved${w.overdue ? ` · ${w.overdue} overdue` : ''}`);
    for (const o of w.oldest) lines.push(`   – ${label(o.category)}${o.landmark ? ', ' + o.landmark : ''}: waiting ${o.days} days — ${SITE}/kasa.html?report=${encodeURIComponent(o.id)}`);
    lines.push(`   Full week: ${SITE}/digest.html?ward=${w.ward}&week=${d.week_start}`, '');
  }
  lines.push('Reports are residents\' allegations, not verified facts. A problem counts as fixed only when neighbours confirm it on the spot.',
    `All numbers: ${SITE}/analytics.html · To respond on the record, reply to this email.`);
  return { subject: `${preview ? '[Preview] ' : ''}Purulia ward digest, ${week}: ${sum('open')} unresolved, ${sum('overdue')} overdue`, text: lines.join('\n') };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });
  if (!RESEND_KEY) return reply(503, { error: 'email not configured (RESEND_API_KEY missing)' });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data, error } = await admin.rpc('kasa_weekly_digest_claim');
  if (error) return reply(500, { error: error.message });
  if (!data) return reply(200, { sent: false, reason: 'already sent this week' });
  const d = data as Digest;
  const preview = !d.to.length;
  const to = preview ? d.team : d.to;
  if (!to.length) {
    await admin.rpc('kasa_weekly_digest_done', { p_week: d.week_start, p_error: 'no recipients' });
    return reply(200, { sent: false, reason: 'no recipients' });
  }
  const { subject, text } = render(d, preview);
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `kasa-digest-${d.week_start}` },
    body: JSON.stringify({ from: FROM, to, subject, text, ...(!preview && d.team.length ? { cc: d.team, reply_to: d.team[0] } : {}) }),
  }).catch(e => ({ ok: false, status: 0, text: async () => String(e) }) as Response);
  const err = res.ok ? null : `Resend ${res.status}: ${(await res.text()).slice(0, 200)}`;
  await admin.rpc('kasa_weekly_digest_done', { p_week: d.week_start, p_error: err });
  return reply(err ? 502 : 200, err ? { error: err } : { sent: true, preview, wards: d.wards.length });
});
