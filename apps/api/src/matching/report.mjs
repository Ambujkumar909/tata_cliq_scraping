/**
 * Product Match Comparison Report.
 *
 * Shapes a comparison into the report structure: a source header, five
 * banded row-groups (Product · Pricing & Offers · Specifications · Content
 * Quality · AI Comparison Scores), and an AI Decision Summary.
 *
 * Two rules govern every cell, because a price-intelligence report is only
 * useful if a merchandiser can trust it:
 *
 *   1. MISSING ≠ DIFFERENT. A value the competitor never published renders as
 *      'na' (grey), never as a difference. Ajio's PDP is hard-403, so most of
 *      its Specifications legitimately have no value — reporting those as
 *      mismatches would invent differences that do not exist.
 *   2. Verdicts are computed against the SOURCE (Tata CLIQ) column, which is
 *      the anchor every comparison is defined against.
 */
import { inr } from '../lib/format.mjs';

const PLATFORMS = { tatacliq: 'Tata CLIQ', myntra: 'Myntra', ajio: 'Ajio' };

// Legend verdicts, matching the report key.
const BEST = 'best';       // green  — best / higher
const MODERATE = 'moderate'; // orange — moderate / lower
const LOW = 'low';         // red    — low / not matching
const NA = 'na';           // grey   — not applicable

const titleCase = (s) =>
  s == null || s === '' ? null : String(s).replace(/\b[a-z]/g, (m) => m.toUpperCase());

const pctText = (v) => (v == null ? null : `${Math.round(v * 100)}%`);

/** Verdict for a value compared against the source value. */
function cmpVerdict(sourceVal, val, { equalIs = BEST, kind = 'text' } = {}) {
  if (val == null || val === '') return NA;
  if (sourceVal == null || sourceVal === '') return NA;
  if (kind === 'text') {
    return String(sourceVal).toLowerCase() === String(val).toLowerCase() ? equalIs : LOW;
  }
  return equalIs;
}

/** Price verdict: cheaper is better for the shopper, and is what CLIQ must know. */
function priceVerdict(value, all) {
  if (value == null) return NA;
  const nums = all.filter((v) => typeof v === 'number');
  if (!nums.length) return NA;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  if (value === min && min !== max) return BEST;
  if (value === max && min !== max) return LOW;
  return MODERATE;
}

function scoreVerdict(v) {
  if (v == null) return NA;
  if (v >= 0.85) return BEST;
  if (v >= 0.6) return MODERATE;
  return LOW;
}

/** Higher-is-better verdict for content-quality counts. */
function countVerdict(value, all) {
  if (value == null) return NA;
  const nums = all.filter((v) => typeof v === 'number');
  if (nums.length < 2) return NA;
  const max = Math.max(...nums), min = Math.min(...nums);
  if (max === min) return MODERATE;
  return value === max ? BEST : value === min ? LOW : MODERATE;
}

/** One column of the report: the source, plus each competitor. */
function buildColumns(cmp) {
  const cols = [
    {
      key: 'tatacliq',
      platform: 'tatacliq',
      label: PLATFORMS.tatacliq,
      role: 'source',
      status: 'source',
      product: cmp.anchor,
      attributes: cmp.anchor.attributes || {},
      content: cmp.anchor.content || {},
      scores: null,
      matchType: null,
      detailAvailable: cmp.anchor.detailAvailable !== false,
      detailReason: null,
    },
  ];
  let n = 0;
  for (const [platform, m] of Object.entries(cmp.competitors || {})) {
    n++;
    cols.push({
      key: platform,
      platform,
      label: `${PLATFORMS[platform] || platform}`,
      role: `target${n}`,
      status: m.status,
      product: m.status === 'matched' ? m.product : null,
      attributes: m.attributes || {},
      content: m.content || {},
      scores: m.scores || null,
      matchType: m.matchType || null,
      score: m.score ?? null,
      why: m.why || [],
      differences: m.differences || [],
      imageCheck: m.imageCheck || null,
      attributeDetail: m.attributeDetail || null,
      detailAvailable: Boolean(m.detailAvailable),
      detailReason: m.detailReason || (m.status !== 'matched' ? m.status : null),
      nearest: m.nearest || null,
      reason: m.reason || null,
    });
  }
  return cols;
}

/**
 * Attribute row: DISPLAY the platform's own wording, but take the verdict from
 * the canonical attribute comparison already computed during matching.
 *
 * Comparing the displayed strings instead would defeat the whole canonical
 * layer — CLIQ's "Single Jersey, 100% Cotton" and Myntra's "Pure Cotton" are
 * the same fabric, and naive equality paints that red.
 */
const ATTR_VERDICT = { match: BEST, partial: MODERATE, differ: LOW, na: NA };

function attrRow(label, cols, canonKey, display) {
  return {
    label,
    cells: cols.map((c) => {
      const value = display(c);
      if (c.role === 'source') return { column: c.key, value, verdict: NA };
      if (value == null) return { column: c.key, value: null, verdict: NA };
      const f = (c.attributeDetail?.fields || []).find((x) => x.key === canonKey);
      return {
        column: c.key,
        value,
        agreement: f?.agreement ?? null,
        verdict: f ? ATTR_VERDICT[f.verdict] ?? NA : MODERATE,
      };
    }),
  };
}

/**
 * Colour is deliberately NOT scored by name — platforms label shades
 * differently (the CLIQ "Orange" vs Myntra "Yellow" case). The image Delta-E is
 * the authority, so the colour row reports what the image check concluded.
 */
function colorRow(cols) {
  return {
    label: 'Color',
    cells: cols.map((c) => {
      const value = titleCase(c.product?.color || c.attributes?.color);
      if (c.role === 'source') return { column: c.key, value, verdict: NA };
      if (value == null) return { column: c.key, value: null, verdict: NA };
      const ic = c.imageCheck;
      const verdict = ic?.colorConfirmed ? BEST : ic?.colorRejected ? LOW : ic?.deltaE != null ? MODERATE : MODERATE;
      return { column: c.key, value, deltaE: ic?.deltaE ?? null, verdict };
    }),
  };
}

/** Build one row: a label plus one cell per column, each with a verdict. */
function row(label, cols, getValue, verdictFn) {
  const values = cols.map((c) => getValue(c));
  const cells = cols.map((c, i) => ({
    column: c.key,
    value: values[i],
    verdict: c.role === 'source' ? NA : verdictFn(values[i], values, c, i),
  }));
  return { label, cells };
}

// ── Row groups ────────────────────────────────────────────────

function productGroup(cols) {
  const src = cols[0];
  const textRow = (label, get) =>
    row(label, cols, get, (v, all, c) => (c.role === 'source' ? NA : cmpVerdict(all[0], v)));

  return {
    id: 'product',
    title: 'Product',
    rows: [
      row('Product Image', cols, (c) => c.product?.image ?? null, (v) => (v ? MODERATE : NA)),
      row('Product Name', cols, (c) => c.product?.title ?? null, (v) => (v ? MODERATE : NA)),
      textRow('Brand', (c) => c.product?.brand ?? null),
      row(
        'Category',
        cols,
        (c) => (c.product?.categoryPath?.length ? c.product.categoryPath.join(' > ') : null),
        (v) => (v ? MODERATE : NA),
      ),
      attrRow('Fit', cols, 'fit', (c) => titleCase(c.attributes?.fit)),
      attrRow('Rise', cols, 'rise', (c) => titleCase(c.attributes?.rise)),
      colorRow(cols),
      attrRow('Material', cols, 'material', (c) =>
        titleCase(c.attributes?.fabricComposition?.raw || c.attributes?.material)),
      attrRow('Pattern', cols, 'pattern', (c) => titleCase(c.attributes?.pattern)),
      // The description TEXT, not just its word count (which the Content
      // Quality band already scores). Truncated: the report is a comparison
      // grid, and a 400-word paragraph in a table cell is unreadable.
      row(
        'Description',
        cols,
        (c) => truncate(c.product?.description, 260),
        (v) => (v ? MODERATE : NA),
      ),
    ].filter((r) => r.cells.some((x) => x.value != null)),
  };
}

/** Trim to a word boundary so a cut never lands mid-word. */
function truncate(s, max) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (t.length <= max) return t;
  return `${t.slice(0, t.lastIndexOf(' ', max) || max)}…`;
}

/**
 * Sizes as a shopper sees them: the list, with anything out of stock called
 * out. CLIQ publishes live per-size stock, so "available" here is a fact about
 * right now, not a catalogue listing.
 */
function sizeText(product) {
  const sizes = product?.sizes ?? [];
  if (!sizes.length) return null;
  const inv = product?.inventory ?? [];
  if (!inv.length) return sizes.join(', ');
  const live = inv.filter((i) => i.available).map((i) => i.size);
  const out = inv.filter((i) => !i.available).map((i) => i.size);
  if (!live.length) return `All ${sizes.length} sizes out of stock`;
  return out.length ? `${live.join(', ')}  (${out.join(', ')} out of stock)` : live.join(', ');
}

/** "Chart + image · Chest, Length" — what the platform actually publishes. */
function sizeGuideText(product) {
  const g = product?.sizeGuide;
  if (!g) return null;
  const bits = [];
  if (g.imageUrl) bits.push('Chart image');
  if (g.dimensions?.length) bits.push(g.dimensions.slice(0, 4).join(', '));
  else if (g.rows) bits.push(`${g.rows} size rows`);
  return bits.join(' · ') || 'Available';
}

function pricingGroup(cols) {
  const prices = cols.map((c) => c.product?.price ?? null);
  const mrps = cols.map((c) => c.product?.mrp ?? null);
  const discounts = cols.map((c) => c.product?.discountPercent ?? null);

  return {
    id: 'pricing',
    title: 'Pricing & Offers',
    rows: [
      {
        label: 'MRP',
        cells: cols.map((c, i) => ({
          column: c.key,
          value: mrps[i] == null ? null : inr(mrps[i]),
          raw: mrps[i],
          verdict: c.role === 'source' ? NA : cmpVerdict(mrps[0], mrps[i], { kind: 'num' }) === NA
            ? NA
            : mrps[i] === mrps[0] ? BEST : LOW,
        })),
      },
      {
        label: 'Selling Price',
        cells: cols.map((c, i) => ({
          column: c.key,
          value: prices[i] == null ? null : inr(prices[i]),
          raw: prices[i],
          verdict: priceVerdict(prices[i], prices),
        })),
      },
      {
        label: 'Discount %',
        cells: cols.map((c, i) => ({
          column: c.key,
          value: discounts[i] == null ? null : `${Math.round(discounts[i])}% OFF`,
          raw: discounts[i],
          verdict: countVerdict(discounts[i], discounts),
        })),
      },
      // These four come only from the PDP. Where the PDP was unreadable we must
      // emit null (→ "not available"), never a confident negative like
      // "No offer listed", which would assert a fact we never observed.
      row(
        'Offer / Coupon',
        cols,
        (c) => (c.product?.offers?.length ? c.product.offers[0] : c.detailAvailable && c.product ? 'No offer listed' : null),
        (v) => (v == null ? NA : /no offer/i.test(v) ? LOW : BEST),
      ),
      row(
        'Delivery',
        cols,
        (c) => c.product?.deliveryModes?.[0]?.promise ?? null,
        (v) => (v ? MODERATE : NA),
      ),
      row('Return Policy', cols, (c) => c.product?.returnPolicy ?? null, (v) => (v ? MODERATE : NA)),
      row(
        'Availability',
        cols,
        (c) =>
          !c.detailAvailable || c.product == null
            ? null
            : c.product.inStock === false ? 'Out of Stock' : c.product.inStock === true ? 'In Stock' : null,
        (v) => (v == null ? NA : v === 'In Stock' ? BEST : LOW),
      ),
      // Who is actually selling it. Marketplace listings differ from
      // brand-direct ones on price, returns and stock, so this is context for
      // every row above it. Myntra does not publish a seller on its PDP, which
      // renders as "not available" rather than as a difference.
      row(
        'Seller',
        cols,
        (c) => {
          const s = c.product?.seller;
          if (!s) return null;
          const r = c.product?.sellerRating;
          return typeof r === 'number' ? `${s} (${r.toFixed(1)}★)` : s;
        },
        (v) => (v ? MODERATE : NA),
      ),
    ].filter((r) => r.cells.some((x) => x.value != null)),
  };
}

function specsGroup(cols) {
  return {
    id: 'specifications',
    title: 'Specifications',
    rows: [
      attrRow('Fabric Composition', cols, 'material', (c) =>
        c.attributes?.fabricComposition?.raw ?? titleCase(c.attributes?.material)),
      attrRow('Closure', cols, 'closure', (c) => titleCase(c.attributes?.closure)),
      attrRow('Pockets', cols, 'pockets', (c) =>
        c.attributes?.pockets == null ? null : String(c.attributes.pockets)),
      attrRow('Neck / Collar', cols, 'neck', (c) => titleCase(c.attributes?.neck)),
      attrRow('Sleeve', cols, 'sleeve', (c) => titleCase(c.attributes?.sleeve)),
      attrRow('Stretch', cols, 'stretch', (c) => titleCase(c.attributes?.stretch)),
      attrRow('Wash Care', cols, 'washCare', (c) => titleCase(c.attributes?.washCare)),
      attrRow('Country of Origin', cols, 'countryOfOrigin', (c) =>
        titleCase(c.attributes?.countryOfOrigin || c.product?.countryOfOrigin)),
      // Sizes are not scored as a match signal — two listings of the same SKU
      // legitimately stock different sizes — so this reports availability
      // rather than agreement.
      row('Sizes Available', cols, (c) => sizeText(c.product), (v) =>
        v == null ? NA : /out of stock/i.test(v) ? MODERATE : BEST),
      row('Size Chart', cols, (c) => sizeGuideText(c.product), (v) => (v ? BEST : NA)),
    ].filter((r) => r.cells.some((x) => x.value != null)),
  };
}

function contentGroup(cols) {
  const num = (get) => cols.map(get);
  const words = num((c) => c.content?.descriptionWords ?? null);
  const bullets = num((c) => c.content?.bulletPoints ?? null);
  const specs = num((c) => c.content?.specificationsListed ?? null);
  const images = num((c) => c.content?.imageCount ?? null);

  const mk = (label, vals, fmt) => ({
    label,
    cells: cols.map((c, i) => ({
      column: c.key,
      value: vals[i] == null ? null : fmt(vals[i]),
      raw: vals[i],
      verdict: countVerdict(vals[i], vals),
    })),
  });

  // Social proof. Counts are compared higher-is-better, but the star rating is
  // NOT — a 4.9 from 3 buyers is not better than a 4.2 from 900, and colouring
  // it as if it were would mislead. It renders alongside its own count instead.
  const ratings = num((c) => c.product?.ratingCount ?? null);
  const reviews = num((c) => c.product?.reviewCount ?? null);

  return {
    id: 'content',
    title: 'Content Quality',
    rows: [
      mk('Description Length', words, (v) => `${v} words`),
      mk('Bullet Points / Highlights', bullets, String),
      mk('Specifications Listed', specs, String),
      mk('Image Count', images, String),
      {
        label: 'Rating',
        cells: cols.map((c) => {
          const r = c.product?.rating ?? null;
          return {
            column: c.key,
            value: r == null ? null : `${Number(r).toFixed(1)} ★`,
            raw: r,
            verdict: r == null ? NA : MODERATE,
          };
        }),
      },
      mk('Ratings Count', ratings, (v) => Number(v).toLocaleString('en-IN')),
      mk('Reviews Count', reviews, (v) => Number(v).toLocaleString('en-IN')),
      {
        label: 'Video Available',
        cells: cols.map((c) => {
          const v = c.content?.videoAvailable;
          const unknown = c.product == null || v == null;
          return {
            column: c.key,
            value: unknown ? null : v ? 'Yes' : 'No',
            raw: unknown ? null : v,
            verdict: unknown ? NA : v ? BEST : MODERATE,
          };
        }),
      },
    ].filter((r) => r.cells.some((x) => x.value != null)),
  };
}

function scoresGroup(cols) {
  const mk = (label, key) => ({
    label,
    cells: cols.map((c) => {
      const v = c.role === 'source' ? null : c.scores?.[key] ?? null;
      return {
        column: c.key,
        value: c.role === 'source' ? '—' : pctText(v),
        raw: v,
        verdict: c.role === 'source' ? NA : scoreVerdict(v),
      };
    }),
  });

  return {
    id: 'scores',
    title: 'AI Comparison Scores',
    rows: [
      mk('Title Similarity', 'title'),
      mk('Description Similarity', 'description'),
      mk('Attribute Match', 'attributes'),
      mk('Image Similarity', 'image'),
      { ...mk('Overall Similarity', 'overall'), emphasis: true },
    ],
  };
}

// ── AI decision summary ───────────────────────────────────────
function decisionSummary(cols, cmp) {
  const targets = cols.filter((c) => c.role !== 'source');
  const matched = targets.filter((c) => c.status === 'matched' && c.score != null);
  const best = matched.sort((a, b) => b.score - a.score)[0] || null;

  const insights = [];
  const src = cols[0];

  if (best) {
    insights.push(`${best.label} is the closest match (${Math.round(best.score * 100)}% overall similarity).`);
  }
  for (const t of targets) {
    if (t.status === 'matched') continue;
    if (t.status === 'blocked') {
      insights.push(`${t.label} could not be queried from this network (${t.detailReason || 'blocked'}).`);
    } else if (t.status === 'ambiguous') {
      insights.push(
        `${t.label} has several near-identical listings at different prices — the exact SKU cannot be proven from public data. Verify manually.`,
      );
    } else if (t.status === 'color_mismatch') {
      insights.push(`${t.label} has a same-style listing in a different colourway — not treated as a match.`);
    } else {
      insights.push(`No confident ${t.label} match was found for this product.`);
    }
  }

  // Price positioning — the actionable part for a CLIQ merchandiser.
  const srcPrice = src.product?.price ?? null;
  const rivals = matched
    .map((c) => ({ label: c.label, price: c.product?.price ?? null }))
    .filter((r) => typeof r.price === 'number');
  let action = 'Insufficient competitor data for a pricing recommendation.';
  let posture = 'unknown';

  if (srcPrice != null && rivals.length) {
    const cheapest = rivals.reduce((a, b) => (b.price < a.price ? b : a));
    const gap = srcPrice - cheapest.price;
    if (gap > 0) {
      posture = 'undercut';
      insights.push(`${cheapest.label} undercuts Tata CLIQ by ${inr(gap)} on the same item.`);
      action = `${cheapest.label} is ${inr(gap)} cheaper — review pricing or promotion on this SKU.`;
    } else if (gap < 0) {
      posture = 'winning';
      insights.push(`Tata CLIQ is ${inr(Math.abs(gap))} cheaper than the closest competitor.`);
      action = `Tata CLIQ holds the best price by ${inr(Math.abs(gap))} — safe to promote as a price win.`;
    } else {
      posture = 'parity';
      insights.push('Price parity with the closest competitor.');
      action = 'Priced at parity — differentiate on delivery, offers or content quality.';
    }
  }

  // Content-quality gap is a lever CLIQ controls directly.
  const srcImages = src.content?.imageCount ?? 0;
  for (const t of matched) {
    const ti = t.content?.imageCount ?? 0;
    if (ti > srcImages) {
      insights.push(`${t.label} shows ${ti} images vs Tata CLIQ's ${srcImages} — richer content.`);
      break;
    }
  }

  return {
    bestMatch: best
      ? { platform: best.platform, label: best.label, title: best.product?.title ?? null, score: best.score, matchType: best.matchType }
      : null,
    matchType: best?.matchType ?? 'NO MATCH',
    confidence: best?.score ?? null,
    whyThisMatch: best?.why ?? [],
    differencesFound: best?.differences ?? [],
    catalogInsights: insights,
    recommendedAction: action,
    posture,
  };
}

/** Overall header confidence + a one-line reason. */
function header(cols, summary) {
  const src = cols[0];
  const best = summary.bestMatch;
  const reasonBits = [];
  if (best) {
    reasonBits.push((summary.whyThisMatch || []).slice(0, 3).join(', ') || 'Matched on core attributes');
    if ((summary.differencesFound || []).length) {
      reasonBits.push(`Differences: ${summary.differencesFound.slice(0, 2).join('; ')}.`);
    }
  } else {
    reasonBits.push('No competitor listing cleared the matching gates for this product.');
  }
  return {
    listingId: src.product?.id ?? null,
    url: src.product?.url ?? null,
    title: src.product?.title ?? null,
    brand: src.product?.brand ?? null,
    image: src.product?.image ?? null,
    overallConfidence: summary.confidence,
    matchType: summary.matchType,
    matchReason: reasonBits.join(' '),
  };
}

/**
 * Build the full report from a comparison object.
 * Pure and synchronous — all network work happened during matching.
 */
export function buildReport(cmp) {
  const columns = buildColumns(cmp);
  const summary = decisionSummary(columns, cmp);

  return {
    kind: 'product_match_comparison_report',
    generatedAt: new Date().toISOString(),
    matchedAt: cmp.matchedAt ?? null,
    header: header(columns, summary),
    columns: columns.map((c) => ({
      key: c.key,
      platform: c.platform,
      label: c.label,
      role: c.role,
      status: c.status,
      matchType: c.matchType ?? null,
      score: c.score ?? null,
      url: c.product?.url ?? null,
      detailAvailable: c.detailAvailable,
      detailReason: c.detailReason,
    })),
    groups: [
      productGroup(columns),
      pricingGroup(columns),
      specsGroup(columns),
      contentGroup(columns),
      scoresGroup(columns),
    ],
    decision: summary,
    legend: [
      { verdict: BEST, label: 'Best / Higher' },
      { verdict: MODERATE, label: 'Moderate / Lower' },
      { verdict: LOW, label: 'Low / Not Matching' },
      { verdict: NA, label: 'Not Applicable' },
    ],
    summary: cmp.summary,
  };
}
