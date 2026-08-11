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
import { persistence, isFresh, ageHours, fingerprint } from './cache/persistence.mjs';
import { toExportRow, compareSizes } from './export/rows.mjs';
import { config } from './config.mjs';

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

    /**
     * The batch-matcher's snapshot, gated on the same fingerprint as the live
     * cache.
     *
     * Without this check the fingerprint protects only Redis and the file
     * cache, and a `npm run match` artifact from an older engine walks straight
     * past it into memory — serving verdicts the current matcher would never
     * reach, which is exactly what the fingerprint exists to prevent. A snapshot
     * with no fingerprint at all predates the field, so it is stale by
     * definition.
     */
    const cmpPath = resolve(DATA, 'comparisons.json');
    if (existsSync(cmpPath)) {
      const snapshot = JSON.parse(await readFile(cmpPath, 'utf8'));
      if (snapshot.fingerprint === fingerprint()) {
        for (const r of snapshot.results || []) this.comparisons.set(r.anchor.id, r);
      } else {
        console.warn(
          `[store] ignoring comparisons.json — built by ${snapshot.fingerprint || 'an older engine'}, ` +
            `current is ${fingerprint()}. Re-run \`npm run match\` to refresh it.`,
        );
      }
    }

    // Replay comparisons saved by earlier runs. They win over the shipped
    // comparisons.json snapshot, which is a build-time artifact and therefore
    // always the older of the two.
    await persistence.init();
    let replayed = 0;
    for (const cmp of await persistence.hydrate()) {
      this.comparisons.set(cmp.anchor.id, cmp);
      // A pasted-URL product is not in the catalog; re-register it so its saved
      // report stays reachable by id after a restart.
      if (!this.byId.has(cmp.anchor.id)) this.addTransient({ ...cmp.anchor });
      replayed++;
    }

    this.loadedAt = new Date().toISOString();
    console.log(
      `[store] loaded ${this.products.length} products, ${this.comparisons.size} comparisons ` +
        `(${replayed} replayed from cache), ${this.brands.size} brands`,
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
    persistence.saveAnchor(product).catch(() => {});
    return product;
  }

  /**
   * Resolve a product by id, falling back to a durably-saved ad-hoc anchor.
   * Covers the case where a shared /report/<id> link is opened in a process
   * that never saw the original paste.
   */
  async resolve(id) {
    const hit = this.byId.get(id);
    if (hit) return hit;
    const saved = await persistence.loadAnchor(id);
    return saved ? this.addTransient(saved) : null;
  }

  getComparison(id) {
    return this.comparisons.get(id) || null;
  }

  /**
   * A saved comparison, but only while it is still within the TTL — past that
   * its prices are history, not a quote. Falls through to the durable cache so
   * an entry evicted from memory is still a hit.
   */
  async getFreshComparison(id) {
    const local = this.comparisons.get(id);
    if (local) return isFresh(local) ? local : null;
    const saved = await persistence.load(id);
    if (!saved) return null;
    this.comparisons.set(id, saved); // warm memory for the catalog grid
    return isFresh(saved) ? saved : null;
  }

  setComparison(id, cmp) {
    this.comparisons.set(id, cmp);
    // Write-through, non-blocking: persisting is an optimisation for the *next*
    // request and must never delay or fail this one.
    persistence.save(id, cmp).catch((err) => console.warn('[store] persist failed:', err.message));
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

  /**
   * Every saved comparison, newest first — the backing list for the /reports
   * page.
   *
   * Reads the comparison map rather than the catalog on purpose: a product
   * compared from a pasted link is deliberately absent from the catalog grid,
   * and those are exactly the reports a user has no other way to find again.
   */
  savedReports({ q = '', page = 1, pageSize = 24, freshOnly = false } = {}) {
    const nq = normalizeText(q);
    const terms = nq ? nq.split(' ').filter(Boolean) : [];

    let rows = [...this.comparisons.values()]
      .filter((c) => c?.anchor?.id)
      .map((c) => {
        const competitors = Object.entries(c.competitors || {});
        const matched = competitors.filter(([, m]) => m?.status === 'matched');
        // Best = highest-scoring matched competitor; it defines the verdict the
        // report leads with.
        const best = matched.sort((a, b) => (b[1].score ?? 0) - (a[1].score ?? 0))[0];
        const age = ageHours(c);
        return {
          id: c.anchor.id,
          brand: c.anchor.brand ?? null,
          title: c.anchor.title ?? null,
          image: c.anchor.image ?? null,
          url: c.anchor.url ?? null,
          matchType: best?.[1]?.matchType ?? 'NO MATCH',
          confidence: best?.[1]?.score ?? null,
          bestPlatform: best?.[0] ?? null,
          matchedCount: c.summary?.matchedCount ?? 0,
          prices: c.summary?.prices ?? {},
          cheapest: c.summary?.cheapest ?? null,
          matchedAt: c.matchedAt ?? null,
          ageHours: age == null ? null : Math.round(age * 10) / 10,
          fresh: isFresh(c),
          // How long this stays replayable. Negative would read as nonsense, so
          // a stale entry reports 0: the next view re-scrapes it.
          expiresInHours:
            age == null ? null : Math.max(0, Math.round((config.reportTtlHours - age) * 10) / 10),
          // Whether this product is in the ingested catalog or arrived as a link.
          source: this.byId.get(c.anchor.id)?._transient ? 'link' : 'catalog',
          _search: normalizeText(`${c.anchor.brand || ''} ${c.anchor.title || ''} ${c.anchor.id}`),
        };
      });

    if (terms.length) rows = rows.filter((r) => terms.every((t) => r._search.includes(t)));
    if (freshOnly) rows = rows.filter((r) => r.fresh);
    rows.sort((a, b) => new Date(b.matchedAt || 0) - new Date(a.matchedAt || 0));

    const total = rows.length;
    const start = (page - 1) * pageSize;
    const items = rows.slice(start, start + pageSize).map(({ _search, ...r }) => r);
    return {
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize) || 1,
      ttlHours: config.reportTtlHours,
      freshCount: rows.filter((r) => r.fresh).length,
      items,
    };
  }

  /**
   * Every saved comparison flattened into business rows, filtered.
   *
   * The filter set is deliberately the merchandising one — category, gender,
   * brand, price band, competitive position — not the engine's vocabulary. A
   * category manager exports "women's footwear where a rival undercuts us",
   * never "comparisons whose myntra competitor has status=matched".
   *
   * Rows are derived on read rather than stored: a comparison is the durable
   * artefact, and deriving keeps the export honest when the taxonomy or the
   * recommendation logic changes.
   */
  exportRows(filters = {}) {
    const {
      q = '', brands = [], categories = [], genders = [], sizes = [],
      position = 'all', matched = 'all', freshOnly = false,
      minPrice = null, maxPrice = null,
    } = filters;

    const nq = normalizeText(q);
    const terms = nq ? nq.split(' ').filter(Boolean) : [];
    const has = (list, v) => !list.length || list.includes(v);

    const rows = [];
    for (const cmp of this.comparisons.values()) {
      if (!cmp?.anchor?.id) continue;
      const row = toExportRow(cmp);

      // `category`/`gender` are null when nothing could be derived; those rows
      // answer to the explicit 'unclassified' filter value, never to a real
      // category, so an export of "T-Shirts" can't quietly include unknowns.
      if (!has(categories, row.category ?? 'unclassified')) continue;
      if (!has(genders, row.gender ?? 'unspecified')) continue;
      if (!has(brands, row.brand)) continue;
      // A row answers a size filter if it is sold in ANY of the chosen sizes;
      // picking S and M means "S or M", the way every storefront reads it.
      if (sizes.length && !sizes.some((s) => row.sizes.includes(s))) continue;
      if (freshOnly && !row.fresh) continue;
      if (matched === 'matched' && row.matchedCount === 0) continue;
      if (matched === 'unmatched' && row.matchedCount > 0) continue;
      if (position !== 'all' && row.posture !== position) continue;
      if (minPrice != null && (row.cliqPrice == null || row.cliqPrice < minPrice)) continue;
      if (maxPrice != null && (row.cliqPrice == null || row.cliqPrice > maxPrice)) continue;
      if (terms.length) {
        const hay = normalizeText(`${row.brand || ''} ${row.title || ''} ${row.id}`);
        if (!terms.every((t) => hay.includes(t))) continue;
      }
      rows.push(row);
    }

    // Biggest competitive exposure first: the rows where a rival undercuts CLIQ
    // by the most money are the ones a merchandiser acts on today.
    rows.sort((a, b) => (b.priceGap ?? -Infinity) - (a.priceGap ?? -Infinity));
    return rows;
  }

  /**
   * The filter vocabulary the export UI offers, with counts, derived from what
   * is actually saved. Offering a category with nothing behind it produces an
   * empty spreadsheet and a support ticket.
   *
   * Counts are relative to the filter set passed in, the way a storefront does
   * it: with Polo selected, "The Souled Store 2" has to become 0, or the panel
   * invites a combination that exports nothing. Each group is counted against
   * every OTHER group but not itself — a brand list that narrowed to the brand
   * you just ticked could never be widened to a second brand.
   *
   * The vocabulary and its order still come from the unfiltered set, so options
   * keep their places instead of resequencing under the cursor, and a value
   * that currently selects nothing is reported at 0 rather than vanishing —
   * "this exists but not here" is information; a shrinking list is not.
   */
  exportFacets(filters = {}) {
    const all = this.exportRows();
    const view = (overrides) => this.exportRows({ ...filters, ...overrides });

    const vocabulary = (key, labelKey) => {
      const m = new Map();
      for (const r of all) {
        const value = r[key] ?? (key === 'category' ? 'unclassified' : 'unspecified');
        const hit = m.get(value) || { value, label: r[labelKey], count: 0 };
        hit.count++;
        m.set(value, hit);
      }
      return [...m.values()].sort((a, b) => b.count - a.count);
    };
    const counted = (key, rows) => {
      const m = new Map();
      for (const r of rows) {
        const value = r[key] ?? (key === 'category' ? 'unclassified' : 'unspecified');
        m.set(value, (m.get(value) || 0) + 1);
      }
      return m;
    };
    const withCounts = (vocab, counts) =>
      vocab.map((o) => ({ ...o, count: counts.get(o.value) ?? 0 }));

    const rows = view({});
    const priceRows = view({ minPrice: null, maxPrice: null });
    const positionRows = view({ position: 'all' });
    const prices = priceRows.map((r) => r.cliqPrice).filter((p) => typeof p === 'number');

    const sizeCounts = (list) => {
      const m = new Map();
      for (const r of list) for (const s of r.sizes ?? []) m.set(s, (m.get(s) || 0) + 1);
      return m;
    };
    const sizeVocab = [...sizeCounts(all).keys()].sort(compareSizes);
    const sizesNow = sizeCounts(view({ sizes: [] }));

    const brandVocab = [...all.reduce((m, r) => m.set(r.brand, (m.get(r.brand) || 0) + 1), new Map()).entries()]
      .filter(([name]) => name)
      .sort((a, b) => b[1] - a[1])
      .map(([value]) => ({ value, label: value }));
    const brandsNow = counted('brand', view({ brands: [] }));

    const posture = (list, name) => list.filter((r) => r.posture === name).length;

    return {
      total: rows.length,
      // Everything saved, ignoring the filter — the empty panel ("nothing saved
      // yet") and the empty result ("nothing matches this filter") are
      // different messages, and `total` can no longer tell them apart.
      savedTotal: all.length,
      categories: withCounts(vocabulary('category', 'categoryLabel'), counted('category', view({ categories: [] }))),
      genders: withCounts(vocabulary('gender', 'genderLabel'), counted('gender', view({ genders: [] }))),
      // Sizes are multi-valued per row, so they are tallied separately and
      // ordered XS→XL (then numerically) rather than by popularity: a size list
      // out of size order is unreadable however well it ranks.
      sizes: sizeVocab.map((value) => ({ value, label: value, count: sizesNow.get(value) ?? 0 })),
      brands: brandVocab.map((b) => ({ ...b, count: brandsNow.get(b.value) ?? 0 })),
      positions: [
        { value: 'undercut', label: 'Competitor undercuts CLIQ', count: posture(positionRows, 'undercut') },
        { value: 'winning', label: 'CLIQ is cheapest', count: posture(positionRows, 'winning') },
        { value: 'parity', label: 'Price parity', count: posture(positionRows, 'parity') },
      ],
      matchedCount: rows.filter((r) => r.matchedCount > 0).length,
      freshCount: rows.filter((r) => r.fresh).length,
      // The price band is the range still reachable under the other filters, so
      // the min/max placeholders describe the data the user can actually select.
      priceRange: prices.length ? { min: Math.min(...prices), max: Math.max(...prices) } : null,
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
