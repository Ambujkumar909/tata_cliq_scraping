/**
 * Evidence model (v4) — replaces the v3 hard AND-gate chain.
 *
 * v3 required brand AND gender AND garment AND exact-MRP AND fit AND pattern to
 * all hold. Any single false rejected the candidate outright, which cost ~50% of
 * real matches (79/150 Myntra, 69/150 Ajio). Exact MRP was the worst offender:
 * it was the single biggest Ajio rejector, yet platforms legitimately publish
 * different MRP for one style.
 *
 * v4 splits the decision in two:
 *
 *   HARD GATES — only attributes whose contradiction PROVES a different product:
 *                brand, gender-class, garment type. Plus image colour rejection,
 *                which v3 already proved reliable.
 *
 *   EVIDENCE   — everything else is scored and summed, never vetoes. Exact MRP
 *                stays the heaviest single signal; it just can no longer
 *                single-handedly discard a candidate that every other signal
 *                agrees on.
 *
 * Unavailable signals are RENORMALISED away rather than scored as zero. This
 * matters for fairness: Ajio's PDP is hard-403, so it has no attribute or
 * description evidence, and scoring those as 0 would systematically rank Ajio
 * below Myntra for reasons that have nothing to do with the product.
 */
import {
  normalizeText, tokens, detectGender, detectGarment, detectFit, detectPattern, genderCompatible,
  brandScore, stripBrand, colorFamily,
} from '../lib/normalize.mjs';
import { canonicalAttributes, attributeMatch } from '../lib/attributes.mjs';
import { titleSimilarity, descriptionSimilarity } from '../lib/semantic.mjs';
import { imageSimilarity } from '../lib/imagesim.mjs';

export const BRAND_MIN = 0.8;

// ── Model codes: the most category-UNIVERSAL identity signal ──
// Brand-issued alphanumeric identifiers — "541" (Levi's), "SM 9085" (Sparx),
// "WH-CH520" (Sony), "VE8G00124" (Versace) — name the exact SKU regardless of
// category, so they keep working for categories our vocabulary has never seen.
//
//   STRONG codes  letters+digits mixed ("ch520", "9085sm"): near-unambiguous.
//   WEAK codes    pure 3–6 digit numbers ("541"): real models, but also GSM /
//                 thread-counts — usable for AGREEMENT only, never conflict.
const UNIT_TOKEN = /^\d+(ml|gm|gms|g|kg|cm|mm|in|inch|tc|gsm|w|hz|mah|hr|hrs|day|days|pc|pcs|pack)$/;
const SIZE_TOKEN = /^(x{0,3}[sl]|\d+x[sl]|\d+[a-f])$/; // xs..xxxl, 2xl, 32b…

export function modelCodes(text) {
  const strong = new Set(), weak = new Set();
  for (const tok of normalizeText(text).split(' ')) {
    if (tok.length < 3 || tok.length > 12) continue;
    const hasDigit = /\d/.test(tok), hasAlpha = /[a-z]/.test(tok);
    if (hasDigit && hasAlpha) {
      if (SIZE_TOKEN.test(tok) || UNIT_TOKEN.test(tok)) continue;
      strong.add(tok);
    } else if (/^\d{3,6}$/.test(tok)) {
      weak.add(tok);
    }
  }
  return { strong, weak };
}

/**
 * Compare model codes between two titles.
 * Returns { score, conflict } — score null when neither side carries codes
 * (renormalised away), conflict true only when BOTH sides declare strong codes
 * and none agree, which is positive evidence of a DIFFERENT SKU.
 */
export function modelSignal(aText, bText) {
  const a = modelCodes(aText), b = modelCodes(bText);
  const sharedStrong = [...a.strong].filter((t) => b.strong.has(t));
  const sharedWeak = [...a.weak].filter((t) => b.weak.has(t));
  if (sharedStrong.length) return { score: 1, conflict: false, shared: sharedStrong };
  if (a.strong.size && b.strong.size) return { score: 0, conflict: true, shared: [] };
  if (sharedWeak.length) return { score: 0.85, conflict: false, shared: sharedWeak };
  // Disjoint pure-number codes ("SM 9085" vs "SM 401" → 9085/401): mild
  // negative evidence, never a conflict — numbers also encode thread counts
  // and wattages, where 140-vs-144 can be one product rounded two ways.
  if (a.weak.size && b.weak.size) return { score: 0.25, conflict: false, shared: [] };
  return { score: null, conflict: false, shared: [] };
}

// ── Layer 2: hard gates ───────────────────────────────────────
/**
 * Only contradictions that PROVE a different product belong here.
 * Returns { pass, reasons } — reasons are surfaced in the report either way.
 */
export function hardGates(anchor, candidate) {
  const brand = brandScore(anchor.brand, candidate.brand);
  const brandOk = brand >= BRAND_MIN;

  const aGender = anchor.gender || detectGender(`${anchor.brand} ${anchor.title}`);
  const cGender = candidate.gender || detectGender(`${candidate.brand} ${candidate.title}`);
  const genderOk = genderCompatible(aGender, cGender);

  // `anchor.garment` is precomputed by the matcher (title + CLIQ category
  // breadcrumb), which resolves titles that name no garment at all.
  const aGarment =
    anchor.garment || detectGarment(stripBrand(anchor.title, anchor.brand), anchor.articleType);
  const cGarment = detectGarment(stripBrand(candidate.title, candidate.brand), candidate.articleType);
  // Both sides must resolve AND agree. An unresolved garment on either side is
  // not proof of difference, so it does not fail the gate.
  const garmentOk = !aGarment || !cGarment ? true : aGarment === cGarment;
  const garmentKnown = Boolean(aGarment && cGarment);

  // FIT is part of SKU identity, not a preference — a tapered jean is not a
  // bootcut jean. v4 originally scored this, which let tapered match bootcut,
  // slim match cropped, and slim match regular. Gate only when BOTH sides
  // declare a fit; an undeclared fit is unknown, not a difference.
  const aFit = detectFit(anchor.title);
  const cFit = detectFit(candidate.title);
  const fitOk = !(aFit && cFit && aFit !== cFit);

  // Colour FAMILY conflict (navy vs brown, grey vs black). Not a veto on its
  // own — platforms mislabel shades — but recorded so the matcher can demand
  // image proof before accepting it. See COLOUR PROOF in matcher.mjs.
  const aFam = colorFamily(anchor.color) || colorFamily(anchor.title);
  const cFam = colorFamily(candidate.color) || colorFamily(candidate.title);
  // 'multi' vs a concrete family is NOT a conflict (a multicolour garment can
  // image as any dominant shade) — but it is not agreement either: the matcher
  // demands moderate image proof for it (colorMulti flag).
  const colorMulti = aFam === 'multi' || cFam === 'multi';
  const colorConflict = Boolean(aFam && cFam && aFam !== cFam && !colorMulti);
  // Both retailers assert the SAME colour family — used to stop noisy image
  // Δe (model-shot vs flat-lay lighting) from vetoing two agreeing labels.
  const colorAgree = Boolean(aFam && cFam && aFam === cFam && aFam !== 'multi');

  return {
    pass: brandOk && genderOk && garmentOk && fitOk,
    reasons: {
      brand: { score: Number(brand.toFixed(2)), anchor: anchor.brand, cand: candidate.brand, ok: brandOk },
      gender: { anchor: aGender, cand: cGender, ok: genderOk },
      garment: { anchor: aGarment, cand: cGarment, ok: garmentOk, known: garmentKnown },
      fit: { anchor: aFit, cand: cFit, ok: fitOk },
      color: { anchor: aFam, cand: cFam, conflict: colorConflict },
    },
    brand,
    garmentKnown,
    colorConflict,
    colorAgree,
    colorMulti,
  };
}

// ── Layer 3: weighted evidence ────────────────────────────────
// Sum to 1.0 when every signal is present; renormalised when some are missing.
export const WEIGHTS = {
  mrpExact: 0.24,     // strongest price-identity signal — brand-set per style
  attributes: 0.20,   // structured spec agreement (needs PDP)
  title: 0.16,        // semantic title similarity
  image: 0.15,        // garment colour + structure
  model: 0.12,        // brand-issued model codes — category-universal
  description: 0.08,  // semantic description similarity (needs PDP)
  brand: 0.05,        // degree of brand agreement above the gate
};

function mrpEvidence(anchor, candidate) {
  if (anchor.mrp == null || candidate.mrp == null) return null;
  const a = Math.round(anchor.mrp), b = Math.round(candidate.mrp);
  if (a === b) return 1;
  const rel = Math.abs(a - b) / Math.max(a, b);
  // Near-identical MRP is still corroboration; wildly different is evidence
  // against, but never a veto.
  if (rel <= 0.02) return 0.9;
  if (rel <= 0.1) return 0.55;
  if (rel <= 0.25) return 0.25;
  return 0;
}

/**
 * Blend present signals, renormalising over whatever was actually available.
 *
 * `scales` shrinks a signal's weight when the evidence behind it is thin. Ajio
 * publishes no PDP, so only 1-2 attributes ever compare and they trivially
 * agree — an unscaled attributes=1.00 pushed a wrong-colour SKU to "EXACT
 * MATCH 85%". A perfect score over two fields must not outweigh five real ones.
 */
function blend(parts, scales = {}) {
  let num = 0, den = 0;
  const used = {};
  for (const [k, w0] of Object.entries(WEIGHTS)) {
    const v = parts[k];
    if (v == null) continue;
    const w = w0 * (scales[k] ?? 1);
    if (w <= 0) continue;
    num += v * w;
    den += w;
    used[k] = Number(v.toFixed(4));
  }
  return {
    score: den ? Number((num / den).toFixed(4)) : null,
    coverage: Number(den.toFixed(3)),
    signals: used,
  };
}

// Attributes only carry full weight once enough fields actually compared.
const ATTR_FULL_COVERAGE = 5;
const attrScale = (compared) => Math.min(1, (compared || 0) / ATTR_FULL_COVERAGE);

/**
 * Stage 1 — cheap, no network. Scored for EVERY surviving candidate so we can
 * rank and pick finalists before spending PDP fetches.
 */
export async function cheapEvidence(anchor, candidate, gates) {
  const title = await titleSimilarity(anchor.title, candidate.title);
  const model = modelSignal(anchor.title, candidate.title);
  const parts = {
    mrpExact: mrpEvidence(anchor, candidate),
    title: title.score,
    model: model.score,
    brand: gates?.brand ?? brandScore(anchor.brand, candidate.brand),
    attributes: null,
    description: null,
    image: null,
  };
  const out = blend(parts);
  return { ...out, parts, titleParts: title.parts, modelConflict: model.conflict };
}

/**
 * Stage 2 — full evidence for finalists only (PDP + image signatures already
 * fetched by the caller).
 */
export async function fullEvidence(anchorCtx, candCtx, gates) {
  const { product: anchor, detail: aDetail, imageSig: aImg } = anchorCtx;
  const { product: candidate, detail: cDetail, imageSig: cImg } = candCtx;

  const attrsA = canonicalAttributes(anchor, aDetail);
  const attrsB = canonicalAttributes(candidate, cDetail);
  const attrMatch = attributeMatch(attrsA, attrsB);

  const title = await titleSimilarity(anchor.title, candidate.title);
  const desc =
    aDetail?.description && cDetail?.description
      ? await descriptionSimilarity(aDetail.description, cDetail.description)
      : { score: null, parts: null };
  const image = imageSimilarity(aImg, cImg);

  const model = modelSignal(anchor.title, candidate.title);
  const parts = {
    mrpExact: mrpEvidence(anchor, candidate),
    attributes: attrMatch.score,
    title: title.score,
    image: image.score,
    model: model.score,
    description: desc.score,
    brand: gates?.brand ?? brandScore(anchor.brand, candidate.brand),
  };

  const out = blend(parts, { attributes: attrScale(attrMatch.compared) });
  return {
    ...out,
    attrCompared: attrMatch.compared,
    modelConflict: model.conflict,
    modelShared: model.shared,
    parts,
    detail: {
      attributes: { a: attrsA, b: attrsB, match: attrMatch },
      model,
      title,
      description: desc,
      image,
      mrp: { anchor: anchor.mrp, cand: candidate.mrp, exact: parts.mrpExact === 1 },
    },
  };
}

// ── Classification ────────────────────────────────────────────
export const MATCH_TIERS = [
  { type: 'EXACT MATCH', min: 0.85 },
  { type: 'CLOSE MATCH', min: 0.72 },
  { type: 'PARTIAL MATCH', min: 0.58 },
];

export function classify(score, minScore = 0.58) {
  if (score == null || score < minScore) return { type: 'NO MATCH', surfaced: false };
  const tier = MATCH_TIERS.find((t) => score >= t.min);
  return { type: tier ? tier.type : 'PARTIAL MATCH', surfaced: true };
}

/**
 * Human-readable rationale for the report's "Match Reason" and the decision
 * sidebar. Built from what the evidence actually showed, never boilerplate.
 */
export function explain(ev, gates) {
  const s = ev.parts || {};
  const why = [], diff = [];

  if (s.brand >= 0.99) why.push('Identical brand');
  else if (s.brand >= BRAND_MIN) why.push('Brand matches');
  else diff.push('Brand is different');

  if (s.mrpExact === 1) why.push('Exact MRP match');
  else if (s.mrpExact != null && s.mrpExact >= 0.55) why.push('Near-identical MRP');
  else if (s.mrpExact != null) diff.push('MRP differs materially');

  const am = ev.detail?.attributes?.match;
  if (am?.score != null) {
    if (am.score >= 0.85) why.push(`Specifications agree (${am.agreed}/${am.compared})`);
    else if (am.score >= 0.6) why.push('Most specifications agree');
    for (const f of (am.differing || []).slice(0, 3)) diff.push(`${f.key}: ${f.a} vs ${f.b}`);
  }

  if (s.title != null && s.title >= 0.7) why.push('Highly similar titles');
  if (s.description != null && s.description >= 0.7) why.push('Descriptions describe the same item');
  else if (s.description != null && s.description < 0.4) diff.push('Descriptions diverge');

  const img = ev.detail?.image;
  if (img?.colorConfirmed) why.push(`Colour verified from image (Δe ${img.deltaE})`);
  else if (img?.colorRejected) diff.push(`Image colour differs (Δe ${img.deltaE})`);
  if (img?.structure != null && img.structure >= 0.8) why.push('Highly similar product images');

  if (gates?.reasons?.garment?.ok && gates.reasons.garment.known) {
    why.push(`Same garment type (${gates.reasons.garment.anchor})`);
  }
  return { why, differences: diff };
}
