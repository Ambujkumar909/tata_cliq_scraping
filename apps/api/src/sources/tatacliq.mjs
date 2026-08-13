/**
 * Tata CLIQ source adapter — the ANCHOR catalog.
 *
 * Two tiers, both pure HTTP and both open (no Akamai wall, unlike Ajio):
 *
 *   1. searchTataCliq()  → searchbff.tatacliq.com listing gateway. Powers
 *      ingestion of the anchor catalog.
 *   2. fetchCliqDetail() → marketplacewebservices productDetails. Supplies the
 *      PDP tier the comparison report needs: structured `details[]` attributes,
 *      fabric composition, wash care, country of origin, return policy,
 *      delivery modes, gallery/video counts and live seller stock.
 *
 * CLIQ is the source of truth for every comparison, so this adapter normalises
 * into exactly the canonical shape the matcher and report consume.
 */
import { fetchJson } from '../lib/http.mjs';

const SEARCH = 'https://searchbff.tatacliq.com/products/mpl/search';
// Base for every per-product endpoint. DETAIL appends the productDetails
// resource; siblings like sizeGuide hang off PRODUCTS directly, NOT off DETAIL.
const PRODUCTS = 'https://www.tatacliq.com/marketplacewebservices/v2/mpl/products';
const DETAIL = `${PRODUCTS}/productDetails`;

const HEADERS = {
  Accept: 'application/json',
  Origin: 'https://www.tatacliq.com',
  Referer: 'https://www.tatacliq.com/',
};

const abs = (u) => (u ? (u.startsWith('//') ? `https:${u}` : u) : null);

/**
 * CLIQ ships size-chart axes in caps and often ordinal-prefixed
 * ("1.ACROSS SHOULDER"). Strip the ordering prefix and soften the case.
 */
const titleCase = (s) =>
  String(s || '')
    .replace(/^\s*\d+\s*[.)]\s*/, '')
    .toLowerCase()
    .replace(/\b[a-z]/g, (m) => m.toUpperCase())
    .trim();

// ── Listing tier ──────────────────────────────────────────────

/** Normalise a searchbff row into the canonical anchor-product shape. */
export function mapListing(p, seedTerm = null) {
  const price = p.price || {};
  const sell = price.sellingPrice?.doubleValue ?? null;
  const mrp = price.mrpPrice?.doubleValue ?? sell;
  const cat = (p.categoryHierarchy || []).reduce((a, o) => ({ ...a, ...o }), {});
  return {
    id: p.productId,
    source: 'tatacliq',
    brand: (p.brandname || '').trim(),
    title: (p.productname || '').trim(),
    color: p.productColor || null,
    styleCode: p.styleCode || null,
    baseProductId: p.baseProductId || null,
    mrp,
    price: sell,
    currency: price.sellingPrice?.currencyIso || 'INR',
    discountPercent: p.discountPercent ? Number(p.discountPercent) : null,
    rating: p.averageRating ?? null,
    ratingCount: p.ratingCount ?? null,
    image: abs(p.imageURL),
    url: p.webURL ? `https://www.tatacliq.com${p.webURL}` : null,
    category: { l1: cat.L1 || null, l2: cat.L2 || null, l3: cat.L3 || null },
    ...(seedTerm ? { seedTerm } : {}),
  };
}

/** Search the CLIQ storefront gateway. Returns { total, candidates }. */
export async function searchTataCliq(query, { page = 0, pageSize = 40 } = {}) {
  const searchText = encodeURIComponent(`${String(query).trim()}:relevance`);
  const url =
    `${SEARCH}?searchText=${searchText}&channel=WEB&page=${page}&pageSize=${pageSize}` +
    `&isKeywordRedirectEnabled=false&isTextSearch=true&isMDE=true`;
  try {
    const data = await fetchJson(url, { headers: HEADERS, retries: 3 });
    const rows = data?.searchresult || [];
    return {
      total: data?.pagination?.totalResults ?? rows.length,
      totalPages: data?.pagination?.totalPages ?? null,
      candidates: rows.filter((r) => r.productId).map((r) => mapListing(r)),
    };
  } catch (err) {
    if (err.status === 403) return { blocked: true, reason: 'blocked', total: 0, candidates: [] };
    return { error: err.message, total: 0, candidates: [] };
  }
}

// ── Detail (PDP) tier ─────────────────────────────────────────

/**
 * Extract a CLIQ product id from a pasted storefront URL.
 *
 * Real URLs look like:
 *   https://www.tatacliq.com/louis-philippe-orange-polo-tshirt/p-mp000000024358256
 *
 * Also accepts a bare product id, so pasting either works.
 * Ids are upper-cased because the catalog is keyed that way.
 */
export function parseCliqProductId(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  // Bare id, e.g. MP000000024358256
  if (/^[a-z]{2}\d{6,}$/i.test(s)) return s.toUpperCase();
  const m = s.match(/\/p-([a-z0-9]+)/i) || s.match(/[?&]productId=([a-z0-9]+)/i);
  return m ? m[1].toUpperCase() : null;
}

/** Raw PDP fetch, shared by the detail and anchor builders. */
async function fetchPdp(productId) {
  return fetchJson(`${DETAIL}/${productId}?isPwa=true&isMDE=true`, { headers: HEADERS, retries: 2 });
}

/** First usable product image out of the gallery albums. */
function firstGalleryImage(galleryImagesList) {
  for (const album of galleryImagesList || []) {
    for (const g of album.galleryImages || []) {
      if (g?.value && g.key === 'product') return abs(g.value);
    }
  }
  for (const album of galleryImagesList || []) {
    for (const g of album.galleryImages || []) if (g?.value) return abs(g.value);
  }
  return null;
}

/**
 * Build a canonical anchor for ANY CLIQ product id, straight from its PDP.
 *
 * This is what lets a pasted link be compared even when the product was never
 * ingested — the 2000-product catalog is a starting corpus, not a limit.
 * Returns { anchor, detail } so the caller does not pay for two PDP fetches.
 */
export async function fetchCliqAnchor(productId) {
  if (!productId) return { ok: false, reason: 'no_product_id' };
  let d;
  try {
    d = await fetchPdp(productId);
  } catch (err) {
    return { ok: false, reason: err.status === 404 ? 'not_found' : err.message };
  }
  const title = (d.productName || d.productTitle || '').trim();
  if (!title) return { ok: false, reason: 'not_found' };

  const cat = (d.categoryHierarchy || []).map((c) => c.category_id).filter(Boolean);
  const price = d.winningSellerPrice?.doubleValue ?? null;
  const mrp = d.mrpPrice?.doubleValue ?? price;
  const discount =
    d.discount != null ? Number(String(d.discount).replace(/[^0-9.]/g, '')) || null
    : mrp && price && mrp > price ? Math.round(((mrp - price) / mrp) * 100)
    : null;

  const anchor = {
    id: productId,
    source: 'tatacliq',
    brand: (d.brandName || '').trim(),
    title,
    color: d.productColor || null,
    styleCode: d.styleCode || null,
    mrp,
    price,
    currency: d.winningSellerPrice?.currencyIso || 'INR',
    discountPercent: discount,
    rating: d.averageRating ?? null,
    ratingCount: d.ratingCount ?? null,
    image: firstGalleryImage(d.galleryImagesList),
    url: d.seo?.canonicalUrl
      ? `https://www.tatacliq.com${d.seo.canonicalUrl}`
      : `https://www.tatacliq.com/p-${productId.toLowerCase()}`,
    category: { l1: cat[0] || null, l2: cat[1] || null, l3: cat[2] || null },
    gender: d.gender ? String(d.gender).toLowerCase() : null,
  };
  return { ok: true, anchor, raw: d };
}

/** `details: [{key,value}]` → a plain lookup object. */
function detailPairs(details) {
  const out = {};
  for (const d of details || []) if (d?.key) out[d.key] = d.value;
  return out;
}

/** Every distinct product image across all gallery albums, largest-first. */
function galleryImages(galleryImagesList) {
  const seen = new Set();
  for (const album of galleryImagesList || []) {
    for (const g of album.galleryImages || []) {
      if (g?.value && g.key === 'product') seen.add(abs(g.value));
    }
  }
  // Fall back to all keys if no 'product'-keyed variants exist.
  if (!seen.size) {
    for (const album of galleryImagesList || []) {
      for (const g of album.galleryImages || []) if (g?.value) seen.add(abs(g.value));
    }
  }
  return [...seen];
}

/**
 * Sizes, with live per-size stock, from the PDP's `variantOptions`.
 *
 * CLIQ lists one entry per seller-variant, so the same size appears many times
 * (a jeans PDP returned "28" nine times). Collapse by size: available if ANY
 * variant has it, stock summed across them — that is what a shopper actually
 * faces. Ordering follows CLIQ's own, which is already size order.
 */
function extractSizes(variantOptions) {
  const out = new Map();
  for (const v of variantOptions || []) {
    const s = v?.sizelink;
    const label = (s?.size ?? s?.brandSize ?? '').toString().trim();
    if (!label) continue;
    const hit = out.get(label) || { size: label, available: false, stock: 0 };
    if (s.isAvailable) hit.available = true;
    const n = Number(s.stockCount);
    if (Number.isFinite(n)) hit.stock += n;
    out.set(label, hit);
  }
  return [...out.values()];
}

/**
 * The size chart: a measurement image AND a structured dimension table.
 *
 * A separate endpoint from the PDP, but keyed on the same product id, so it can
 * be fetched in parallel rather than after. Never throws — a product with no
 * published chart is normal, not an error.
 */
export async function fetchCliqSizeGuide(productId) {
  try {
    const d = await fetchJson(
      `${PRODUCTS}/${productId}/sizeGuide?isPwa=true`,
      { headers: HEADERS, retries: 1 },
    );
    if (d?.status && String(d.status).toLowerCase() !== 'success') return null;
    // Each measurement is repeated once per unit (CMS and INCH), so the Set
    // below is doing real work, not defensive de-duplication.
    const dimensions = [];
    for (const g of d?.sizeGuideList || []) {
      for (const dim of g?.dimensionList || []) {
        if (dim?.dimension) dimensions.push(titleCase(dim.dimension));
      }
    }
    const imageUrl = abs(d?.imageURL) || null;
    if (!imageUrl && !dimensions.length) return null;
    return {
      imageUrl,
      // De-duplicated measurement axes, e.g. "Chest", "Length", "Shoulder".
      dimensions: [...new Set(dimensions)],
      rows: (d?.sizeGuideList || []).length,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch the CLIQ PDP for an anchor product.
 * Returns { available:false, reason } instead of throwing, so a detail outage
 * degrades one column of the report rather than failing the whole comparison.
 */
export async function fetchCliqDetail(productId) {
  if (!productId) return { available: false, reason: 'no_product_id' };
  try {
    // In parallel: the size guide is keyed on the same product id, so it costs
    // latency only if awaited sequentially.
    const [d, sizeGuide] = await Promise.all([
      fetchJson(`${DETAIL}/${productId}?isPwa=true&isMDE=true`, { headers: HEADERS, retries: 2 }),
      fetchCliqSizeGuide(productId),
    ]);
    const pairs = detailPairs(d.details);
    const images = galleryImages(d.galleryImagesList);
    const description = d.productDescription || d.styleNote || null;

    return {
      available: true,
      description,
      styleNote: d.styleNote || null,
      // Structured attribute pairs, verbatim from CLIQ (Fit / Pattern / Wash /
      // Color / Neck-Collar / Sleeve / Fabric / Model fit …).
      attributes: pairs,
      bulletPoints: (d.details || []).length,
      gender: d.gender || null,
      categoryPath: (d.categoryHierarchy || []).map((c) => c.category_name).filter(Boolean),
      countryOfOrigin: d.mfgDetails?.countryOfOrigin || null,
      manufacturer: d.mfgDetails?.manufacturer?.[0]?.value || null,
      returnPolicy:
        (d.knowMoreV2 || []).map((k) => k.knowMoreItemV2).find((t) => /return/i.test(t || '')) ||
        d.returnPolicy ||
        null,
      deliveryModes: (d.deliveryModesATP || []).map((m) => ({ mode: m.key, promise: m.value })),
      offers: (d.potentialPromotions || []).map((o) => o.description || o.title).filter(Boolean),
      imageCount: images.length,
      images,
      // Live per-size stock, straight off the PDP's variant list.
      sizes: extractSizes(d.variantOptions),
      sizeGuide,
      videoAvailable: Boolean(
        (d.imageGalleryAttributes || []).some?.((a) => /video/i.test(a?.key || '')) || d.videoUrl,
      ),
      inStock: d.allOOStock === false || (d.winningSellerAvailableStock ?? 0) > 0,
      availableStock: d.winningSellerAvailableStock ?? null,
      seller: d.winningSellerName || null,
      sellerRating: d.winningSellerRating ?? null,
      isCOD: d.isCOD ?? null,
      exchangeAvailable: d.exchangeAvailable ?? d.isExchangeAvailable ?? null,
      rating: d.averageRating ?? null,
      ratingCount: d.ratingCount ?? null,
      reviewCount: d.numberOfReviews ?? null,
    };
  } catch (err) {
    return { available: false, reason: err.status === 403 ? 'blocked' : err.message };
  }
}
