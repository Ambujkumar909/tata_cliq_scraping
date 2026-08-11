/**
 * Export rows — a saved comparison flattened into the handful of fields a
 * merchandiser actually works with.
 *
 * Deliberately NOT the full comparison. A comparison carries specifications,
 * content-quality counts, four sub-scores, image evidence and per-attribute
 * agreement; all of that exists to JUSTIFY the verdict on screen, and dumping
 * it into a spreadsheet buries the six numbers a category manager buys or
 * reprices on. What survives here is: what the product is, what the three
 * platforms charge, who is cheaper by how much, and what to do about it.
 *
 * The recommendation column is not written here — it is the exact string the
 * report UI shows (`decision.recommendedAction`), reused via buildReport so the
 * spreadsheet can never drift from the screen.
 */
import { detectGarment, detectGender, stripBrand } from '../lib/normalize.mjs';
import { buildReport } from '../matching/report.mjs';
import { isFresh, ageHours } from '../cache/persistence.mjs';

/** Business-facing names for the taxonomy's garment keys. */
export const CATEGORY_LABELS = {
  tshirt: 'T-Shirt', polo: 'Polo', shirt: 'Shirt', sweatshirt: 'Sweatshirt / Hoodie',
  jacket: 'Jacket / Blazer', jeans: 'Jeans', trousers: 'Trousers', shorts: 'Shorts',
  kurta: 'Kurta / Kurti', saree: 'Saree', dress: 'Dress', top: 'Top', skirt: 'Skirt',
  heels: 'Heels', flats: 'Flats', sandals: 'Sandals', boots: 'Boots', loafers: 'Loafers',
  shoes: 'Shoes / Sneakers', watch: 'Watch', belt: 'Belt', bag: 'Bag / Backpack',
};
export const GENDER_LABELS = {
  men: 'Men', women: 'Women', boys: 'Boys', girls: 'Girls', kids: 'Kids', unisex: 'Unisex',
};
const UNCLASSIFIED = 'Uncategorised';

/** Competitor platforms, in the order they appear in the sheet. */
export const PLATFORMS = [
  { key: 'myntra', label: 'Myntra' },
  { key: 'ajio', label: 'Ajio' },
];

/**
 * Why a competitor has no price. The raw status codes are engine vocabulary;
 * a merchandiser reading a spreadsheet needs to know whether "no price" means
 * "we looked and it isn't sold there" or "we could not look".
 */
const STATUS_LABELS = {
  matched: 'Matched',
  no_match: 'No match',
  no_results: 'Not listed',
  blocked: 'Blocked — retry',
  ambiguous: 'Ambiguous — verify',
  color_mismatch: 'Different colourway',
  error: 'Error',
};

const round = (v, dp = 0) => (typeof v === 'number' ? Number(v.toFixed(dp)) : null);

/**
 * The product's selling category.
 *
 * The CLIQ category code (`MSH1116100`) is an internal identifier and useless
 * as a filter label, so the garment is derived from the PDP breadcrumb first
 * (the most reliable signal CLIQ publishes) and the brand-stripped title
 * second — the same order the matcher itself trusts.
 */
export function categoryOf(anchor) {
  if (anchor?.garment) return anchor.garment;
  const path = Array.isArray(anchor?.categoryPath) ? anchor.categoryPath : [];
  for (let i = path.length - 1; i >= 0; i--) {
    const g = detectGarment(path[i]);
    if (g) return g;
  }
  return detectGarment(stripBrand(anchor?.title || '', anchor?.brand || '')) || null;
}

/**
 * Gender for the filter column.
 *
 * `anchor.gender` is the matcher's resolved value — title, then CLIQ's PDP
 * gender field, then the breadcrumb — and it is the same value that gated the
 * match, so the spreadsheet and the engine agree by construction. The
 * breadcrumb re-read below only covers comparisons saved before the anchor
 * carried a resolved gender.
 *
 * Null is reported as "Unspecified" rather than guessed. A filter that files
 * womenswear under Men is worse than one that admits it does not know.
 */
export function genderOf(anchor) {
  if (anchor?.gender) return anchor.gender;
  const fromTitle = detectGender(`${anchor?.brand || ''} ${anchor?.title || ''}`);
  if (fromTitle) return fromTitle;
  for (const crumb of Array.isArray(anchor?.categoryPath) ? anchor.categoryPath : []) {
    const g = detectGender(crumb);
    if (g) return g;
  }
  return null;
}

/**
 * Sizes carried by a comparison.
 *
 * Tata CLIQ's PDP payload does not publish a size list, so the only honest
 * source is the listings we matched it to on Myntra and Ajio — those do carry
 * one. A size filter therefore means "this product is sold in that size on a
 * platform we matched", which is exactly the question a merchandiser asks
 * ("show me the L's a rival undercuts us on") and is never invented: a
 * comparison with no match contributes no sizes at all.
 */
const SIZE_RANK = [
  'XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL', 'FREE SIZE', 'ONE SIZE',
];

/** Canonical form: uppercase, no padding, `2XL`-style aliases folded onto one key. */
export function normalizeSize(raw) {
  const s = String(raw || '').trim().toUpperCase().replace(/\s+/g, ' ');
  if (!s || s.length > 12) return null;
  const alias = { '2XL': 'XXL', '2XS': 'XXS', 'XXXL': '3XL', 'FREE': 'FREE SIZE', 'OS': 'ONE SIZE' };
  return alias[s] ?? s;
}

/** Apparel order first (XS → 5XL), then numbers ascending, then the rest A-Z. */
export function compareSizes(a, b) {
  const ra = SIZE_RANK.indexOf(a);
  const rb = SIZE_RANK.indexOf(b);
  if (ra !== -1 || rb !== -1) {
    if (ra === -1) return 1;
    if (rb === -1) return -1;
    return ra - rb;
  }
  const na = Number(a);
  const nb = Number(b);
  const aNum = Number.isFinite(na);
  const bNum = Number.isFinite(nb);
  if (aNum && bNum) return na - nb;
  if (aNum) return -1;
  if (bNum) return 1;
  return a.localeCompare(b);
}

/** Every size the matched competitor listings offer for this comparison. */
export function sizesOf(cmp) {
  const out = new Set();
  for (const { key } of PLATFORMS) {
    const m = cmp.competitors?.[key];
    if (m?.status !== 'matched') continue;
    for (const s of m.product?.sizes ?? []) {
      const n = normalizeSize(s);
      if (n) out.add(n);
    }
  }
  return [...out].sort(compareSizes);
}

/** Flatten one saved comparison into its export row. */
export function toExportRow(cmp) {
  const a = cmp.anchor || {};
  const decision = buildReport(cmp).decision;

  const category = categoryOf(a);
  const gender = genderOf(a);

  const competitors = {};
  for (const { key } of PLATFORMS) {
    const m = cmp.competitors?.[key];
    const matched = m?.status === 'matched';
    competitors[key] = {
      status: m?.status ?? 'error',
      statusLabel: STATUS_LABELS[m?.status] ?? m?.status ?? 'Error',
      // The verdict tier (EXACT / CLOSE / PARTIAL) only exists for a match;
      // for everything else the status IS the answer.
      matchType: matched ? m.matchType : null,
      confidence: matched ? round(m.score, 4) : null,
      title: matched ? m.product?.title ?? null : null,
      mrp: matched ? m.product?.mrp ?? null : null,
      price: matched ? m.product?.price ?? null : null,
      discountPercent: matched ? round(m.product?.discountPercent) : null,
      url: matched ? m.product?.url ?? null : null,
    };
  }

  // Price position from CLIQ's side. `gap > 0` means a competitor undercuts us,
  // which is the number the whole report exists to surface.
  const cliqPrice = a.price ?? null;
  const rivals = PLATFORMS.map(({ key, label }) => ({ key, label, price: competitors[key].price })).filter(
    (r) => typeof r.price === 'number',
  );
  const cheapestRival = rivals.length ? rivals.reduce((x, y) => (y.price < x.price ? y : x)) : null;
  const gap = cliqPrice != null && cheapestRival ? cliqPrice - cheapestRival.price : null;

  let position = 'No competitor data';
  if (gap != null) position = gap > 0 ? 'Undercut' : gap < 0 ? 'CLIQ cheapest' : 'Parity';

  /**
   * The whole market for this SKU, CLIQ included — which is what a reader of
   * the spreadsheet is actually looking for. "Who is cheapest and who is
   * dearest, and by how much" is a different question from "does a rival
   * undercut us", and only the second one was being answered.
   */
  const market = [
    ...(cliqPrice != null ? [{ key: 'tatacliq', label: 'Tata CLIQ', price: cliqPrice }] : []),
    ...rivals,
  ];
  // "Cheapest" and "dearest" only mean something when there are at least two
  // DIFFERENT prices. With a single listing, or at parity, naming a winner
  // reports Tata CLIQ as both the cheapest and the dearest on the same row —
  // true arithmetically, nonsense to a reader.
  const lo = market.length ? Math.min(...market.map((m) => m.price)) : null;
  const hi = market.length ? Math.max(...market.map((m) => m.price)) : null;
  const ranked = market.length > 1 && lo !== hi;
  const cheapest = ranked ? market.find((m) => m.price === lo) : null;
  const dearest = ranked ? market.find((m) => m.price === hi) : null;
  const spread = ranked ? hi - lo : market.length ? 0 : null;

  const age = ageHours(cmp);

  return {
    id: a.id ?? null,
    brand: a.brand ?? null,
    title: a.title ?? null,
    category,
    categoryLabel: category ? CATEGORY_LABELS[category] ?? category : UNCLASSIFIED,
    gender,
    genderLabel: gender ? GENDER_LABELS[gender] ?? gender : 'Unspecified',
    sizes: sizesOf(cmp),
    color: a.color ?? null,

    cliqMrp: a.mrp ?? null,
    cliqPrice,
    cliqDiscount: round(a.discountPercent),
    cliqRating: round(a.rating, 2),
    cliqInStock: a.inStock === true ? 'In stock' : a.inStock === false ? 'Out of stock' : null,
    cliqUrl: a.url ?? null,

    competitors,

    matchedCount: cmp.summary?.matchedCount ?? 0,
    // Confidence of the best competitor match — the number that says how much
    // to trust the price comparison on this row.
    confidence: round(decision.confidence, 4),
    matchType: decision.matchType ?? 'NO MATCH',
    bestPlatform: decision.bestMatch?.label ?? null,

    // Market view: who is cheapest, who is dearest, how far apart they are.
    cheapestPlatform: cheapest?.label ?? null,
    cheapestPrice: cheapest?.price ?? null,
    dearestPlatform: dearest?.label ?? null,
    dearestPrice: dearest?.price ?? null,
    priceSpread: spread,
    // CLIQ's price with the cheapest listing as 100. Above 100 means we are
    // dearer, and by what factor — comparable across products of any value,
    // which a rupee gap is not. Only meaningful once a rival price exists.
    priceIndex: rivals.length && lo && cliqPrice ? round((cliqPrice / lo) * 100) : null,

    lowestCompetitorPrice: cheapestRival?.price ?? null,
    priceGap: gap,
    priceGapPercent: gap != null && cliqPrice ? round((gap / cliqPrice) * 100, 1) : null,
    position,
    posture: decision.posture,

    recommendation: decision.recommendedAction,

    matchedAt: cmp.matchedAt ?? null,
    ageHours: age == null ? null : round(age, 1),
    fresh: isFresh(cmp),
  };
}
