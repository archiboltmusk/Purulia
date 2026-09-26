// Supabase Edge Function: re-saves photos of long-fixed problems smaller, in place.
//
// Runs nightly. The database hands out photo paths (kasa_shrink_claim: photos of
// problems resolved more than shrink_after_days ago, not yet shrunk). Each is
// decoded, scaled so its longest side is shrink_max_px, re-encoded at quality 60
// and uploaded over the original, so links keep working. A photo is only replaced
// when the new file is smaller.
//
// Deploy:  supabase functions deploy kasa-photo-shrink

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import jpeg from 'npm:jpeg-js@0.4.4';
import { downscale } from './shrink.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BUCKET = 'kasa-photos';
const QUALITY = 60;

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data, error } = await admin.rpc('kasa_shrink_claim', { p_limit: 15 });
  if (error) return reply(500, { error: error.message });
  const paths = (data?.paths ?? []) as string[];
  const maxPx = Number(data?.max_px) || 1024;
  let saved = 0, shrunk = 0;
  for (const path of paths) {
    let before = 0, after = 0, err: string | null = null;
    try {
      const { data: file, error: dl } = await admin.storage.from(BUCKET).download(path);
      if (dl || !file) throw new Error('final: missing');
      const bytes = new Uint8Array(await file.arrayBuffer());
      before = bytes.length;
      let img;
      try { img = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: 30, maxMemoryUsageInMB: 256 }); }
      catch (_) { throw new Error('final: not a readable JPEG'); }
      const small = downscale(img.data, img.width, img.height, maxPx) ?? { data: img.data, width: img.width, height: img.height };
      const out = jpeg.encode(small, QUALITY).data as Uint8Array;
      after = out.length;
      if (after < before * 0.9) {
        const { error: up } = await admin.storage.from(BUCKET)
          .upload(path, out, { contentType: 'image/jpeg', upsert: true, cacheControl: '31536000' });
        if (up) throw new Error(`upload: ${up.message}`);
        saved += before - after; shrunk++;
      } else {
        after = before;  // already small; leave it alone
      }
    } catch (e) {
      err = String((e as Error).message ?? e);
      console.error('shrink failed', path, err);
    }
    await admin.rpc('kasa_shrink_done', { p_path: path, p_before: before || null, p_after: after || null, p_error: err });
  }
  return reply(200, { checked: paths.length, shrunk, saved_kb: Math.round(saved / 1024) });
});
