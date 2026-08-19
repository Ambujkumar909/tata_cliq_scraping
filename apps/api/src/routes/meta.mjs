import { store } from '../store.mjs';
import { runHarvester, harvesterStats } from '../sources/ajio-chart-harvester.mjs';
import { cacheStats } from '../cache/fetch-cache.mjs';
import { pacerStats } from '../lib/pacer.mjs';
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

  // Operational visibility: cache, pacing health, harvest progress.
  fastify.get('/telemetry', async () => ({
    cache: cacheStats(),
    pacer: pacerStats(),
    charts: harvesterStats(),
  }));

  // Kick the background chart harvester (idempotent; returns immediately).
  fastify.post('/charts/harvest', async (req) => {
    const max = Number(req.query.max) || Infinity;
    runHarvester({ max }).catch(() => {});
    return { started: true, ...harvesterStats() };
  });
}
