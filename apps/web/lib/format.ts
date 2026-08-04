export function inr(n: number | null | undefined): string {
  if (n == null) return '—';
  return '₹' + Math.round(n).toLocaleString('en-IN');
}

export function pct(n: number | null | undefined): string {
  if (n == null) return '';
  return `${Math.round(n)}%`;
}

/** Normalise possibly-protocol-relative image URLs. */
export function img(url: string | null | undefined): string {
  if (!url) return '';
  if (url.startsWith('//')) return 'https:' + url;
  return url;
}
