/**
 * Image similarity — the report's "Image Similarity" score.
 *
 * Two signals, fetched and computed in ONE pass per image:
 *
 *   • Garment COLOUR (CIELAB Delta-E, from imagecolor.mjs) — the stable signal.
 *     Marketplaces reshoot the same garment on different models, at different
 *     crops, against different backdrops, but the colourway does not change.
 *   • Structural dHash — a 64-bit gradient signature. Weak on its own here for
 *     exactly the reason above, but it corroborates: two photos of the same
 *     garment still share silhouette and print placement more than two photos
 *     of different garments do.
 *
 * Colour therefore leads and structure supports. Weighting them the other way
 * would make the score mostly a measure of how similarly the two sites art-
 * direct their photography.
 */
import sharp from 'sharp';
import { garmentColor, deltaE, COLOR_CONFIRM, COLOR_REJECT, regionForGarment } from './imagecolor.mjs';
export { regionForGarment };

/**
 * 64-bit difference hash: 9x8 greyscale, then compare each pixel to its right
 * neighbour. Robust to scale and mild brightness shifts.
 */
export async function dhash(buf) {
  const { data } = await sharp(buf)
    .resize(9, 8, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const bits = [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const i = y * 9 + x;
      bits.push(data[i] > data[i + 1] ? 1 : 0);
    }
  }
  return bits.join('');
}

export function hamming(a, b) {
  if (!a || !b || a.length !== b.length) return null;
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

// ── Signature fetch (one network round-trip, cached) ──────────
const _cache = new Map();

/**
 * Rewrite a marketplace CDN URL to a small rendition. The pipeline resizes to
 * 96px before sampling, so the default 437–1080px assets waste ~90% of the
 * transfer — on a mobile uplink that difference is most of a second per image.
 * Unknown URL shapes pass through unchanged; a failed small fetch falls back to
 * the original, so this can only make things faster, never blinder.
 */
function smallVariant(u) {
  // Tata CLIQ: .../437Wx649H/... and _437Wx649H_ filename segments
  let s = u.replace(/\/(\d{3,4})Wx(\d{3,4})H\//g, '/158Wx198H/').replace(/_(\d{3,4})Wx(\d{3,4})H_/g, '_158Wx198H_');
  // Ajio: .../-473Wx593H-... rendition markers
  s = s.replace(/-(\d{3,4})Wx(\d{3,4})H-/g, '-286Wx359H-');
  // Myntra assets: transformation params h_NNN / w_NNN / q_NN / dpr_N
  if (/myntassets\.com/.test(s)) {
    s = s.replace(/([,(/])h_\d{3,4}/g, '$1h_256').replace(/([,(/])w_\d{3,4}/g, '$1w_192')
      .replace(/([,(/])q_\d{2,3}/g, '$1q_60').replace(/dpr_\d/g, 'dpr_1');
  }
  return s;
}

async function fetchBuffer(u, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: ctrl.signal });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Returns { lab, rgb, dhash, sampled, region } or null. Never throws.
 *
 * `region` must match the garment class — reading a chest box on a jeans photo
 * samples the model, not the product. Cached per (region, url) for that reason.
 */
export async function fetchImageSignature(url, { region = 'top', timeoutMs = 12000 } = {}) {
  if (!url) return null;
  const u = url.startsWith('//') ? `https:${url}` : url;
  const key = `${region}|${u}`;
  if (_cache.has(key)) return _cache.get(key);

  let out = null;
  try {
    const small = smallVariant(u);
    let buf = await fetchBuffer(small, timeoutMs);
    if (!buf && small !== u) buf = await fetchBuffer(u, timeoutMs); // rendition missing → original
    if (buf) {
      const [color, hash] = await Promise.all([
        garmentColor(buf, region).catch(() => null),
        dhash(buf).catch(() => null),
      ]);
      if (color || hash) out = { ...(color || {}), dhash: hash, region };
    }
  } catch {
    out = null;
  }
  _cache.set(key, out);
  return out;
}

// Smooth colour agreement: Delta-E 0 → 1.0, ~15 (confirm) → 0.59,
// ~26 (reject) → 0.32. No cliff, so the displayed score degrades honestly.
const colorScore = (de) => 1 / (1 + (de / 18) ** 2);

/**
 * Compare two image signatures.
 * Returns { score, deltaE, hamming, structure, colorConfirmed, colorRejected }.
 * `score` is null when neither signal could be computed — the report shows that
 * as "not available" rather than as a zero, which would read as a difference.
 */
export function imageSimilarity(a, b) {
  if (!a || !b) return { score: null, deltaE: null, hamming: null, structure: null, colorConfirmed: null, colorRejected: null };

  const de = a.lab && b.lab ? deltaE(a.lab, b.lab) : null;
  const ham = hamming(a.dhash, b.dhash);
  const structure = ham == null ? null : 1 - ham / 64;
  const colour = de == null ? null : colorScore(de);

  let score = null;
  if (colour != null && structure != null) score = 0.72 * colour + 0.28 * structure;
  else if (colour != null) score = colour;
  else if (structure != null) score = structure;

  return {
    score: score == null ? null : Number(score.toFixed(4)),
    deltaE: de,
    hamming: ham,
    structure: structure == null ? null : Number(structure.toFixed(4)),
    colorConfirmed: de == null ? null : de <= COLOR_CONFIRM,
    colorRejected: de == null ? null : de > COLOR_REJECT,
  };
}
