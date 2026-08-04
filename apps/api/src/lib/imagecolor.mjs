/**
 * Garment colour signature from a product image.
 *
 * Product photos differ by model/pose/background across marketplaces, so full
 * perceptual hashing is unreliable. But the garment's COLOUR is stable. We crop
 * the central chest region (where the garment dominates), drop near-white
 * background and skin-tone pixels, average the rest in CIELAB, and compare two
 * signatures with Delta-E. Small Delta-E ⇒ same colourway (even if the platforms
 * NAME the colour differently, e.g. Orange vs Yellow).
 */
import sharp from 'sharp';

function rgb2lab(r, g, b) {
  let R = r / 255, G = g / 255, B = b / 255;
  R = R > 0.04045 ? ((R + 0.055) / 1.055) ** 2.4 : R / 12.92;
  G = G > 0.04045 ? ((G + 0.055) / 1.055) ** 2.4 : G / 12.92;
  B = B > 0.04045 ? ((B + 0.055) / 1.055) ** 2.4 : B / 12.92;
  let X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  let Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  let Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  X = f(X); Y = f(Y); Z = f(Z);
  return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
}

/**
 * Learn the backdrop colour from the image border instead of assuming it.
 *
 * The previous heuristic only rejected near-white and near-black, so a BEIGE
 * studio backdrop was sampled as if it were the garment: navy jeans on tan
 * returned RGB [176,143,120] (the tan), brown jeans on white returned a similar
 * wash, and the two "matched". Product shots put backdrop at the frame edge
 * essentially always, so the border is a reliable sample of it.
 *
 * Median (not mean) so a garment clipping the edge cannot drag the estimate.
 */
function borderColor(data, size, ch) {
  const t = Math.max(2, Math.round(size * 0.06));
  const rs = [], gs = [], bs = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (y >= t && y < size - t && x >= t && x < size - t) continue;
      const i = (y * size + x) * ch;
      rs.push(data[i]); gs.push(data[i + 1]); bs.push(data[i + 2]);
    }
  }
  if (!rs.length) return null;
  const med = (a) => { a.sort((p, q) => p - q); return a[a.length >> 1]; };
  return [med(rs), med(gs), med(bs)];
}

/** Perceptual distance in CIELAB, used to decide "is this pixel backdrop?". */
function labDist(rgbA, rgbB) {
  const a = rgb2lab(...rgbA), b = rgb2lab(...rgbB);
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

// Pixels this close to the learned backdrop are treated as backdrop.
const BG_TOLERANCE = 16;

/**
 * Where the garment actually sits in a product photo, by garment class.
 *
 * A single fixed "chest" box is only correct for tops. On a full-body jeans
 * shot that same box lands on the model's torso and hands — a Navy pair of
 * jeans sampled RGB [176,143,120] (skin tone), so wrong colourways were being
 * "confirmed" by comparing skin against skin. Region must follow the garment.
 *
 * [y0, y1, x0, x1] as fractions of the frame, plus a wider fallback.
 */
export const SAMPLE_REGIONS = {
  // Chest — face is higher, arms are wider.
  top: { primary: [0.42, 0.78, 0.36, 0.64], fallback: [0.40, 0.85, 0.28, 0.72] },
  // Thighs/legs — below the waist, avoiding shoes and any held items.
  bottom: { primary: [0.55, 0.86, 0.38, 0.62], fallback: [0.48, 0.92, 0.30, 0.70] },
  // Footwear occupies the lower band and is usually shot wide.
  footwear: { primary: [0.35, 0.85, 0.20, 0.80], fallback: [0.25, 0.95, 0.10, 0.90] },
  // Bags, watches, and anything shot as a centred object on plain backdrop.
  object: { primary: [0.30, 0.75, 0.28, 0.72], fallback: [0.18, 0.88, 0.15, 0.85] },
};

// Product-class → sampling region mapping lives in taxonomy.mjs (extensible
// via data/taxonomy.custom.json). Unknown classes fall back to 'object'.
import { GARMENT_REGION } from './taxonomy.mjs';

/** Garment type → sampling region key. Unknown garments use the object box. */
export function regionForGarment(garment) {
  if (!garment) return 'object';
  return GARMENT_REGION[garment] || 'top';
}

/**
 * Returns { lab:[L,a,b], rgb:[r,g,b], sampled, region } or null.
 * `region` is one of SAMPLE_REGIONS — pass the garment's class, not a guess.
 */
export async function garmentColor(buf, region = 'top') {
  const size = 96;
  const { data, info } = await sharp(buf)
    .resize(size, size, { fit: 'cover' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  const bg = borderColor(data, size, ch);

  /**
   * Collect garment pixels from a window, then return the DOMINANT colour
   * rather than the mean. Averaging blends denim with skin, shoes and any
   * residual backdrop into a muddy value that matches almost anything; the
   * dominant cluster is the garment itself.
   */
  const sample = (y0, y1, x0, x1) => {
    const bins = new Map();
    let n = 0;
    const ry0 = Math.floor(size * y0), ry1 = Math.floor(size * y1);
    const rx0 = Math.floor(size * x0), rx1 = Math.floor(size * x1);
    for (let y = ry0; y < ry1; y++) {
      for (let x = rx0; x < rx1; x++) {
        const i = (y * size + x) * ch;
        const R = data[i], G = data[i + 1], B = data[i + 2];
        if (bg && labDist([R, G, B], bg) < BG_TOLERANCE) continue; // backdrop
        // 16 levels per channel — coarse enough to group shading, fine enough
        // to keep navy and brown apart.
        const key = ((R >> 4) << 8) | ((G >> 4) << 4) | (B >> 4);
        let e = bins.get(key);
        if (!e) bins.set(key, (e = { r: 0, g: 0, b: 0, c: 0 }));
        e.r += R; e.g += G; e.b += B; e.c++;
        n++;
      }
    }
    if (!n) return null;
    let best = null;
    for (const e of bins.values()) if (!best || e.c > best.c) best = e;
    return {
      rgb: [Math.round(best.r / best.c), Math.round(best.g / best.c), Math.round(best.b / best.c)],
      dominant: best.c,
      sampled: n,
    };
  };

  const box = SAMPLE_REGIONS[region] || SAMPLE_REGIONS.top;
  let s = sample(...box.primary);
  if (!s || s.sampled < 40) s = sample(...box.fallback) || s;
  // Backdrop-coloured garment (white shirt on white) drops everything — fall
  // back to the whole frame rather than reporting no colour at all.
  if (!s || s.sampled < 20) s = sample(0.1, 0.9, 0.1, 0.9);
  if (!s || s.sampled < 12) return null;

  const [r, g, b] = s.rgb;
  return {
    rgb: [r, g, b],
    lab: rgb2lab(r, g, b),
    sampled: s.sampled,
    dominant: s.dominant,
    background: bg,
    region,
  };
}

/** CIE76 Delta-E between two LAB colours. <~15 = same colourway. */
export function deltaE(labA, labB) {
  const d = Math.hypot(labA[0] - labB[0], labA[1] - labB[1], labA[2] - labB[2]);
  return Number(d.toFixed(1));
}

// Network-backed garment-colour lookup with an in-memory cache.
// Cache key includes the region: the same photo yields a different colour
// depending on which part of the garment we read.
const _cache = new Map();
export async function fetchGarmentColor(url, region = 'top', timeoutMs = 12000) {
  if (!url) return null;
  const u = url.startsWith('//') ? 'https:' + url : url;
  const key = `${region}|${u}`;
  if (_cache.has(key)) return _cache.get(key);
  let out = null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: ctrl.signal });
    clearTimeout(t);
    if (res.ok) out = await garmentColor(Buffer.from(await res.arrayBuffer()), region);
  } catch {
    out = null;
  }
  _cache.set(key, out);
  return out;
}

export const COLOR_CONFIRM = 15; // Δe ≤ → same colourway confirmed
export const COLOR_REJECT = 26; // Δe > → different colour, reject as not-ditto
