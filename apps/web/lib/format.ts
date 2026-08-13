export function inr(n: number | null | undefined): string {
  if (n == null) return '—';
  return '₹' + Math.round(n).toLocaleString('en-IN');
}

export function pct(n: number | null | undefined): string {
  if (n == null) return '';
  return `${Math.round(n)}%`;
}

/**
 * "12 min ago" from an exact ISO timestamp.
 *
 * Deliberately reads `matchedAt`/`searchedAt` rather than the API's `ageHours`:
 * that field is rounded to one decimal for display elsewhere, and multiplying a
 * 0.1-hour-resolution number back up to minutes quantises the answer to
 * 6-minute steps — a comparison made 4 minutes ago rendered as "6 min ago".
 * The precise instant is already on the wire, so use it.
 */
export function since(iso: string | null | undefined): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return '—';
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'moments ago';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

/** Normalise possibly-protocol-relative image URLs. */
export function img(url: string | null | undefined): string {
  if (!url) return '';
  if (url.startsWith('//')) return 'https:' + url;
  return url;
}
