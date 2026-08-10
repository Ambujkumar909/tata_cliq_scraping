/**
 * PriceLens API — Fastify modular monolith.
 * Serves the Tata CLIQ catalog and live 3-way price comparisons.
 */
import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { config } from './config.mjs';
import { store } from './store.mjs';
import { persistence } from './cache/persistence.mjs';
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

  // Flush the pending comparison snapshot before the process goes away —
  // docker stop must not discard matches that were just paid for.
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.once(sig, async () => {
      await app.close().catch(() => {});
      await persistence.close();
      process.exit(0);
    });
  }

  try {
    await app.listen({ port: config.port, host: config.host });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
