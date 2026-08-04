/** Shared value formatting for API-side report rendering. */

export function inr(n) {
  if (n == null || Number.isNaN(Number(n))) return null;
  return `₹${Math.round(Number(n)).toLocaleString('en-IN')}`;
}

export function pct(n) {
  if (n == null) return null;
  return `${Math.round(n)}%`;
}
