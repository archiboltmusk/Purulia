/* Parishkar Purulia — reads what a photo file says about itself, on the phone.
 *
 *   KasaPhotoMeta.read(file) → { taken_at, lat, lng, ai_marker }
 *
 * - taken_at: when the camera says the photo was taken (EXIF DateTimeOriginal,
 *   using OffsetTimeOriginal when present, otherwise this device's time zone).
 * - lat/lng: the camera's GPS stamp, if the phone kept one.
 * - ai_marker: set when the file declares it was generated or edited with AI
 *   (IPTC digital source type, written into XMP and C2PA Content Credentials
 *   by Google, Samsung, Adobe, OpenAI and others).
 *
 * Only these values are sent to the server. The photo itself is re-encoded
 * without any metadata before upload. Anything unreadable comes back null —
 * missing metadata is normal (WhatsApp, screenshots, browsers that strip GPS).
 */
(function (root) {
  'use strict';

  const SCAN_BYTES = 1024 * 1024; // AI markers sit in the header, well inside this
  // Searched case-insensitively: the eraser/"magic edit" value is
  // compositeWithTrainedAlgorithmicMedia (capital T). The last entry also
  // covers both "trained" forms; it never matches "algorithmicallyEnhanced",
  // which only means ordinary phone processing (HDR, night mode).
  const AI_MARKERS = [['trainedalgorithmicmedia', 'trainedAlgorithmicMedia'],
                      ['compositesynthetic', 'compositeSynthetic'],
                      ['algorithmicmedia', 'algorithmicMedia']];

  function empty() { return { taken_at: null, lat: null, lng: null, ai_marker: null }; }

  async function read(file) {
    const out = empty();
    if (!file || typeof file.slice !== 'function') return out;
    let buf;
    try { buf = new Uint8Array(await file.slice(0, SCAN_BYTES).arrayBuffer()); } catch (e) { return out; }
    return parse(buf);
  }

  function parse(buf) {
    const out = empty();
    try { out.ai_marker = findAiMarker(buf); } catch (e) { /* keep going */ }
    try { Object.assign(out, readExif(buf)); } catch (e) { /* no EXIF */ }
    return out;
  }

  // Byte search for the IPTC terms, in any container (JPEG, PNG, WebP, HEIC).
  function findAiMarker(buf) {
    const text = latin1(buf).toLowerCase();
    for (const [needle, name] of AI_MARKERS) if (text.indexOf(needle) !== -1) return name;
    return null;
  }

  function latin1(buf) {
    if (typeof TextDecoder !== 'undefined') {
      try { return new TextDecoder('latin1').decode(buf); } catch (e) { /* fall through */ }
    }
    let s = '';
    for (let i = 0; i < buf.length; i += 8192) s += String.fromCharCode.apply(null, buf.subarray(i, i + 8192));
    return s;
  }

  // ── JPEG → APP1 "Exif\0\0" → TIFF ─────────────────────────────────────────
  function readExif(buf) {
    if (buf.length < 4 || buf[0] !== 0xFF || buf[1] !== 0xD8) return {};
    let p = 2;
    while (p + 4 <= buf.length) {
      if (buf[p] !== 0xFF) return {};
      const type = buf[p + 1];
      if (type === 0xD8 || (type >= 0xD0 && type <= 0xD7) || type === 0x01 || type === 0xFF) { p += type === 0xFF ? 1 : 2; continue; }
      if (type === 0xDA || type === 0xD9) return {};
      const len = (buf[p + 2] << 8) | buf[p + 3];
      if (len < 2) return {};
      if (type === 0xE1 && len >= 8 && buf[p + 4] === 0x45 && buf[p + 5] === 0x78 && buf[p + 6] === 0x69 &&
          buf[p + 7] === 0x66 && buf[p + 8] === 0 && buf[p + 9] === 0) {
        return readTiff(buf.subarray(p + 10, Math.min(buf.length, p + 2 + len)));
      }
      p += 2 + len;
    }
    return {};
  }

  function readTiff(t) {
    if (t.length < 8) return {};
    const le = t[0] === 0x49 && t[1] === 0x49;
    if (!le && !(t[0] === 0x4D && t[1] === 0x4D)) return {};
    const u16 = (o) => (o + 2 <= t.length ? (le ? t[o] | (t[o + 1] << 8) : (t[o] << 8) | t[o + 1]) : null);
    const u32 = (o) => (o + 4 <= t.length
      ? (le ? (t[o] | (t[o + 1] << 8) | (t[o + 2] << 16)) + t[o + 3] * 16777216
            : t[o] * 16777216 + ((t[o + 1] << 16) | (t[o + 2] << 8) | t[o + 3]))
      : null);
    if (u16(2) !== 42) return {};

    // Returns { tag: { type, count, at } } where `at` is where the value lives.
    function ifd(off) {
      const entries = {};
      const n = u16(off);
      if (n == null || n > 500) return entries;
      for (let i = 0; i < n; i++) {
        const e = off + 2 + i * 12;
        const tag = u16(e), type = u16(e + 2), count = u32(e + 4);
        if (tag == null || type == null || count == null) break;
        const size = ({ 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 })[type] || 1;
        const at = size * count <= 4 ? e + 8 : u32(e + 8);
        if (at != null && at < t.length) entries[tag] = { type, count, at };
      }
      return entries;
    }
    const ascii = (en) => {
      if (!en || en.type !== 2) return null;
      let s = '';
      for (let i = 0; i < en.count && en.at + i < t.length; i++) { const c = t[en.at + i]; if (!c) break; s += String.fromCharCode(c); }
      return s.trim() || null;
    };
    const rationals = (en, n) => {
      if (!en || en.type !== 5 || en.count < n) return null;
      const out = [];
      for (let i = 0; i < n; i++) {
        const num = u32(en.at + i * 8), den = u32(en.at + i * 8 + 4);
        if (num == null || !den) return null;
        out.push(num / den);
      }
      return out;
    };

    const ifd0 = ifd(u32(4));
    const exifPtr = ifd0[0x8769], gpsPtr = ifd0[0x8825];
    const res = {};

    if (exifPtr) {
      const ex = ifd(u32(exifPtr.at));
      const when = ascii(ex[0x9003]) || ascii(ex[0x9004]);           // DateTimeOriginal, DateTimeDigitized
      const zone = ascii(ex[0x9011]) || ascii(ex[0x9012]);           // OffsetTimeOriginal, OffsetTimeDigitized
      res.taken_at = toIso(when, zone);
    }
    if (gpsPtr) {
      const g = ifd(u32(gpsPtr.at));
      const lat = rationals(g[2], 3), lng = rationals(g[4], 3);
      const latRef = ascii(g[1]), lngRef = ascii(g[3]);
      if (lat && lng) {
        let la = lat[0] + lat[1] / 60 + lat[2] / 3600;
        let lo = lng[0] + lng[1] / 60 + lng[2] / 3600;
        if (latRef === 'S') la = -la;
        if (lngRef === 'W') lo = -lo;
        if (Number.isFinite(la) && Number.isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180 && (la || lo)) {
          res.lat = Math.round(la * 1e6) / 1e6;
          res.lng = Math.round(lo * 1e6) / 1e6;
        }
      }
    }
    return res;
  }

  // "2026:09:24 14:05:09" + optional "+05:30" → ISO UTC. Without an offset the
  // camera's clock is this phone's clock, so read it in this device's zone.
  function toIso(when, zone) {
    const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(when || '');
    if (!m) return null;
    const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
    if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    const z = /^([+-])(\d{2}):?(\d{2})$/.exec(zone || '');
    let ms;
    if (z) {
      const off = (Number(z[2]) * 60 + Number(z[3])) * (z[1] === '-' ? -1 : 1);
      ms = Date.UTC(y, mo - 1, d, h, mi, s) - off * 60000;
    } else {
      ms = new Date(y, mo - 1, d, h, mi, s).getTime();
    }
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  }

  const api = { read, parse };
  root.KasaPhotoMeta = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
