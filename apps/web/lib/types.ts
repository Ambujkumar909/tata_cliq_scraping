export type Platform = 'tatacliq' | 'myntra' | 'ajio';

export interface ComparisonSummary {
  matchedCount: number;
  prices: Partial<Record<Platform, number>>;
  cheapest: { platform: Platform; price: number } | null;
  matchedAt: string;
}

export interface ProductListItem {
  id: string;
  brand: string;
  title: string;
  color: string | null;
  mrp: number | null;
  price: number | null;
  currency: string;
  discountPercent: number | null;
  rating: number | null;
  ratingCount: number | null;
  image: string | null;
  url: string | null;
  category?: { l1: string | null; l2: string | null; l3: string | null };
  comparison: ComparisonSummary | null;
}

export interface CompetitorProduct {
  id: string;
  brand: string;
  title: string;
  color: string | null;
  mrp: number | null;
  price: number | null;
  currency: string;
  discountPercent: number | null;
  rating: number | null;
  ratingCount: number | null;
  image: string | null;
  url: string | null;
  sizes: string[];
  inventory: { size: string; available: boolean; count: number | null }[];
}

export interface ImageCheck {
  deltaE: number | null;
  colorConfirmed: boolean | null;
}

export interface AmbiguousCandidate {
  title: string;
  brand: string;
  price: number | null;
  mrp: number | null;
  color: string | null;
  url: string | null;
  image: string | null;
  score: number | null;
}

export interface CompetitorMatch {
  status: 'matched' | 'no_match' | 'color_mismatch' | 'no_results' | 'blocked' | 'error' | 'ambiguous';
  /** Populated when status is 'ambiguous': near-tied candidates with differing prices. */
  candidates?: AmbiguousCandidate[];
  rejectedBy?: string;
  query?: string;
  score?: number;
  colorDiffers?: boolean;
  imageCheck?: ImageCheck;
  reasons?: Record<string, any>;
  product?: CompetitorProduct;
  nearest?: { brand: string; title: string; price: number | null; score?: number };
  reason?: string;
}

export interface Comparison {
  anchor: ProductListItem & { styleCode?: string | null };
  competitors: Record<'myntra' | 'ajio', CompetitorMatch>;
  summary: ComparisonSummary;
  matchedAt: string;
}

export interface Stats {
  products: number;
  brands: number;
  comparisons: number;
  cliqCheapest: number;
  cliqCheapestPct: number;
  positioning: { win: number; tie: number; lose: number; total: number; avgUndercut: number };
  topBrands: { name: string; count: number }[];
  loadedAt: string;
}

export interface InsightRow {
  id: string;
  brand: string;
  title: string;
  image: string | null;
  cliqPrice: number;
  competitor: { platform: Platform; price: number };
  gap: number;
  prices: Partial<Record<Platform, number>>;
}

export interface Insights {
  undercuts: InsightRow[];
  wins: InsightRow[];
}

export interface ResolveResult {
  id: string;
  /** false when the product was fetched on demand rather than ingested. */
  inCatalog: boolean;
  product: ProductListItem;
}

// ── Product Match Comparison Report ───────────────────────────
export type Verdict = 'best' | 'moderate' | 'low' | 'na';

export interface ReportCell {
  column: string;
  value: string | null;
  raw?: number | boolean | null;
  agreement?: number | null;
  deltaE?: number | null;
  verdict: Verdict;
}

export interface ReportRow {
  label: string;
  cells: ReportCell[];
  emphasis?: boolean;
}

export interface ReportGroup {
  id: 'product' | 'pricing' | 'specifications' | 'content' | 'scores';
  title: string;
  rows: ReportRow[];
}

export interface ReportColumn {
  key: string;
  platform: Platform;
  label: string;
  role: 'source' | string;
  status: string;
  matchType: string | null;
  score: number | null;
  url: string | null;
  detailAvailable: boolean;
  detailReason: string | null;
}

export interface ReportDecision {
  bestMatch: {
    platform: Platform;
    label: string;
    title: string | null;
    score: number;
    matchType: string;
  } | null;
  matchType: string;
  confidence: number | null;
  whyThisMatch: string[];
  differencesFound: string[];
  catalogInsights: string[];
  recommendedAction: string;
  posture: 'undercut' | 'winning' | 'parity' | 'unknown';
}

export interface MatchReport {
  kind: string;
  generatedAt: string;
  matchedAt: string | null;
  cached?: boolean;
  header: {
    listingId: string | null;
    url: string | null;
    title: string | null;
    brand: string | null;
    image: string | null;
    overallConfidence: number | null;
    matchType: string;
    matchReason: string;
  };
  columns: ReportColumn[];
  groups: ReportGroup[];
  decision: ReportDecision;
  legend: { verdict: Verdict; label: string }[];
  summary: ComparisonSummary;
}

export interface ProductPage {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  items: ProductListItem[];
}
