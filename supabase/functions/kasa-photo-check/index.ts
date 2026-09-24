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
import jpeg from 'npm:jpeg-js@0.4.4';
import { encodeBase64 } from 'jsr:@std/encoding@1/base64';
import * as jose from 'npm:jose@5.8.0';
import exifParser from 'npm:exif-parser@0.1.12';
import { JPEG_OPTIONS, dhashFromGray, garbageScore, grayThumb, isPhotoPath, isUnsafe, visionHealthFromError } from './logic.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VISION_KEY = Deno.env.get('GOOGLE_VISION_API_KEY') ?? '';
const JWT_SECRET = Deno.env.get('KASA_PHOTO_TOKEN_SECRET');
const MAX_BYTES = 6 * 1024 * 1024;
const EXIF_MATCH_THRESHOLD = 100; // meters — allow ±100m drift in GPS

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

// The page always uploads JPEG (it re-encodes every photo), so a pure-JS
// decoder is enough — no native or WebAssembly code for the runtime to load.
function perceptualHash(bytes: Uint8Array): string | null {
  try {
    const img = jpeg.decode(bytes, JPEG_OPTIONS);
    return dhashFromGray(grayThumb(img.data, img.width, img.height));
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

// Setup check: is the Vision key present and accepted? Sends an empty request,
// which Google answers without analysing (or billing) any image.
async function visionHealth(): Promise<string> {
  if (!VISION_KEY) return 'no_key';
  try {
    const res = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${VISION_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requests: [] }),
    });
    if (res.ok) return 'ok';
    return visionHealthFromError(await res.json().catch(() => ({})));
  } catch (_) {
    return 'unreachable';
  }
}

// Verify the one-time photo capture token. Returns user_id or null if invalid.
async function verifyToken(token: string): Promise<string | null> {
  if (!JWT_SECRET || !token) return null;
  try {
    const secret = new TextEncoder().encode(JWT_SECRET);
    const verified = await jose.jwtVerify(token, secret);
    return String(verified.payload.sub) || null;
  } catch (_) {
    return null;
  }
}

// Extract GPS coordinates from EXIF data. Returns { lat, lng } or null.
function extractExifGPS(bytes: Uint8Array): { lat: number; lng: number } | null {
  try {
    const parser = exifParser.create(Buffer.from(bytes));
    const result = parser.parse();
    const tags = result.tags;
    if (!tags.GPSLatitude || !tags.GPSLongitude) return null;
    return { lat: tags.GPSLatitude, lng: tags.GPSLongitude };
  } catch (_) {
    return null;
  }
}

// Haversine distance between two GPS points in meters.
function gpsDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371e3; // meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const asUser = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
  const { data: { user } } = await asUser.auth.getUser(jwt);
  if (!user) return reply(401, { error: 'sign-in required' });

  let body: { path?: unknown; health?: unknown; token?: unknown; lat?: unknown; lng?: unknown } = {};
  try { body = await req.json(); } catch (_) { /* fallthrough */ }
  if (body.health === true) return reply(200, { vision: await visionHealth() });

  const path = String(body.path ?? '');
  if (!isPhotoPath(path)) return reply(400, { error: 'bad path' });

  // Verify the one-time photo capture token (if JWT_SECRET is configured).
  const captureToken = String(body.token ?? '');
  if (JWT_SECRET && captureToken) {
    const tokenUserId = await verifyToken(captureToken);
    if (!tokenUserId) return reply(401, { error: 'token_invalid_or_expired' });
    if (tokenUserId !== user.id) return reply(403, { error: 'token_mismatch' });
  }

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
  const dhash = perceptualHash(bytes);

  // Extract EXIF GPS data from the photo itself.
  let exifGps = extractExifGPS(bytes);
  let exifMatch = true;
  if (exifGps && body.lat && body.lng) {
    const dist = gpsDistance(exifGps.lat, exifGps.lng, Number(body.lat), Number(body.lng));
    // If EXIF GPS is too far from reported location, flag as mismatch.
    exifMatch = dist <= EXIF_MATCH_THRESHOLD;
    if (!exifMatch) {
      console.warn(`EXIF GPS mismatch: ${dist.toFixed(0)}m for photo ${path}`);
    }
  }

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
    p_exif_gps_lat: exifGps?.lat ?? null, p_exif_gps_lng: exifGps?.lng ?? null,
    p_exif_match: exifMatch,
  });
  if (recErr) return reply(500, { error: recErr.message });

  return reply(200, {
    ok: true, garbage_score: score, labels, unsafe, face_count: faces, vision: score !== null,
    exif_gps: exifGps, exif_match: exifMatch
  });
});
