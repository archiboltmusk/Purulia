// Edge function: Handle unsubscribe requests from email links
// URL: /kasa-unsubscribe?token=...

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SITE = (Deno.env.get('SITE_URL') || 'https://archiboltmusk.github.io/Purulia').replace(/\/$/, '');

Deno.serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
      },
    });
  }

  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'GET only' }), { status: 405 });
  }

  const url = new URL(req.url);
  const token = url.searchParams.get('token');

  if (!token) {
    return new Response(
      `<!DOCTYPE html>
<html>
<head><title>Unsubscribe</title><link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='13' fill='none' stroke='%23D4882A' stroke-width='1.5'/%3E%3C/svg%3E"></head>
<body style="font-family:system-ui;padding:2rem;max-width:600px;margin:0 auto;color:#444;">
<h2>Unsubscribe</h2>
<p>No unsubscribe token provided. If you received an unsubscribe link in your email, please use that link.</p>
<p><a href="${SITE}/digest-subscribe.html">Return to digest page →</a></p>
</body>
</html>`,
      { status: 400, headers: { 'Content-Type': 'text/html' } }
    );
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data, error } = await admin.rpc('kasa_digest_unsubscribe', { p_token: token });

  const success = data?.success;
  const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
  const message = esc(data?.message || error?.message || 'Unknown error');
  const email = esc(data?.email);

  return new Response(
    `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Unsubscribe Confirmation</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='13' fill='none' stroke='%23D4882A' stroke-width='1.5'/%3E%3C/svg%3E">
<style>
  body{font-family:system-ui,-apple-system,sans-serif;padding:2rem;max-width:600px;margin:0 auto;background:#faf9f6;color:#333;}
  h2{color:#0a0805;margin-top:0;}
  .success{padding:1rem;background:#e8f5e9;border-left:4px solid #4caf50;color:#2e7d32;border-radius:2px;}
  .error{padding:1rem;background:#ffebee;border-left:4px solid #f44336;color:#c62828;border-radius:2px;}
  a{color:#d4882a;text-decoration:none;font-weight:500;}
  a:hover{text-decoration:underline;}
  .footer{margin-top:2rem;font-size:.9rem;color:#666;border-top:1px solid #ddd;padding-top:1rem;}
</style>
</head>
<body>
<h2>Parishkar Bengal</h2>
${
  success
    ? `<div class="success">
      <strong>✓ Unsubscribed</strong>
      <p>You've been removed from the weekly civic digest. Your email address (${email}) will not receive future updates.</p>
    </div>
    <p>If this was a mistake, you can re-subscribe anytime at <a href="${SITE}/digest-subscribe.html">digest-subscribe.html</a>.</p>`
    : `<div class="error">
      <strong>Could not unsubscribe</strong>
      <p>${message}</p>
    </div>
    <p>The token may have expired or you may already be unsubscribed. <a href="${SITE}/digest-subscribe.html">Manage your subscription →</a></p>`
}
<div class="footer">
  <p><strong>Parishkar Bengal</strong> — civic reporting for West Bengal.</p>
  <p><a href="${SITE}/kasa.html">View map</a> • <a href="${SITE}/privacy.html">Privacy</a></p>
</div>
</body>
</html>`,
    {
      status: success ? 200 : 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': '*' },
    }
  );
});
