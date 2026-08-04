/**
 * Semantic similarity for product titles and descriptions.
 *
 * WHY NOT EMBEDDINGS: a transformer encoder would mean a ~25MB model fetched at
 * runtime (breaking offline/Docker cold starts) and a per-candidate inference
 * cost the 0.2s/product matching budget cannot absorb. `setEmbedder()` below is
 * the seam to swap one in when that trade becomes worth it.
 *
 * WHAT THIS DOES INSTEAD — three complementary signals:
 *
 *   1. IDF-weighted token cosine, over a synonym-canonicalised vocabulary, so
 *      "tee" == "t-shirt" and boilerplate words ("men", "cotton") stop
 *      dominating while distinctive ones ("typography", "pique") count.
 *   2. Character-trigram cosine, which survives the morphological drift that
 *      wrecks token matching ("colourblocked" ~ "colour block").
 *   3. Domain-concept overlap — the decisive one for DESCRIPTIONS. Marketing
 *      prose shares almost no vocabulary across platforms:
 *
 *        CLIQ   "Get the perfect finish to your laid-back looks with this
 *                black t-shirt from Bewakoof. Made from cotton fabric…"
 *        Myntra "Black printed T-shirt, has a round neck, and short sleeves"
 *
 *      Bag-of-words scores that pair near zero, yet they describe one garment.
 *      Comparing the CONCEPTS each text asserts (colour, garment, neck, sleeve,
 *      fabric, fit, pattern) measures agreement about the product rather than
 *      agreement about phrasing.
 */
import { normalizeText } from './normalize.mjs';
import { detectRise, detectNeck, detectSleeve, detectClosure, detectOccasion, parseFabric } from './attributes.mjs';
import { detectFit, detectPattern, detectGarment, detectGender } from './normalize.mjs';

// ── Vocabulary canonicalisation ───────────────────────────────
const STOP = new Set([
  'the', 'a', 'an', 'and', 'with', 'for', 'of', 'in', 'on', 'by', 'to', 'is', 'are', 'has', 'have',
  'this', 'that', 'it', 'its', 'from', 'your', 'you', 'our', 'we', 'be', 'as', 'at', 'or', 'will',
  'can', 'made', 'perfect', 'great', 'look', 'looks', 'style', 'styled', 'pair', 'paired', 'wear',
  'wearing', 'comes', 'featuring', 'features', 'designed', 'crafted', 'please', 'note', 'disclaimer',
  'product', 'item', 'buy', 'shop', 'online', 'day', 'days', 'model', 'height', 'size', 'wears',
]);

// Cross-platform surface forms that mean the same thing. Data lives in
// taxonomy.mjs and is runtime-extensible via data/taxonomy.custom.json.
import { SYNONYMS } from './taxonomy.mjs';

const canon = (t) => SYNONYMS[t] || t;

export function semanticTokens(text) {
  return normalizeText(text)
    .split(' ')
    .filter((t) => t.length > 1 && !STOP.has(t))
    .map(canon);
}

// ── IDF model ─────────────────────────────────────────────────
// Trained from the anchor catalog at load so that corpus-common words ("men",
// "cotton", "fit") carry little weight and rare ones carry a lot. Untrained, it
// degrades to uniform weighting rather than failing.
let _idf = null;

export function buildIdf(documents) {
  const df = new Map();
  let n = 0;
  for (const doc of documents) {
    n++;
    for (const t of new Set(semanticTokens(doc))) df.set(t, (df.get(t) || 0) + 1);
  }
  _idf = { n, df };
  return _idf;
}

function idf(token) {
  if (!_idf) return 1;
  const d = _idf.df.get(token) || 0;
  return Math.log((_idf.n + 1) / (d + 1)) + 1;
}

export const isIdfTrained = () => Boolean(_idf);

// ── Signal 1: IDF-weighted token cosine ───────────────────────
function tokenCosine(a, b) {
  const ta = semanticTokens(a), tb = semanticTokens(b);
  if (!ta.length || !tb.length) return 0;
  const va = new Map(), vb = new Map();
  for (const t of ta) va.set(t, (va.get(t) || 0) + 1);
  for (const t of tb) vb.set(t, (vb.get(t) || 0) + 1);

  let dot = 0, na = 0, nb = 0;
  for (const [t, c] of va) { const w = c * idf(t); na += w * w; if (vb.has(t)) dot += w * vb.get(t) * idf(t); }
  for (const [t, c] of vb) { const w = c * idf(t); nb += w * w; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

// ── Signal 2: character-trigram cosine ────────────────────────
function trigrams(s) {
  const t = ` ${normalizeText(s).replace(/\s+/g, ' ')} `;
  const g = new Map();
  for (let i = 0; i < t.length - 2; i++) {
    const k = t.slice(i, i + 3);
    g.set(k, (g.get(k) || 0) + 1);
  }
  return g;
}

function trigramCosine(a, b) {
  const ga = trigrams(a), gb = trigrams(b);
  if (!ga.size || !gb.size) return 0;
  let dot = 0, na = 0, nb = 0;
  for (const [k, v] of ga) { na += v * v; if (gb.has(k)) dot += v * gb.get(k); }
  for (const [, v] of gb) nb += v * v;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

// ── Signal 3: domain-concept overlap ──────────────────────────
import { COLOR_WORDS as COLORS } from './taxonomy.mjs';

/** The set of product facts a piece of text actually asserts. */
export function extractConcepts(text) {
  const t = normalizeText(text);
  const fabric = parseFabric(t);
  return {
    garment: detectGarment(t),
    gender: detectGender(t),
    fit: detectFit(t),
    pattern: detectPattern(t),
    neck: detectNeck(t),
    sleeve: detectSleeve(t),
    rise: detectRise(t),
    closure: detectClosure(t),
    occasion: detectOccasion(t),
    material: fabric?.primary || null,
    color: COLORS.find((c) => new RegExp(`\\b${c}\\b`).test(t)) || null,
  };
}

// Concepts are not equally identifying. Garment and gender DEFINE the product —
// a contradiction there means it is a different item no matter how much wording
// the two texts share. Occasion is nearly decorative.
const CONCEPT_WEIGHTS = {
  garment: 3.0, gender: 2.5, color: 1.5, pattern: 1.2, rise: 1.0, fit: 1.0,
  neck: 1.0, material: 1.0, sleeve: 0.8, closure: 0.6, occasion: 0.5,
};
const CRITICAL_CONCEPTS = new Set(['garment', 'gender']);
// Without this, "Nike Men Black Polo" vs "Nike Women Black Polo" scores ~0.75
// on concepts and ~81% overall, because the shared brand/colour/garment wording
// drowns the one fact that matters. A critical contradiction must dominate.
const CRITICAL_CONTRADICTION_PENALTY = 0.3;

/**
 * Weighted agreement over concepts both texts assert. Concepts only one side
 * mentions are unknown, not contradictions, so they are excluded — otherwise a
 * terse description would be punished simply for being terse.
 */
function conceptOverlap(a, b) {
  const ca = extractConcepts(a), cb = extractConcepts(b);
  let num = 0, den = 0, compared = 0, agree = 0;
  const contradictions = [];

  for (const k of Object.keys(ca)) {
    if (ca[k] == null || cb[k] == null) continue;
    const w = CONCEPT_WEIGHTS[k] ?? 1;
    const same = ca[k] === cb[k];
    compared++;
    den += w;
    if (same) { num += w; agree++; }
    else {
      contradictions.push(k);
      if (CRITICAL_CONCEPTS.has(k)) contradictions.critical = true;
    }
  }

  if (!compared) return { score: null, compared: 0, agree: 0, contradictions: [] };
  let score = num / den;
  if (contradictions.critical) score *= CRITICAL_CONTRADICTION_PENALTY;
  return { score, compared, agree, contradictions: [...contradictions] };
}

// ── Pluggable embedder seam ───────────────────────────────────
let _embedder = null;
/** Inject an async (texts:string[]) => number[][] encoder to upgrade scoring. */
export function setEmbedder(fn) { _embedder = fn; }
export const hasEmbedder = () => Boolean(_embedder);

function cosineVec(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

// ── Public scoring API ────────────────────────────────────────

/**
 * Title similarity. Titles are short and dense, so lexical signals lead and
 * concepts act as a floor for the Ajio case, where the title omits brand and
 * gender entirely ("Men Graphic Print Regular Fit T-shirt").
 */
export async function titleSimilarity(a, b) {
  if (!a || !b) return { score: null, parts: null };
  if (_embedder) {
    const [va, vb] = await _embedder([a, b]);
    return { score: Number(cosineVec(va, vb).toFixed(4)), parts: { embedding: true } };
  }
  const tok = tokenCosine(a, b);
  const tri = trigramCosine(a, b);
  const con = conceptOverlap(a, b);
  const lexical = 0.62 * tok + 0.38 * tri;
  const score = con.score == null ? lexical : 0.62 * lexical + 0.38 * con.score;
  return {
    score: Number(score.toFixed(4)),
    parts: { token: +tok.toFixed(4), trigram: +tri.toFixed(4), concept: con.score == null ? null : +con.score.toFixed(4) },
  };
}

/**
 * Description similarity. Prose diverges far more than titles do, so concept
 * agreement leads here and raw lexical overlap is the supporting signal.
 */
export async function descriptionSimilarity(a, b) {
  if (!a || !b) return { score: null, parts: null };
  if (_embedder) {
    const [va, vb] = await _embedder([a, b]);
    return { score: Number(cosineVec(va, vb).toFixed(4)), parts: { embedding: true } };
  }
  const tok = tokenCosine(a, b);
  const tri = trigramCosine(a, b);
  const con = conceptOverlap(a, b);
  const lexical = 0.7 * tok + 0.3 * tri;
  const score = con.score == null ? lexical : 0.6 * con.score + 0.4 * lexical;
  return {
    score: Number(score.toFixed(4)),
    parts: {
      token: +tok.toFixed(4),
      trigram: +tri.toFixed(4),
      concept: con.score == null ? null : +con.score.toFixed(4),
      conceptsCompared: con.compared,
    },
  };
}
