// Supabase Edge Function: the weekly email to each office (Purulia Municipality for town
// wards, the BDO for a village block) listing its open reports. Reports still open 14 days
// past their deadline also go to the District Magistrate (office 'dm'), naming who was told.
//
// Runs every Monday from pg_cron. It only writes to offices the database hands out: ones
// with open reports that haven't had this week's letter. An office with nothing open gets
// nothing, and calling it again the same week sends nothing twice.
//
// Deploy:  supabase functions deploy kasa-office-letters
// Secrets: RESEND_API_KEY   (shared with the other alerts)
//          FLAG_ALERT_FROM  (sender; must be on a domain verified in Resend)
//          SITE_URL         (optional; default https://archiboltmusk.github.io/Purulia)

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const FROM = Deno.env.get('FLAG_ALERT_FROM') || 'Parishkar Purulia <onboarding@resend.dev>';
const SITE = (Deno.env.get('SITE_URL') || 'https://archiboltmusk.github.io/Purulia').replace(/\/$/, '') + '/';

interface Report { id: string; created_at: string; ward_no: number | null; category: string; landmark: string | null; sla_days: number | null; councillor: string | null; via?: string | null; kind?: string | null; block?: string | null }
interface Office { office: string; title: string; addressee: string; emails: string[]; reports: Report[] }

const KIND: Record<string, string> = { dry_tap: 'tap fitted but no water', pump_broken: 'hand pump not working',
  no_doctor: 'no doctor present', no_medicine: 'medicines not in stock', centre_closed: 'closed in working hours',
  dirty_spot: 'dirty spot', garbage_dump: 'garbage dump', bin_full: 'dustbin not cleaned', vehicle_missed: 'garbage van did not come',
  not_swept: 'sweeping not done', burning: 'garbage being burnt', construction: 'construction debris', dead_animal: 'dead animal',
  toilet_dirty: 'public toilet not cleaned', toilet_no_water: 'no water in public toilet', toilet_no_power: 'no electricity in public toilet',
  toilet_blocked: 'public toilet blocked', toilet_locked: 'public toilet locked', open_defecation: 'open defecation',
  yellow_spot: 'public urination spot', drain_blocked: 'drain blocked', sewer_overflow: 'sewage or storm water overflow',
  stagnant_water: 'stagnant water', septic_overflow: 'septic tank overflowing', sludge_dumped: 'faecal sludge dumped in the open',
  open_manhole: 'open manhole or drain', manhole_entry: 'worker sent into a sewer without safety gear',
  water_leak: 'water pipe leaking', pothole: 'pothole', light_out: 'streetlight not working' };

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// Same wording as the drafts in admin.html's "Letters to offices".
function render(o: Office): { subject: string; text: string } {
  const now = Date.now(), age = (r: Report) => Math.floor((now - Date.parse(r.created_at)) / 86400000);
  const overdue = (r: Report) => age(r) > (r.sla_days || 7);
  const line = (r: Report) => {
    const where = r.ward_no != null ? `Ward ${r.ward_no}${r.councillor ? ` (Councillor ${r.councillor})` : ''}` : r.block ? `${r.block} block` : r.via ? r.via.replace(/^BDO, /, '') + ' block' : `${o.office} block`;
    const what = r.category + (r.kind && KIND[r.kind] ? ` (${KIND[r.kind]})` : '');
    const past = age(r) - (r.sla_days || 7);
    if (r.via) return `- ${what}${r.landmark ? ' near ' + r.landmark : ''}, ${where}: open ${age(r)} days, ${past} days past its ${r.sla_days || 7}-day deadline. Sent weekly to ${r.via}. Photo and location: ${SITE}kasa.html?report=${r.id}`;
    return `- ${what}${r.landmark ? ' near ' + r.landmark : ''}, ${where}: open ${age(r)} days${overdue(r) ? ', overdue' : ''}. Photo and location: ${SITE}kasa.html?report=${r.id}`;
  };
  const n = o.reports.length, late = o.reports.filter(overdue).length;
  if (o.office === 'dm') return {
    subject: `${n} civic report${n === 1 ? '' : 's'} still open more than 14 days past deadline`,
    text: `To ${o.addressee},\n\nThe reports below were sent every week to the office responsible and are still open more than 14 days after their deadline. Each has a live-camera photo taken at the spot with GPS. We bring them to your notice for follow-up.\n\n${o.reports.map(line).join('\n')}\n\nWhen one is fixed, a resident photographs the fixed spot and it is marked resolved on the public record. If you would like to reply on the record, answer this email and we will publish your response next to the report.\n\nThis is a weekly summary, sent only in weeks when a report has gone this far past its deadline.\n\nParishkar Purulia\n${SITE}`,
  };
  const page = o.office === 'phed' ? SITE + 'kasa.html' : o.office === 'municipality' ? SITE + 'municipality.html' : SITE + 'ward.html?block=' + encodeURIComponent(o.office);
  const wards = o.office === 'municipality' ? '\n\nFor town wards, please pass each item to the attention of the Councillor of that ward.' : '';
  return {
    subject: `${n} open civic report${n === 1 ? '' : 's'} in your area${late ? `, ${late} overdue` : ''}`,
    text: `To ${o.addressee},\n\nResidents have reported the problems below on Parishkar Purulia. Each has a live-camera photo taken at the spot with GPS. They are still open.${wards}\n\n${o.reports.map(line).join('\n')}\n\nWhen one is fixed, a resident photographs the fixed spot and it is marked resolved on the public record. If you would like to reply on the record, answer this email and we will publish your response next to the report.\n\nAll reports for your area: ${page}\n\nThis is a weekly summary, sent only in weeks when something in your area is open.\n\nParishkar Purulia\n${SITE}`,
  };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });
  if (!RESEND_KEY) return reply(503, { error: 'email not configured (set RESEND_API_KEY)' });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data, error } = await admin.rpc('kasa_office_letters_claim');
  if (error) return reply(500, { error: error.message });
  const week = data?.week as string;
  const offices = (data?.offices ?? []) as Office[];
  const replyTo = (data?.reply_to ?? []) as string[];

  const results = [];
  for (const o of offices) {
    const { subject, text } = render(o);
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json',
                 'Idempotency-Key': `kasa-office-${o.office}-${week}` },
      body: JSON.stringify({ from: FROM, to: o.emails, subject, text, ...(replyTo.length ? { reply_to: replyTo } : {}) }),
    }).catch(e => ({ ok: false, status: 0, text: async () => String(e) }) as Response);
    const err = res.ok ? null : `Resend ${res.status}: ${(await res.text()).slice(0, 200)}`;
    await admin.rpc('kasa_office_letters_done', { p_office: o.office, p_week: week, p_error: err });
    results.push({ office: o.office, reports: o.reports.length, ok: !err });
  }
  return reply(results.some(r => !r.ok) ? 502 : 200, { week, sent: results.filter(r => r.ok).length, results });
});
