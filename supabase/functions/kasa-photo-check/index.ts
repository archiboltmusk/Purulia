// Supabase Edge Function: server-side photo check for Purulia Kasa.
//
// The browser uploads a photo, then calls this function with its storage
// path. We fingerprint it (SHA-256 + perceptual dHash) and, if a Google
// Vision key is configured, ask Vision what it shows. The result is written
// with the service role, so a browser can never fake a "clean" result, and
// the Vision key never leaves the server.
//
// Deploy:  supabase functions deploy kasa-photo-check
// Secret:  supabase secrets set GOOGLE_VISION_API_KEY=...   (optional)

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { Image } from 'npm:imagescript@1.3.0';
import { encodeBase64 } from 'jsr:@std/encoding@1/base64';
import { dhashFromGray, garbageScore, grayThumb, isPhotoPath, isUnsafe } from './logic.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VISION_KEY = Deno.env.get('GOOGLE_VISION_API_KEY') ?? '';
const MAX_BYTES = 6 * 1024 * 1024;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

async function perceptualHash(bytes: Uint8Array): Promise<string | null> {
  try {
    const img = await Image.decode(bytes);
    return dhashFromGray(grayThumb(img.bitmap, img.width, img.height));
  } catch (_) {
    return null;
  }
}

async function vision(bytes: Uint8Array) {
  if (!VISION_KEY) return null;
  const res = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${VISION_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [{
        image: { content: encodeBase64(bytes) },
        features: [
          { type: 'LABEL_DETECTION', maxResults: 25 },
          { type: 'OBJECT_LOCALIZATION', maxResults: 20 },
          { type: 'SAFE_SEARCH_DETECTION' },
          { type: 'FACE_DETECTION', maxResults: 10 },
        ],
      }],
    }),
  });
  if (!res.ok) throw new Error(`vision ${res.status}`);
  return (await res.json()).responses?.[0] ?? {};
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const asUser = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
  const { data: { user } } = await asUser.auth.getUser(jwt);
  if (!user) return reply(401, { error: 'sign-in required' });

  let path = '';
  try { path = String((await req.json()).path ?? ''); } catch (_) { /* fallthrough */ }
  if (!isPhotoPath(path)) return reply(400, { error: 'bad path' });

  // Only the uploader can have their photo checked (Storage records the owner).
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: owner } = await admin.rpc('kasa_photo_owner', { p_path: path });
  if (owner !== user.id) return reply(403, { error: 'not your photo' });
  const { data: file, error: dlErr } = await admin.storage.from('kasa-photos').download(path);
  if (dlErr || !file) return reply(404, { error: 'photo not found' });
  if (file.size > MAX_BYTES) return reply(413, { error: 'photo too large' });
  const bytes = new Uint8Array(await file.arrayBuffer());

  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  const dhash = await perceptualHash(bytes);

  let score: number | null = null;
  let labels: string[] = [];
  let unsafe = false;
  let faces = 0;
  try {
    const v = await vision(bytes);
    if (v) {
      score = garbageScore(v.labelAnnotations, v.localizedObjectAnnotations);
      labels = (v.labelAnnotations ?? []).slice(0, 8).map((l: { description: string }) => l.description);
      unsafe = isUnsafe(v.safeSearchAnnotation);
      faces = (v.faceAnnotations ?? []).length;
    }
  } catch (e) {
    // Vision outage: still record the fingerprint so reuse checks keep working.
    console.error('vision failed', e);
  }

  const { error: recErr } = await admin.rpc('kasa_record_photo_check', {
    p_path: path, p_sha256: sha256, p_dhash: dhash, p_garbage_score: score,
    p_labels: labels, p_unsafe: unsafe, p_face_count: faces,
  });
  if (recErr) return reply(500, { error: recErr.message });

  return reply(200, { ok: true, garbage_score: score, labels, unsafe, face_count: faces, vision: score !== null });
});
