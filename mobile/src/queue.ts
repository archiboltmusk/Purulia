import * as BackgroundTask from 'expo-background-task';
import { Directory, File, Paths } from 'expo-file-system';
import * as Network from 'expo-network';
import * as SQLite from 'expo-sqlite';
import * as TaskManager from 'expo-task-manager';
import { type Draft, type Filed, fileReport, OfflineError } from './api';
import { AppError } from './supabase';

/* "Snap & hold": a report that can't reach the server is kept on the phone (photo in
   the app's documents, the rest in SQLite) and sent when the network is back. The
   client id makes a resend safe: the server returns the first copy instead of a second. */

const TASK = 'parishkar-send-queue';
const dir = new Directory(Paths.document, 'queue');
let db: SQLite.SQLiteDatabase | null = null;
let draining: Promise<DrainResult> | null = null;
const listeners = new Set<() => void>();
const refusedListeners = new Set<(r: DrainResult['refused'][number]) => void>();

async function open() {
  if (db) return db;
  db = await SQLite.openDatabaseAsync('queue.db');
  await db.execAsync(`create table if not exists pending (
    client_id text primary key, draft text not null, tries integer not null default 0, created_at integer not null)`);
  return db;
}

export function onQueue(f: () => void) {
  listeners.add(f);
  return () => { listeners.delete(f); };
}
const changed = () => listeners.forEach((f) => f());

/* A saved report the server refused is dropped; whoever listens tells the person why, once. */
export function onRefused(f: (r: DrainResult['refused'][number]) => void) {
  refusedListeners.add(f);
  return () => { refusedListeners.delete(f); };
}

export async function pendingCount() {
  const row = await (await open()).getFirstAsync<{ n: number }>('select count(*) as n from pending');
  return row?.n ?? 0;
}

/* Moves the photo out of the camera cache, which the OS may clear. */
export async function enqueue(d: Draft) {
  if (!dir.exists) dir.create({ intermediates: true });
  const kept = new File(dir, `${d.clientId}.jpg`);
  if (!kept.exists) new File(d.photoUri).copySync(kept);
  const extras = (d.extras ?? []).map((x, i) => {
    const f = new File(dir, `${d.clientId}-${i + 1}.jpg`);
    if (!f.exists) new File(x.uri).copySync(f);
    return { ...x, uri: f.uri };
  });
  const saved: Draft = { ...d, photoUri: kept.uri, extras };
  await (await open()).runAsync('insert or ignore into pending (client_id, draft, created_at) values (?, ?, ?)',
    d.clientId, JSON.stringify(saved), Date.now());
  changed();
}

export type DrainResult = { sent: Filed[]; refused: { draft: Draft; error: AppError }[] };

export function drain(): Promise<DrainResult> {
  if (!draining) draining = run().finally(() => { draining = null; });
  return draining;
}

async function run(): Promise<DrainResult> {
  const out: DrainResult = { sent: [], refused: [] };
  const net = await Network.getNetworkStateAsync().catch(() => null);
  if (net && net.isInternetReachable === false) return out;
  const d = await open();
  const rows = await d.getAllAsync<{ client_id: string; draft: string }>('select client_id, draft from pending order by created_at');
  for (const row of rows) {
    const draft = JSON.parse(row.draft) as Draft;
    try {
      out.sent.push(await fileReport(draft));
      await forget(row.client_id);
    } catch (e) {
      if (e instanceof OfflineError) {
        await d.runAsync('update pending set tries = tries + 1 where client_id = ?', row.client_id);
        break;
      }
      // The server said no (too old, outside the area, rate limit…): retrying won't change that.
      const refused = { draft, error: e instanceof AppError ? e : new AppError('generic') };
      out.refused.push(refused);
      refusedListeners.forEach((f) => f(refused));
      await forget(row.client_id);
    }
  }
  changed();
  return out;
}

async function forget(clientId: string) {
  await (await open()).runAsync('delete from pending where client_id = ?', clientId);
  for (const name of [`${clientId}.jpg`, `${clientId}-1.jpg`, `${clientId}-2.jpg`]) {
    const f = new File(dir, name);
    if (f.exists) f.delete();
  }
}

TaskManager.defineTask(TASK, async () => {
  try {
    await drain();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

/* Foreground: send as soon as the network returns. Background: the OS runs the task
   when it chooses (at least every 15 min on Android, less predictably on iOS). */
export function startQueue() {
  BackgroundTask.registerTaskAsync(TASK, { minimumInterval: 15 }).catch(() => {});
  const sub = Network.addNetworkStateListener((s) => {
    if (s.isConnected && s.isInternetReachable !== false) drain().catch(() => {});
  });
  drain().catch(() => {});
  return () => sub.remove();
}
