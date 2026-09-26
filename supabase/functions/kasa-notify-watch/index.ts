// Supabase Edge Function: notifies citizens watching a specific report when
// its status changes (claimed, confirmed, resolved, disputed...).
//
// Unlike kasa-notify (called by a signed-in browser right after it files a
// report), this is pinged by the database itself — kasa_private.events'
// report_watch_alert trigger, best-effort, plus a 10-minute pg_cron backstop
// — so it takes no caller identity, exactly like p2040-signup-alert. It
// claims events (kasa_watch_notify_claim), sends web push to that event's
// report_watches (never to the person whose own action caused the event),
// and reports each result back, so calling it more often than needed is
// harmless: an event is only ever sent once.
//
// Deploy:  supabase functions deploy kasa-notify-watch
// Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:...),
//          KASA_PAGE_URL (e.g. https://your-site/kasa.html)
//          (shared with kasa-notify — Supabase secrets are project-wide)

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import webpush from 'npm:web-push@3.6.7';
import { buildMessage, isGone } from './watch-message.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PAGE_URL = Deno.env.get('KASA_PAGE_URL') ?? '';
const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? '';

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

interface Target { id: string; endpoint: string; p256dh: string; auth: string; lang: string }
interface QueuedEvent { event_id: number; report_id: string; kind: string; targets: Target[] }

Deno.serve(async (req) => {
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });
  if (!VAPID_PUBLIC || !VAPID_PRIVATE || !VAPID_SUBJECT || !PAGE_URL) return reply(503, { error: 'alerts not configured' });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data, error } = await admin.rpc('kasa_watch_notify_claim', { p_limit: 20 });
  if (error) return reply(500, { error: error.message });

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
  const events: QueuedEvent[] = data ?? [];
  let sent = 0, failed = 0;
  for (const ev of events) {
    const err = await sendEvent(ev).catch((e) => String(e));
    await admin.rpc('kasa_watch_notify_done', { p_event_ids: [ev.event_id], p_error: err });
    err ? failed++ : sent++;
  }
  return reply(200, { sent, failed, events: events.length });

  // Per-target sends are reported individually (kasa_watch_notify_result), so one
  // dead subscription never fails the whole event — only an unexpected error here does.
  async function sendEvent(ev: QueuedEvent): Promise<string | null> {
    let image: string | null = null;
    if (ev.kind === 'resolved'){
      const { data: r } = await admin.from('reports').select('resolved_photo_url').eq('id', ev.report_id).maybeSingle();
      image = r?.resolved_photo_url ?? null;
    }
    for (const target of ev.targets ?? []) {
      const msg = buildMessage({ report_id: ev.report_id, kind: ev.kind, image }, target.lang, PAGE_URL);
      let ok = false, gone = false;
      try {
        await webpush.sendNotification({ endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
          JSON.stringify(msg), { TTL: 3 * 3600, urgency: 'normal' });
        ok = true;
      } catch (err) {
        gone = isGone((err as { statusCode?: number }).statusCode);
      }
      await admin.rpc('kasa_watch_notify_result', { p_watch_id: target.id, p_ok: ok, p_gone: gone });
    }
    return null;
  }
});
