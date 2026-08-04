import { store } from '../store.mjs';
import { matchAnchor } from '../matching/matcher.mjs';
import { buildReport } from '../matching/report.mjs';
import { parseCliqProductId, fetchCliqAnchor } from '../sources/tatacliq.mjs';
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

    const existing = store.get(id);
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

  // Product detail with full 3-way comparison. Matches live on cache miss.
  fastify.get('/products/:id', async (req, reply) => {
    const anchor = store.get(req.params.id);
    if (!anchor) return reply.code(404).send({ error: 'product_not_found' });

    let cmp = store.getComparison(anchor.id);
    const refresh = req.query.refresh === 'true';
    if (!cmp || refresh) {
      cmp = await matchAnchor(anchor, { minScore: config.matchMinScore, strictSku: config.strictSku });
      store.setComparison(anchor.id, cmp);
    }
    return { ...cmp, cached: !refresh && !!cmp };
  });

  /**
   * Full Product Match Comparison Report.
   * Matches live on cache miss; `?refresh=true` forces a re-match.
   * The report itself is derived synchronously from the comparison, so a warm
   * cache serves it without touching the network.
   */
  fastify.get('/products/:id/report', async (req, reply) => {
    const anchor = store.get(req.params.id);
    if (!anchor) return reply.code(404).send({ error: 'product_not_found' });

    const refresh = req.query.refresh === 'true';
    let cmp = store.getComparison(anchor.id);
    const cached = Boolean(cmp) && !refresh;
    if (!cached) {
      cmp = await matchAnchor(anchor, { minScore: config.matchMinScore, strictSku: config.strictSku });
      store.setComparison(anchor.id, cmp);
    }
    return { ...buildReport(cmp), cached };
  });

  // Force a fresh live match (bypasses cache).
  fastify.post('/products/:id/match', async (req, reply) => {
    const anchor = store.get(req.params.id);
    if (!anchor) return reply.code(404).send({ error: 'product_not_found' });
    const cmp = await matchAnchor(anchor, { minScore: config.matchMinScore, strictSku: config.strictSku });
    store.setComparison(anchor.id, cmp);
    return cmp;
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
