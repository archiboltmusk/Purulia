// Supabase Edge Function: posts on X when a town ward's unresolved reports cross a threshold.
//
// pg_cron calls this a few times a day (migration 20260927130000_kasa_x_autopost.sql). The
// database picks at most one ward that is due, so calling it directly can't post anything the
// public map doesn't already show, or post the same ward twice inside x_post_repeat_days.
//
// Deploy:  supabase functions deploy kasa-x-post
// Secrets: X_API_KEY, X_API_SECRET             (the app's consumer keys)
//          X_ACCESS_TOKEN, X_ACCESS_SECRET     (for the posting account, with Read and Write permission)
//          SITE_URL                            (optional; default https://archiboltmusk.github.io/Purulia)

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const KEY = Deno.env.get('X_API_KEY') ?? '', KEY_SECRET = Deno.env.get('X_API_SECRET') ?? '';
const TOKEN = Deno.env.get('X_ACCESS_TOKEN') ?? '', TOKEN_SECRET = Deno.env.get('X_ACCESS_SECRET') ?? '';
const SITE = (Deno.env.get('SITE_URL') || 'https://archiboltmusk.github.io/Purulia').replace(/\/$/, '');
const TWEET_URL = 'https://api.x.com/2/tweets';

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// RFC 3986 encoding, as OAuth 1.0a requires.
const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());

async function oauthHeader(method: string, url: string): Promise<string> {
  const p: Record<string, string> = {
    oauth_consumer_key: KEY, oauth_nonce: crypto.randomUUID().replace(/-/g, ''),
    oauth_signature_method: 'HMAC-SHA1', oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: TOKEN, oauth_version: '1.0',
  };
  // JSON bodies are not part of the signature; only the oauth_* parameters are.
  const params = Object.keys(p).sort().map(k => `${enc(k)}=${enc(p[k])}`).join('&');
  const base = [method, enc(url), enc(params)].join('&');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(`${enc(KEY_SECRET)}&${enc(TOKEN_SECRET)}`),
    { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(base)));
  p.oauth_signature = btoa(String.fromCharCode(...sig));
  return 'OAuth ' + Object.keys(p).sort().map(k => `${enc(k)}="${enc(p[k])}"`).join(', ');
}

interface Ward { id: number; ward_no: number; open: number; overdue: number; councillor: string | null; mention: string | null }

export function message(w: Ward): string {
  return [
    `${w.mention ? w.mention.trim() + ' ' : ''}Ward ${w.ward_no}, Purulia: ${w.open} problems reported by residents are still unresolved`
      + (w.overdue ? `, ${w.overdue} of them past their deadline.` : '.'),
    w.councillor ? `Councillor: ${w.councillor}.` : '',
    `See each one, with photos: ${SITE}/kasa.html?ward=${w.ward_no}`,
    '#Purulia #ParishkarPurulia',
  ].filter(Boolean).join('\n');
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });
  if (!KEY || !KEY_SECRET || !TOKEN || !TOKEN_SECRET) return reply(503, { error: 'X posting not configured (X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET)' });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data, error } = await admin.rpc('kasa_x_post_claim');
  if (error) return reply(500, { error: error.message });
  if (!data) return reply(200, { posted: 0 });
  const w = data as Ward;

  const res = await fetch(TWEET_URL, {
    method: 'POST',
    headers: { Authorization: await oauthHeader('POST', TWEET_URL), 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: message(w) }),
  }).catch(e => ({ ok: false, status: 0, text: async () => String(e), json: async () => ({}) }) as Response);
  if (!res.ok){
    const err = `X ${res.status}: ${(await res.text()).slice(0, 200)}`;
    await admin.rpc('kasa_x_post_done', { p_id: w.id, p_tweet_id: null, p_error: err });
    return reply(502, { error: err });
  }
  const tweetId = (await res.json())?.data?.id ?? null;
  await admin.rpc('kasa_x_post_done', { p_id: w.id, p_tweet_id: tweetId, p_error: null });
  return reply(200, { posted: 1, ward: w.ward_no, tweet_id: tweetId });
});
