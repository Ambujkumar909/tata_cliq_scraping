/**
 * Ajio size-chart harvester — collects charts by BRAND+CATEGORY, slowly.
 *
 * THE INSIGHT THAT MAKES THIS SAFE
 * Size charts are not per-SKU. Ajio keys them by brandCode+brickCode, so every
 * AD by Arvind slim jean shares one chart (measured: 200 products collapse to
 * 91 charts). A 10k catalogue therefore needs roughly 1,400 chart fetches, not
 * 10,000 — and once fetched a chart is good for a season.
 *
 * So we stop asking for charts on demand and let them ACCUMULATE:
 *
 *   · walk the distinct brand+category list, never the product list
 *   · one fetch every ~40 s — a slower cadence than a person browsing
 *   · cache each for 60 days
 *   · priority order: the chart that unlocks the most products goes first
 *
 * WHY THIS BEATS FETCH-ON-DEMAND
 * On-demand needs a healthy browser session at the exact moment a user opens a
 * report, and hammers Ajio at import speed — which is what got the session
 * denied in testing. Harvesting is indifferent to timing: if Ajio refuses, the
 * harvester simply sleeps and retries later, and no import, report or user
 * request is ever blocked by it. Coverage grows toward complete over days and
 * stays warm for two months.
 *
 * Credentials are deliberately not involved. Akamai's token gates on browser
 * authenticity, not on being logged in, so an account would add risk (a
 * bannable identity, clearer ToS exposure, a permanent fingerprint) and buy
 * nothing.
 */
import { config } from '../config.mjs';
import { cacheGet, cacheSet, cacheKey, TTL } from '../cache/fetch-cache.mjs';
import { searchAjio } from './ajio.mjs';
import { ajioPdpFetch, ajioBrowserEnabled } from './ajio-session.mjs';

const log = (m) => console.log(`[chart-harvest] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Human jitter: a fixed cadence is the most machine-looking signal there is.
const gap = () => config.chartHarvestGapMs * (0.7 + Math.random() * 0.6);

const queue = new Map(); // key -> { brand, garment, want, tries }
const state = { running: false, harvested: 0, failed: 0, skipped: 0, startedAt: null, last: null };

const keyOf = (brand, garment) => `${String(brand || '').toLowerCase().trim()}|${String(garment || 'any').toLowerCase().trim()}`;

/**
 * Register demand for a chart. Called wherever a product is seen (import,
 * catalog load) — cheap, synchronous, deduplicating.
 */
export function wantChart(brand, garment) {
  if (!brand) return;
  const k = keyOf(brand, garment);
  const e = queue.get(k);
  if (e) e.want++;
  else queue.set(k, { brand, garment, want: 1, tries: 0 });
}

/** Chart for a brand+category, or null. Served from cache; never fetches. */
export async function getChart(brand, garment) {
  if (!brand) return null;
  const hit = await cacheGet(cacheKey.chart(brand, garment));
  return hit ?? null;
}

/**
 * Harvest ONE chart: find a representative product for the brand+category,
 * read its PDP through the browser session, store the chart under the shared
 * key. Returns 'ok' | 'miss' | 'blocked'.
 */
async function harvestOne(entry) {
  const { brand, garment } = entry;
  const ck = cacheKey.chart(brand, garment);
  if ((await cacheGet(ck)) !== undefined) return 'ok'; // already have it

  const res = await searchAjio(`${brand} ${garment || ''}`.trim(), { limit: 5 });
  const candidate = (res.candidates || []).find((c) => c.url && c.id);
  if (!candidate) {
    // Nothing to represent this pair — cache the negative briefly so the queue
    // stops retrying a brand Ajio simply does not carry.
    await cacheSet(ck, null, 24 * 3600);
    return 'miss';
  }

  const data = await ajioPdpFetch(candidate.id, candidate.url);
  if (!data) return 'blocked'; // session unhealthy — retry later, do not burn the entry

  const raw = data?.fnlColorVariantData?.sizeGuideDesktop;
  if (typeof raw !== 'string' || !raw.includes('sizechart')) {
    await cacheSet(ck, null, 7 * 24 * 3600); // this brand publishes no chart
    return 'miss';
  }
  await cacheSet(ck, { raw, brand, garment, source: candidate.url, at: new Date().toISOString() }, TTL.chart);
  return 'ok';
}

/**
 * Run the harvester until the queue drains. Highest-demand charts first, so
 * coverage of PRODUCTS rises fastest.
 */
export async function runHarvester({ max = Infinity } = {}) {
  if (state.running) return state;
  if (!config.chartHarvest || !ajioBrowserEnabled()) {
    log('disabled (needs CHART_HARVEST=true and AJIO_BROWSER_COOKIES=true)');
    return state;
  }
  state.running = true;
  state.startedAt = new Date().toISOString();
  log(`starting — ${queue.size} charts queued, ~${Math.round(config.chartHarvestGapMs / 1000)}s apart`);

  try {
    let done = 0;
    let blockedStreak = 0;
    while (done < max) {
      const pending = [...queue.entries()].filter(([, e]) => e.tries < 3).sort((a, b) => b[1].want - a[1].want);
      if (!pending.length) break;
      const [k, entry] = pending[0];
      entry.tries++;

      let outcome = 'blocked';
      try { outcome = await harvestOne(entry); } catch (err) { log(`error on ${k}: ${err.message}`); }

      if (outcome === 'ok') { queue.delete(k); state.harvested++; blockedStreak = 0; }
      else if (outcome === 'miss') { queue.delete(k); state.skipped++; blockedStreak = 0; }
      else {
        state.failed++;
        blockedStreak++;
        // Ajio is refusing right now. Back off hard rather than hammering —
        // the whole point of harvesting is that we can afford to wait.
        if (blockedStreak >= 3) { log('session refused 3x — pausing 10 min'); await sleep(600_000); blockedStreak = 0; }
      }
      state.last = { key: k, outcome, at: new Date().toISOString() };
      done++;
      await sleep(gap());
    }
  } finally {
    state.running = false;
    log(`stopped — harvested ${state.harvested}, skipped ${state.skipped}, blocked ${state.failed}, ${queue.size} left`);
  }
  return state;
}

export const harvesterStats = () => ({
  ...state,
  queued: queue.size,
  topWanted: [...queue.values()].sort((a, b) => b.want - a.want).slice(0, 5)
    .map((e) => `${e.brand}|${e.garment} (${e.want})`),
});
