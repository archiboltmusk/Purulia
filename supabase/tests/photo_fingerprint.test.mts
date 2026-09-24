// Photo fingerprint + Vision scoring tests for the kasa-photo-check function.
//   npm i --no-save imagescript@1.3.0 jpeg-js@0.4.4
//   node --experimental-strip-types supabase/tests/photo_fingerprint.test.mts
// ImageScript only draws and encodes the test photos; they are decoded with
// jpeg-js, exactly as the Edge Function does.
import assert from 'node:assert/strict';
import pkg from 'imagescript';
import jpeg from 'jpeg-js';
const { Image } = pkg;
import { JPEG_OPTIONS, dhashFromGray, grayThumb, photoDistance, isSamePhoto, garbageScore, isUnsafe, isPhotoPath, visionHealthFromError } from '../functions/kasa-photo-check/logic.ts';

// Deterministic PRNG so the test is repeatable
let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;

function scene(w: number, h: number, clutter: boolean, shift = 0) {
  const img = new Image(w, h);
  for (let y = 1; y <= h; y++) for (let x = 1; x <= w; x++) {
    // wall (top) + road (bottom) + a doorway, like a street corner
    let c = y < h * 0.45 ? [180 - y / 8, 170 - y / 10, 150] : [90 + x / 30, 85, 80];
    if (x > w * 0.6 + shift && x < w * 0.75 + shift && y > h * 0.15 && y < h * 0.45) c = [60, 40, 30];
    const n = (rnd() - 0.5) * 30; // texture / sensor noise
    const cl = (v: number) => Math.max(0, Math.min(255, v + n)) | 0;
    img.setPixelAt(x, y, Image.rgbToColor(cl(c[0]), cl(c[1]), cl(c[2])));
  }
  if (clutter) {
    seed = 7;
    for (let i = 0; i < 400; i++) {
      const cx = Math.floor(w * 0.1 + rnd() * w * 0.55), cy = Math.floor(h * 0.5 + rnd() * h * 0.45), r = 4 + Math.floor(rnd() * 22);
      const col = Image.rgbToColor(Math.floor(rnd() * 255), Math.floor(rnd() * 255), Math.floor(rnd() * 255));
      for (let y = Math.max(1, cy - r); y < Math.min(h, cy + r); y++) for (let x = Math.max(1, cx - r); x < Math.min(w, cx + r); x++) img.setPixelAt(x, y, col);
    }
  }
  return img;
}

async function hashOf(bytes: Uint8Array) {
  const img = jpeg.decode(bytes, JPEG_OPTIONS);
  return dhashFromGray(grayThumb(img.data, img.width, img.height));
}

const dirty = scene(1200, 900, true);
const dirtyJpg = await dirty.encodeJPEG(90);
const h1 = await hashOf(dirtyJpg);
const h2 = await hashOf(await (await Image.decode(dirtyJpg)).encodeJPEG(35));          // recompressed
const h3 = await hashOf(await (await Image.decode(dirtyJpg)).resize(600, 450).encodeJPEG(70)); // resized
const clean = await hashOf(await scene(1200, 900, false).encodeJPEG(90));               // same place, cleaned
const cleanMoved = await hashOf(await scene(1200, 900, false, 40).encodeJPEG(85));      // cleaned, slightly different framing
const d = (a: string, b: string) => photoDistance(a, b);
const report = { recompress: d(h1, h2), resize: d(h1, h3), cleaned: d(h1, clean), cleanedVsCleanedMoved: d(clean, cleanMoved) };
console.log(report);
assert.ok(isSamePhoto(h1, h2), 'recompressed copy must be caught as the same photo');
assert.ok(isSamePhoto(h1, h3), 'resized copy must be caught as the same photo');
assert.ok(!isSamePhoto(h1, clean), 'a real after-cleanup photo must not be mistaken for the original');
// A barely re-framed photo of an unchanged scene IS a look-alike — which is why the
// database only treats look-alikes as cheating when they come from another place.
assert.ok(isSamePhoto(clean, cleanMoved), 'near-identical framing of the same scene looks alike');
assert.equal(h1.length, 64);

// Vision scoring
assert.equal(garbageScore([{ description: 'Waste', score: 0.91 }, { description: 'Road', score: 0.95 }]), 0.91);
assert.equal(garbageScore([{ description: 'Plastic', score: 0.9 }]), 0.54, 'weak terms count for less');
assert.equal(garbageScore([{ description: 'Road surface', score: 0.97 }, { description: 'Asphalt', score: 0.9 }]), 0);
assert.equal(garbageScore([], [{ name: 'Plastic bag', score: 0.8 }]), 0.48);
assert.equal(garbageScore(undefined, undefined), 0);
assert.equal(garbageScore([{ description: 'Waste container', score: 0.9 }, { description: 'Street', score: 0.95 }]), 0.27,
  'a dustbin on a clean street is not garbage');
assert.equal(garbageScore([{ description: 'Waste container', score: 0.9 }, { description: 'Litter', score: 0.82 }]), 0.82);
assert.equal(isUnsafe({ adult: 'VERY_UNLIKELY', violence: 'LIKELY', racy: 'UNLIKELY' }), true);
assert.equal(isUnsafe({ adult: 'UNLIKELY', violence: 'POSSIBLE', racy: 'LIKELY' }), false);
assert.equal(isUnsafe(undefined), false);

const uid = '3f1c2a9e-0000-4000-8000-000000000001';
assert.equal(isPhotoPath('claims/abcdEFGH1234_-xyz.jpg'), true);
assert.equal(isPhotoPath(`claims/${uid}/abcdEFGH1234xyz.jpg`), false); // per-user folders would make links identify people
assert.equal(isPhotoPath('claims/../../abcdEFGH1234xyz.jpg'), false);
assert.equal(isPhotoPath('other/abcdEFGH1234_-xyz.jpg'), false);
assert.equal(isPhotoPath('claims/short.jpg'), false);
// Vision setup check: reasons Google gives when a key is refused
const gErr = (status: string, reason?: string) => ({ error: { status, details: reason ? [{ reason }] : [] } });
assert.equal(visionHealthFromError(gErr('INVALID_ARGUMENT', 'API_KEY_INVALID')), 'invalid_key');
assert.equal(visionHealthFromError(gErr('PERMISSION_DENIED', 'SERVICE_DISABLED')), 'api_disabled');
assert.equal(visionHealthFromError(gErr('PERMISSION_DENIED', 'BILLING_DISABLED')), 'billing_disabled');
assert.equal(visionHealthFromError(gErr('PERMISSION_DENIED', 'API_KEY_HTTP_REFERRER_BLOCKED')), 'key_restricted_to_websites');
assert.equal(visionHealthFromError(gErr('INVALID_ARGUMENT')), 'ok', 'an accepted key with an empty request is fine');
assert.equal(visionHealthFromError({}), 'error');
console.log('logic tests passed');
