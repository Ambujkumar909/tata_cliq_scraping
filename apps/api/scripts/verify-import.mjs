/**
 * Verifies the bulk-import pipeline end to end: parse → job → background
 * processing → progress → cancel/resume → export.
 *
 * Runs the real routes through fastify.inject (no port), against the client's
 * own sheet. Live matching IS exercised, so it makes real requests — keep the
 * sheet small or pass a smaller IMPORT_MAX_ROWS.
 *
 *   node scripts/verify-import.mjs [path-to-sheet]
 */
import { readFile } from 'node:fs/promises';
import Fastify from 'fastify';
import { store } from '../src/store.mjs';
import { persistence } from '../src/cache/persistence.mjs';
import { importJobs } from '../src/import/jobs.mjs';
import importRoutes from '../src/routes/import.mjs';
import { parseSheet } from '../src/import/parse.mjs';

const SHEET = process.argv[2] || 'C:/Users/Divyanshi/Downloads/scanner/SKU Example List.xlsx';

let failures = 0;
const ok = (label, cond, extra = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? '✅' : '❌'} ${label}${extra ? ` — ${extra}` : ''}`);
};

await store.load();
const app = Fastify({ bodyLimit: 32 * 1024 * 1024 });
for (const t of ['application/octet-stream', 'text/csv']) {
  app.addContentTypeParser(t, { parseAs: 'buffer' }, (_r, b, d) => d(null, b));
}
app.register(importRoutes, { prefix: '/api' });
await app.ready();

const buf = await readFile(SHEET);
const upload = (qs = '') => app.inject({
  method: 'POST',
  url: `/api/import?filename=${encodeURIComponent('SKU Example List.xlsx')}${qs}`,
  headers: { 'content-type': 'application/octet-stream' },
  payload: buf,
});

console.log('\n=== 1. Parsing ===');
const parsed = await parseSheet(buf, 'x.xlsx');
ok('found products across both sheets', parsed.total === 17, `${parsed.total} unique`);
ok('captured competitor URL hints', parsed.withHints === 3, `${parsed.withHints} rows`);
ok('every id looks like a CLIQ id', parsed.items.every((i) => /^MP\d+$/.test(i.id)));
ok('source rows recorded', parsed.items.every((i) => i.sourceRows?.length >= 1));

console.log('\n=== 2. Dry run does not scrape ===');
const dry = await upload('&dryRun=true');
ok('202/200 with a preview', dry.statusCode === 200, `status ${dry.statusCode}`);
ok('reports totals without a job', dry.json().dryRun === true && dry.json().total === 17);
ok('no job created', importJobs.list().total === 0, `${importJobs.list().total} jobs`);

console.log('\n=== 3. Rejections ===');
const empty = await app.inject({ method: 'POST', url: '/api/import?filename=a.xlsx', headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.alloc(0) });
ok('empty upload rejected', empty.statusCode === 400, `status ${empty.statusCode}`);
const badExt = await app.inject({ method: 'POST', url: '/api/import?filename=a.pdf', headers: { 'content-type': 'application/octet-stream' }, payload: buf });
ok('wrong extension rejected', badExt.statusCode === 400, badExt.json().error);
const noLinks = await app.inject({ method: 'POST', url: '/api/import?filename=a.csv', headers: { 'content-type': 'text/csv' }, payload: Buffer.from('name,qty\nwidget,3\n') });
ok('sheet with no CLIQ links rejected', noLinks.statusCode === 400, noLinks.json().error);
ok('  …and says how many rows it scanned', noLinks.json().rowsScanned === 2);

console.log('\n=== 4. Real job (live matching) ===');
const res = await upload();
ok('upload accepted with 202', res.statusCode === 202, `status ${res.statusCode}`);
const jobId = res.json().id;
ok('job id returned', !!jobId, jobId);
ok('no items array in the poll payload', res.json().items === undefined);
ok('total counted', res.json().total === 17);

let view;
const t0 = Date.now();
for (;;) {
  view = (await app.inject(`/api/import/${jobId}`)).json();
  if (view.status !== 'running' && view.status !== 'queued') break;
  if (Date.now() - t0 > 240000) { console.log('  (timeout — cancelling)'); importJobs.cancel(jobId); break; }
  process.stdout.write(`\r  ${view.done}/${view.total} · ${view.percent}% · eta ${view.etaSeconds ?? '—'}s   `);
  await new Promise((r) => setTimeout(r, 1000));
}
console.log(`\r  finished in ${((Date.now() - t0) / 1000).toFixed(1)}s${' '.repeat(30)}`);

ok('job reached a terminal state', ['done', 'cancelled'].includes(view.status), view.status);
ok('every row accounted for', view.done === view.total, `${view.done}/${view.total}`);
ok('counters sum to done', view.matched + view.noMatch + view.failed === view.done,
  `${view.matched}+${view.noMatch}+${view.failed} vs ${view.done}`);
console.log(`     matched=${view.matched} noMatch=${view.noMatch} failed=${view.failed} cached=${view.fromCache}`);
console.log(`     hint agreement: ${view.hintAgreed} agreed / ${view.hintDisagreed} disagreed`);

console.log('\n=== 4b. Imported products reach the recent strip ===');
{
  const recent = await store.recentSearches({ limit: 50 });
  const ids = new Set(recent.items.map((i) => i.id));
  const compared = (await app.inject(`/api/import/${jobId}?items=true&pageSize=200`)).json()
    .rows.items.filter((i) => i.status === 'matched' || i.status === 'no_match');
  ok('import pinned products as recent', compared.some((i) => ids.has(i.id)),
    `${compared.filter((i) => ids.has(i.id)).length}/${compared.length} pinned`);
  ok('strip stays capped, not flooded', recent.items.length <= 50);
}

console.log('\n=== 5. Row-level results ===');
const rows = (await app.inject(`/api/import/${jobId}?items=true&pageSize=5`)).json();
ok('rows paginate', rows.rows.items.length === 5 && rows.rows.total === 17, `${rows.rows.total} rows`);
ok('rows carry brand/title', rows.rows.items.some((i) => i.brand));
const failedOnly = (await app.inject(`/api/import/${jobId}?items=true&filter=failed`)).json();
ok('filter=failed matches counter', failedOnly.rows.total === view.failed, `${failedOnly.rows.total} vs ${view.failed}`);

console.log('\n=== 6. Cache replay on re-upload ===');
const again = await upload();
const jobId2 = again.json().id;
for (;;) {
  const v = (await app.inject(`/api/import/${jobId2}`)).json();
  if (v.status !== 'running' && v.status !== 'queued') { view = v; break; }
  await new Promise((r) => setTimeout(r, 500));
}
ok('second run served from cache', view.fromCache > 0, `${view.fromCache}/${view.total} cached`);

console.log('\n=== 7. Resume after a crash mid-run ===');
{
  // Simulate a process that died with work outstanding: a persisted job still
  // marked 'running', with pending items. This is the case that matters — a
  // 4-hour job must not restart from row one, or lose its place entirely.
  const victim = importJobs.create({
    filename: 'crash-test.xlsx',
    parsed: {
      rowsScanned: 3, linksFound: 3, duplicates: 0, total: 3, withHints: 0,
      items: store.products.slice(0, 3).map((p, n) => ({
        id: p.id, sheet: 'S', row: n + 1, sourceRows: [n + 1], hints: {},
      })),
    },
  });
  victim.status = 'running';
  victim.startedAt = new Date().toISOString();
  await persistence.saveJob(victim, true);

  // Drop every trace from memory, the way a restart would.
  importJobs.jobs.clear();
  importJobs.running.clear();
  ok('job is gone from memory', importJobs.get(victim.id) === null);

  await importJobs.init();
  const revived = importJobs.get(victim.id);
  ok('job restored from cache', !!revived, revived?.id);
  ok('marked as resumed', !!revived?.note, revived?.note);
  // The point of the resume: a worker is actually attached again, rather than
  // the job sitting in 'running' forever with nothing driving it.
  ok('a worker was attached again', importJobs.running.has(victim.id));

  for (let i = 0; i < 60 && importJobs.get(victim.id)?.status === 'running'; i++) {
    await new Promise((r) => setTimeout(r, 500));
  }
  const after = importJobs.get(victim.id);
  ok('resumed job ran to completion', after.done === after.total, `${after.done}/${after.total}`);
  ok('no rows left pending', !after.items.some((i) => i.state === 'pending'));
}

console.log('\n=== 8. Export ===');
const xlsx = await app.inject(`/api/import/${jobId}/export.xlsx`);
ok('workbook returned', xlsx.statusCode === 200, `status ${xlsx.statusCode}`);
ok('is a real xlsx (zip magic)', xlsx.rawPayload.slice(0, 2).toString() === 'PK');
ok('attachment filename set', /attachment; filename=".*\.xlsx"/.test(xlsx.headers['content-disposition']));
const missing = await app.inject('/api/import/nope/export.xlsx');
ok('unknown job 404s', missing.statusCode === 404);

console.log(`\n${failures ? `FAILED (${failures})` : 'ALL PASS'}\n`);
await app.close();
process.exit(failures ? 1 : 0);
