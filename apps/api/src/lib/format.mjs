/** Shared value formatting for API-side report rendering. */

export function inr(n) {
  if (n == null || Number.isNaN(Number(n))) return null;
  return `₹${Math.round(Number(n)).toLocaleString('en-IN')}`;
}

export function pct(n) {
  if (n == null) return null;
  return `${Math.round(n)}%`;
}

/**
 * A size-chart measurement, which is not always a single number.
 *
 * Tata CLIQ publishes plenty of charts as ranges — `"36 - 38"`, `"66 - 68.6"` —
 * and Myntra ships explicit minValue/maxValue alongside value. Reading either
 * with Number() yields NaN and silently discards the whole chart, so every
 * measurement is normalised to an interval: a plain number becomes [v, v].
 *
 * Returns { value, lo, hi } where `value` is the midpoint (what a single-number
 * display needs) — or null if there is no number in there at all.
 */
export function parseMeasurement(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? { value: raw, lo: raw, hi: raw } : null;
  }
  const nums = String(raw)
    .replace(/[–—]/g, '-')                       // en/em dash → hyphen
    .match(/-?\d+(?:\.\d+)?/g);
  if (!nums?.length) return null;
  const vals = nums.map(Number).filter(Number.isFinite);
  if (!vals.length) return null;
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  return { value: (lo + hi) / 2, lo, hi };
}
