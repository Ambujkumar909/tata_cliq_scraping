import type {
  ProductPage, Comparison, Stats, Insights, MatchReport, ResolveResult, SavedReportPage,
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
};

export const PLATFORM_META = {
  tatacliq: { label: 'Tata CLIQ', short: 'CLIQ', color: '#e11d48', soft: '#fb7185' },
  myntra: { label: 'Myntra', short: 'Myntra', color: '#ff3f6c', soft: '#ff7aa0' },
  ajio: { label: 'Ajio', short: 'Ajio', color: '#2f80ed', soft: '#6fa8ff' },
} as const;
