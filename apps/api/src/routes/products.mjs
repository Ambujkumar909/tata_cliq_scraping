import { store } from '../store.mjs';
import { matchAnchor } from '../matching/matcher.mjs';
import { buildReport } from '../matching/report.mjs';
import { parseCliqProductId, fetchCliqAnchor } from '../sources/tatacliq.mjs';
import { ageHours } from '../cache/persistence.mjs';
import { config } from '../config.mjs';

export default async function productRoutes(fastify) {
  /**
   * Resolve a pasted Tata CLIQ product link (or bare product id) to something
   * the report routes can serve.
   *
   * Products outside the ingested catalog are fetched from their PDP and
   * registered transiently — the ingested corpus is a starting point, not a
   * limit on what can be compared.
   */
  fastify.get('/resolve', async (req, reply) => {
    const raw = String(req.query.url || '').trim();
    if (!raw) {
      return reply.code(400).send({ error: 'missing_url', message: 'Paste a Tata CLIQ product link first.' });
    }

    const id = parseCliqProductId(raw);
    if (!id) {
      return reply.code(400).send({
        error: 'invalid_url',
        message: 'That does not look like a Tata CLIQ product link. Expected a URL containing "/p-<id>".',
      });
    }

    const existing = await store.resolve(id);
    if (existing) return { id, inCatalog: !existing._transient, product: store.withSummary(existing) };

    const res = await fetchCliqAnchor(id);
    if (!res.ok) {
      const message =
        res.reason === 'not_found'
          ? `Tata CLIQ has no product with id ${id}. Check the link is a live product page.`
          : `Could not read that product from Tata CLIQ (${res.reason}).`;
      return reply.code(404).send({ error: 'product_not_found', id, reason: res.reason, message });
    }
    store.addTransient(res.anchor);
    return { id, inCatalog: false, product: store.withSummary(res.anchor) };
  });

  // Paginated catalog with comparison summaries.
  fastify.get('/products', async (req) => {
    const {
      q = '', brand = '', page = '1', pageSize = '24', sort = 'relevance', comparedOnly = 'false',
    } = req.query;
    return store.query({
      q, brand,
      page: Math.max(1, Number(page)),
      pageSize: Math.min(60, Math.max(1, Number(pageSize))),
      sort,
      comparedOnly: comparedOnly === 'true',
    });
  });

  /**
   * Fetch the comparison for an anchor, reusing a saved one when it is still
   * within the TTL. A match costs three storefronts' worth of scraping, so the
   * same product is never compared twice in a day unless explicitly refreshed.
   */
  async function comparisonFor(anchor, refresh) {
    if (!refresh) {
      const saved = await store.getFreshComparison(anchor.id);
      if (saved) return { cmp: saved, cached: true };
    }
    const cmp = await matchAnchor(anchor, { minScore: config.matchMinScore, strictSku: config.strictSku });
    store.setComparison(anchor.id, cmp);
    return { cmp, cached: false };
  }

  // Cache provenance the UI can be honest with: a replayed report says so, and
  // says how old it is, instead of implying the prices were just fetched.
  const provenance = (cmp, cached) => ({
    cached,
    savedAt: cmp.matchedAt,
    ageHours: ageHours(cmp) == null ? null : Math.round(ageHours(cmp) * 10) / 10,
    ttlHours: config.reportTtlHours,
  });

  // Product detail with full 3-way comparison. Matches live on cache miss.
  fastify.get('/products/:id', async (req, reply) => {
    const anchor = await store.resolve(req.params.id);
    if (!anchor) return reply.code(404).send({ error: 'product_not_found' });

    const { cmp, cached } = await comparisonFor(anchor, req.query.refresh === 'true');
    return { ...cmp, ...provenance(cmp, cached) };
  });

  /**
   * Full Product Match Comparison Report.
   * Replays a saved comparison when one is fresh; matches live otherwise.
   * `?refresh=true` forces a re-match. The report itself is derived
   * synchronously from the comparison, so a hit never touches the network.
   */
  fastify.get('/products/:id/report', async (req, reply) => {
    const anchor = await store.resolve(req.params.id);
    if (!anchor) return reply.code(404).send({ error: 'product_not_found' });

    const { cmp, cached } = await comparisonFor(anchor, req.query.refresh === 'true');
    return { ...buildReport(cmp), ...provenance(cmp, cached) };
  });

  // Force a fresh live match (bypasses cache).
  fastify.post('/products/:id/match', async (req, reply) => {
    const anchor = await store.resolve(req.params.id);
    if (!anchor) return reply.code(404).send({ error: 'product_not_found' });
    const cmp = await matchAnchor(anchor, { minScore: config.matchMinScore, strictSku: config.strictSku });
    store.setComparison(anchor.id, cmp);
    return cmp;
  });

  /**
   * Every comparison already generated and saved, newest first.
   * Backs the /reports page — including link-sourced products, which are the
   * ones with no other route back.
   */
  fastify.get('/reports', async (req) => {
    const { q = '', page = '1', pageSize = '24', freshOnly = 'false' } = req.query;
    return store.savedReports({
      q,
      page: Math.max(1, Number(page)),
      pageSize: Math.min(100, Math.max(1, Number(pageSize))),
      freshOnly: freshOnly === 'true',
    });
  });

  // Brand facet list.
  fastify.get('/brands', async () => {
    return {
      brands: [...store.brands.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => ({ name, count })),
    };
  });
}
