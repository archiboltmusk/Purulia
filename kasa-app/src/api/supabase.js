import { createClient } from '@supabase/supabase-js';

let supabase = null;

export function initSupabase() {
  if (!supabase) {
    const url = window.KASA_CONFIG?.SUPABASE_URL;
    const key = window.KASA_CONFIG?.SUPABASE_ANON_KEY;
    if (!url || !key) {
      throw new Error('Missing Supabase config');
    }
    supabase = createClient(url, key);
  }
  return supabase;
}

export function getSb() {
  if (!supabase) initSupabase();
  return supabase;
}

function rpcError(error) {
  const e = new Error(error.message);
  e.details = error.details;
  e.hint = error.hint;
  e.code = error.code;
  return e;
}

// Reporting requires an anonymous Supabase Auth session (server ties reports to a user_id).
export async function ensureSession() {
  const sb = getSb();
  const { data: { session } } = await sb.auth.getSession();
  if (session) return session.user.id;
  const { data, error } = await sb.auth.signInAnonymously();
  if (error || !data?.user) {
    throw new Error('Could not start a session. Enable Anonymous sign-in under Supabase Authentication → Providers.');
  }
  return data.user.id;
}

export async function uploadPhoto(folder, blob) {
  const sb = getSb();
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
  const { error } = await sb.storage.from('kasa-photos').upload(path, blob, {
    contentType: 'image/jpeg',
    upsert: false,
    cacheControl: '31536000'
  });
  if (error) throw new Error('Photo upload failed: ' + error.message);
  return path;
}

// One-time capture token — server-side Edge Function, not an RPC.
export async function getCaptureToken() {
  const sb = getSb();
  try {
    const { data, error } = await sb.functions.invoke('kasa-photo-token', { body: {} });
    if (error || !data?.ok) return null;
    return data.token;
  } catch {
    return null;
  }
}

export async function sendPhotoMeta(path, meta) {
  if (!meta) return;
  const sb = getSb();
  const { error } = await sb.rpc('kasa_photo_meta', { p_path: path, p_meta: meta });
  // PGRST202 = function missing on older DBs; treat as non-fatal like the vanilla app does.
  if (error && error.code !== 'PGRST202') {
    console.warn('Photo metadata not recorded:', error);
  }
}

// Server-side safety check (Vision AI + EXIF + token) — Edge Function, best effort, async.
export async function checkPhoto(path, token, lat, lng) {
  const sb = getSb();
  try {
    const timeout = new Promise(resolve => setTimeout(() => resolve({ error: 'timeout' }), 15000));
    const body = { path };
    if (token) body.token = token;
    if (lat != null) body.lat = lat;
    if (lng != null) body.lng = lng;
    const { data, error } = await Promise.race([
      sb.functions.invoke('kasa-photo-check', { body }),
      timeout
    ]);
    if (error) return null;
    return data;
  } catch {
    return null;
  }
}

export async function createReport(d) {
  const sb = getSb();
  await ensureSession();

  const [captureToken, path] = await Promise.all([
    getCaptureToken(),
    uploadPhoto('reports', d.photoBlob)
  ]);

  await sendPhotoMeta(path, d.photoMeta);

  checkPhoto(path, captureToken, d.lat, d.lng).catch(err =>
    console.warn('photo check failed', err)
  );

  const clientId = d.clientId || crypto.randomUUID();
  const { data, error } = await sb.rpc('kasa_create_report', {
    p_category: d.category,
    p_severity: d.severity,
    p_lat: d.lat,
    p_lng: d.lng,
    p_accuracy: d.accuracy,
    p_ward_no: d.ward,
    p_description: d.description || null,
    p_landmark: d.landmark || null,
    p_photo_path: path,
    p_client_id: clientId
  });

  if (error) throw rpcError(error);

  return {
    id: String(data.id),
    moderation: data.moderation_status,
    duplicateOf: data.duplicate_of,
    recurrenceOf: data.recurrence_of,
    replayed: data.replayed
  };
}

export async function submitEvidence(mode, r, blob, meta, pos) {
  const sb = getSb();
  await ensureSession();

  const [captureToken, path] = await Promise.all([
    getCaptureToken(),
    uploadPhoto(mode === 'claim' ? 'claims' : 'votes', blob)
  ]);

  await sendPhotoMeta(path, meta);

  await checkPhoto(path, captureToken, pos.lat, pos.lng);

  const { data, error } = mode === 'claim'
    ? await sb.rpc('kasa_claim_cleanup', {
        p_report_id: r.id,
        p_photo_path: path,
        p_lat: pos.lat,
        p_lng: pos.lng,
        p_accuracy: pos.accuracy
      })
    : await sb.rpc('kasa_vote_claim', {
        p_claim_id: r.id,
        p_photo_path: path,
        p_lat: pos.lat,
        p_lng: pos.lng,
        p_accuracy: pos.accuracy
      });

  if (error) throw rpcError(error);
  return data;
}

// --- Moderation: gated behind kasa_private.is_admin(), requires a signed-in
// user present in public.admins. No generic delete exists — only approve/hide/restore.

export async function getModerationQueue() {
  const sb = getSb();
  const { data, error } = await sb.rpc('kasa_admin_queue');
  if (error) throw rpcError(error);
  return data; // { reports: [...], claims: [...] }
}

export async function moderateReport(reportId, action, reason) {
  const sb = getSb();
  const { data, error } = await sb.rpc('kasa_admin_moderate', {
    p_report_id: String(reportId),
    p_action: action, // 'approve' | 'hide' | 'restore'
    p_reason: reason || null
  });
  if (error) throw rpcError(error);
  return data;
}

export function getPhotoUrl(photoPath) {
  const url = window.KASA_CONFIG?.SUPABASE_URL;
  return `${url}/storage/v1/object/public/kasa-photos/${photoPath}`;
}
