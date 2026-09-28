// Supabase Edge Function: an admin invites someone to the moderation team.
//
// admin.html has no public sign-up, so a new moderator has no way to make an
// account. An admin (role 'admin' in public.admins) calls this with the person's
// email and role. It makes the account if needed, adds it to the team through
// kasa_admin_set_role (called as the admin, so the same rules apply), and returns
// a one-time token. admin.html turns that into a link the admin shares; opening it
// signs the person in and asks them to choose a password.
// For someone who already has an account, the token is a password-reset one, so the
// same button also helps a teammate who forgot their password.
//
// Deploy:  supabase functions deploy kasa-team-invite   (verify_jwt on)
// Secrets: none beyond the defaults.

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });

  const auth = req.headers.get('Authorization') ?? '';
  const caller = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
  const { data: role } = await caller.rpc('kasa_my_role');
  if (role !== 'admin') return reply(403, { error: 'Admins only.' });

  const body = await req.json().catch(() => ({}));
  const email = String(body.email ?? '').trim().toLowerCase();
  const newRole = body.role === 'admin' ? 'admin' : 'moderator';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 200) return reply(400, { error: 'That email does not look right.' });

  const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  // New person: an invite token (creates the account). Existing account: a reset token.
  let type: 'invite' | 'recovery' = 'invite';
  let link = await svc.auth.admin.generateLink({ type, email });
  if (link.error && /already|registered|exists/i.test(link.error.message)){
    type = 'recovery';
    link = await svc.auth.admin.generateLink({ type, email });
  }
  if (link.error || !link.data?.properties?.hashed_token) return reply(500, { error: link.error?.message ?? 'Could not make a link.' });

  const { error: roleErr } = await caller.rpc('kasa_admin_set_role', { p_email: email, p_role: newRole });
  if (roleErr) return reply(400, { error: roleErr.details || roleErr.message });

  return reply(200, { token: link.data.properties.hashed_token, type, existing: type === 'recovery' });
});
