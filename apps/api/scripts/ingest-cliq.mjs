#!/usr/bin/env node
/**
 * PriceLens — Tata CLIQ anchor-catalog ingestion.
 *
 * Pages through the Tata CLIQ storefront search gateway (searchbff) across a set
 * of seed terms, normalises each hit into the canonical anchor-product shape, and
 * writes a deduplicated catalog to apps/api/data/tatacliq.products.json.
 *
 * This is the *real* ingestion path used by the backend bootstrap — not a mock.
 * Run standalone:  node scripts/ingest-cliq.mjs
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '..', 'data');
const OUT_FILE = resolve(OUT_DIR, 'tatacliq.products.json');

const TARGET = Number(process.env.INGEST_TARGET_COUNT || 2000);
const TERMS = (process.env.INGEST_TERMS ||
  'tshirt,shirt,jeans,trousers,kurta,dress,top,shoes,sneakers,watch,handbag,jacket,saree,sweatshirt,heels,sandals,kurti,sunglasses,wallet,perfume')
  .split(',').map((t) => t.trim()).filter(Boolean);

const PAGE_SIZE = 40;
const MAX_PAGES_PER_TERM = 20; // 20 * 40 = 800 max per term
const BASE = 'https://searchbff.tatacliq.com/products/mpl/search';

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'application/json',
  Origin: 'https://www.tatacliq.com',
  Referer: 'https://www.tatacliq.com/',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(term, page, attempt = 1) {
  const searchText = encodeURIComponent(`${term}:relevance`);
  const url =
    `${BASE}?searchText=${searchText}&channel=WEB&page=${page}&pageSize=${PAGE_SIZE}` +
    `&isKeywordRedirectEnabled=false&isTextSearch=true&isMDE=true`;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), Number(process.env.HTTP_TIMEOUT_MS || 20000));
    const res = await fetch(url, { headers: HEADERS, signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    if (attempt <= 3) {
      await sleep(500 * attempt);
      return fetchPage(term, page, attempt + 1);
    }
    console.warn(`  ! ${term} p${page} failed after retries: ${err.message}`);
    return null;
  }
}

function toCanonical(p, term) {
  const price = p.price || {};
  const sell = price.sellingPrice?.doubleValue ?? null;
  const mrp = price.mrpPrice?.doubleValue ?? sell;
  const cat = (p.categoryHierarchy || []).reduce((a, o) => ({ ...a, ...o }), {});
  const img = p.imageURL ? (p.imageURL.startsWith('//') ? `https:${p.imageURL}` : p.imageURL) : null;
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
    image: img,
    url: p.webURL ? `https://www.tatacliq.com${p.webURL}` : null,
    category: { l1: cat.L1 || null, l2: cat.L2 || null, l3: cat.L3 || null },
    seedTerm: term,
    ingestedAt: new Date().toISOString(),
  };
}

async function main() {
  console.log(`\n🛰️  PriceLens ingestion → target ${TARGET} unique Tata CLIQ products`);
  console.log(`    terms: ${TERMS.join(', ')}\n`);
  const byId = new Map();

  outer: for (const term of TERMS) {
    let added = 0;
    for (let page = 0; page < MAX_PAGES_PER_TERM; page++) {
      const data = await fetchPage(term, page);
      const rows = data?.searchresult || [];
      if (!rows.length) break;
      for (const row of rows) {
        if (!row.productId || byId.has(row.productId)) continue;
        const c = toCanonical(row, term);
        if (!c.title || c.price == null) continue;
        byId.set(c.id, c);
        added++;
      }
      const total = data?.pagination?.totalResults;
      process.stdout.write(
        `\r  [${term}] page ${page + 1} → +${added} (catalog: ${byId.size}/${TARGET}, source total ~${total})   `,
      );
      if (byId.size >= TARGET) { console.log(''); break outer; }
      const totalPages = data?.pagination?.totalPages ?? MAX_PAGES_PER_TERM;
      if (page + 1 >= totalPages) break;
      await sleep(120);
    }
    console.log('');
  }

  const products = [...byId.values()];
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(
    OUT_FILE,
    JSON.stringify(
      { source: 'tatacliq', count: products.length, generatedAt: new Date().toISOString(), products },
      null,
      2,
    ),
  );

  const brands = new Set(products.map((p) => p.brand)).size;
  console.log(`\n✅ Ingested ${products.length} unique products across ${brands} brands`);
  console.log(`   → ${OUT_FILE}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
