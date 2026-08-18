/**
 * Ajio source adapter (pure HTTP, proxy-aware, optional browser session).
 *
 * TWO DIFFERENT WALLS, two different fixes — established by measurement:
 *
 *   SEARCH  `/api/search` gates on IP REPUTATION. Datacenter IPs get 403;
 *           residential/mobile IPs sail through. Fix: SCRAPE_PROXY.
 *   PDP     `/api/p/{code}` gates on Akamai's JS-computed `_abck` token, NOT
 *           the IP. Proven: one machine, one residential IP, one second —
 *           Node's fetch 403 with every header permutation, the same URL 200
 *           inside a Chrome tab. No proxy can mint that token.
 *           Fix: AJIO_BROWSER_COOKIES=true (see ajio-session.mjs).
 *
 * Both degrade gracefully: search returns { blocked: true }, detail returns
 * { available: false }, and the report renders "not available" rather than
 * inventing a difference.
 */
import { fetchJson } from '../lib/http.mjs';
import { parseMeasurement } from '../lib/format.mjs';
import { ajioPdpFetch, ajioBrowserEnabled } from './ajio-session.mjs';
import { config } from '../config.mjs';

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

export async function fetchAjioDetail(product) {
  const code = product?.id;
  if (!code) return { available: false, reason: 'no_product_code' };
  try {
    let data;
    if (ajioBrowserEnabled()) {
      // The PDP API only answers requests originating INSIDE a real page — see
      // ajio-session.mjs for the measurements. Seed the page on this product's
      // own PDP so the first call warms and reads in one navigation.
      data = await ajioPdpFetch(code, product.url);
      if (!data) return { available: false, reason: 'browser_session_unavailable' };
    } else {
      data = await fetchJson(`${API.replace('/search', '')}/p/${code}?fields=SITE`, {
        headers: HEADERS,
        retries: 1,
      });
    }
    // Ajio ships a FLAT feature list — [{ name, featureValues: [{ value }] }] —
    // while `classifications` (older shape) nests them under groups. Handle
    // both: reading only the grouped shape silently produced empty specs.
    const feature = {};
    const addFeature = (f) => {
      const k = f?.name || f?.code;
      const v = Array.isArray(f?.featureValues)
        ? f.featureValues.map((x) => x.value).filter(Boolean).join(', ')
        : f?.value;
      if (k && v) feature[k] = v;
    };
    for (const f of data.featureData || []) addFeature(f);
    for (const g of data.classifications || []) for (const f of g.features || []) addFeature(f);
    const images = Array.isArray(data.images) ? data.images.filter((i) => i.format === 'product').length : 0;
    return {
      available: true,
      // Ajio usually leaves `description` empty and puts the marketing prose in
      // an "Additional Information" feature instead — without this fallback the
      // description signal and content-quality row read as zero for every Ajio
      // product that in fact has copy.
      description:
        data.description ||
        feature['Additional Information 1'] ||
        feature['Additional Information'] ||
        null,
      // Verified against a live PDP: the chart hides in
      // fnlColorVariantData.sizeGuideDesktop as a JSON *string*.
      sizeGuide: extractSizeGuide(data),
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
