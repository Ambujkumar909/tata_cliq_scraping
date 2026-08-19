/**
 * Per-host request pacing — the difference between "a customer browsing" and
 * "a bot worth blocking".
 *
 * WHY THIS EXISTS
 * Blocking is driven by RATE and REGULARITY, not by intent. Two clients pulling
 * the same 14k pages a day look completely different to Akamai: one arrives in
 * a machine-gun burst on a fixed 200ms cadence, the other trickles with human
 * variance. We measured both failure modes on this project — Myntra tarpitted a
 * client after ~17 matches in a minute, and Ajio denied a browser profile after
 * a burst — so pacing is not politeness, it is the thing that keeps the pipe
 * open.
 *
 * THREE PROPERTIES, each mimicking a real person:
 *   1. TOKEN BUCKET  a sustained ceiling per host, with a small burst allowance
 *                    (people do click two things quickly, then pause).
 *   2. JITTER        never the same gap twice. A fixed interval is the single
 *                    most machine-looking signal there is.
 *   3. ADAPTIVE      a 403/429/tarpit halves the rate for a cooldown and it
 *                    recovers gradually — the way a cautious human would back
 *                    off, and what stops one bad minute from becoming a ban.
 *
 * After the fetch-cache layer the real load is ~0.16 req/s, so these limits are
 * generous headroom rather than a throttle you will feel.
 */

const DEFAULTS = {
  ratePerSec: Number(process.env.PACE_RATE || 0.5), // sustained ceiling
  burst: Number(process.env.PACE_BURST || 3), // tokens available immediately
  minGapMs: Number(process.env.PACE_MIN_GAP || 350), // floor between calls
  jitterMs: Number(process.env.PACE_JITTER || 900), // random extra, 0..jitter
};

const PENALTY_MS = 5 * 60 * 1000; // how long a slow-down lasts

const hosts = new Map();

function hostState(host) {
  let s = hosts.get(host);
  if (!s) {
    s = { tokens: DEFAULTS.burst, last: Date.now(), penaltyUntil: 0, factor: 1, waits: 0, waitedMs: 0 };
    hosts.set(host, s);
  }
  return s;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'unknown'; } };

/**
 * Wait until this host may be called again. Always resolves; the only cost is
 * time. Call immediately before the fetch it governs.
 */
export async function pace(url) {
  const host = hostOf(url);
  const s = hostState(host);

  // Refill by elapsed time, at the (possibly penalised) rate.
  const now = Date.now();
  const rate = DEFAULTS.ratePerSec * (now < s.penaltyUntil ? 0.5 : s.factor);
  s.tokens = Math.min(DEFAULTS.burst, s.tokens + ((now - s.last) / 1000) * rate);
  s.last = now;

  if (s.tokens < 1) {
    const needSec = (1 - s.tokens) / rate;
    const waitMs = Math.ceil(needSec * 1000);
    s.waits++; s.waitedMs += waitMs;
    await sleep(waitMs);
    s.tokens = 0;
  } else {
    s.tokens -= 1;
  }

  // Human variance on every single call — never a fixed cadence.
  const jitter = DEFAULTS.minGapMs + Math.random() * DEFAULTS.jitterMs;
  await sleep(jitter);
  s.waitedMs += jitter;
}

/**
 * Report a hostile response (403/429/tarpit). Halves throughput for a cooldown
 * so one bad minute cannot escalate into a ban.
 */
export function penalize(url, reason = 'blocked') {
  const host = hostOf(url);
  const s = hostState(host);
  s.penaltyUntil = Date.now() + PENALTY_MS;
  s.factor = Math.max(0.25, s.factor * 0.5);
  console.warn(`[pacer] ${host} slowed (${reason}) — rate x${s.factor.toFixed(2)} for 5 min`);
}

/** Report a clean response, letting the rate creep back toward normal. */
export function reward(url) {
  const s = hostState(hostOf(url));
  if (s.factor < 1 && Date.now() > s.penaltyUntil) s.factor = Math.min(1, s.factor * 1.15);
}

export const pacerStats = () =>
  Object.fromEntries([...hosts.entries()].map(([h, s]) => [h,
    { factor: Number(s.factor.toFixed(2)), penalised: Date.now() < s.penaltyUntil, waits: s.waits, waitedSec: Math.round(s.waitedMs / 100) / 10 }]));
