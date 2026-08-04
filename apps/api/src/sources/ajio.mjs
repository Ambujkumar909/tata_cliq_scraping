/**
 * Ajio source adapter (pure HTTP, proxy-aware).
 *
 * Ajio sits behind Akamai and blocks datacenter/unclean IPs at the edge (HTTP 403
 * on every endpoint — even a full browser is blocked, so a headless browser buys
 * nothing). The correct, fast solution is a clean residential/mobile proxy via the
 * SCRAPE_PROXY env var. With a working egress IP this hits Ajio's JSON search API
 * directly. Without one, it degrades gracefully: { blocked: true }.
 */
import { fetchJson } from '../lib/http.mjs';

const API = 'https://www.ajio.com/api/search';
const HEADERS = {
  Accept: 'application/json',
  Referer: 'https://www.ajio.com/',
  Origin: 'https://www.ajio.com',
};

// Ajio exposes gender as a merchandising "segment" (Men / Women / Boys / Girls /
// Kids). It is the ONLY gender signal on the listing — the title has the brand
// and gender stripped out — so mapping it is what keeps the gender gate armed.
// Ajio ships colour as a variant key like "469525293_black" (or in the URL as
// ".../p/469525293_black"). Pull the human part out; the numeric prefix is a
// style id, not a colour.
function colorFromVariant(colorGroup, url) {
  const raw = String(colorGroup || '') || String(url || '').split('/p/')[1] || '';
  const tail = raw.split('_').slice(1).join(' ').trim();
  if (!tail) return null;
  return tail.replace(/[^a-zA-Z ]+/g, ' ').replace(/\s+/g, ' ').trim() || null;
}

function genderFromSegment(segment) {
  const s = String(segment || '').toLowerCase();
  if (!s) return null;
  if (s.includes('girl')) return 'girls';
  if (s.includes('boy')) return 'boys';
  if (s.includes('women') || s.includes('woman') || s.includes('ladies')) return 'women';
  if (s.includes('men') || s.includes('man')) return 'men';
  if (s.includes('unisex')) return 'unisex';
  return null;
}

function mapProduct(p) {
  const v = p.fnlColorVariantData || {};
  return {
    source: 'ajio',
    id: String(p.code || p.id),
    brand: (p.brandName || v.brandName || '').trim(),
    title: (p.name || '').trim(),
    color: colorFromVariant(v.colorGroup, p.url) || p.color || null,
    // Structured facets — Ajio's titles omit brand/gender, so these carry the
    // signal that title text cannot.
    gender: genderFromSegment(p.segmentNameText || p.segmentName),
    articleType: p.brickNameText || p.brickName || null,
    category: {
      segment: p.segmentNameText || p.segmentName || null,
      vertical: p.verticalNameText || p.verticalName || null,
      brick: p.brickNameText || p.brickName || null,
    },
    mrp: p.wasPriceData?.value ?? p.mrp ?? null,
    price: p.price?.value ?? p.offerPrice?.value ?? null,
    currency: 'INR',
    discountPercent: p.discountPercent ? Number(String(p.discountPercent).replace(/[^0-9.]/g, '')) : null,
    rating: p.averageRating ? Number(Number(p.averageRating).toFixed(2)) : null,
    ratingCount: p.totalRatingsCount ?? null,
    image: p.imageUrl || (Array.isArray(p.images) && p.images[0]?.url) || null,
    url: p.url ? `https://www.ajio.com${p.url}` : null,
    sizes: Array.isArray(p.sizeOptions)
      ? p.sizeOptions.map((s) => s.sizeValue || s.value).filter(Boolean)
      : [],
    inventory: [],
    colourVariants: [],
  };
}

export async function searchAjio(query, { limit = 40 } = {}) {
  const url =
    `${API}?fields=SITE&currentPage=0&pageSize=${limit}&format=json` +
    `&query=${encodeURIComponent(query.trim())}&sortBy=relevance&platform=Desktop`;
  try {
    const data = await fetchJson(url, { headers: HEADERS, retries: 2 });
    const products = data.products || [];
    return { total: data.pagination?.totalCount ?? products.length, candidates: products.slice(0, limit).map(mapProduct) };
  } catch (err) {
    if (err.status === 403) {
      return { blocked: true, reason: 'akamai-ip-block', total: 0, candidates: [] };
    }
    return { error: err.message, total: 0, candidates: [] };
  }
}

/**
 * Product-detail enrichment.
 *
 * Ajio's PDP is harder-walled than its search API: both `/api/p/{code}` and the
 * PDP HTML return 403 from a datacenter IP even though search returns 200. So
 * unlike CLIQ and Myntra there is no detail tier here without SCRAPE_PROXY, and
 * we say so explicitly rather than silently returning empty specs — the report
 * renders those cells as "not available" instead of implying a real difference.
 */
export async function fetchAjioDetail(product) {
  const code = product?.id;
  if (!code) return { available: false, reason: 'no_product_code' };
  try {
    const data = await fetchJson(`${API.replace('/search', '')}/p/${code}?fields=SITE`, {
      headers: HEADERS,
      retries: 1,
    });
    const feature = {};
    for (const g of data.featureData || data.classifications || []) {
      for (const f of g.features || g.featureValues || []) {
        const k = f.name || f.code;
        const v = Array.isArray(f.featureValues) ? f.featureValues.map((x) => x.value).join(', ') : f.value;
        if (k && v) feature[k] = v;
      }
    }
    const images = Array.isArray(data.images) ? data.images.filter((i) => i.format === 'product').length : 0;
    return {
      available: true,
      description: data.description || null,
      attributes: feature,
      countryOfOrigin: data.countryOfOrigin || feature['Country of Origin'] || null,
      imageCount: images || (Array.isArray(data.images) ? data.images.length : 0),
      videoAvailable: false,
      inStock: data.stock?.stockLevelStatus !== 'outOfStock',
      offers: (data.potentialPromotions || []).map((o) => o.description || o.title).filter(Boolean),
      returnPolicy: data.returnPolicy || null,
      seller: data.sellerName || null,
    };
  } catch (err) {
    if (err.status === 403) return { available: false, reason: 'akamai-ip-block' };
    return { available: false, reason: err.message };
  }
}
