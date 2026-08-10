/**
 * Structured-fingerprint product matching (v3).
 *
 * A Tata CLIQ product is the anchor; we decide whether a competitor listing is
 * the DITTO-SAME product using a composite fingerprint rather than fuzzy title
 * text. Learned from a real verified pair (Louis Philippe orange polo — CLIQ
 * "Orange" vs Myntra "Yellow", both MRP ₹1899):
 *
 *   HARD GATES (all must pass):  brand · gender · garment · EXACT MRP · fit · pattern
 *   SOFT / FLAGGED:              colour name (platforms mislabel shades), title tokens
 *
 * MRP is the linchpin — brand-set, identical across marketplaces for one style.
 * Colour NAME is deliberately NOT a gate (proven unreliable).
 */

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'with', 'for', 'of', 'in', 'on', 'by', 'to', 's',
  'cotton', 'polyester', 'blend', 'fabric', 'pure', 'branding', 'brand',
  'sleeve', 'sleeves', 'collar', 'tipping',
]);

// Category vocabulary is DATA, not logic — see taxonomy.mjs for the extension
// contract (drop-in data/taxonomy.custom.json, no code changes).
import {
  BRAND_ALIASES, GARMENT_RULES, FIT_TOKENS, FIT_CANON, COLOR_FAMILY, COLOR_WORDS, BASE_COLORS,
} from './taxonomy.mjs';

export function normalizeText(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}
export function normalizeBrand(s) {
  const n = normalizeText(s);
  return BRAND_ALIASES.get(n) || n;
}
export function tokens(s, { keepStop = false } = {}) {
  return normalizeText(s).split(' ').filter((t) => t.length > 1 && (keepStop || !STOPWORDS.has(t)));
}
function jaccard(a, b) {
  const A = new Set(a), B = new Set(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

// ── Brand ────────────────────────────────────────────────────
export function brandScore(a, b) {
  const na = normalizeBrand(a), nb = normalizeBrand(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.85;
  const j = jaccard(na.split(' '), nb.split(' '));
  return j >= 0.5 ? 0.6 + j * 0.2 : j * 0.4;
}

// ── Gender ───────────────────────────────────────────────────
export function detectGender(text) {
  const t = ` ${normalizeText(text)} `;
  if (/\b(girls?)\b/.test(t)) return 'girls';
  if (/\b(boys?)\b/.test(t)) return 'boys';
  if (/\b(women|womens|woman|ladies)\b/.test(t)) return 'women';
  if (/\b(men|mens|man|gents)\b/.test(t)) return 'men';
  // Bare "Kids"/"Infant" with no sex word — age is known, sex is not.
  if (/\b(kids?|children|childrens|infants?|toddlers?)\b/.test(t)) return 'kids';
  if (/\b(unisex)\b/.test(t)) return 'unisex';
  return null;
}
/**
 * Gender from a category code whose FIRST LETTER encodes it (M/W/B/G).
 *
 * ⚠ Not every retailer's codes work this way, and Tata CLIQ's do not. CLIQ
 * merchandise codes look like `MSH10` / `MSH11` / `MSH21`, where the prefix is
 * a hierarchy id, not a gender: `MSH10` holds "ADIDAS Women's Purple TR-ES CREW
 * T-Shirt" as well as menswear. Applying this to a CLIQ code answers "men" for
 * every product, which is worse than answering nothing — see the matcher, which
 * reads CLIQ's PDP gender field and breadcrumb instead.
 *
 * Kept for retailers whose codes genuinely carry the prefix; do not wire it in
 * without first checking a real sample of that retailer's codes.
 */
export function genderFromCategory(code) {
  if (!code) return null;
  const c = String(code).toUpperCase();
  if (c.startsWith('M')) return 'men';
  if (c.startsWith('W')) return 'women';
  if (c.startsWith('B')) return 'boys';
  if (c.startsWith('G')) return 'girls';
  return null;
}
/**
 * Gender compatibility across TWO independent axes: sex and age.
 *
 * v3 collapsed men↔boys and women↔girls into one "male"/"female" class, on the
 * reasoning that MRP + garment + image-colour would separate kids from adults.
 * That held only while EXACT MRP was a hard gate. Once MRP became weighted
 * evidence (see matching/evidence.mjs), the collapse started admitting real
 * false positives — a "U.S. Polo Assn. Kids Boys Printed Polo" scored 72%
 * against the men's polo it merely resembles.
 *
 * Adult and kids garments are different products, and every platform publishes
 * this reliably as a structured facet (Myntra `analytics.gender`, Ajio
 * `segmentNameText`, CLIQ category prefix), so gating on it is safe.
 */
const GENDER_SPEC = {
  men: { sex: 'male', age: 'adult' },
  women: { sex: 'female', age: 'adult' },
  boys: { sex: 'male', age: 'kids' },
  girls: { sex: 'female', age: 'kids' },
  kids: { sex: 'any', age: 'kids' },
  unisex: { sex: 'any', age: 'any' },
};
export function genderCompatible(a, b) {
  if (!a || !b) return true; // unknown on either side → don't reject on gender alone
  const A = GENDER_SPEC[a], B = GENDER_SPEC[b];
  if (!A || !B) return true;
  const sexOk = A.sex === 'any' || B.sex === 'any' || A.sex === B.sex;
  const ageOk = A.age === 'any' || B.age === 'any' || A.age === B.age;
  return sexOk && ageOk;
}

// ── Garment type ─────────────────────────────────────────────
export function detectGarment(text, articleType) {
  const t = ` ${normalizeText(text)} `;
  for (const [type, re] of GARMENT_RULES) if (re.test(t)) return type;
  if (articleType) {
    const a = ` ${normalizeText(articleType)} `;
    for (const [type, re] of GARMENT_RULES) if (re.test(a)) return type;
  }
  return null;
}

// ── Fit / Pattern / Sleeve ───────────────────────────────────
/**
 * Fit vocabulary, MOST SPECIFIC FIRST — first match wins.
 *
 * bootcut / straight / cropped were missing entirely, so a "541 Athletic
 * Tapered" jean matched a "Classic Bootcut" and a "Slim Fit" matched a
 * "Cropped Fit". For jeans especially, fit IS part of the SKU identity.
 *
 * "slim" precedes "tapered" deliberately: slim-tapered is a slim variant and
 * should still match a plain slim, whereas athletic-tapered (no slim token)
 * resolves to tapered and correctly differs.
 */
export function detectFit(text) {
  const t = normalizeText(text);
  for (const f of FIT_TOKENS) {
    if (new RegExp(`\\b${f}\\b`).test(t)) return FIT_CANON[f] || f;
  }
  return null;
}

/**
 * Colour families — so navy/blue and grey/charcoal are not treated as a
 * conflict, while navy/brown and grey/black correctly are. Shade vocabulary
 * lives in taxonomy.mjs; unknown shades yield null (= unknown, never a
 * conflict), so a shade name we have never seen cannot cause a wrong verdict.
 */
export function colorFamily(name) {
  if (!name) return null;
  const t = normalizeText(name);
  // Take the last colour-ish token ("Navy Blue" → blue, "Dark Olive" → olive).
  const words = t.split(' ').filter(Boolean);
  for (let i = words.length - 1; i >= 0; i--) {
    const w = words[i];
    if (COLOR_FAMILY[w]) return COLOR_FAMILY[w];
    if (BASE_COLORS.includes(w)) return w;
  }
  return null;
}
export function detectPattern(text) {
  const t = normalizeText(text);
  if (/\b(solid|plain)\b/.test(t)) return 'solid';
  if (/\b(graphic|typography|printed|print)\b/.test(t)) return 'printed';
  if (/\b(striped|stripe|stripes)\b/.test(t)) return 'striped';
  if (/\b(checked|checks|check|plaid)\b/.test(t)) return 'checked';
  if (/\b(floral)\b/.test(t)) return 'floral';
  if (/\b(colourblocked|colorblocked|colour block|color block)\b/.test(t)) return 'colourblocked';
  return null;
}

function colorOf(...texts) {
  const t = normalizeText(texts.filter(Boolean).join(' '));
  return COLOR_WORDS.find((c) => new RegExp(`\\b${c}\\b`).test(t)) || null;
}

// Remove brand tokens from a title so brand words (e.g. "U.S. Polo Assn.")
// don't leak into garment/attribute detection.
export function stripBrand(title, brand) {
  const bt = new Set(tokens(brand, { keepStop: true }));
  return normalizeText(title).split(' ').filter((t) => !bt.has(t)).join(' ');
}

function distinctiveTokens(title, brand) {
  const brandTokens = new Set(tokens(brand, { keepStop: true }));
  const drop = new Set([...brandTokens, ...COLOR_WORDS,
    'men', 'mens', 'man', 'women', 'womens', 'woman', 'boys', 'girls', 'kids', 'unisex',
    'fit', 'neck', 'shirt', 'tshirt', 'shirts', 'tshirts', 'tee', 'tees', 'polo',
    'slim', 'regular', 'relaxed', 'oversized', 'solid', 'printed', 'print']);
  return tokens(title).filter((t) => !drop.has(t));
}

/**
 * LEGACY (v3) ditto scorer — NOT the live matching path.
 *
 * Superseded by matching/evidence.mjs (hard gates + weighted evidence). Retained
 * because scripts/verify-gender.mjs exercises the gender-compatibility matrix
 * through it, and because it documents the all-or-nothing behaviour v4 replaced.
 * `genderCompatible` is shared with v4, so the gender audit stays meaningful.
 *
 * Returns { score, isDitto, colorDiffers, reasons }.
 */
export function scoreMatch(anchor, candidate) {
  const brand = brandScore(anchor.brand, candidate.brand);
  const brandOk = brand >= 0.8;

  const aGender = anchor.gender || detectGender(`${anchor.brand} ${anchor.title}`);
  const cGender = candidate.gender || detectGender(`${candidate.brand} ${candidate.title}`);
  const genderOk = genderCompatible(aGender, cGender);

  // Detect garment on the brand-stripped title (brands like "U.S. Polo Assn."
  // contain garment words that would otherwise poison detection).
  const aGarment = detectGarment(stripBrand(anchor.title, anchor.brand), anchor.articleType);
  const cGarment = detectGarment(stripBrand(candidate.title, candidate.brand), candidate.articleType);
  // Strict: both sides must resolve to a garment type AND agree.
  const garmentOk = !!aGarment && !!cGarment && aGarment === cGarment;

  // EXACT MRP gate (both sides always have MRP in practice).
  const mrpKnown = anchor.mrp != null && candidate.mrp != null;
  const mrpOk = mrpKnown && Math.round(anchor.mrp) === Math.round(candidate.mrp);

  const aFit = detectFit(anchor.title), cFit = detectFit(candidate.title);
  const fitOk = !(aFit && cFit && aFit !== cFit);

  const aPat = detectPattern(anchor.title), cPat = detectPattern(candidate.title);
  const patOk = !(aPat && cPat && aPat !== cPat);

  const aColor = anchor.color ? normalizeText(anchor.color).split(' ').pop() : colorOf(anchor.title);
  const cColor = candidate.color ? normalizeText(candidate.color).split(' ').pop() : colorOf(candidate.title);
  const colorDiffers = !!(aColor && cColor && aColor !== cColor);

  const titleTok = jaccard(distinctiveTokens(anchor.title, anchor.brand), distinctiveTokens(candidate.title, candidate.brand));

  const isDitto = brandOk && genderOk && garmentOk && mrpOk && fitOk && patOk;

  // Confidence (for ranking + display). MRP + brand dominate; colour is a soft nudge.
  const colorScore = aColor && cColor ? (aColor === cColor ? 1 : 0.3) : 0.6;
  let score =
    0.30 * brand +
    0.24 * (mrpOk ? 1 : 0) +
    0.14 * (garmentOk ? 1 : 0) +
    0.10 * (aFit && cFit && aFit === cFit ? 1 : 0.5) +
    0.08 * (aPat && cPat && aPat === cPat ? 1 : 0.5) +
    0.08 * titleTok +
    0.06 * colorScore;
  if (!isDitto) score *= 0.4; // non-ditto candidates rank far below

  return {
    score: Number(score.toFixed(4)),
    isDitto,
    colorDiffers,
    reasons: {
      brand: Number(brand.toFixed(2)), brandOk,
      gender: { anchor: aGender, cand: cGender, ok: genderOk },
      garment: { anchor: aGarment, cand: cGarment, ok: garmentOk },
      mrp: { anchor: anchor.mrp, cand: candidate.mrp, ok: mrpOk },
      fit: { anchor: aFit, cand: cFit, ok: fitOk },
      pattern: { anchor: aPat, cand: cPat, ok: patOk },
      color: { anchor: aColor, cand: cColor, differs: colorDiffers },
      titleTok: Number(titleTok.toFixed(2)),
    },
  };
}

/**
 * Build a competitor search query. Colour is deliberately EXCLUDED — platforms
 * name shades differently (CLIQ "Orange" vs Myntra "Yellow"), so a colour word
 * would hide the true match. Shade is confirmed later via image garment-colour.
 */
export function buildQuery(anchor) {
  const brand = normalizeText(anchor.brand);
  const gender = anchor.gender || detectGender(`${anchor.brand} ${anchor.title}`);
  const garment = detectGarment(stripBrand(anchor.title, anchor.brand), anchor.articleType);
  const extra = distinctiveTokens(anchor.title, anchor.brand).slice(0, 2).join(' ');
  const garmentWord = garment === 'tshirt' ? 't-shirt' : garment === 'polo' ? 'polo t-shirt' : garment || '';
  return [brand, gender === 'unisex' ? '' : gender, garmentWord, extra]
    .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Multiple complementary queries to lift recall. The competitor's HTML search
 * exposes only its top ~32 hits, so we cast several narrower nets and union the
 * results. A colour-narrowed query is included because colour NAMES usually DO
 * agree across platforms (the mismatch case is the exception).
 */
export function buildQueries(anchor) {
  const brand = normalizeText(anchor.brand);
  const gender = (anchor.gender || detectGender(`${anchor.brand} ${anchor.title}`));
  const g = gender === 'unisex' ? '' : gender || '';
  const garment = detectGarment(stripBrand(anchor.title, anchor.brand), anchor.articleType);
  const gw = garment === 'tshirt' ? 't-shirt' : garment === 'polo' ? 'polo t-shirt' : garment || '';
  const color = anchor.color ? normalizeText(anchor.color).split(' ').pop() : '';
  const pattern = detectPattern(anchor.title) || '';
  const dist = distinctiveTokens(anchor.title, anchor.brand);

  const q = [
    [brand, g, gw, color],                    // colour-narrowed (works when names agree)
    [brand, g, gw, dist.slice(0, 2).join(' ')], // distinctive tokens
    [brand, g, gw, pattern, color],           // pattern + colour
    [brand, g, gw],                           // broad fallback
  ].map((parts) => parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim());

  return [...new Set(q)].filter(Boolean);
}
