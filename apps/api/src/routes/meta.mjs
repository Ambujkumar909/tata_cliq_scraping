import { store } from '../store.mjs';
import { persistence } from '../cache/persistence.mjs';

export default async function metaRoutes(fastify) {
  fastify.get('/health', async () => ({
    status: 'ok',
    uptime: Math.round(process.uptime()),
    loadedAt: store.loadedAt,
    products: store.products.length,
  }));

  // Where saved comparisons live, how many there are, and how long they last.
  fastify.get('/cache', async () => persistence.stats());

  fastify.get('/stats', async () => store.stats());

  fastify.get('/insights', async (req) => store.insights({ limit: Math.min(30, Number(req.query.limit) || 12) }));
}
