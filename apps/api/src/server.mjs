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
import exportRoutes from './routes/export.mjs';
import importRoutes from './routes/import.mjs';
import { importJobs } from './import/jobs.mjs';
import { prewarmMyntra } from './sources/myntra.mjs';

async function build() {
  const app = Fastify({
    logger: { level: config.env === 'production' ? 'info' : 'debug' },
    // A spreadsheet of thousands of links is megabytes; the 1MB default would
    // reject it as a malformed request rather than a large one.
    bodyLimit: config.importMaxUploadMb * 1024 * 1024,
  });

  await app.register(cors, { origin: config.corsOrigin.split(','), credentials: true });
  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    // A progress bar polls once a second for hours; that is normal use of this
    // API, not abuse, and must not exhaust the shared budget.
    allowList: (req) => req.url.startsWith('/api/import/'),
  });

  /**
   * Spreadsheet uploads arrive as a raw body. Fastify has no parser for these
   * content types, and without one it rejects the upload as unsupported before
   * any route sees it.
   */
  for (const type of [
    'application/octet-stream',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv',
  ]) {
    app.addContentTypeParser(type, { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
  }

  app.register(metaRoutes, { prefix: '/api' });
  app.register(productRoutes, { prefix: '/api' });
  app.register(exportRoutes, { prefix: '/api' });
  app.register(importRoutes, { prefix: '/api' });

  app.get('/', async () => ({ name: 'PriceLens API', docs: '/api/health' }));

  return app;
}

async function main() {
  await store.load();
  // Warm Myntra's Akamai cookies now and keep them fresh, so the first click
  // after boot (or after idle) never pays the storefront round-trip.
  prewarmMyntra();
  // Restores saved jobs and restarts anything the last process died mid-run.
  await importJobs.init();
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
