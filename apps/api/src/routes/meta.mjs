import { store } from '../store.mjs';

export default async function metaRoutes(fastify) {
  fastify.get('/health', async () => ({
    status: 'ok',
    uptime: Math.round(process.uptime()),
    loadedAt: store.loadedAt,
    products: store.products.length,
  }));

  fastify.get('/stats', async () => store.stats());

  fastify.get('/insights', async (req) => store.insights({ limit: Math.min(30, Number(req.query.limit) || 12) }));
}
