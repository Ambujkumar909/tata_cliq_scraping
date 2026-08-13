/**
 * Myntra source adapter (gateway API + cookie warming).
 *
 * Myntra's storefront HTML embeds only the top ~32 hits. Its real search
 * gateway (gateway/v2/search) returns 100 per page and paginates deep, but it's
 * Akamai-protected. We warm cookies (bm_sz/_abck) from a normal page load, then
 * call the gateway with those cookies + the x-myntra-app header — giving full
 * catalog recall. Falls back to HTML parsing if the gateway is unavailable.
 */
import { extractJsonAfter } from '../lib/http.mjs';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const APP_HEADER = 'deviceID=pricelens;reqChannel=web;appFamily=MyntraRetailWeb;';

let _cookie = null;
let _cookieAt = 0;
const COOKIE_TTL = 10 * 60 * 1000;

/**
 * fetch() with a hard deadline. Every network call in this adapter goes through
 * it — an unbounded request is a batch-run hazard, not just a slow page.
 */
async function fetchWithTimeout(url, init = {}, timeoutMs) {
  const timeout = timeoutMs || Number(process.env.HTTP_TIMEOUT_MS || 20000);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

function mergeSetCookie(prev, setCookies) {
  const jar = new Map();
  for (const c of (prev || '').split('; ').filter(Boolean)) {
    const i = c.indexOf('=');
    if (i > 0) jar.set(c.slice(0, i), c.slice(i + 1));
  }
  for (const sc of setCookies || []) {
    const first = sc.split(';')[0];
    const i = first.indexOf('=');
    if (i > 0) jar.set(first.slice(0, i).trim(), first.slice(i + 1).trim());
  }
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

async function warmCookies(force = false) {
  if (!force && _cookie && Date.now() - _cookieAt < COOKIE_TTL) return _cookie;
  const res = await fetchWithTimeout('https://www.myntra.com/tshirts', {
    headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'en-IN,en;q=0.9' },
  });
  await res.text();
  const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  _cookie = mergeSetCookie(_cookie, setCookies);
  _cookieAt = Date.now();
  return _cookie;
}

function mapProduct(p) {
  const sizes = p.sizes ? String(p.sizes).split(',').map((s) => s.trim()).filter(Boolean) : [];
  const inventory = Array.isArray(p.inventoryInfo)
    ? p.inventoryInfo.map((i) => ({ size: i.label, available: !!i.available, count: i.inventory ?? null }))
    : [];
  const colours = Array.isArray(p.colourVariants)
    ? p.colourVariants.map((c) => ({ color: c.color || c.colour, id: c.styleId })).filter((c) => c.color)
    : [];
  return {
    source: 'myntra',
    id: String(p.productId),
    brand: (p.brand || '').trim(),
    title: (p.productName || '').trim(),
    color: p.primaryColour || null,
    gender: p.gender ? String(p.gender).toLowerCase() : null,
    articleType: p.articleType || null,
    mrp: p.mrp ?? null,
    price: p.price ?? null,
    currency: 'INR',
    // `p.discount` is the rupee AMOUNT off, not a percentage — reading it as a
    // percent produced "600% OFF" on a ₹1099→₹499 item. Derive the percentage
    // from mrp/price whenever both are present, and only fall back to
    // `p.discount` when it is plausibly already a percentage.
    discountPercent:
      p.mrp && p.price ? Math.round(((p.mrp - p.price) / p.mrp) * 100)
      : p.discount != null && Number(p.discount) <= 100 ? Number(p.discount)
      : null,
    rating: p.rating ? Number(Number(p.rating).toFixed(2)) : null,
    ratingCount: p.ratingCount ?? null,
    image: p.searchImage || (Array.isArray(p.images) && p.images[0]?.src) || null,
    url: p.landingPageUrl ? `https://www.myntra.com/${p.landingPageUrl}` : null,
    sizes,
    inventory,
    colourVariants: colours,
  };
}

async function gatewayPage(query, offset, rows, attempt = 1) {
  const cookie = await warmCookies(attempt > 1);
  const url = `https://www.myntra.com/gateway/v2/search/${encodeURIComponent(query)}?rows=${rows}&o=${offset}`;
  const res = await fetchWithTimeout(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'application/json',
      'Accept-Language': 'en-IN,en;q=0.9',
      Referer: `https://www.myntra.com/${encodeURIComponent(query).replace(/%20/g, '-')}`,
      'x-myntra-app': APP_HEADER,
      Cookie: cookie,
    },
  });
  if ((res.status === 401 || res.status === 403) && attempt < 2) {
    return gatewayPage(query, offset, rows, attempt + 1);
  }
  if (!res.ok) throw new Error(`gateway HTTP ${res.status}`);
  return res.json();
}

/** HTML fallback (top ~32) if the gateway is blocked. */
async function htmlFallback(query, limit) {
  const slug = encodeURIComponent(query.trim()).replace(/%20/g, '-');
  const res = await fetchWithTimeout(`https://www.myntra.com/${slug}?rawQuery=${encodeURIComponent(query.trim())}`, {
    headers: { 'User-Agent': UA, Accept: 'text/html', Referer: 'https://www.myntra.com/' },
  });
  const html = await res.text();
  const data = extractJsonAfter(html, 'window.__myx =') || extractJsonAfter(html, 'window.__myx=');
  const products = data?.searchData?.results?.products || [];
  return { total: data?.searchData?.results?.totalCount ?? products.length, candidates: products.slice(0, limit).map(mapProduct) };
}

// ── Detail (PDP) tier ─────────────────────────────────────────

/** Strip Myntra's HTML-ish descriptor markup down to plain text. */
function plain(s) {
  return String(s || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fetch a Myntra PDP and pull the detail tier the comparison report needs.
 *
 * The PDP HTML embeds the full `window.__myx` payload — `articleAttributes`
 * (Closure / Fabrics / Neck / Number of Pockets / Wash Care / Weave Type …),
 * `descriptors`, media counts, offers, serviceability and stock flags — so no
 * headless browser is required. Never throws: returns { available:false }.
 */
export async function fetchMyntraDetail(product, { timeoutMs } = {}) {
  const url = product?.url || (product?.id ? `https://www.myntra.com/product/${product.id}` : null);
  if (!url) return { available: false, reason: 'no_product_url' };
  try {
    const res = await fetchWithTimeout(
      url,
      { headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'en-IN,en;q=0.9' } },
      timeoutMs,
    );
    if (!res.ok) {
      return { available: false, reason: res.status === 403 ? 'blocked' : `HTTP ${res.status}` };
    }
    const html = await res.text();
    const root = extractJsonAfter(html, 'window.__myx =') || extractJsonAfter(html, 'window.__myx=');
    const d = root?.pdpData;
    if (!d) return { available: false, reason: 'no_pdp_payload' };

    // articleAttributes uses the literal string "NA" for absent values — drop
    // those so they never read as a real difference in the report.
    const attributes = {};
    for (const [k, v] of Object.entries(d.articleAttributes || {})) {
      if (v != null && String(v).trim() && String(v).trim().toUpperCase() !== 'NA') attributes[k] = v;
    }

    const descriptors = {};
    for (const x of d.descriptors || []) if (x?.title) descriptors[x.title] = plain(x.description);
    const description =
      descriptors.description ||
      plain((d.productDetails || []).find((p) => /product details/i.test(p?.title || ''))?.description) ||
      null;

    const imageUrls = [];
    for (const album of d.media?.albums || []) {
      for (const im of album.images || []) {
        const u = im?.secureSrc || im?.src;
        if (u && !imageUrls.includes(u)) imageUrls.push(u);
      }
    }

    /**
     * Myntra publishes its size chart as structured measurements rather than an
     * image. Reported in the same shape as CLIQ's so the report can compare
     * like with like — "has a chart, measured on these axes".
     */
    const sizeChart = d.sizeChart || d.sizeChartUrl || null;
    const dimensions = Array.isArray(d.sizeChart?.sizeRepresentationUrl)
      ? []
      : (d.sizeChart?.dimensions || []).map((x) => x?.name).filter(Boolean);
    const sizeGuide = sizeChart
      ? {
          imageUrl: typeof d.sizeChart?.sizeRepresentationUrl === 'string' ? d.sizeChart.sizeRepresentationUrl : null,
          dimensions: [...new Set(dimensions)],
          rows: (d.sizeChart?.sizeChartUnits || []).length || 0,
        }
      : null;

    return {
      available: true,
      description,
      styleNote: descriptors.style_note || null,
      sizeFitDesc: descriptors.size_fit_desc || null,
      attributes,
      bulletPoints: Object.keys(attributes).length,
      gender: d.analytics?.gender ? String(d.analytics.gender).toLowerCase() : null,
      categoryPath: [d.analytics?.masterCategory, d.analytics?.subCategory, d.analytics?.articleType]
        .filter(Boolean),
      countryOfOrigin: d.countryOfOrigin || null,
      manufacturer: typeof d.manufacturer === 'string' ? d.manufacturer : null,
      returnPolicy: d.serviceability?.returnPeriod
        ? `${d.serviceability.returnPeriod} Days Return`
        : (d.serviceability?.descriptors || []).find((t) => /return/i.test(t)) || null,
      deliveryModes: (d.serviceability?.descriptors || []).map((t) => ({ mode: 'standard', promise: t })),
      offers: (d.offers || []).map((o) => o.title).filter(Boolean),
      imageCount: imageUrls.length,
      images: imageUrls,
      sizeGuide,
      videoAvailable: (d.media?.videos || []).length > 0,
      inStock: d.flags?.outOfStock === false,
      isCOD: d.flags?.codEnabled ?? null,
      exchangeAvailable: d.flags?.isExchangeable ?? null,
      isReturnable: d.flags?.isReturnable ?? null,
      seller: (d.sellers || [])[0]?.name || null,
      rating: d.ratings?.averageRating ? Number(d.ratings.averageRating.toFixed(2)) : null,
      ratingCount: d.ratings?.totalCount ?? null,
      reviewCount: Number(d.ratings?.reviewInfo?.reviewsCount) || null,
      baseColour: d.baseColour || null,
    };
  } catch (err) {
    return { available: false, reason: err.name === 'AbortError' ? 'timeout' : err.message };
  }
}

/**
 * Search Myntra with deep recall. `limit` caps candidates; `pages` caps API
 * pages (100 each). Returns { total, candidates }.
 */
export async function searchMyntra(query, { limit = 100, pages = 2 } = {}) {
  try {
    const byId = new Map();
    let total = 0;
    for (let i = 0; i < pages; i++) {
      const data = await gatewayPage(query, i * 100, 100);
      total = data.totalCount ?? total;
      const prods = data.products || [];
      for (const p of prods) if (p.productId && !byId.has(String(p.productId))) byId.set(String(p.productId), mapProduct(p));
      if (!data.hasNextPage || prods.length === 0 || byId.size >= limit) break;
    }
    if (byId.size === 0) return htmlFallback(query, limit);
    return { total, candidates: [...byId.values()].slice(0, limit) };
  } catch {
    return htmlFallback(query, limit).catch(() => ({ total: 0, candidates: [] }));
  }
}
