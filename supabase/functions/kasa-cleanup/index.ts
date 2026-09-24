// Supabase Edge Function: removes photo uploads that nothing uses.
//
// The page uploads a photo and uses it within seconds. Uploads that no
// report, cleanup claim or confirmation uses (a refused attempt, a closed
// tab) are removed here once they are two days old — through the Storage
// API, because Supabase doesn't allow deleting storage rows with SQL (the
// files would be left behind). The weekly database job calls this function.
//
// Anyone with the public key may trigger it: all it can do is remove old
// uploads that nothing uses, so running it more often is harmless.
//
// Deploy:  supabase functions deploy kasa-cleanup

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BATCH = 100;

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: paths, error } = await admin.rpc('kasa_orphan_photos', { p_limit: 500 });
  if (error) return reply(500, { error: error.message });

  const list = (paths ?? []) as string[];
  const removed: string[] = [];
  for (let i = 0; i < list.length; i += BATCH) {
    const { data, error: rmErr } = await admin.storage.from('kasa-photos').remove(list.slice(i, i + BATCH));
    if (rmErr) { console.error('remove failed', rmErr); continue; }
    for (const o of data ?? []) if (o?.name) removed.push(o.name);
  }
  if (removed.length) {
    const { error: logErr } = await admin.rpc('kasa_photos_removed', { p_paths: removed });
    if (logErr) console.error('record failed', logErr);
  }
  return reply(200, { found: list.length, removed: removed.length });
});
