/**
 * Ajio source adapter (pure HTTP, proxy-aware).
 *
 * Ajio sits behind Akamai and denies this egress IP at the edge: HTTP 403 with
 * Akamai's "Access Denied / Reference #18.x" page on EVERY endpoint, including
 * the homepage.
 *
 * Measured 2026-08-19, all from the same residential Reliance Jio IP in India
 * (ip-api: proxy:false, hosting:false), while myntra.com and tatacliq.com both
 * returned 200:
 *
 *   node fetch                → 403      Playwright Chromium   → 403
 *   impit Chrome TLS profile  → 403      impit Firefox profile → 403
 *
 * So this is NOT a datacenter-IP problem, a TLS/JA3 fingerprint problem, or a
 * missing-cookie problem — a genuine browser engine on a clean residential IP is
 * refused before any bot-sensor runs.
 *
 * A browser sidecar was built and proven to work (headed Chromium under Xvfb
 * reached the PDP where every HTTP client was refused), then removed on
 * request. If Ajio detail is wanted again the options are that sidecar, a
 * rotating residential/mobile proxy via SCRAPE_PROXY, or a managed unblocking
 * API. Until then this degrades gracefully to { blocked: true } rather than
 * inventing empty data.
 */
import { fetchJson } from '../lib/http.mjs';
import { parseMeasurement } from '../lib/format.mjs';

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
 * `/api/p/{code}` and the PDP HTML are refused by the same edge deny that stops
 * search (see the module header — search does NOT return 200 from a blocked IP,
 * whatever its reputation). So unlike CLIQ and Myntra there is no detail tier
 * here without a working SCRAPE_PROXY, and
 * we say so explicitly rather than silently returning empty specs — the report
 * renders those cells as "not available" instead of implying a real difference.
 */
/**
 * Ajio's size chart, in the canonical cross-platform shape.
 *
 * VERIFIED against a live PDP on 2026-08-19 (MAX polo, code 460942193001),
 * fetched from a real browser session — the earlier shape-tolerant guesser it
 * replaces was written blind while the endpoint was unreachable.
 *
 * The chart is NOT a normal field: `fnlColorVariantData.sizeGuideDesktop` is a
 * JSON *string* that must be parsed a second time. Inside it:
 *
 *   sizechart[] → { measurementType: "Garment Measurement" | "Body …",
 *                   gender, brickName, brandName, howToMeasureImage1Url,
 *                   brickBrandSizes[] → { sizeName,
 *                     sizeChartAttributes[] → { attributeName: "Chest_attribute",
 *                                               attributeValue:        "36",     // inches
 *                                               convertedAttributeValue: "91.44" // cm
 *                                             } } }
 *
 * Both units come for free, so no conversion is invented here.
 */
const AJIO_LABEL_ATTRS = /^(Universal Size|Brand Size)( Format)?$/i;

function extractSizeGuide(data) {
  const raw = data?.fnlColorVariantData?.sizeGuideDesktop;
  if (typeof raw !== 'string' || !raw.includes('sizechart')) return null;
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return null; }

  const table = [];
  const dimensions = [];
  const units = new Set();
  let imageUrl = null;

  for (const group of parsed?.sizechart || []) {
    // "Garment Measurement" vs a body chart — the basis the comparison needs so
    // a to-fit number is never scored against a garment one.
    const basisOf = /body/i.test(group?.measurementType || '') ? 'body' : 'garment';
    imageUrl = imageUrl || group?.howToMeasureImage1Url || null;

    for (const row of group?.brickBrandSizes || []) {
      const size = String(row?.sizeName ?? '').trim();
      if (!size) continue;
      const measurements = {};
      const basis = {};
      let brandSize = null;

      for (const attr of row?.sizeChartAttributes || []) {
        const name = String(attr?.attributeName ?? '').replace(/_attribute$/i, '').trim();
        if (!name) continue;
        // Size LABELS ride in the same array as measurements; they are not axes.
        if (AJIO_LABEL_ATTRS.test(name)) {
          if (/^brand size$/i.test(name)) brandSize = String(attr.attributeValue ?? '').trim() || null;
          continue;
        }
        const inch = parseMeasurement(attr?.attributeValue);
        const cm = parseMeasurement(attr?.convertedAttributeValue);
        if (!inch && !cm) continue;
        measurements[name] = {
          ...(inch ? { inch: inch.value, ...(inch.lo !== inch.hi ? { inchRange: [inch.lo, inch.hi] } : {}) } : {}),
          ...(cm ? { cm: cm.value, ...(cm.lo !== cm.hi ? { cmRange: [cm.lo, cm.hi] } : {}) } : {}),
        };
        basis[name] = basisOf;
        if (inch) units.add('inch');
        if (cm) units.add('cm');
        if (!dimensions.includes(name)) dimensions.push(name);
      }

      if (!Object.keys(measurements).length) continue;
      table.push({ size, brandSize: brandSize || size, available: null, measurements, basis });
    }
  }

  if (!table.length && !imageUrl) return null;
  return { imageUrl, dimensions, table, units: [...units], rows: table.length };
}

/** PDP payload → the canonical detail shape. Transport-agnostic on purpose:
 *  the plain-HTTP path and the browser path hand it the identical JSON. */
function mapAjioDetail(data) {
  const feature = {};
  for (const g of data.featureData || data.classifications || []) {
    // Ajio ships featureData FLAT — { name: 'Fabric', featureValues:[{value}] } —
    // not as classification groups containing features. Reading it as nested
    // found a name on nothing and silently produced zero attributes, which is
    // why the Ajio specification cells stayed blank even once the PDP was
    // reachable. Both shapes are handled: flat first, nested as the fallback.
    if (g?.name && Array.isArray(g.featureValues)) {
      const v = g.featureValues.map((x) => x?.value ?? x).filter(Boolean).join(', ');
      if (v) feature[g.name] = v;
      continue;
    }
    for (const f of g?.features || []) {
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
    sizeGuide: extractSizeGuide(data),
    videoAvailable: false,
    inStock: data.stock?.stockLevelStatus !== 'outOfStock',
    offers: (data.potentialPromotions || []).map((o) => o.description || o.title).filter(Boolean),
    returnPolicy: data.returnPolicy || null,
    seller: data.sellerName || null,
  };
}

export async function fetchAjioDetail(product) {
  const code = product?.id;
  if (!code) return { available: false, reason: 'no_product_code' };
  try {
    const data = await fetchJson(`${API.replace('/search', '')}/p/${code}?fields=SITE`, {
      headers: HEADERS,
      retries: 1,
    });
    return mapAjioDetail(data);
  } catch (err) {
    if (err.status === 403) return { available: false, reason: 'akamai-ip-block' };
    return { available: false, reason: err.message };
  }
}
