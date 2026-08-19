/**
 * Upstream response cache — the layer that makes 10k/day affordable and quiet.
 *
 * MEASURED PROBLEM (payload sizes, live):
 *   Myntra HTML search page ... 1,376 KB
 *   Ajio search JSON (40) .....   674 KB
 *   Myntra PDP HTML ...........  ~450 KB
 * A naive 10k-product run pulls ~96 GB/day and fires ~230k requests — which is
 * both unaffordable through any proxy and, far worse, a volume no human browses
 * at. Being blocked is a SYMPTOM of request volume, so volume is what we cut.
 *
 * THREE KEYS, chosen because each collapses many products into one fetch:
 *
 *   search:{host}:{query}   A 10k catalog issues only ~2k DISTINCT queries —
 *                           every U.S. Polo polo asks "us polo assn men polo
 *                           t-shirt". Short TTL: prices ride in search results.
 *   pdp:{host}:{code}       The same competitor product is a candidate for many
 *                           anchors. Specs/fabric/size charts do not move, so a
 *                           long TTL is safe; prices are never read from here.
 *   chart:{brand}:{brick}   Size charts are per BRAND+CATEGORY, not per SKU —
 *                           measured 200 products -> 91 keys. Seasonal TTL.
 *
 * Backed by Redis when available, else an in-process LRU that survives the
 * run. A cache miss must never break a fetch: every failure path returns
 * "not cached" and the caller does what it always did.
 */
import { createHash } from 'node:crypto';
import { persistence } from './persistence.mjs';

// TTLs in seconds. Prices move daily; specs and charts do not.
export const TTL = {
  search: Number(process.env.CACHE_TTL_SEARCH || 12 * 3600),
  pdp: Number(process.env.CACHE_TTL_PDP || 30 * 24 * 3600),
  chart: Number(process.env.CACHE_TTL_CHART || 60 * 24 * 3600),
};

const PREFIX = 'pl:fc';
const MAX_MEM_ENTRIES = Number(process.env.CACHE_MAX_MEM || 5000);

// Long queries make unwieldy keys; hash anything beyond a readable length.
const shortKey = (s) => {
  const t = String(s).toLowerCase().replace(/\s+/g, ' ').trim();
  return t.length <= 80 ? t : createHash('sha1').update(t).digest('hex');
};

export const cacheKey = {
  search: (host, query) => `${PREFIX}:search:${host}:${shortKey(query)}`,
  pdp: (host, code) => `${PREFIX}:pdp:${host}:${code}`,
  chart: (brand, brick) => `${PREFIX}:chart:${shortKey(brand)}:${shortKey(brick || 'any')}`,
};

// In-process fallback (also an L1 in front of Redis): insertion-ordered Map
// doubles as an LRU when we delete-then-set on read.
const mem = new Map();
const stats = { hit: 0, miss: 0, set: 0, bytesSaved: 0 };

function memGet(key) {
  const e = mem.get(key);
  if (!e) return undefined;
  if (e.exp < Date.now()) { mem.delete(key); return undefined; }
  mem.delete(key); mem.set(key, e); // refresh recency
  return e.val;
}

function memSet(key, val, ttlSec) {
  mem.set(key, { val, exp: Date.now() + ttlSec * 1000 });
  while (mem.size > MAX_MEM_ENTRIES) mem.delete(mem.keys().next().value);
}

async function redisClient() {
  // persistence owns the connection; borrow it only when it is actually up.
  return persistence?.backend === 'redis' ? persistence.redis : null;
}

/** Read a cached value, or undefined. Never throws. */
export async function cacheGet(key) {
  const local = memGet(key);
  if (local !== undefined) { stats.hit++; return local; }
  const r = await redisClient();
  if (r) {
    try {
      const raw = await r.get(key);
      if (raw != null) {
        const val = JSON.parse(raw);
        memSet(key, val, 300); // brief L1 so a hot key stops hitting Redis
        stats.hit++;
        return val;
      }
    } catch { /* treat as a miss */ }
  }
  stats.miss++;
  return undefined;
}

/** Store a value. Never throws; a failed write just means a future miss. */
export async function cacheSet(key, val, ttlSec) {
  stats.set++;
  memSet(key, val, ttlSec);
  const r = await redisClient();
  if (r) {
    try { await r.set(key, JSON.stringify(val), { EX: ttlSec }); } catch { /* ignore */ }
  }
}

/**
 * Memoize an upstream call.
 * `estBytes` is the payload size this call would have pulled; it is only used
 * to report how much traffic the cache actually prevented.
 */
export async function cached(key, ttlSec, producer, { estBytes = 0, skip } = {}) {
  const hit = await cacheGet(key);
  if (hit !== undefined) {
    stats.bytesSaved += estBytes;
    return hit;
  }
  const val = await producer();
  // Never cache a failure — a blocked or empty response would otherwise be
  // replayed as fact for the whole TTL.
  if (val != null && !(typeof skip === 'function' && skip(val))) await cacheSet(key, val, ttlSec);
  return val;
}

export const cacheStats = () => ({
  ...stats,
  entries: mem.size,
  hitRate: stats.hit + stats.miss ? Math.round((stats.hit / (stats.hit + stats.miss)) * 100) : 0,
  mbSaved: Math.round((stats.bytesSaved / 1048576) * 10) / 10,
  backend: persistence?.backend === 'redis' ? 'redis+memory' : 'memory',
});

export const resetCacheStats = () => { stats.hit = 0; stats.miss = 0; stats.set = 0; stats.bytesSaved = 0; };
