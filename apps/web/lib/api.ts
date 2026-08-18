import type {
  ProductPage, Comparison, Stats, Insights, MatchReport, ResolveResult, SavedReportPage,
  RecentSearchPage, ExportFacets, ExportFilters, ExportPreview, ExportFormat,
  ImportJob, ImportPreview,
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

/** Shared error unwrapping for non-GET calls. */
async function fail(res: Response, path: string): Promise<never> {
  let detail = '';
  try {
    const body = await res.json();
    detail = body?.message || body?.error || '';
  } catch {
    /* non-JSON error body */
  }
  throw new Error(detail || `API ${res.status} on ${path}`);
}

async function post<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: 'POST' });
  if (!res.ok) await fail(res, path);
  return res.json();
}

/**
 * Send a spreadsheet as a raw body.
 *
 * Not multipart: the payload is exactly one file, so wrapping it in form
 * boundaries only adds a parser on the far end. The filename rides in the
 * query string because that is all the server needs from it.
 */
async function upload<T>(file: File, dryRun: boolean): Promise<T> {
  const qs = new URLSearchParams({ filename: file.name });
  if (dryRun) qs.set('dryRun', 'true');
  const res = await fetch(`${BASE}/import?${qs}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: file,
  });
  if (!res.ok) await fail(res, '/import');
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

  /**
   * Fire-and-forget match warm-up, sent on card hover. The server dedupes, so
   * the click that follows joins the already-running match instead of starting
   * a cold one. Never throws — a failed prefetch just means a normal load.
   */
  prefetch: (id: string) => {
    fetch(`${BASE}/products/${id}/prefetch`, { method: 'POST' }).catch(() => {});
  },

  /** Every comparison already generated and saved, newest first. */
  savedReports: (params: { q?: string; page?: number; pageSize?: number; freshOnly?: boolean } = {}) =>
    get<SavedReportPage>('/reports', params as Record<string, string | number | boolean>),

  /** Products looked up by link inside the recency window, newest first. */
  recent: (limit?: number) =>
    get<RecentSearchPage>('/recent', limit ? { limit } : undefined),

  /** Unpin one recent search. The saved comparison survives. */
  forgetRecent: async (id: string) => {
    const res = await fetch(`${BASE}/recent/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`API ${res.status} on /recent/${id}`);
  },

  // ── Bulk import ────────────────────────────────────────────
  /**
   * Parse a sheet WITHOUT scraping, so the user can confirm we read it
   * correctly before committing to a run that may take hours.
   */
  importPreview: (file: File) => upload<ImportPreview>(file, true),

  /** Upload for real. Returns immediately with a job to poll. */
  importStart: (file: File) => upload<ImportJob>(file, false),

  importJobs: (limit = 20) => get<{ total: number; jobs: ImportJob[] }>('/import', { limit }),

  importJob: (
    id: string,
    opts: { items?: boolean; page?: number; pageSize?: number; filter?: string } = {},
  ) => get<ImportJob>(`/import/${id}`, opts as Record<string, string | number | boolean>),

  importCancel: (id: string) => post<ImportJob>(`/import/${id}/cancel`),
  importResume: (id: string) => post<ImportJob>(`/import/${id}/resume`),

  importExportUrl: (id: string) => `${BASE}/import/${id}/export.xlsx`,

  /** A blank sheet in the shape we accept, with worked examples. */
  importTemplateUrl: () => `${BASE}/import/template.xlsx`,

  stats: () => get<Stats>('/stats'),

  insights: (limit = 12) => get<Insights>('/insights', { limit }),

  /**
   * Filter values with counts. Pass the current filter set and each count comes
   * back as what that value would select alongside everything else already
   * chosen — the counts move as the panel is narrowed.
   */
  exportFacets: (filters: Partial<ExportFilters> = {}) =>
    get<ExportFacets>(`/export/facets?${exportQuery(filters)}`),

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
  for (const s of f.sizes ?? []) p.append('size', s);
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
