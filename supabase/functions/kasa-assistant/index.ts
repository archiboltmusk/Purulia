// Supabase Edge Function: the Bengali/Hindi/English help assistant (assistant.html), answered by Sarvam AI.
//
// Signed-in visitors (the site's anonymous sign-in) send the last few chat turns; this
// forwards them to Sarvam's chat API with a fixed system prompt about the site and returns
// the answer. Each visitor gets ASSISTANT_DAILY_LIMIT questions a day (kasa_assistant_take),
// so the API key can't be drained from one browser. Nothing is stored except that count.
//
// Secrets (Supabase → Edge Functions → Secrets; never in the repo):
//   SARVAM_API_KEY   from https://dashboard.sarvam.ai (required; unset = assistant off)
//   SARVAM_MODEL     optional, default sarvam-105b
// Deploy:  supabase functions deploy kasa-assistant

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SARVAM_KEY = Deno.env.get('SARVAM_API_KEY');
const MODEL = Deno.env.get('SARVAM_MODEL') || 'sarvam-105b';
const SARVAM_URL = 'https://api.sarvam.ai/v1/chat/completions';
const MAX_TURNS = 8, MAX_CHARS = 1200;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const LANGS: Record<string, string> = { en: 'English', bn: 'Bengali (বাংলা)', hi: 'Hindi (हिन्दी)' };

const SYSTEM = (lang: string) => `You are the help assistant of Parishkar Bengal, a free civic website for West Bengal, India.
Reply in ${LANGS[lang] || LANGS.en}, in simple words, at most about 150 words. Use short lists for steps.

What the site does (link pages by file name, e.g. kasa.html):
- kasa.html: report a civic problem (garbage, drain, streetlight, road, water, toilet...). It needs a live camera photo and real GPS at the spot; gallery photos and dropping a pin by hand are not allowed. Reports go to moderators, then the map; people can confirm, watch and claim a cleanup.
- Tapping any district, block, gram panchayat or town on the map shows who is responsible there (MLA, MP, councillors, BDO, DM) with sources.
- noticeboard.html: public demands to leaders. promises.html: leaders' promises and whether they were kept.
- grievance.html: personal grievances and right of reply. communities.html: volunteer groups. adopt.html: adopt a spot. dogs.html: community dog feeding spots.
- schools.html, toilets.html, waste.html, analytics.html, digest.html (weekly ward digest), data.html (sourced district facts), municipality.html.
- For official complaints: CPGRAMS (pgportal.gov.in) for central matters, the West Bengal CM grievance cell (cmo.wb.gov.in) for state matters, and an RTI application (Rs 10 fee, 30-day reply under the RTI Act 2005) for information.

Rules:
- Never invent numbers, names of officials, phone numbers or facts about a place. If you don't know, say so and point to the page where the sourced answer is.
- Not legal or medical advice; in an emergency say to call 112.
- Stay non-partisan: no opinions on parties or politicians.
- Only help with civic matters, using the site and contacting authorities. Politely decline anything else.`;

interface Turn { role: string; content: string }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });
  if (!SARVAM_KEY) return reply(503, { error: 'assistant_off' });

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const asUser = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
  const { data: { user } } = await asUser.auth.getUser(jwt);
  if (!user) return reply(401, { error: 'sign-in required' });

  let body: { messages?: Turn[]; lang?: string };
  try { body = await req.json(); } catch { return reply(400, { error: 'bad json' }); }
  const lang = LANGS[body.lang ?? ''] ? body.lang! : 'en';
  const turns = (Array.isArray(body.messages) ? body.messages : [])
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-MAX_TURNS)
    .map(m => ({ role: m.role, content: m.content.trim().slice(0, MAX_CHARS) }));
  while (turns.length && turns[0].role !== 'user') turns.shift();
  if (!turns.length || turns[turns.length - 1].role !== 'user') return reply(400, { error: 'no question' });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: allowed, error: limErr } = await admin.rpc('kasa_assistant_take', { p_user: user.id });
  if (limErr) { console.error('limit', limErr.message); return reply(500, { error: 'limit check failed' }); }
  if (!allowed) return reply(429, { error: 'daily_limit' });

  try {
    const res = await fetch(SARVAM_URL, {
      method: 'POST',
      headers: { 'api-subscription-key': SARVAM_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, temperature: 0.3, max_tokens: 700,
                             messages: [{ role: 'system', content: SYSTEM(lang) }, ...turns] }),
      signal: AbortSignal.timeout(45000),
    });
    if (!res.ok) { console.error('sarvam', res.status, (await res.text()).slice(0, 300)); return reply(502, { error: 'upstream' }); }
    const out = await res.json();
    // The model can think aloud inside <think>…</think>; only the answer is shown.
    const text = String(out?.choices?.[0]?.message?.content ?? '').replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trim();
    if (!text) return reply(502, { error: 'empty' });
    return reply(200, { ok: true, answer: text.slice(0, 4000) });
  } catch (e) {
    console.error('sarvam', String(e));
    return reply(504, { error: 'timeout' });
  }
});
