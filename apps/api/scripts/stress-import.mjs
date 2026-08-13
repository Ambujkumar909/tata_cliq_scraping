/**
 * Scale test for the bulk importer at 10,000 links.
 *
 * Does NOT scrape 10k products (that is ~4.5 hours of real traffic). It proves
 * the plumbing that scale actually stresses: workbook parsing, job creation,
 * the size and latency of a persisted 10k job document, poll-response size
 * while the job is huge, and the export path.
 *
 *   node scripts/stress-import.mjs [rows]
 */
import ExcelJS from 'exceljs';
import Fastify from 'fastify';
import { store } from '../src/store.mjs';
import { persistence } from '../src/cache/persistence.mjs';
import { parseSheet } from '../src/import/parse.mjs';
import { importJobs } from '../src/import/jobs.mjs';
import importRoutes from '../src/routes/import.mjs';
import { buildTemplate } from '../src/import/template.mjs';

const ROWS = Number(process.argv[2] || 10000);
let failures = 0;
const ok = (label, cond, extra = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? '✅' : '❌'} ${label}${extra ? ` — ${extra}` : ''}`);
};
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;
const heap = () => process.memoryUsage().heapUsed;

await store.load();
const app = Fastify({ bodyLimit: 64 * 1024 * 1024 });
for (const t of ['application/octet-stream', 'text/csv']) {
  app.addContentTypeParser(t, { parseAs: 'buffer' }, (_r, b, d) => d(null, b));
}
app.register(importRoutes, { prefix: '/api' });
await app.ready();

// ── Build a realistic 10k sheet ───────────────────────────────────
console.log(`\n=== 1. Generating a ${ROWS.toLocaleString('en-IN')}-row workbook ===`);
let t = Date.now();
const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet('Products');
ws.addRow(['#', 'Product', 'CLIQ link', 'Myntra', 'Notes']);
const real = store.products.map((p) => p.id);
for (let i = 0; i < ROWS; i++) {
  // Mostly synthetic ids (they resolve to 404 fast, which is the interesting
  // failure path at scale), salted with real catalog ids and duplicates.
  const id =
    i % 50 === 0 ? real[i % real.length]
    : i % 97 === 0 ? real[0] // deliberate duplicates
    : `MP${String(100000000000 + i).padStart(15, '0')}`;
  ws.addRow([
    i + 1,
    `Example product ${i + 1}`,
    `https://www.tatacliq.com/some-slug-${i}/p-${id.toLowerCase()}`,
    i % 11 === 0 ? 'https://www.myntra.com/tshirts/x/y/32409751/buy' : '',
    'lorem ipsum notes column that should be ignored entirely',
  ]);
}
const buf = Buffer.from(await wb.xlsx.writeBuffer());
console.log(`  built in ${((Date.now() - t) / 1000).toFixed(1)}s · file ${mb(buf.length)}`);
ok('file within the upload limit', buf.length < 25 * 1024 * 1024, mb(buf.length));

// ── Parse ─────────────────────────────────────────────────────────
console.log('\n=== 2. Parsing ===');
const h0 = heap();
t = Date.now();
const parsed = await parseSheet(buf, 'stress.xlsx');
const parseMs = Date.now() - t;
console.log(`  parsed in ${(parseMs / 1000).toFixed(1)}s · heap +${mb(heap() - h0)}`);
ok('parse completes well under a minute', parseMs < 60000, `${(parseMs / 1000).toFixed(1)}s`);
ok('every row scanned', parsed.rowsScanned === ROWS + 1, `${parsed.rowsScanned}`);
ok('duplicates collapsed', parsed.duplicates > 0 && parsed.total < parsed.linksFound,
  `${parsed.linksFound} links → ${parsed.total} unique (${parsed.duplicates} dupes)`);
ok('competitor hints captured', parsed.withHints > 0, `${parsed.withHints}`);
ok('notes column did not create products', parsed.total <= ROWS);

// ── Upload path ───────────────────────────────────────────────────
console.log('\n=== 3. Upload + dry run ===');
t = Date.now();
const dry = await app.inject({
  method: 'POST',
  url: '/api/import?filename=stress.xlsx&dryRun=true',
  headers: { 'content-type': 'application/octet-stream' },
  payload: buf,
});
ok('dry run succeeds', dry.statusCode === 200, `${((Date.now() - t) / 1000).toFixed(1)}s`);
ok('dry-run payload stays small', dry.rawPayload.length < 20000, `${dry.rawPayload.length} bytes`);

// ── Job document at scale ─────────────────────────────────────────
console.log('\n=== 4. Job document ===');
const job = importJobs.create({ filename: 'stress.xlsx', parsed });
const docBytes = Buffer.byteLength(JSON.stringify(job));
console.log(`  ${job.total.toLocaleString('en-IN')} items · serialised ${mb(docBytes)}`);
ok('job doc well under the Redis value limit', docBytes < 64 * 1024 * 1024, mb(docBytes));

t = Date.now();
await persistence.saveJob(job, true);
const saveMs = Date.now() - t;
console.log(`  persisted in ${saveMs}ms`);
ok('a checkpoint write is fast', saveMs < 3000, `${saveMs}ms`);

// ── Poll latency while the job is huge ────────────────────────────
console.log('\n=== 5. Progress polling ===');
t = Date.now();
const poll = await app.inject(`/api/import/${job.id}`);
const pollMs = Date.now() - t;
ok('poll responds fast', pollMs < 500, `${pollMs}ms`);
ok('poll payload is tiny (items stripped)', poll.rawPayload.length < 2000,
  `${poll.rawPayload.length} bytes for a ${job.total.toLocaleString('en-IN')}-row job`);
ok('poll reports the full total', poll.json().total === parsed.total);

const paged = await app.inject(`/api/import/${job.id}?items=true&pageSize=50`);
ok('rows paginate rather than dumping 10k', paged.json().rows.items.length === 50,
  `${paged.rawPayload.length} bytes/page`);

// ── A slice of real processing, then cancel ───────────────────────
console.log('\n=== 6. Live processing (short slice, then cancel) ===');
importJobs.start(job.id);
await new Promise((r) => setTimeout(r, 20000));
const mid = (await app.inject(`/api/import/${job.id}`)).json();
console.log(`  ${mid.done} rows in 20s · ${mid.matched} matched · ${mid.failed} failed · eta ${mid.etaSeconds}s`);
ok('work is actually progressing', mid.done > 0, `${mid.done} rows`);
ok('bad ids fail fast rather than hanging', mid.failed > 0, `${mid.failed} failed`);
ok('ETA is projected for the full run', mid.etaSeconds > 0, `${Math.round(mid.etaSeconds / 60)} min`);

importJobs.cancel(job.id);
await new Promise((r) => setTimeout(r, 3000));
const stopped = (await app.inject(`/api/import/${job.id}`)).json();
ok('cancel takes effect promptly', stopped.status === 'cancelled', stopped.status);
ok('remaining work is still queued for resume', stopped.remaining > 0,
  `${stopped.remaining.toLocaleString('en-IN')} left`);

const rate = mid.done / 20;
console.log(`\n  measured ${rate.toFixed(1)} rows/sec → ${ROWS.toLocaleString('en-IN')} rows ≈ ` +
  `${(ROWS / rate / 60).toFixed(0)} min (mostly 404s here; real products are slower)`);

// ── Template ──────────────────────────────────────────────────────
console.log('\n=== 7. Template ===');
const tpl = await buildTemplate();
ok('template generated', tpl.length > 5000, mb(tpl.length));
const check = new ExcelJS.Workbook();
await check.xlsx.load(tpl);
ok('has both sheets', check.worksheets.length === 2, check.worksheets.map((w) => w.name).join(', '));
const round = await parseSheet(tpl, 'pricelens-import-template.xlsx');
ok('template parses through our own importer', round.total === 3, `${round.total} example products`);
ok('template example carries a competitor hint', round.withHints === 1, `${round.withHints}`);

console.log(`\n  peak heap ${mb(process.memoryUsage().heapUsed)}`);
console.log(`\n${failures ? `FAILED (${failures})` : 'ALL PASS'}\n`);
await app.close();
process.exit(failures ? 1 : 0);
