/**
 * Bulk import jobs — thousands of pasted links, processed in the background.
 *
 * A single comparison costs ~5s of scraping and image hashing, so a 5,000-row
 * sheet is a multi-hour job, not a request. That shapes everything here:
 *
 *   - The upload returns a job id immediately; the work happens after.
 *   - Progress is persisted, so a browser refresh (or a redeploy) does not lose
 *     the run. A job left 'running' when the process died is requeued on boot.
 *   - Every row is isolated: one dead product id must not abort 4,999 others.
 *   - Cache first. Re-uploading last week's sheet should mostly replay saved
 *     comparisons rather than re-scrape a storefront we already asked.
 *   - Bounded concurrency, because the constraint is Myntra's and Ajio's
 *     patience, not our CPU.
 */
import { store } from '../store.mjs';
import { matchAnchor } from '../matching/matcher.mjs';
import { resolveOrFetchAnchor, anchorErrorMessage } from '../lib/anchor.mjs';
import { persistence } from '../cache/persistence.mjs';
import { config } from '../config.mjs';

const newId = () =>
  `imp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** Competitor product id out of a supplied hint URL, for agreement checking. */
function hintId(platform, url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (platform === 'myntra') return u.pathname.match(/\/(\d+)\/buy/)?.[1] || null;
    if (platform === 'ajio') return u.pathname.match(/\/p\/(\w+)/)?.[1] || null;
  } catch { /* not a URL */ }
  return null;
}

class ImportJobs {
  constructor() {
    this.jobs = new Map(); // id -> job
    this.running = new Set(); // job ids with an active worker loop
  }

  /** Replay saved jobs, and restart anything the last process died mid-way. */
  async init() {
    for (const job of await persistence.loadJobs()) this.jobs.set(job.id, job);
    const stalled = [...this.jobs.values()].filter((j) => j.status === 'running');
    for (const job of stalled) {
      job.status = 'queued';
      job.note = 'Resumed after an API restart.';
      this.start(job.id);
    }
    if (this.jobs.size) {
      console.log(`[import] ${this.jobs.size} jobs restored${stalled.length ? `, ${stalled.length} resumed` : ''}`);
    }
  }

  create({ filename, parsed }) {
    const job = {
      id: newId(),
      filename,
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      status: 'queued',
      rowsScanned: parsed.rowsScanned,
      linksFound: parsed.linksFound,
      duplicates: parsed.duplicates,
      total: parsed.total,
      done: 0,
      matched: 0,
      noMatch: 0,
      failed: 0,
      fromCache: 0,
      hintAgreed: 0,
      hintDisagreed: 0,
      concurrency: config.importConcurrency,
      items: parsed.items.map((i) => ({
        id: i.id,
        sheet: i.sheet,
        row: i.row,
        sourceRows: i.sourceRows,
        hints: i.hints,
        state: 'pending', // pending | done | error
        status: null, // matched | no_match | error
        error: null,
        cached: false,
        agreement: null, // agreed | disagreed | null (no hint)
      })),
    };
    this.jobs.set(job.id, job);
    this._persist(job);
    return job;
  }

  get(id) {
    return this.jobs.get(id) || null;
  }

  /** Newest first. Items are stripped — the list view never needs 10k rows. */
  list({ limit = 20 } = {}) {
    const jobs = [...this.jobs.values()]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit)
      .map(({ items, ...j }) => ({ ...j, pending: items.filter((i) => i.state === 'pending').length }));
    return { total: this.jobs.size, jobs };
  }

  cancel(id) {
    const job = this.jobs.get(id);
    if (!job) return null;
    if (job.status === 'running' || job.status === 'queued') {
      job.status = 'cancelled';
      job.finishedAt = new Date().toISOString();
      this._persist(job);
    }
    return job;
  }

  /** Re-queue a cancelled or finished job for whatever is still pending. */
  resume(id) {
    const job = this.jobs.get(id);
    if (!job) return null;
    if (job.items.some((i) => i.state === 'pending')) {
      job.status = 'queued';
      job.finishedAt = null;
      this.start(id);
    }
    return job;
  }

  /**
   * Kick off (or resume) processing. Returns immediately — the worker loop runs
   * detached, and progress is read back through get().
   */
  start(id) {
    const job = this.jobs.get(id);
    if (!job || this.running.has(id)) return job;
    if (job.status === 'done' || job.status === 'cancelled') return job;

    this.running.add(id);
    job.status = 'running';
    job.startedAt = job.startedAt || new Date().toISOString();

    this._run(job)
      .catch((err) => {
        job.status = 'failed';
        job.error = err.message;
        console.error('[import] job failed:', err);
      })
      .finally(() => {
        this.running.delete(id);
        job.finishedAt = job.finishedAt || new Date().toISOString();
        if (job.status === 'running') {
          job.status = job.items.some((i) => i.state === 'pending') ? 'cancelled' : 'done';
        }
        this._persist(job, true);
        console.log(
          `[import] ${job.id} ${job.status} — ${job.matched} matched, ${job.noMatch} no-match, ` +
            `${job.failed} failed, ${job.fromCache} from cache`,
        );
      });

    return job;
  }

  /** Bounded-concurrency worker pool over the job's pending items. */
  async _run(job) {
    const queue = job.items.filter((i) => i.state === 'pending');
    let cursor = 0;
    let sinceFlush = 0;

    const worker = async () => {
      while (cursor < queue.length) {
        // Re-read status each iteration so a cancel takes effect promptly
        // rather than at the end of the sheet.
        if (job.status === 'cancelled') return;
        const item = queue[cursor++];
        await this._processItem(job, item);
        job.done++;
        // Checkpoint periodically: often enough that a crash costs little,
        // rarely enough that a 10k job is not 10k cache writes.
        if (++sinceFlush >= 25) { sinceFlush = 0; this._persist(job); }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(job.concurrency, queue.length || 1) }, worker),
    );
  }

  async _processItem(job, item) {
    try {
      const res = await resolveOrFetchAnchor(item.id);
      if (!res.ok) {
        item.state = 'error';
        item.status = 'error';
        item.error = anchorErrorMessage(item.id, res.reason);
        job.failed++;
        return;
      }
      const anchor = res.anchor;
      item.brand = anchor.brand;
      item.title = anchor.title;

      // Cache first — a comparison still inside its TTL is a replay, not a scrape.
      let cmp = await store.getFreshComparison(item.id);
      if (cmp) {
        item.cached = true;
        job.fromCache++;
      } else {
        cmp = await matchAnchor(anchor, {
          minScore: config.matchMinScore,
          strictSku: config.strictSku,
        });
        store.setComparison(item.id, cmp);
      }

      // An imported product is a compared product, so it belongs in the recent
      // strip alongside pasted links. The strip is capped at `recentLimit`, so
      // a 10k import surfaces its most recent rows rather than 10k cards.
      store.markRecent(item.id);

      const matchedCount = cmp.summary?.matchedCount ?? 0;
      item.state = 'done';
      item.status = matchedCount > 0 ? 'matched' : 'no_match';
      item.matchedCount = matchedCount;
      item.prices = cmp.summary?.prices ?? {};
      if (matchedCount > 0) job.matched++;
      else job.noMatch++;

      // Did the engine independently land on the URL the sheet supplied?
      this._checkHints(job, item, cmp);
    } catch (err) {
      item.state = 'error';
      item.status = 'error';
      item.error = err.message;
      job.failed++;
    }
  }

  /**
   * Compare our match against any competitor URL the sheet named.
   *
   * This is free evidence: the client's own sheet is ground truth, so a
   * disagreement is a matcher bug worth seeing, and an agreement is proof the
   * engine works on their data rather than ours.
   */
  _checkHints(job, item, cmp) {
    const platforms = Object.keys(item.hints || {}).filter((p) => p === 'myntra' || p === 'ajio');
    if (!platforms.length) return;

    let agreed = null;
    for (const p of platforms) {
      const expected = hintId(p, item.hints[p]);
      const got = cmp.competitors?.[p];
      if (!expected || got?.status !== 'matched' || !got.product?.id) continue;
      const same = String(got.product.id) === String(expected);
      agreed = agreed === false ? false : same;
    }
    if (agreed === null) return;
    item.agreement = agreed ? 'agreed' : 'disagreed';
    if (agreed) job.hintAgreed++;
    else job.hintDisagreed++;
  }

  _persist(job, immediate = false) {
    persistence.saveJob(job, immediate).catch(() => {});
  }
}

export const importJobs = new ImportJobs();
