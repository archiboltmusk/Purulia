// Pure helpers for the photo check, kept free of Deno/Supabase imports so
// they can be unit-tested with plain Node.

// Random flat names: a public photo link must not reveal who uploaded it.
export const PATH_RE = /^(reports|claims|votes)\/[A-Za-z0-9_-]{16,64}\.(jpg|jpeg|png|webp)$/;

/** True for a well-formed Kasa photo path (no folders, no traversal). */
export function isPhotoPath(path: string): boolean {
  return PATH_RE.test(path);
}

export const GRID = 9;
const FLAT = 4; // gray levels; pairs closer than this are "flat" and ignored

/**
 * Difference hash that survives re-compression: for a 9×9 grayscale
 * thumbnail, 64 horizontal + 64 vertical "is the next cell brighter" bits,
 * plus a 128-bit mask of which comparisons were clear enough to trust.
 * Flat areas (walls, road, sky) go in the mask as "don't care", so JPEG
 * noise there can't flip the hash. Returns 64 hex chars: signs then mask.
 */
export function dhashFromGray(gray: ArrayLike<number>): string {
  if (gray.length !== GRID * GRID) throw new Error('dhash needs a 9x9 thumbnail');
  const sign: number[] = [];
  const care: number[] = [];
  const push = (a: number, b: number) => { sign.push(a < b ? 1 : 0); care.push(Math.abs(a - b) >= FLAT ? 1 : 0); };
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) push(gray[y * GRID + x], gray[y * GRID + x + 1]);
  for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) push(gray[y * GRID + x], gray[(y + 1) * GRID + x]);
  const hex = (bits: number[]) => {
    let out = '';
    for (let i = 0; i < bits.length; i += 4) out += ((bits[i] << 3) | (bits[i + 1] << 2) | (bits[i + 2] << 1) | bits[i + 3]).toString(16);
    return out;
  };
  return hex(sign) + hex(care);
}

/** Box-filters an RGBA bitmap down to the 9×9 grayscale grid. */
export function grayThumb(rgba: ArrayLike<number>, width: number, height: number): number[] {
  const sums = new Array(GRID * GRID).fill(0);
  const counts = new Array(GRID * GRID).fill(0);
  for (let y = 0; y < height; y++) {
    const cy = Math.min(GRID - 1, Math.floor((y * GRID) / height));
    for (let x = 0; x < width; x++) {
      const cx = Math.min(GRID - 1, Math.floor((x * GRID) / width));
      const i = (y * width + x) * 4;
      sums[cy * GRID + cx] += 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
      counts[cy * GRID + cx]++;
    }
  }
  return sums.map((s, i) => s / Math.max(1, counts[i]));
}

const bitsOf = (hex: string) => hex.split('').flatMap((c) => {
  const n = parseInt(c, 16);
  return [(n >> 3) & 1, (n >> 2) & 1, (n >> 1) & 1, n & 1];
});

/**
 * How different two photos are, comparing each of the 128 edge tests as
 * "brighter", "darker" or "flat". A comparison that is flat in one photo but
 * a clear edge in the other counts as a difference too — that is exactly
 * what removing (or adding) a pile of garbage does. `informative` is how
 * many tests were an edge in at least one photo. Mirrors
 * kasa_private.photo_distance() in the migration.
 */
export function photoDistance(a: string, b: string): { dist: number; informative: number } {
  const [sa, ca, sb, cb] = [bitsOf(a.slice(0, 32)), bitsOf(a.slice(32)), bitsOf(b.slice(0, 32)), bitsOf(b.slice(32))];
  let dist = 0, informative = 0;
  for (let i = 0; i < 128; i++) {
    if (ca[i] || cb[i]) informative++;
    if (ca[i] !== cb[i] || (ca[i] && sa[i] !== sb[i])) dist++;
  }
  return { dist, informative };
}

/** Same rule the database applies: near-identical and enough detail to judge. */
export function isSamePhoto(a: string, b: string, maxDist = 6, minInformative = 24): boolean {
  const { dist, informative } = photoDistance(a, b);
  return informative >= minInformative && dist <= maxDist;
}

// Vision vocabulary. Bins are checked first: a clean street with a dustbin
// gets labelled "Waste container", which must not read as garbage. Strong
// terms mean waste on their own; weak terms ("plastic", "bottle") also show
// up in clean scenes, so they count for less.
const BINS = ['waste container', 'waste containment', 'trash can', 'garbage can', 'recycling bin', 'dustbin', 'wheelie bin', 'dumpster', 'bin'];
const STRONG = ['litter', 'garbage', 'rubbish', 'trash', 'landfill', 'debris', 'dumping', 'refuse', 'junk', 'scrap', 'sewage', 'pollution', 'waste'];
const WEAK = ['plastic bag', 'plastic', 'packaging', 'bottle', 'paper', 'rubble'];
const BIN_WEIGHT = 0.3;
const WEAK_WEIGHT = 0.6;

export interface Annotation { description?: string; name?: string; score?: number }

/** 0..1 — how strongly Vision thinks the photo shows garbage. */
export function garbageScore(labels: Annotation[] = [], objects: Annotation[] = []): number {
  let best = 0;
  for (const a of [...labels, ...objects]) {
    const text = String(a.description ?? a.name ?? '').toLowerCase();
    const score = Number(a.score ?? 0);
    const weight = BINS.some((t) => text.includes(t)) ? BIN_WEIGHT
      : STRONG.some((t) => text.includes(t)) ? 1
      : WEAK.some((t) => text.includes(t)) ? WEAK_WEIGHT : 0;
    best = Math.max(best, score * weight);
  }
  return Math.round(best * 1000) / 1000;
}

const BAD = new Set(['LIKELY', 'VERY_LIKELY']);

/** Adult or violent content is never published; "racy" only when very likely. */
export function isUnsafe(safe: Record<string, string> | undefined): boolean {
  if (!safe) return false;
  return BAD.has(safe.adult) || BAD.has(safe.violence) || safe.racy === 'VERY_LIKELY';
}
