/**
 * In-memory catalog + comparison store.
 *
 * Loads the ingested Tata CLIQ catalog and any precomputed comparisons from
 * apps/api/data, builds fast lookup indexes, and caches live match results.
 * Kept deliberately simple and dependency-free (Redis can back this later).
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { normalizeText } from './lib/normalize.mjs';
import { buildIdf } from './lib/semantic.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(__dirname, '..', 'data');

class Store {
  constructor() {
    this.products = [];
    this.byId = new Map();
    this.comparisons = new Map(); // id -> comparison result
    this.brands = new Map(); // brand -> count
    this.loadedAt = null;
  }

  async load() {
    const catalogPath = resolve(DATA, 'tatacliq.products.json');
    if (!existsSync(catalogPath)) {
      console.warn('[store] no catalog found — run `npm run ingest` first');
    } else {
      const { products } = JSON.parse(await readFile(catalogPath, 'utf8'));
      this.products = products;
      for (const p of products) {
        this.byId.set(p.id, p);
        p._search = normalizeText(`${p.brand} ${p.title} ${p.color || ''}`);
        this.brands.set(p.brand, (this.brands.get(p.brand) || 0) + 1);
      }
      // Train the semantic IDF model on the anchor catalog so corpus-common
      // words ("men", "cotton", "fit") stop dominating title similarity.
      buildIdf(products.map((p) => `${p.brand} ${p.title}`));
    }

    const cmpPath = resolve(DATA, 'comparisons.json');
    if (existsSync(cmpPath)) {
      const { results } = JSON.parse(await readFile(cmpPath, 'utf8'));
      for (const r of results) this.comparisons.set(r.anchor.id, r);
    }
    this.loadedAt = new Date().toISOString();
    console.log(
      `[store] loaded ${this.products.length} products, ${this.comparisons.size} comparisons, ${this.brands.size} brands`,
    );
  }

  get(id) {
    return this.byId.get(id) || null;
  }

  /**
   * Register a product resolved on demand (e.g. from a pasted CLIQ link) so the
   * normal product/report routes can serve it.
   *
   * Deliberately NOT pushed into `this.products`: ad-hoc lookups must not
   * inflate catalog size, brand facets, pagination or the dashboard KPIs. It is
   * reachable by id only, which is all the report needs.
   */
  addTransient(product) {
    if (!product?.id) return null;
    const existing = this.byId.get(product.id);
    if (existing) return existing;
    product._search = normalizeText(`${product.brand} ${product.title} ${product.color || ''}`);
    product._transient = true;
    this.byId.set(product.id, product);
    return product;
  }

  getComparison(id) {
    return this.comparisons.get(id) || null;
  }

  setComparison(id, cmp) {
    this.comparisons.set(id, cmp);
  }

  query({ q = '', brand = '', page = 1, pageSize = 24, sort = 'relevance', comparedOnly = false } = {}) {
    const nq = normalizeText(q);
    const terms = nq ? nq.split(' ').filter(Boolean) : [];
    let rows = this.products;

    if (brand) rows = rows.filter((p) => p.brand === brand);
    if (terms.length) rows = rows.filter((p) => terms.every((t) => p._search.includes(t)));
    if (comparedOnly) rows = rows.filter((p) => this.comparisons.has(p.id));

    rows = rows.slice();
    if (sort === 'price_asc') rows.sort((a, b) => (a.price ?? 1e12) - (b.price ?? 1e12));
    else if (sort === 'price_desc') rows.sort((a, b) => (b.price ?? -1) - (a.price ?? -1));
    else if (sort === 'discount') rows.sort((a, b) => (b.discountPercent ?? 0) - (a.discountPercent ?? 0));
    else if (sort === 'rating') rows.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));

    const total = rows.length;
    const start = (page - 1) * pageSize;
    const items = rows.slice(start, start + pageSize).map((p) => this.withSummary(p));
    return { total, page, pageSize, totalPages: Math.ceil(total / pageSize), items };
  }

  withSummary(p) {
    const cmp = this.comparisons.get(p.id);
    return {
      id: p.id, brand: p.brand, title: p.title, color: p.color,
      mrp: p.mrp, price: p.price, currency: p.currency,
      discountPercent: p.discountPercent, rating: p.rating, ratingCount: p.ratingCount,
      image: p.image, url: p.url, category: p.category,
      comparison: cmp
        ? {
            matchedCount: cmp.summary.matchedCount,
            prices: cmp.summary.prices,
            cheapest: cmp.summary.cheapest,
            matchedAt: cmp.matchedAt,
          }
        : null,
    };
  }

  // Comparisons that have at least one matched competitor price.
  _matchedComparisons() {
    return [...this.comparisons.values()].filter((c) => c.summary.matchedCount > 0);
  }

  // Per-comparison price position from CLIQ's perspective.
  _position(c) {
    const cliq = c.summary.prices.tatacliq;
    const comps = Object.entries(c.summary.prices).filter(([k]) => k !== 'tatacliq');
    if (cliq == null || !comps.length) return null;
    const cheapestComp = comps.reduce((a, b) => (b[1] < a[1] ? b : a));
    const gap = cliq - cheapestComp[1]; // >0 → CLIQ costlier (dealer undercuts)
    return { cliq, cheapestComp: { platform: cheapestComp[0], price: cheapestComp[1] }, gap };
  }

  stats() {
    const withCmp = this._matchedComparisons();
    const cliqCheapest = withCmp.filter((c) => c.summary.cheapest?.platform === 'tatacliq').length;
    const topBrands = [...this.brands.entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, 12)
      .map(([name, count]) => ({ name, count }));

    let win = 0, tie = 0, lose = 0, gapSum = 0, gapN = 0;
    for (const c of withCmp) {
      const p = this._position(c);
      if (!p) continue;
      if (p.gap > 0) { lose++; gapSum += p.gap; gapN++; }
      else if (p.gap < 0) win++;
      else tie++;
    }
    return {
      products: this.products.length,
      brands: this.brands.size,
      comparisons: this.comparisons.size,
      cliqCheapest,
      cliqCheapestPct: withCmp.length ? Math.round((cliqCheapest / withCmp.length) * 100) : 0,
      positioning: { win, tie, lose, total: withCmp.length, avgUndercut: gapN ? Math.round(gapSum / gapN) : 0 },
      topBrands,
      loadedAt: this.loadedAt,
    };
  }

  // Actionable insights: where dealers most undercut CLIQ, and CLIQ's biggest wins.
  insights({ limit = 12 } = {}) {
    const rows = this._matchedComparisons()
      .map((c) => ({ c, p: this._position(c) }))
      .filter((x) => x.p);
    const shape = ({ c, p }) => ({
      id: c.anchor.id, brand: c.anchor.brand, title: c.anchor.title, image: c.anchor.image,
      cliqPrice: p.cliq, competitor: p.cheapestComp, gap: p.gap,
      prices: c.summary.prices,
    });
    const undercuts = rows.filter((x) => x.p.gap > 0).sort((a, b) => b.p.gap - a.p.gap).slice(0, limit).map(shape);
    const wins = rows.filter((x) => x.p.gap < 0).sort((a, b) => a.p.gap - b.p.gap).slice(0, limit).map(shape);
    return { undercuts, wins };
  }
}

export const store = new Store();
