import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';
import { AppError, ensureSession, sb } from './supabase';

export type Fix = { lat: number; lng: number; accuracy: number; mocked: boolean; at: number };

export type Draft = {
  clientId: string;
  photoUri: string;
  captureToken: string | null;
  takenAt: string;
  fix: Fix;
  category: string | null;
  note: string;
};

export type Filed = {
  id: string;
  moderation: string;
  duplicateOf: string | null;
  recurrenceOf: string | null;
  replayed: boolean;
};

export type PublicReport = {
  id: string;
  created_at: string;
  lat: number;
  lng: number;
  category: string;
  status: string;
  description: string | null;
  photo_url: string | null;
  ward_no: number | null;
  local_body: string | null;
  block_name: string | null;
  area_kind: string | null;
};

const PUBLIC_COLS = 'id,created_at,lat,lng,category,status,description,photo_url,ward_no,local_body,block_name,area_kind';

/* Network trouble (worth queueing) vs a server refusal (show it, don't retry). */
export class OfflineError extends Error {}

function rpcError(error: { message: string; hint?: string | null }) {
  const code = error.message || '';
  if (/^KASA_[A-Z_]+$/.test(code)) {
    let data: Record<string, number> = {};
    try { data = error.hint ? JSON.parse(error.hint) : {}; } catch { /* no detail */ }
    return new AppError(code, { d: data.distance_m, limit: data.limit_m, a: data.accuracy_m });
  }
  if (/network|fetch|timeout/i.test(code)) return new OfflineError(code);
  return new AppError('generic');
}

function randomName(n: number) {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = Crypto.getRandomBytes(n);
  return Array.from(bytes, (b) => abc[b % abc.length]).join('');
}

export function newClientId() { return 'A' + Date.now() + randomName(6); }

/* One-time camera token, asked for when the camera opens; the server only counts a
   photo as live when its metadata arrives with an unspent token of this account. */
export async function issueCaptureToken(): Promise<string | null> {
  try {
    await ensureSession();
    const { data, error } = await sb.rpc('kasa_issue_capture_token');
    return error ? null : (data as string);
  } catch { return null; }
}

/* Same steps and order as kasa.js api.createReport: upload, metadata (spends the
   token), background photo check, then the report. Every rule stays on the server. */
export async function fileReport(d: Draft): Promise<Filed> {
  try {
    await ensureSession();
  } catch (e) {
    throw e instanceof AppError ? new OfflineError('session') : e;
  }
  const path = `reports/${randomName(24)}.jpg`;
  const bytes = await new File(d.photoUri).bytes();
  const up = await sb.storage.from('kasa-photos').upload(path, bytes, {
    contentType: 'image/jpeg', upsert: false, cacheControl: '31536000',
  });
  if (up.error) {
    if (/network|fetch/i.test(up.error.message)) throw new OfflineError(up.error.message);
    throw new AppError('upload');
  }

  const meta = {
    capture: 'live',
    capture_token: d.captureToken ?? undefined,
    taken_at: d.takenAt,
    lat: d.fix.lat,
    lng: d.fix.lng,
    // Not read by the server yet; the app already refuses mocked fixes (see README).
    mock_location: d.fix.mocked,
    source: 'app',
  };
  const m = await sb.rpc('kasa_photo_meta', { p_path: path, p_meta: meta });
  if (m.error && m.error.code !== 'PGRST202') throw rpcError(m.error);

  sb.functions.invoke('kasa-photo-check', { body: { path, lat: d.fix.lat, lng: d.fix.lng } }).catch(() => {});

  const { data, error } = await sb.rpc('kasa_create_report', {
    p_category: d.category, p_severity: null, p_lat: d.fix.lat, p_lng: d.fix.lng,
    p_accuracy: d.fix.accuracy, p_ward_no: null, p_description: d.note.trim() || null, p_landmark: null,
    p_photo_path: path, p_client_id: d.clientId, p_boundary_type: null,
  });
  if (error) throw rpcError(error);
  const r = data as { id: number | string; moderation_status: string; duplicate_of?: string; recurrence_of?: string; replayed?: boolean };
  if (r.moderation_status === 'approved' && !r.duplicate_of && !r.replayed) {
    sb.functions.invoke('kasa-notify', { body: { report_id: String(r.id) } }).catch(() => {});
  }
  return {
    id: String(r.id), moderation: r.moderation_status, duplicateOf: r.duplicate_of ? String(r.duplicate_of) : null,
    recurrenceOf: r.recurrence_of ? String(r.recurrence_of) : null, replayed: !!r.replayed,
  };
}

/* The public row, as the map shows it. Null while it waits for a moderator. */
export async function publicReport(id: string): Promise<PublicReport | null> {
  const { data } = await sb.from('kasa_public_reports').select(PUBLIC_COLS).eq('id', id).maybeSingle();
  return (data as PublicReport | null) ?? null;
}

export async function recentReports(): Promise<PublicReport[]> {
  const { data, error } = await sb.from('kasa_public_reports').select(PUBLIC_COLS)
    .order('created_at', { ascending: false }).limit(50);
  return error ? [] : ((data as PublicReport[]) ?? []);
}

export type Warranty = { id: number; work_name: string; agency: string | null; contractor: string | null; warranty_until: string; distance_m: number };

/* A moderator-approved public work still under its defect liability period near this
   report (works.html). Null when there is none: nothing is guessed. */
export async function reportWarranty(id: string): Promise<Warranty | null> {
  const { data, error } = await sb.rpc('kasa_report_warranty', { p_report_id: id });
  return error || !data ? null : (data as Warranty);
}

export const FLAG_REASONS = ['not_an_issue', 'wrong_location', 'duplicate', 'inappropriate', 'fake_or_old_photo', 'other'] as const;
export type FlagReason = (typeof FLAG_REASONS)[number];

export async function flagReport(id: string, reason: FlagReason) {
  await ensureSession();
  const { error } = await sb.rpc('kasa_flag_report', { p_report_id: id, p_reason: reason, p_note: 'via app' });
  if (error) throw rpcError(error);
}
