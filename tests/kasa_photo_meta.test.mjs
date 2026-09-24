// Tests for kasa-photo-meta.js (the on-phone photo metadata reader).
//   node tests/kasa_photo_meta.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
// Loaded as a classic script, the way the page loads it.
vm.runInThisContext(fs.readFileSync(new URL('../kasa-photo-meta.js', import.meta.url), 'utf8'));
const { parse } = globalThis.KasaPhotoMeta;

// Builds a TIFF block with IFD0 → Exif IFD / GPS IFD, in either byte order.
function tiff({ le = true, when, zone, lat, lng, digitizedOnly = false }) {
  const bytes = [];
  const u16 = (v) => (le ? [v & 255, v >> 8] : [v >> 8, v & 255]);
  const u32 = (v) => (le ? [v & 255, (v >> 8) & 255, (v >> 16) & 255, v >>> 24] : [v >>> 24, (v >> 16) & 255, (v >> 8) & 255, v & 255]);
  const extra = []; // out-of-line values, appended after the IFDs
  let extraBase = 0;
  const place = (arr) => { const at = extraBase + extra.length; extra.push(...arr); if (extra.length % 2) extra.push(0); return at; };
  const asciiBytes = (s) => [...Buffer.from(s + '\0', 'latin1')];
  const rational3 = (v) => {
    const d = Math.floor(v), m = Math.floor((v - d) * 60), s = Math.round(((v - d) * 60 - m) * 60 * 1000);
    return [...u32(d), ...u32(1), ...u32(m), ...u32(1), ...u32(s), ...u32(1000)];
  };
  const exifEntries = [];
  if (when) exifEntries.push([digitizedOnly ? 0x9004 : 0x9003, 2, asciiBytes(when)]);
  if (zone) exifEntries.push([0x9011, 2, asciiBytes(zone)]);
  const gpsEntries = [];
  if (lat != null) {
    gpsEntries.push([1, 2, asciiBytes(lat < 0 ? 'S' : 'N')], [2, 5, rational3(Math.abs(lat))],
                    [3, 2, asciiBytes(lng < 0 ? 'W' : 'E')], [4, 5, rational3(Math.abs(lng))]);
  }
  const ifdSize = (n) => 2 + n * 12 + 4;
  const ifd0At = 8;
  const exifAt = ifd0At + ifdSize(2);
  const gpsAt = exifAt + ifdSize(exifEntries.length);
  extraBase = gpsAt + ifdSize(gpsEntries.length);
  const writeIfd = (entries) => {
    const out = [...u16(entries.length)];
    for (const [tag, type, val] of entries) {
      const count = val.length / ({ 2: 1, 3: 2, 4: 4, 5: 8 })[type];
      out.push(...u16(tag), ...u16(type), ...u32(count));
      if (val.length <= 4) out.push(...val, ...Array(4 - val.length).fill(0));
      else out.push(...u32(place(val)));
    }
    out.push(...u32(0));
    return out;
  };
  const ifd0 = writeIfd([[0x8769, 4, u32(exifAt)], [0x8825, 4, u32(gpsAt)]]);
  const exif = writeIfd(exifEntries);
  const gps = writeIfd(gpsEntries);
  bytes.push(...(le ? [0x49, 0x49] : [0x4D, 0x4D]), ...u16(42), ...u32(ifd0At), ...ifd0, ...exif, ...gps, ...extra);
  return bytes;
}

function jpeg(segments) {
  const out = [0xFF, 0xD8];
  for (const [marker, payload] of segments) out.push(0xFF, marker, (payload.length + 2) >> 8, (payload.length + 2) & 255, ...payload);
  out.push(0xFF, 0xDA, 0, 2, 1, 2, 3, 0xFF, 0xD9); // start of scan + a little "image data"
  return new Uint8Array(out);
}
const exifSeg = (opts) => [0xE1, [...Buffer.from('Exif\0\0', 'latin1'), ...tiff(opts)]];
const xmpSeg = (xml) => [0xE1, [...Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'latin1'), ...Buffer.from(xml, 'latin1')]];

// Time with an explicit offset (IST) → exact UTC instant
let m = parse(jpeg([exifSeg({ when: '2026:09:24 14:05:09', zone: '+05:30' })]));
assert.equal(m.taken_at, '2026-09-24T08:35:09.000Z');
assert.equal(m.lat, null);
assert.equal(m.ai_marker, null);

// Big-endian (Motorola) TIFF, GPS in the southern/western hemispheres
m = parse(jpeg([exifSeg({ le: false, when: '2026:01:02 03:04:05', zone: '-03:00', lat: -23.3321, lng: -86.3655 })]));
assert.equal(m.taken_at, '2026-01-02T06:04:05.000Z');
assert.ok(Math.abs(m.lat + 23.3321) < 1e-5 && Math.abs(m.lng + 86.3655) < 1e-5, JSON.stringify(m));

// Purulia GPS, little-endian; no offset → this device's time zone
m = parse(jpeg([exifSeg({ when: '2026:09:24 14:05:09', lat: 23.3321, lng: 86.3655 })]));
assert.ok(Math.abs(m.lat - 23.3321) < 1e-5 && Math.abs(m.lng - 86.3655) < 1e-5, JSON.stringify(m));
assert.equal(m.taken_at, new Date(2026, 8, 24, 14, 5, 9).toISOString());

// DateTimeDigitized is used when DateTimeOriginal is missing
m = parse(jpeg([exifSeg({ when: '2025:12:31 23:59:59', zone: '+00:00', digitizedOnly: true })]));
assert.equal(m.taken_at, '2025-12-31T23:59:59.000Z');

// AI-edit markers in XMP (e.g. an eraser tool) and C2PA-style text
const aiXmp = '<x:xmpmeta><rdf:Description Iptc4xmpExt:DigitalSourceType="http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia"/></x:xmpmeta>';
m = parse(jpeg([exifSeg({ when: '2026:09:24 14:05:09' }), xmpSeg(aiXmp)]));
assert.equal(m.ai_marker, 'trainedAlgorithmicMedia');
m = parse(jpeg([[0xEB, [...Buffer.from('JP\0\0jumbc2pa.actions digitalSourceType compositeSynthetic', 'latin1')]]]));
assert.equal(m.ai_marker, 'compositeSynthetic');

// Ordinary phone processing is not AI generation
m = parse(jpeg([xmpSeg('<rdf:Description DigitalSourceType="http://cv.iptc.org/newscodes/digitalsourcetype/algorithmicallyEnhanced"/>')]));
assert.equal(m.ai_marker, null, 'algorithmicallyEnhanced must not count as AI-made');
m = parse(jpeg([xmpSeg('<rdf:Description DigitalSourceType="http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture"/>')]));
assert.equal(m.ai_marker, null);

// PNG from an image generator (marker in an iTXt chunk) — no EXIF, marker found
const png = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
  ...Buffer.from('....iTXtXML:com.adobe.xmp....trainedAlgorithmicMedia....IDAT', 'latin1')]);
m = parse(png);
assert.deepEqual(m, { taken_at: null, lat: null, lng: null, ai_marker: 'trainedAlgorithmicMedia' });

// Broken / hostile input never throws
for (const junk of [new Uint8Array(0), new Uint8Array([0xFF, 0xD8]), new Uint8Array([0xFF, 0xD8, 0xFF, 0xE1, 0, 1]),
  jpeg([[0xE1, [...Buffer.from('Exif\0\0II*\0\xff\xff\xff\xff', 'latin1')]]]),
  jpeg([exifSeg({ when: 'not a date' })]), jpeg([exifSeg({ when: '1970:01:01 00:00:00' })])]) {
  const r = parse(junk);
  assert.equal(r.taken_at, null);
  assert.equal(r.lat, null);
}

// GPS 0,0 (a common "no fix" value) is ignored
m = parse(jpeg([exifSeg({ lat: 0, lng: 0 })]));
assert.equal(m.lat, null);

console.log('photo metadata reader tests passed');
