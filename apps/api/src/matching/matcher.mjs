/**
 * Anchored matching engine (v4) — layered retrieval → gates → evidence.
 *
 *   Layer 1  RETRIEVAL   Union several complementary queries per source, then
 *                        rely on the structured facets each platform publishes
 *                        (gender segment, article type) rather than title text.
 *   Layer 2  HARD GATES  brand · gender-class · garment. Only contradictions
 *                        that prove a different product reject here.
 *   Layer 3  EVIDENCE    Cheap scoring ranks every survivor; the top few
 *                        FINALISTS get PDP + image enrichment and are rescored
 *                        on full evidence (MRP, specs, title, description,
 *                        image). Enriching only finalists is what keeps this
 *                        affordable — a PDP fetch per candidate would cost
 *                        roughly 100x the network round-trips.
 *
 * v3 gated on brand AND gender AND garment AND exact-MRP AND fit AND pattern,
 * which rejected ~50% of real matches. See evidence.mjs for that rationale.
 *
 * Tata CLIQ is always the anchor; competitors are matched against it.
 */
import { searchMyntra, fetchMyntraDetail } from '../sources/myntra.mjs';
import { searchAjio, fetchAjioDetail } from '../sources/ajio.mjs';
import { fetchCliqDetail } from '../sources/tatacliq.mjs';
import {
  buildQueries, detectGender, genderFromCategory, detectGarment, stripBrand, normalizeText,
} from '../lib/normalize.mjs';
import { hardGates, cheapEvidence, fullEvidence, classify, explain } from './evidence.mjs';
import { fetchImageSignature, regionForGarment } from '../lib/imagesim.mjs';
import { canonicalAttributes, contentQuality } from '../lib/attributes.mjs';

const SOURCES = {
  myntra: { search: searchMyntra, detail: fetchMyntraDetail },
  ajio: { search: searchAjio, detail: fetchAjioDetail },
};

// How many top-ranked candidates may get the expensive PDP + image treatment.
// Evaluated lazily with an early exit, so a clean top hit still costs one fetch.
// Rejections (wrong colourway, model conflict) do NOT consume the budget —
// otherwise five look-alikes ahead of the true SKU starve it of its slot —
// but total fetches are still bounded by MAX_SCAN.
const MAX_ENRICH = 5;
const MAX_SCAN = 10;
// Stop enriching once a candidate is this convincing — more fetches cannot
// change the outcome.
const EARLY_EXIT_SCORE = 0.85;
// Δe a colour-FAMILY conflict must beat to survive. Deliberately far stricter
// than COLOR_CONFIRM (15): at 15 the engine "confirmed" grey against blue.
const CONFLICT_PROOF_DE = 8;
// Strict-SKU surfacing rules, both measured on a 220-decision live audit:
//   · PARTIAL-tier matches were only 44% right (EXACT/CLOSE: 98%), so strict
//     mode refuses to present them as matches at all.
//   · Requiring MRP within 6% removed most remaining false positives while
//     sacrificing ZERO audited true positives (the verified Louis Philippe
//     same-SKU pair sits at 5.0%, inside the bound).
//   · Cutoff 0.70, not the CLOSE boundary 0.72: with the MRP rule active the
//     audit's 0.70–0.75 bucket is 100% correct (5/5) while 0.65–0.70 drops to
//     67% — and 0.70 keeps the verified Louis Philippe pair (score ≈ 0.71).
const STRICT_MIN_TIER = 0.70;
const STRICT_MRP_TOLERANCE = 0.06;
// Runner-up within this score delta of the winner = statistically a tie.
const AMBIGUITY_DELTA = 0.04;
// ...but a tie only matters when the tied candidates disagree on PRICE.
const AMBIGUITY_PRICE_TIE = 0.02;
// ...and is broken when the winner's image evidence clearly dominates.
const IMAGE_DOMINANCE = 0.12;

/**
 * Cheap colour-name affinity, used ONLY to order finalists.
 *
 * Cheap ranking has no image signal, so without this the enrichment budget can
 * be spent entirely on wrong-colourway look-alikes while the correct variant
 * sits just below the cut — every finalist then gets colour-rejected and a real
 * match is reported as a miss.
 *
 * Deliberately a ranking nudge and never a gate: colour NAMES disagree across
 * platforms (the CLIQ "Orange" vs Myntra "Yellow" case), so the image Delta-E
 * remains the authority on shade.
 */
const lastColorWord = (c) => (c ? normalizeText(c).split(' ').filter(Boolean).pop() : null);
function colorAffinity(anchor, candidate) {
  const a = lastColorWord(anchor.color);
  const b = lastColorWord(candidate.color) || lastColorWord(candidate.title);
  if (!a || !b) return 0;
  return a === b ? 1 : 0;
}

/**
 * Resolve a garment type from CLIQ's category breadcrumb, most specific first
 * ("Men's Clothing > Casual Wear > T-shirts & Polos" → tshirt).
 *
 * Titles frequently omit the garment word — "Nike Men England Home Regular Fit"
 * names no garment at all — and the hard gate lets an UNRESOLVED garment pass,
 * since an unknown is not proof of difference. Without this fallback that
 * combination matched a jersey to "Ebernon Low Premium Sneakers" and an Adidas
 * Defender duffle bag to a crew-neck tee. The breadcrumb makes the anchor's
 * garment known, so the gate can actually do its job.
 */
function garmentFromCategoryPath(path) {
  if (!Array.isArray(path)) return null;
  for (let i = path.length - 1; i >= 0; i--) {
    const g = detectGarment(path[i]);
    if (g) return g;
  }
  return null;
}

function enrichAnchor(anchor) {
  return {
    ...anchor,
    gender:
      anchor.gender ||
      detectGender(`${anchor.brand} ${anchor.title}`) ||
      genderFromCategory(anchor.category?.l1),
    garment: detectGarment(stripBrand(anchor.title, anchor.brand), anchor.articleType),
  };
}

async function matchOne(anchorCtx, sourceName, { minScore, strictSku }) {
  const anchor = anchorCtx.product;
  const { search, detail: fetchDetail } = SOURCES[sourceName];
  const queries = buildQueries(anchor);

  // ── Layer 1: retrieval ──────────────────────────────────────
  const pages = await Promise.all(
    queries.map((q) =>
      search(q).then((r) => ({ q, ...r })).catch((err) => ({ q, error: err.message, candidates: [] })),
    ),
  );
  if (pages.every((p) => p.blocked)) {
    return { status: 'blocked', query: queries[0], reason: pages.find((p) => p.reason)?.reason || 'blocked' };
  }

  const byId = new Map();
  for (const p of pages) for (const c of p.candidates || []) if (!byId.has(c.id)) byId.set(c.id, c);
  const candidates = [...byId.values()];
  const query = queries.join(' | ');
  if (!candidates.length) return { status: 'no_results', query, total: 0 };

  // ── Layer 2: hard gates ─────────────────────────────────────
  const gated = candidates.map((c) => ({ c, g: hardGates(anchor, c) }));
  const survivors = gated.filter((x) => x.g.pass);

  if (!survivors.length) {
    const near = gated[0];
    return {
      status: 'no_match',
      query,
      scanned: candidates.length,
      rejectedBy: 'hard_gate',
      nearest: near
        ? { brand: near.c.brand, title: near.c.title, price: near.c.price, reasons: near.g.reasons }
        : null,
    };
  }

  // ── Layer 3a: cheap ranking (no network) ────────────────────
  const ranked = (
    await Promise.all(
      survivors.map(async (x) => ({
        ...x,
        ev: await cheapEvidence(anchor, x.c, x.g),
        colorAff: colorAffinity(anchor, x.c),
      })),
    )
  ).sort((a, b) => (b.ev.score ?? 0) + 0.1 * b.colorAff - ((a.ev.score ?? 0) + 0.1 * a.colorAff));

  // ── Layer 3b: enrich finalists lazily, with early exit ──────
  const scored = [];
  let enriched = 0;
  for (const f of ranked.slice(0, MAX_SCAN)) {
    if (enriched >= MAX_ENRICH) break;
    // Sample the candidate's image in the SAME garment region as the anchor —
    // comparing a chest crop against a leg crop is meaningless.
    const [detail, imageSig] = await Promise.all([
      fetchDetail(f.c).catch(() => ({ available: false, reason: 'detail_error' })),
      fetchImageSignature(f.c.image, { region: anchorCtx.imageRegion }),
    ]);
    const candCtx = { product: f.c, detail, imageSig };
    const ev = await fullEvidence(anchorCtx, candCtx, f.g);
    const img = ev.detail?.image;

    // ── COLOUR PROOF ────────────────────────────────────────
    // 1. Contradicted colourway → a different variant → a different product.
    // 2. Conflicting colour FAMILIES (grey vs blue, navy vs brown) demand
    //    STRICT image proof — far stricter than COLOR_CONFIRM (15), which was
    //    loose enough to "confirm" grey against blue at Δe 13 and surface a
    //    wrong-colour SKU. Colour names are imperfect (CLIQ "Orange" vs Myntra
    //    "Yellow" is a verified same-product pair at Δe 5.9), so a conflict is
    //    survivable — but only on strong pixel evidence.
    let rejected = null;
    if (f.g.colorMulti && !(img?.deltaE != null && img.deltaE <= 15)) {
      // One side claims MULTICOLOUR: never a name-conflict, but a positive
      // claim that needs moderate image proof (Δe ≤ COLOR_CONFIRM). Without
      // this, a "Multicolor" girls dress matched a WHITE heart-print dress at
      // Δe 25.2 — just under the generic 26 rejection line.
      rejected = 'color_unproven';
    } else if (img?.colorRejected && !f.g.colorAgree) {
      // Image says different shade AND the labels don't agree → reject.
      // When both retailers NAME the same colour family, a bad Δe is far more
      // often model-shot vs flat-lay lighting than a real colourway change —
      // an audit measured 22 false rejections of label-agreeing pairs (Blue vs
      // Blue, olive vs olive, Black vs Black). Rejection demands positive
      // evidence of difference; agreeing labels are positive evidence of SAME.
      rejected = 'color';
    } else if (f.g.colorConflict) {
      // Exact-SKU mode treats any colour-family disagreement as disqualifying.
      const proven = img?.deltaE != null && img.deltaE <= CONFLICT_PROOF_DE;
      if (strictSku || !proven) rejected = 'color_family';
    } else if (strictSku && ev.modelConflict) {
      // Both titles declare brand-issued model codes and none agree — that is
      // positive, category-universal evidence of a DIFFERENT SKU.
      rejected = 'model_mismatch';
    }

    scored.push({ ...f, candCtx, ev, rejected });
    if (!rejected) enriched++; // rejected candidates don't consume the budget
    if (!rejected && (ev.score ?? 0) >= EARLY_EXIT_SCORE) break;
  }

  const viable = scored.filter((s) => !s.rejected).sort((a, b) => (b.ev.score ?? 0) - (a.ev.score ?? 0));

  if (!viable.length) {
    const c = scored[0];
    return {
      status: 'color_mismatch',
      query,
      scanned: candidates.length,
      nearest: { brand: c.c.brand, title: c.c.title, deltaE: c.ev.detail?.image?.deltaE ?? null },
    };
  }

  const best = viable[0];
  let cls = classify(best.ev.score, minScore);
  const reason = explain(best.ev, best.g);

  // A surviving colour-label conflict can never be an EXACT/CLOSE match. The
  // pixels agree but the retailers disagree about the colourway, so the SKU is
  // unproven — report it as PARTIAL and say why, rather than claiming 86%.
  if (best.g.colorConflict && cls.surfaced) {
    cls = { type: 'PARTIAL MATCH', surfaced: true };
    reason.differences.unshift(
      `Colour label differs (${best.g.reasons.color.anchor} vs ${best.g.reasons.color.cand}) — verify manually`,
    );
  }

  // ── Strict-SKU surfacing gates (audit-derived, see constants above) ──
  let rejectedBy = null;
  if (!cls.surfaced) rejectedBy = 'low_confidence';
  else if (strictSku) {
    const aM = anchor.mrp, cM = best.c.mrp;
    const mrpDelta = aM != null && cM != null ? Math.abs(aM - cM) / Math.max(aM, cM) : null;
    // Identity override: a shared brand-issued model code plus an agreeing
    // colour label identifies the SKU more strongly than list price does —
    // retailers do revise MRP for the same style (Levi's 541 sat at a 9.3%
    // delta across platforms). Widen tolerance for those candidates only.
    const identityProven = (best.ev.modelShared?.length ?? 0) > 0 && best.g.colorAgree;
    const mrpTolerance = identityProven ? 0.15 : STRICT_MRP_TOLERANCE;
    if (mrpDelta != null && mrpDelta > mrpTolerance) rejectedBy = 'mrp_mismatch';
    else if ((best.ev.score ?? 0) < STRICT_MIN_TIER) rejectedBy = 'below_strict_tier';
    else {
      // ── Ambiguity: the commodity-product case ────────────────
      // "Navy blue slim jeans" has near-identical same-brand siblings; when
      // runner-up candidates score within noise of the winner, choosing one is
      // a guess, not a match. BUT ambiguity only matters when the near-ties
      // DISAGREE on price — if they all cost the same, the price-intelligence
      // answer is identical whichever sibling is the true SKU.
      const bestImg = best.ev.detail?.image?.score ?? null;
      const rivals = viable.slice(1).filter((v) => {
        if ((best.ev.score ?? 0) - (v.ev.score ?? 0) > AMBIGUITY_DELTA) return false;
        if (v.c.id === best.c.id) return false;
        if (v.c.price == null || best.c.price == null) return false;
        if (Math.abs(v.c.price - best.c.price) / Math.max(v.c.price, best.c.price) <= AMBIGUITY_PRICE_TIE) return false;
        // Image-dominance tie-break: photos are the one signal titles can't
        // fake. If the winner's image evidence clearly beats the rival's
        // (e.g. plain polo vs pocket polo shot), the tie is not real.
        const rivalImg = v.ev.detail?.image?.score ?? null;
        if (bestImg != null && rivalImg != null && bestImg - rivalImg > IMAGE_DOMINANCE) return false;
        return true;
      });
      if (rivals.length) {
        return {
          status: 'ambiguous',
          query,
          scanned: candidates.length,
          reason: `${rivals.length + 1} near-identical candidates with different prices — the exact SKU is not provable from public data`,
          candidates: [best, ...rivals].slice(0, 3).map((v) => ({
            title: v.c.title, brand: v.c.brand, price: v.c.price, mrp: v.c.mrp,
            color: v.c.color, url: v.c.url, image: v.c.image,
            score: v.ev.score,
          })),
        };
      }
    }
  }

  if (rejectedBy) {
    return {
      status: 'no_match',
      query,
      scanned: candidates.length,
      rejectedBy,
      nearest: {
        brand: best.c.brand, title: best.c.title, price: best.c.price, mrp: best.c.mrp,
        url: best.c.url, score: best.ev.score, reasons: best.g.reasons, differences: reason.differences,
      },
    };
  }

  const c = best.c;
  const d = best.candCtx.detail;
  return {
    status: 'matched',
    query,
    scanned: candidates.length,
    score: best.ev.score,
    matchType: cls.type,
    signals: best.ev.signals,
    coverage: best.ev.coverage,
    reasons: best.g.reasons,
    why: reason.why,
    differences: reason.differences,
    // The four sub-scores the report renders under "AI Comparison Scores".
    scores: {
      title: best.ev.detail?.title?.score ?? null,
      description: best.ev.detail?.description?.score ?? null,
      attributes: best.ev.detail?.attributes?.match?.score ?? null,
      image: best.ev.detail?.image?.score ?? null,
      overall: best.ev.score,
    },
    imageCheck: best.ev.detail?.image ?? null,
    attributeDetail: best.ev.detail?.attributes?.match ?? null,
    attributes: canonicalAttributes(c, d),
    content: contentQuality(c, d),
    detailAvailable: Boolean(d?.available),
    detailReason: d?.available ? null : d?.reason || null,
    product: {
      id: c.id, brand: c.brand, title: c.title, color: c.color,
      mrp: c.mrp, price: c.price, currency: c.currency,
      discountPercent: c.discountPercent,
      rating: d?.rating ?? c.rating,
      ratingCount: d?.ratingCount ?? c.ratingCount,
      image: c.image, url: c.url, sizes: c.sizes, inventory: c.inventory,
      description: d?.description ?? null,
      countryOfOrigin: d?.countryOfOrigin ?? null,
      returnPolicy: d?.returnPolicy ?? null,
      deliveryModes: d?.deliveryModes ?? [],
      offers: d?.offers ?? [],
      inStock: d?.inStock ?? null,
      seller: d?.seller ?? null,
      categoryPath: d?.categoryPath ?? [],
    },
  };
}

/**
 * Match one CLIQ anchor against every competitor source.
 * Anchor PDP + image signature are fetched ONCE and shared across sources.
 */
export async function matchAnchor(anchorRaw, { minScore = 0.58, strictSku = true } = {}) {
  const anchor = enrichAnchor(anchorRaw);

  // Detail FIRST, not in parallel: the garment type decides which region of the
  // photo actually shows the product, so the image signature depends on it.
  const detail = await fetchCliqDetail(anchor.id).catch(() => ({ available: false, reason: 'detail_error' }));

  // The PDP breadcrumb is the most reliable garment signal CLIQ publishes —
  // fold it in before gating.
  const resolved = {
    ...anchor,
    categoryPath: detail?.categoryPath ?? [],
    garment: anchor.garment || garmentFromCategoryPath(detail?.categoryPath),
  };
  const imageRegion = regionForGarment(resolved.garment);
  const imageSig = await fetchImageSignature(anchor.image, { region: imageRegion });
  const anchorCtx = { product: resolved, detail, imageSig, imageRegion };

  const names = Object.keys(SOURCES);
  const settled = await Promise.all(
    names.map((n) =>
      matchOne(anchorCtx, n, { minScore, strictSku }).catch((err) => ({ status: 'error', reason: err.message })),
    ),
  );
  const competitors = {};
  names.forEach((n, i) => (competitors[n] = settled[i]));

  const prices = { tatacliq: anchor.price };
  for (const n of names) if (competitors[n].status === 'matched') prices[n] = competitors[n].product.price;
  const numeric = Object.entries(prices).filter(([, v]) => typeof v === 'number');
  const cheapest = numeric.length ? numeric.reduce((a, b) => (b[1] < a[1] ? b : a)) : null;

  return {
    anchor: {
      id: anchor.id, brand: anchor.brand, title: anchor.title, color: anchor.color, gender: anchor.gender,
      mrp: anchor.mrp, price: anchor.price, currency: anchor.currency,
      discountPercent: anchor.discountPercent,
      rating: detail?.rating ?? anchor.rating,
      ratingCount: detail?.ratingCount ?? anchor.ratingCount,
      image: anchor.image, url: anchor.url, styleCode: anchor.styleCode,
      description: detail?.description ?? null,
      countryOfOrigin: detail?.countryOfOrigin ?? null,
      returnPolicy: detail?.returnPolicy ?? null,
      deliveryModes: detail?.deliveryModes ?? [],
      offers: detail?.offers ?? [],
      inStock: detail?.inStock ?? null,
      seller: detail?.seller ?? null,
      categoryPath: detail?.categoryPath ?? [],
      attributes: canonicalAttributes(anchor, detail),
      content: contentQuality(anchor, detail),
      detailAvailable: Boolean(detail?.available),
    },
    competitors,
    summary: {
      prices,
      cheapest: cheapest ? { platform: cheapest[0], price: cheapest[1] } : null,
      matchedCount: names.filter((n) => competitors[n].status === 'matched').length,
    },
    matchedAt: new Date().toISOString(),
  };
}

export async function matchMany(anchors, { concurrency = 5, minScore, strictSku, onProgress } = {}) {
  const results = new Array(anchors.length);
  let idx = 0, done = 0;
  async function worker() {
    while (idx < anchors.length) {
      const i = idx++;
      try {
        results[i] = await matchAnchor(anchors[i], { minScore, strictSku });
      } catch (err) {
        // One bad anchor must never abort a batch run.
        results[i] = {
          anchor: anchors[i], error: err.message, competitors: {},
          summary: { prices: {}, cheapest: null, matchedCount: 0 },
        };
      }
      done++;
      onProgress?.(done, anchors.length, results[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, anchors.length) }, worker));
  return results;
}
