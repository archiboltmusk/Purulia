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
  // Optional, newer drafts only: the "what exactly" pick and up to two more live photos.
  wasteType?: string | null;
  extras?: Extra[];
};

export type Extra = { uri: string; token: string | null; takenAt: string };

export type Filed = {
  id: string;
  moderation: string;
  duplicateOf: string | null;
  recurrenceOf: string | null;
  replayed: boolean;
  extraFailed: number;
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

async function uploadPhoto(folder: 'reports' | 'claims' | 'votes', uri: string) {
  const path = `${folder}/${randomName(24)}.jpg`;
  const bytes = await new File(uri).bytes();
  const up = await sb.storage.from('kasa-photos').upload(path, bytes, {
    contentType: 'image/jpeg', upsert: false, cacheControl: '31536000',
  });
  if (up.error) {
    if (/network|fetch/i.test(up.error.message)) throw new OfflineError(up.error.message);
    throw new AppError('upload');
  }
  return path;
}

/* Metadata spends the camera token, so it goes in before the photo is used anywhere. */
async function sendMeta(path: string, token: string | null, takenAt: string, fix: Fix) {
  const meta = {
    capture: 'live',
    capture_token: token ?? undefined,
    taken_at: takenAt,
    lat: fix.lat,
    lng: fix.lng,
    // Not read by the server yet; the app already refuses mocked fixes (see README).
    mock_location: fix.mocked,
    source: 'app',
  };
  const m = await sb.rpc('kasa_photo_meta', { p_path: path, p_meta: meta });
  if (m.error && m.error.code !== 'PGRST202') throw rpcError(m.error);
}

/* kasa-photo-check (reuse fingerprint, safety). Awaited where the server needs its
   verdict first (extra and evidence photos); 15 s at most, then the database decides. */
function checkPhoto(path: string, fix: Fix) {
  const call = sb.functions.invoke('kasa-photo-check', { body: { path, lat: fix.lat, lng: fix.lng } }).catch(() => null);
  return Promise.race([call, new Promise((r) => setTimeout(r, 15000))]);
}

/* Same steps and order as kasa.js api.createReport: upload, metadata (spends the
   token), background photo check, then the report. Every rule stays on the server. */
export async function fileReport(d: Draft): Promise<Filed> {
  try {
    await ensureSession();
  } catch (e) {
    throw e instanceof AppError ? new OfflineError('session') : e;
  }
  const path = await uploadPhoto('reports', d.photoUri);
  await sendMeta(path, d.captureToken, d.takenAt, d.fix);
  checkPhoto(path, d.fix);

  const { data, error } = await sb.rpc('kasa_create_report', {
    p_category: d.category, p_severity: null, p_lat: d.fix.lat, p_lng: d.fix.lng,
    p_accuracy: d.fix.accuracy, p_ward_no: null, p_description: d.note.trim() || null, p_landmark: null,
    p_photo_path: path, p_client_id: d.clientId, p_boundary_type: null,
    // Sent only when picked, like the site, so an older database still files the report.
    ...(d.wasteType ? { p_waste_type: d.wasteType } : {}),
  });
  if (error) throw rpcError(error);
  const r = data as { id: number | string; moderation_status: string; duplicate_of?: string; recurrence_of?: string; replayed?: boolean };
  const id = String(r.id);
  const extraFailed = !r.replayed && d.extras?.length ? await addPhotos(id, d) : 0;
  if (r.moderation_status === 'approved' && !r.duplicate_of && !r.replayed) {
    sb.functions.invoke('kasa-notify', { body: { report_id: id } }).catch(() => {});
  }
  return {
    id, moderation: r.moderation_status, duplicateOf: r.duplicate_of ? String(r.duplicate_of) : null,
    recurrenceOf: r.recurrence_of ? String(r.recurrence_of) : null, replayed: !!r.replayed, extraFailed,
  };
}

/* Extra photos never block the report: one that fails is counted and skipped. */
async function addPhotos(id: string, d: Draft) {
  let failed = 0;
  for (const x of d.extras ?? []) {
    try {
      const path = await uploadPhoto('reports', x.uri);
      await sendMeta(path, x.token, x.takenAt, d.fix);
      await checkPhoto(path, d.fix);
      const { error } = await sb.rpc('kasa_add_report_photo', { p_report_id: id, p_photo_path: path });
      if (error) throw rpcError(error);
    } catch { failed++; }
  }
  return failed;
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

export type MapDot = { id: string; lat: number; lng: number; status: string };

/* The same rows the site map draws: newest 1000 West Bengal reports + 500 from other places. */
export async function mapReports(): Promise<MapDot[]> {
  const cols = 'id,lat,lng,status';
  const [wb, other] = await Promise.all([
    sb.from('kasa_public_reports').select(cols).order('created_at', { ascending: false }).limit(1000),
    sb.from('kasa_public_place_reports').select(cols).order('created_at', { ascending: false }).limit(500),
  ]);
  if (wb.error && other.error) throw new OfflineError(wb.error.message);
  return [...((wb.data as MapDot[]) ?? []), ...((other.data as MapDot[]) ?? [])].filter((r) => r.lat != null && r.lng != null);
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

/* ── Report sheet: the same reads and actions as kasa.js openSheet / renderSheet ── */

export type Report = PublicReport & {
  severity: string | null; landmark: string | null; waste_type: string | null;
  upvotes: number | null; seen_on_site: number | null; moderation_status: string | null; flags: number | null;
  recurrence_count: number | null; rejected_claims: number | null; resolved_at: string | null; resolved_photo_url: string | null;
  resolution_method: string | null; sla_days: number | null; gps_verified: boolean | null;
  claim_id: string | null; claim_photo_url: string | null; claim_created_at: string | null;
  claim_verify_count: number | null; claim_dispute_count: number | null; claim_finalize_after: string | null;
  claim_distance_m: number | null; claim_needs_review: boolean | null;
  rating_count: number | null; onsite_rating_count: number | null; authenticity_avg: number | null; severity_avg: number | null;
  neighbour_status: string | null; reply_count: number | null; verify_needed: number | null;
};

const REPORT_COLS = PUBLIC_COLS + ',severity,landmark,waste_type,upvotes,seen_on_site,moderation_status,flags,recurrence_count,' +
  'rejected_claims,resolved_at,resolved_photo_url,resolution_method,sla_days,gps_verified,claim_id,claim_photo_url,claim_created_at,' +
  'claim_verify_count,claim_dispute_count,claim_finalize_after,claim_distance_m,claim_needs_review,rating_count,onsite_rating_count,' +
  'authenticity_avg,severity_avg,neighbour_status,reply_count,verify_needed';

/* Town/village reports, then the other-places view (kasa_public_place_reports), like the map. */
export async function reportById(id: string): Promise<Report | null> {
  for (const view of ['kasa_public_reports', 'kasa_public_place_reports']) {
    const { data, error } = await sb.from(view).select(REPORT_COLS).eq('id', id).maybeSingle();
    if (error && /network|fetch/i.test(error.message)) throw new OfflineError(error.message);
    if (data) return data as unknown as Report;
  }
  return null;
}

export type Rules = { verify_quorum: number; dispute_quorum: number; claim_radius_m: number; vote_radius_m: number; max_gps_accuracy_m: number; claim_expiry_days: number };
const DEFAULT_RULES: Rules = { verify_quorum: 3, dispute_quorum: 2, claim_radius_m: 50, vote_radius_m: 100, max_gps_accuracy_m: 60, claim_expiry_days: 14 };
let rulesCache: Rules | null = null;
export async function rules(): Promise<Rules> {
  if (rulesCache) return rulesCache;
  const { data, error } = await sb.rpc('kasa_rules');
  if (error || !data) return DEFAULT_RULES;
  const r = { ...DEFAULT_RULES };
  for (const k of Object.keys(r) as (keyof Rules)[]) if (data[k] != null) r[k] = Number(data[k]);
  return (rulesCache = r);
}

export async function reportPhotos(id: string): Promise<string[]> {
  const { data, error } = await sb.rpc('kasa_report_photos', { p_report_id: id });
  return error ? [] : ((data ?? []) as { photo_url: string }[]).map((p) => p.photo_url).filter((u) => /^https:\/\//.test(u));
}

export type ReportEvent = { id: number; kind: string; actor_tag: string | null; photo_url: string | null; distance_m: number | null; detail: Record<string, any> | null; created_at: string };
export async function reportEvents(id: string): Promise<ReportEvent[]> {
  const { data, error } = await sb.from('kasa_public_events').select('id,kind,actor_tag,photo_url,distance_m,detail,created_at')
    .eq('report_id', id).order('created_at').order('id');
  return error ? [] : ((data as ReportEvent[]) ?? []);
}

export type Reply = { id: number; responder_name: string; responder_role: string; body: string; verified_note: string | null; created_at: string };
export async function reportReplies(id: string): Promise<Reply[]> {
  const { data, error } = await sb.from('kasa_public_replies').select('id,responder_name,responder_role,body,verified_note,created_at')
    .eq('report_id', id).order('created_at');
  return error ? [] : ((data as Reply[]) ?? []);
}

export const DOCKET_PORTALS = ['cpgrams', 'state', 'rti', 'other'] as const;
export type Docket = { portal: string; number: string; added: string };
export async function reportDockets(id: string): Promise<Docket[]> {
  const { data, error } = await sb.rpc('kasa_report_dockets', { p_report_id: id });
  return error ? [] : ((data as Docket[]) ?? []);
}
export async function addDocket(id: string, portal: string, number: string) {
  await ensureSession();
  const { error } = await sb.rpc('kasa_add_docket', { p_report_id: id, p_portal: portal, p_number: number });
  if (error) throw rpcError(error);
}

const pos = (f: Fix | null) => ({ p_lat: f?.lat ?? null, p_lng: f?.lng ?? null, p_accuracy: f?.accuracy ?? null });

export async function markSeen(id: string, fix: Fix | null): Promise<{ counted: boolean; reason?: string }> {
  await ensureSession();
  const { data, error } = await sb.rpc('kasa_mark_seen', { p_report_id: id, ...pos(fix) });
  if (error) throw rpcError(error);
  return data;
}

export type RateResult = { seen_count?: number; rating_count: number; onsite_rating_count: number; authenticity_avg: number | null; severity_avg: number | null; neighbour_status: string | null; on_site?: boolean };
export async function rateReport(id: string, authenticity: number | null, severity: number | null, fix: Fix | null): Promise<RateResult> {
  await ensureSession();
  const { data, error } = await sb.rpc('kasa_rate_report', { p_report_id: id, p_authenticity: authenticity, p_severity: severity, ...pos(fix) });
  if (error) throw rpcError(error);
  return data;
}

export type EvidenceMode = 'claim' | 'verify' | 'dispute';
export type EvidenceResult = { verify_needed?: number; dispute_needed?: number; needs_review?: boolean; claim_status?: string; final_after?: string; verify_count?: number; dispute_count?: number };

/* kasa.js api.evidence: live photo into claims/ or votes/, metadata, an awaited photo
   check (the server refuses unchecked evidence), then the claim or the vote. */
export async function submitEvidence(mode: EvidenceMode, r: Report, shot: Extra, fix: Fix, note: string): Promise<EvidenceResult> {
  await ensureSession();
  const path = await uploadPhoto(mode === 'claim' ? 'claims' : 'votes', shot.uri);
  await sendMeta(path, shot.token, shot.takenAt, fix);
  await checkPhoto(path, fix);
  const { data, error } = mode === 'claim'
    ? await sb.rpc('kasa_claim_cleanup', { p_report_id: r.id, p_photo_path: path, p_lat: fix.lat, p_lng: fix.lng, p_accuracy: fix.accuracy })
    : await sb.rpc('kasa_vote_claim', {
      p_claim_id: r.claim_id, p_vote: mode, p_photo_path: path,
      p_lat: fix.lat, p_lng: fix.lng, p_accuracy: fix.accuracy, p_note: note.trim() || null,
    });
  if (error) throw rpcError(error);
  return data;
}

export function distanceM(lat1: number, lng1: number, lat2: number, lng2: number) {
  const rad = (x: number) => (x * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(a));
}

/* ── Spot forms (kasa.js openAdopt/openFeed/openSnake/openRescuer/openPandal/openWork) ── */

/* A live photo for a spot form: same upload, metadata and awaited check as evidence. */
export async function spotPhoto(shot: Extra, fix: Fix) {
  await ensureSession();
  const path = await uploadPhoto('reports', shot.uri);
  await sendMeta(path, shot.token, shot.takenAt, fix);
  await checkPhoto(path, fix);
  return path;
}

/* Calls one of the public kasa_* RPCs; every limit and check stays on the server. */
export async function spotRpc<T = any>(name: string, args: Record<string, unknown>): Promise<T> {
  await ensureSession();
  const { data, error } = await sb.rpc(name, args);
  if (error) throw rpcError(error);
  return data as T;
}
