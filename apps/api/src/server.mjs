/**
 * PriceLens API — Fastify modular monolith.
 * Serves the Tata CLIQ catalog and live 3-way price comparisons.
 */
import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { config } from './config.mjs';
import { store } from './store.mjs';
import metaRoutes from './routes/meta.mjs';
import productRoutes from './routes/products.mjs';

async function build() {
  const app = Fastify({
    logger: { level: config.env === 'production' ? 'info' : 'debug' },
  });

  await app.register(cors, { origin: config.corsOrigin.split(','), credentials: true });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });

  app.register(metaRoutes, { prefix: '/api' });
  app.register(productRoutes, { prefix: '/api' });

  app.get('/', async () => ({ name: 'PriceLens API', docs: '/api/health' }));

  return app;
}

async function main() {
  await store.load();
  const app = await build();
  try {
    await app.listen({ port: config.port, host: config.host });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
