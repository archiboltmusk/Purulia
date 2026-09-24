// Supabase Edge Function: Generate one-time photo capture tokens
// Prevents photo spoofing by binding evidence to a specific capture session.
//
// A browser requests a token before opening the camera. The token expires
// in 5 minutes and can only be used once. When the photo is submitted, the
// server verifies the token is valid and marks it used.
//
// Deploy: supabase functions deploy kasa-photo-token

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import * as jose from 'npm:jose@5.8.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const JWT_SECRET = Deno.env.get('KASA_PHOTO_TOKEN_SECRET');

if (!JWT_SECRET) {
  console.warn('KASA_PHOTO_TOKEN_SECRET not set — token generation disabled');
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const asUser = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
  const { data: { user } } = await asUser.auth.getUser(jwt);
  if (!user) return reply(401, { error: 'sign-in required' });

  if (!JWT_SECRET) return reply(503, { error: 'token_generation_disabled', ok: false });

  try {
    // Generate a JWT token valid for 5 minutes.
    // Token includes: user_id, a random nonce, and expiration.
    // Browser must include this token in the photo check request.
    const nonce = Math.random().toString(36).slice(2, 15);
    const secret = new TextEncoder().encode(JWT_SECRET);
    const alg = 'HS256';
    const token = await jose.SignJWT({
      sub: user.id,
      nonce,
      type: 'photo_capture',
    })
      .setProtectedHeader({ alg })
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(secret);

    return reply(200, { token, expires_in: 300, ok: true });
  } catch (e) {
    console.error('token generation failed', e);
    return reply(500, { error: String(e), ok: false });
  }
});
