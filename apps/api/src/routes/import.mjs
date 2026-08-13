/**
 * Bulk import routes — upload a sheet of CLIQ links, compare every one.
 *
 * The upload is taken as a raw body rather than multipart: the payload is a
 * single file, the browser can send it with one fetch, and it avoids a
 * dependency whose only job would be to unwrap one part.
 */
import { parseSheet } from '../import/parse.mjs';
import { importJobs } from '../import/jobs.mjs';
import { buildTemplate } from '../import/template.mjs';
import { store } from '../store.mjs';
import { buildWorkbook } from '../export/workbook.mjs';
import { toExportRow } from '../export/rows.mjs';
import { config } from '../config.mjs';

export default async function importRoutes(fastify) {
  /**
   * A blank sheet in the shape we accept, with worked examples.
   *
   * Registered before `/import/:id` so the static path wins the route match,
   * and generated on demand so it can never describe limits the API no longer
   * enforces.
   */
  fastify.get('/import/template.xlsx', async (_req, reply) => {
    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', 'attachment; filename="pricelens-import-template.xlsx"')
      .send(await buildTemplate());
  });

  /**
   * Upload a spreadsheet. Parses immediately (fast, no network) and starts the
   * comparison run in the background, returning a job id to poll.
   *
   * `?dryRun=true` parses and reports what was found WITHOUT scraping — the
   * honest way to let someone confirm a 5,000-row sheet was read correctly
   * before committing to hours of work.
   */
  fastify.post('/import', async (req, reply) => {
    const body = req.body;
    if (!body || !body.length) {
      return reply.code(400).send({ error: 'empty_upload', message: 'No file received.' });
    }
    const filename = String(req.query.filename || 'upload.xlsx');
    if (!/\.(xlsx|xlsm|csv)$/i.test(filename)) {
      return reply.code(400).send({
        error: 'unsupported_format',
        message: 'Upload an .xlsx, .xlsm or .csv file.',
      });
    }

    let parsed;
    try {
      parsed = await parseSheet(body, filename);
    } catch (err) {
      return reply.code(400).send({
        error: 'unreadable_file',
        message: `Could not read that spreadsheet (${err.message}).`,
      });
    }

    if (!parsed.total) {
      return reply.code(400).send({
        error: 'no_links_found',
        message:
          `Scanned ${parsed.rowsScanned} rows but found no Tata CLIQ product links. ` +
          'Cells should contain a link like tatacliq.com/…/p-mp000000024358256, or a bare product id.',
        rowsScanned: parsed.rowsScanned,
      });
    }
    if (parsed.total > config.importMaxRows) {
      return reply.code(413).send({
        error: 'too_many_rows',
        message: `That sheet has ${parsed.total} products; the limit is ${config.importMaxRows}.`,
      });
    }

    if (req.query.dryRun === 'true') {
      const { items, ...summary } = parsed;
      return { dryRun: true, ...summary, sample: items.slice(0, 10) };
    }

    const job = importJobs.create({ filename, parsed });
    importJobs.start(job.id);
    return reply.code(202).send(jobView(job, { items: false }));
  });

  // Every import job, newest first.
  fastify.get('/import', async (req) => importJobs.list({ limit: Math.min(100, Number(req.query.limit) || 20) }));

  /**
   * Job progress. Rows are paginated because a finished 10k job is far too
   * large to hand back on every poll — the progress counters live on the job
   * itself, so a polling UI never needs the rows at all.
   */
  fastify.get('/import/:id', async (req, reply) => {
    const job = importJobs.get(req.params.id);
    if (!job) return reply.code(404).send({ error: 'job_not_found' });

    const includeItems = req.query.items === 'true';
    if (!includeItems) return jobView(job, { items: false });

    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50));
    const filter = String(req.query.filter || 'all');
    const rows = job.items.filter((i) =>
      filter === 'all' ? true
      : filter === 'failed' ? i.status === 'error'
      : filter === 'unmatched' ? i.status === 'no_match'
      : filter === 'matched' ? i.status === 'matched'
      : filter === 'disagreed' ? i.agreement === 'disagreed'
      : true,
    );
    return {
      ...jobView(job, { items: false }),
      rows: {
        total: rows.length,
        page,
        pageSize,
        totalPages: Math.ceil(rows.length / pageSize) || 1,
        items: rows.slice((page - 1) * pageSize, page * pageSize),
      },
    };
  });

  fastify.post('/import/:id/cancel', async (req, reply) => {
    const job = importJobs.cancel(req.params.id);
    if (!job) return reply.code(404).send({ error: 'job_not_found' });
    return jobView(job, { items: false });
  });

  fastify.post('/import/:id/resume', async (req, reply) => {
    const job = importJobs.resume(req.params.id);
    if (!job) return reply.code(404).send({ error: 'job_not_found' });
    return jobView(job, { items: false });
  });

  /**
   * The finished sheet: every comparison this job produced, as the same
   * workbook the rest of the app exports.
   *
   * Rows are derived from the saved comparisons rather than stored on the job,
   * so the export reflects the current taxonomy and recommendation logic — the
   * comparison is the durable artefact, the spreadsheet is a rendering of it.
   */
  fastify.get('/import/:id/export.xlsx', async (req, reply) => {
    const job = importJobs.get(req.params.id);
    if (!job) return reply.code(404).send({ error: 'job_not_found' });

    const rows = [];
    for (const item of job.items) {
      if (item.status !== 'matched' && item.status !== 'no_match') continue;
      const cmp = store.getComparison(item.id);
      if (cmp) rows.push(toExportRow(cmp));
    }
    if (!rows.length) {
      return reply.code(409).send({
        error: 'nothing_to_export',
        message: 'This job has not produced any comparisons yet.',
      });
    }

    rows.sort((a, b) => (b.priceGap ?? -Infinity) - (a.priceGap ?? -Infinity));
    const buffer = await buildWorkbook(rows, {
      filters: { q: `Imported from ${job.filename}` },
      ttlHours: config.reportTtlHours,
    });
    const safe = job.filename.replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename="pricelens-${safe || 'import'}.xlsx"`)
      .send(buffer);
  });
}

/** Job without its (potentially huge) item array, plus derived progress. */
function jobView(job, { items = false } = {}) {
  const { items: rows, ...rest } = job;
  const pct = job.total ? Math.round((job.done / job.total) * 100) : 0;
  // Throughput measured from this run, used for the "about N min left" line.
  const elapsedMs = job.startedAt ? Date.now() - new Date(job.startedAt).getTime() : 0;
  const perItem = job.done > 0 ? elapsedMs / job.done : null;
  const remaining = job.total - job.done;
  return {
    ...rest,
    percent: pct,
    remaining,
    etaSeconds:
      perItem && remaining > 0 && job.status === 'running'
        ? Math.round((perItem * remaining) / 1000)
        : null,
    ...(items ? { items: rows } : {}),
  };
}
