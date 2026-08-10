/**
 * Durable comparison cache.
 *
 * A live match costs several scrapes (CLIQ PDP + Myntra + Ajio search and
 * detail tiers) and a few seconds of image hashing, so a comparison that has
 * already been computed must survive an API restart, a container rebuild and a
 * redeploy — not just the lifetime of one process.
 *
 * Storage is Redis when reachable (the compose stack already runs it on a named
 * volume, and per-key TTLs expire stale prices without a sweeper), falling back
 * to a JSON snapshot on disk so `npm run dev` without docker still persists.
 * Both are strictly a cache: losing them costs time, never correctness.
 */
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createClient } from 'redis';
import { config } from '../config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Separate from data/, which holds the build-time catalog: the cache is
// mutable runtime state and gets its own volume in docker.
const CACHE_DIR = process.env.CACHE_DIR || resolve(__dirname, '..', '..', 'data');
const SNAPSHOT = resolve(CACHE_DIR, 'comparison-cache.json');

const PREFIX = 'pricelens';
const CMP_KEY = (fp, id) => `${PREFIX}:cmp:${fp}:${id}`;
const ANCHOR_KEY = (id) => `${PREFIX}:anchor:${id}`;

/**
 * Cached results are only reusable while the inputs that produced them hold.
 * The fingerprint pins the matcher's identity rules AND its tuning knobs, so
 * flipping STRICT_SKU or MATCH_MIN_SCORE re-matches instead of serving verdicts
 * the current configuration would never have reached. Bump MATCHER_VERSION
 * whenever matcher/evidence logic changes in a way that alters verdicts.
 */
// v5: anchor gender comes from the CLIQ PDP (gender field / breadcrumb) instead
// of the category code's first letter. That changes which candidates survive the
// gender gate and what is sent to the competitor search, so every v4 comparison
// is a verdict the current engine would not necessarily reach — orphan them.
export const MATCHER_VERSION = 'v5';
export const fingerprint = () =>
  `${MATCHER_VERSION}-s${config.strictSku ? 1 : 0}-m${String(config.matchMinScore).replace('.', '')}`;

/** A saved comparison older than the TTL is stale: prices move. */
export const isFresh = (cmp) => {
  if (!cmp?.matchedAt) return false;
  const age = Date.now() - new Date(cmp.matchedAt).getTime();
  return Number.isFinite(age) && age >= 0 && age < config.reportTtlHours * 3600_000;
};

export const ageHours = (cmp) =>
  cmp?.matchedAt ? (Date.now() - new Date(cmp.matchedAt).getTime()) / 3600_000 : null;

class Persistence {
  constructor() {
    this.redis = null;
    this.backend = 'none'; // 'redis' | 'file' | 'none'
    this.snapshot = new Map(); // id -> cmp   (file backend only)
    this.anchors = new Map(); // id -> anchor (file backend only)
    this.flushTimer = null;
    this.writes = 0;
  }

  /**
   * Never throws and never blocks startup: an unreachable Redis degrades to the
   * file snapshot, and an unwritable disk degrades to memory-only. A cache that
   * takes the API down with it would be worse than no cache.
   */
  async init() {
    const url = process.env.REDIS_URL;
    if (url) {
      try {
        const client = createClient({
          url,
          socket: { connectTimeout: 3000, reconnectStrategy: (n) => (n > 5 ? false : Math.min(n * 200, 2000)) },
        });
        // Post-connect errors (server restart, network blip) must not crash the
        // process — the reconnect strategy handles recovery.
        client.on('error', (err) => {
          if (this.backend === 'redis') console.warn('[cache] redis error:', err.message);
        });
        await client.connect();
        await client.ping();
        this.redis = client;
        this.backend = 'redis';
        console.log(`[cache] redis connected — comparisons persist for ${config.reportTtlHours}h`);
        return;
      } catch (err) {
        console.warn(`[cache] redis unavailable (${err.message}) — falling back to file snapshot`);
      }
    }
    await this._loadSnapshot();
    this.backend = 'file';
    console.log(`[cache] file snapshot at ${SNAPSHOT} (${this.snapshot.size} entries)`);
  }

  async _loadSnapshot() {
    if (!existsSync(SNAPSHOT)) return;
    try {
      const raw = JSON.parse(await readFile(SNAPSHOT, 'utf8'));
      if (raw.fingerprint !== fingerprint()) {
        console.log('[cache] snapshot fingerprint changed — discarding stale comparisons');
        return;
      }
      for (const [id, cmp] of Object.entries(raw.comparisons || {})) this.snapshot.set(id, cmp);
      for (const [id, a] of Object.entries(raw.anchors || {})) this.anchors.set(id, a);
    } catch (err) {
      console.warn('[cache] snapshot unreadable — starting cold:', err.message);
    }
  }

  /** Debounced so a batch match writes once, not once per product. */
  _scheduleFlush() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush().catch((err) => console.warn('[cache] snapshot write failed:', err.message));
    }, 2000);
    this.flushTimer.unref?.();
  }

  async flush() {
    if (this.backend !== 'file' || !this.snapshot.size) return;
    await mkdir(CACHE_DIR, { recursive: true });
    const body = JSON.stringify({
      fingerprint: fingerprint(),
      savedAt: new Date().toISOString(),
      comparisons: Object.fromEntries(this.snapshot),
      anchors: Object.fromEntries(this.anchors),
    });
    // tmp + rename: a crash mid-write must not truncate a good snapshot.
    const tmp = `${SNAPSHOT}.tmp`;
    await writeFile(tmp, body, 'utf8');
    await rename(tmp, SNAPSHOT);
  }

  // ── Comparisons ────────────────────────────────────────────────
  async save(id, cmp) {
    this.writes++;
    if (this.backend === 'redis') {
      try {
        await this.redis.set(CMP_KEY(fingerprint(), id), JSON.stringify(cmp), {
          EX: Math.round(config.reportTtlHours * 3600),
        });
      } catch (err) {
        console.warn('[cache] save failed:', err.message);
      }
      return;
    }
    this.snapshot.set(id, cmp);
    this._scheduleFlush();
  }

  async load(id) {
    if (this.backend === 'redis') {
      try {
        const raw = await this.redis.get(CMP_KEY(fingerprint(), id));
        return raw ? JSON.parse(raw) : null;
      } catch (err) {
        console.warn('[cache] load failed:', err.message);
        return null;
      }
    }
    return this.snapshot.get(id) || null;
  }

  /**
   * Warm the in-memory store on boot so the catalog grid shows its comparison
   * badges immediately. Bounded: the dashboard only needs the working set, and
   * anything missed is still served by load() on the individual product route.
   */
  async hydrate({ limit = 5000 } = {}) {
    const out = [];
    if (this.backend === 'redis') {
      try {
        const prefix = CMP_KEY(fingerprint(), '');
        const keys = [];
        for await (const key of this.redis.scanIterator({ MATCH: `${prefix}*`, COUNT: 500 })) {
          keys.push(key);
          if (keys.length >= limit) break;
        }
        for (let i = 0; i < keys.length; i += 200) {
          const chunk = keys.slice(i, i + 200);
          const vals = await this.redis.mGet(chunk);
          for (const raw of vals) {
            if (!raw) continue;
            try {
              const cmp = JSON.parse(raw);
              if (cmp?.anchor?.id) out.push(cmp);
            } catch { /* skip corrupt entry */ }
          }
        }
      } catch (err) {
        console.warn('[cache] hydrate failed:', err.message);
      }
      return out;
    }
    for (const cmp of this.snapshot.values()) {
      if (out.length >= limit) break;
      if (cmp?.anchor?.id) out.push(cmp);
    }
    return out;
  }

  // ── Ad-hoc anchors ─────────────────────────────────────────────
  // A product pasted as a URL lives only in memory, so without this its saved
  // report would 404 after a restart — the id would resolve to nothing.
  async saveAnchor(anchor) {
    if (!anchor?.id) return;
    if (this.backend === 'redis') {
      try {
        await this.redis.set(ANCHOR_KEY(anchor.id), JSON.stringify(anchor), {
          EX: Math.round(Math.max(config.reportTtlHours, 24 * 30) * 3600),
        });
      } catch (err) {
        console.warn('[cache] anchor save failed:', err.message);
      }
      return;
    }
    this.anchors.set(anchor.id, anchor);
    this._scheduleFlush();
  }

  async loadAnchor(id) {
    if (this.backend === 'redis') {
      try {
        const raw = await this.redis.get(ANCHOR_KEY(id));
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    }
    return this.anchors.get(id) || null;
  }

  async stats() {
    let stored = null;
    if (this.backend === 'redis') {
      try {
        let n = 0;
        for await (const _ of this.redis.scanIterator({ MATCH: `${CMP_KEY(fingerprint(), '')}*`, COUNT: 500 })) n++;
        stored = n;
      } catch { /* leave null */ }
    } else if (this.backend === 'file') {
      stored = this.snapshot.size;
    }
    return { backend: this.backend, stored, ttlHours: config.reportTtlHours, fingerprint: fingerprint() };
  }

  async close() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    await this.flush().catch(() => {});
    if (this.redis) await this.redis.quit().catch(() => {});
  }
}

export const persistence = new Persistence();
