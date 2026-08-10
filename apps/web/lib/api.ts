import type {
  ProductPage, Comparison, Stats, Insights, MatchReport, ResolveResult, SavedReportPage,
  ExportFacets, ExportFilters, ExportPreview, ExportFormat,
} from './types';

const BASE =
  process.env.NEXT_PUBLIC_API_BASE ||
  (typeof window !== 'undefined' ? 'http://localhost:4010/api' : 'http://localhost:4010/api');

async function get<T>(path: string, params?: Record<string, string | number | boolean>): Promise<T> {
  const url = new URL(`${BASE}${path}`);
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url.toString(), { cache: 'no-store' });
  if (!res.ok) {
    // Surface the API's own message (e.g. "that isn't a Tata CLIQ product link")
    // instead of a bare status code — these reach the user directly.
    let detail = '';
    try {
      const body = await res.json();
      detail = body?.message || body?.error || '';
    } catch {
      /* non-JSON error body */
    }
    throw new Error(detail || `API ${res.status} on ${path}`);
  }
  return res.json();
}

/**
 * Only a fallback for renders that happen before the API reports its own TTL —
 * REPORT_TTL_HOURS on the API is the source of truth. Keep the two in step.
 */
export const DEFAULT_TTL_HOURS = 168;

export const api = {
  products: (params: {
    q?: string;
    brand?: string;
    page?: number;
    pageSize?: number;
    sort?: string;
    comparedOnly?: boolean;
  }) => get<ProductPage>('/products', params as Record<string, string | number | boolean>),

  product: (id: string, refresh = false) =>
    get<Comparison>(`/products/${id}`, refresh ? { refresh: true } : undefined),

  /** Resolve a pasted Tata CLIQ product link (or bare id) into a comparable product. */
  resolve: (url: string) => get<ResolveResult>('/resolve', { url }),

  report: (id: string, refresh = false) =>
    get<MatchReport>(`/products/${id}/report`, refresh ? { refresh: true } : undefined),

  /** Every comparison already generated and saved, newest first. */
  savedReports: (params: { q?: string; page?: number; pageSize?: number; freshOnly?: boolean } = {}) =>
    get<SavedReportPage>('/reports', params as Record<string, string | number | boolean>),

  stats: () => get<Stats>('/stats'),

  insights: (limit = 12) => get<Insights>('/insights', { limit }),

  /** Filter values that actually have saved comparisons behind them. */
  exportFacets: () => get<ExportFacets>('/export/facets'),

  /** How many rows a filter set selects — asked before building the file. */
  exportPreview: (filters: Partial<ExportFilters>) =>
    get<ExportPreview>(`/export/preview?${exportQuery(filters)}`),

  /**
   * The download URL for either format. Handed to the browser as a plain
   * navigation rather than fetched: the browser then handles the download, the
   * progress and the filename from Content-Disposition, none of which is worth
   * reimplementing.
   */
  exportUrl: (filters: Partial<ExportFilters>, format: ExportFormat = 'xlsx') =>
    `${BASE}/export/comparisons.${format}?${exportQuery(filters)}`,
};

/** Serialise export filters. Repeated keys, so values may contain commas. */
export function exportQuery(f: Partial<ExportFilters>): string {
  const p = new URLSearchParams();
  if (f.q) p.set('q', f.q);
  for (const c of f.categories ?? []) p.append('category', c);
  for (const g of f.genders ?? []) p.append('gender', g);
  for (const b of f.brands ?? []) p.append('brand', b);
  if (f.position && f.position !== 'all') p.set('position', f.position);
  if (f.matched && f.matched !== 'all') p.set('matched', f.matched);
  if (f.freshOnly) p.set('freshOnly', 'true');
  if (f.minPrice != null) p.set('minPrice', String(f.minPrice));
  if (f.maxPrice != null) p.set('maxPrice', String(f.maxPrice));
  return p.toString();
}

export const PLATFORM_META = {
  tatacliq: { label: 'Tata CLIQ', short: 'CLIQ', color: '#e11d48', soft: '#fb7185' },
  myntra: { label: 'Myntra', short: 'Myntra', color: '#ff3f6c', soft: '#ff7aa0' },
  ajio: { label: 'Ajio', short: 'Ajio', color: '#2f80ed', soft: '#6fa8ff' },
} as const;
