/**
 * Verifies the recent-searches strip: pinning, ordering, dedupe, expiry after
 * RECENT_TTL_HOURS, the limit, and dismissal.
 *
 * Runs the real routes through fastify.inject rather than over HTTP, and seeds
 * from catalog ids, so it needs neither a listening port nor a single scrape.
 *
 *   node scripts/verify-recent.mjs
 */
import Fastify from 'fastify';
import { store } from '../src/store.mjs';
import productRoutes from '../src/routes/products.mjs';
import { config } from '../src/config.mjs';

let failures = 0;
const ok = (label, cond, extra = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? '✅' : '❌'} ${label}${extra ? ` — ${extra}` : ''}`);
};
const recent = async (qs = '') => (await app.inject(`/api/recent${qs}`)).json();

await store.load();
const app = Fastify();
app.register(productRoutes, { prefix: '/api' });
await app.ready();

console.log(`\nrecentTtlHours=${config.recentTtlHours}  recentLimit=${config.recentLimit}`);
const [a, b] = store.products.slice(0, 2);
store.recent.clear();

console.log('\n=== 1. Pinning and order ===');
ok('empty before any lookup', (await recent()).items.length === 0);

store.markRecent(a.id);
await new Promise((r) => setTimeout(r, 5));
store.markRecent(b.id);
let body = await recent();
ok('both lookups pinned', body.items.length === 2, `got ${body.items.length}`);
ok('newest first', body.items[0].id === b.id, `first=${body.items[0].id}`);
ok('ttl reported to the UI', body.ttlHours === config.recentTtlHours);
ok('cards carry product fields', !!body.items[0].title && !!body.items[0].brand);
ok(
  'expiry counts down from the full window',
  body.items[0].expiresInHours <= config.recentTtlHours &&
    body.items[0].expiresInHours > config.recentTtlHours - 1,
  `${body.items[0].expiresInHours}h left`,
);
ok("catalog product tagged 'catalog'", body.items[0].source === 'catalog', body.items[0].source);

console.log('\n=== 2. Re-searching moves, never duplicates ===');
await new Promise((r) => setTimeout(r, 5));
store.markRecent(a.id);
body = await recent();
ok('no duplicate row', body.items.length === 2, `got ${body.items.length}`);
ok('moved back to the front', body.items[0].id === a.id, `first=${body.items[0].id}`);

console.log('\n=== 3. Expiry after the TTL ===');
store.recent.set(b.id, new Date(Date.now() - (config.recentTtlHours + 1) * 3600_000).toISOString());
body = await recent();
ok('stale entry no longer served', body.items.length === 1 && body.items[0].id === a.id,
  `got ${body.items.map((i) => i.id).join(',') || 'none'}`);
ok('stale entry pruned from memory', !store.recent.has(b.id));

console.log('\n=== 4. Limit ===');
for (const p of store.products.slice(2, 20)) store.markRecent(p.id);
ok('explicit limit respected', (await recent('?limit=5')).items.length === 5);
body = await recent();
ok('default limit applied', body.items.length === config.recentLimit, `got ${body.items.length}`);

console.log('\n=== 5. Dismissal ===');
const target = body.items[0].id;
const del = await app.inject({ method: 'DELETE', url: `/api/recent/${target}` });
ok('delete returns 200', del.statusCode === 200, `status ${del.statusCode}`);
ok('dismissed card is gone', !(await recent()).items.some((i) => i.id === target));

console.log('\n=== 6. Resolving a link pins it ===');
store.recent.clear();
const res = await app.inject(`/api/resolve?url=https://www.tatacliq.com/x/p-${a.id}`);
ok('resolve succeeds', res.statusCode === 200, `status ${res.statusCode}`);
ok('resolve reports searchedAt', !!res.json().searchedAt);
body = await recent();
ok('product now pinned', body.items.length === 1 && body.items[0].id === a.id);

const bad = await app.inject('/api/resolve?url=https://example.com/nope');
ok('non-CLIQ link rejected', bad.statusCode === 400, `status ${bad.statusCode}`);
ok('rejected link not pinned', (await recent()).items.length === 1);

console.log(`\n${failures ? `FAILED (${failures})` : 'ALL PASS'}\n`);
await app.close();
process.exit(failures ? 1 : 0);
