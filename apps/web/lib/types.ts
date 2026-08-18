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
  /** When this lookup pinned the product to the recent-searches strip. */
  searchedAt?: string;
  product: ProductListItem;
}

/** A product looked up by link, pinned above the catalog until it ages out. */
export interface RecentSearch extends ProductListItem {
  searchedAt: string;
  ageHours: number;
  /** How much longer it stays pinned. */
  expiresInHours: number;
  /** 'link' means it is not in the ingested catalog — the strip is its only route back. */
  source: 'catalog' | 'link';
}

export interface RecentSearchPage {
  total: number;
  ttlHours: number;
  items: RecentSearch[];
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

/** One measurement on one platform, in both units where published. */
export interface SizeMeasurement {
  /** Midpoint when the platform published a range. */
  inch: number | null;
  cm: number | null;
  /** Present only when the platform published a span, e.g. "36 - 38". */
  inchRange?: [number, number];
  cmRange?: [number, number];
}

export interface SizeChartCell {
  values: Partial<Record<Platform, SizeMeasurement | null>>;
  /** 'match' · 'mismatch' · 'single' (only one platform published it) · 'na'. */
  status: 'match' | 'mismatch' | 'single' | 'na';
  /** Largest gap between platforms, in inches. */
  delta: number | null;
  severity: 'minor' | 'major' | null;
  low?: Platform | null;
  high?: Platform | null;
}

export interface SizeChartRow {
  size: string;
  labels: Partial<Record<Platform, string | null>>;
  brandSizes: Partial<Record<Platform, string | null>>;
  available: Partial<Record<Platform, boolean | null>>;
  /** Footwear only: how each platform labels this shoe on the UK/US/EU scales. */
  scales: Partial<Record<Platform, { uk: string | null; us: string | null; euro: string | null } | null>>;
  /** Set when exactly one platform sells this size — a catalog gap, not a mismatch. */
  onlyOn: Platform | null;
  cells: Record<string, SizeChartCell>;
}

export interface SizeChartComparison {
  platforms: Platform[];
  /** Why a platform contributes no chart: 'akamai-ip-block', 'no_match', 'not_published'… */
  unavailable: Partial<Record<Platform, string>>;
  axes: { key: string; axis: string; basis: 'garment' | 'body'; label: string }[];
  unit: 'inch';
  tolerance: { matchIn: number; majorIn: number };
  images: Partial<Record<Platform, string | null>>;
  rows: SizeChartRow[];
  flags: {
    size: string; axis: string; delta: number;
    severity: 'minor' | 'major'; low: Platform; high: Platform; text: string;
  }[];
  summary: {
    comparedCells: number;
    matched: number;
    minor: number;
    major: number;
    sizesOnlyOnOnePlatform: { size: string; platform: Platform }[];
    verdict: 'consistent' | 'minor_variance' | 'mismatch' | 'single_source' | 'not_comparable';
  };
}

export interface MatchReport {
  kind: string;
  generatedAt: string;
  matchedAt: string | null;
  /** True when this report replayed a saved comparison instead of re-scraping. */
  cached?: boolean;
  savedAt?: string | null;
  ageHours?: number | null;
  ttlHours?: number;
  header: {
    listingId: string | null;
    url: string | null;
    title: string | null;
    brand: string | null;
    image: string | null;
    overallConfidence: number | null;
    matchType: string;
    matchReason: string;
    /**
     * Set when the platforms' size charts were comparable. severity 'none'
     * means they agree; null means nothing was comparable, which is NOT the
     * same as agreement.
     */
    sizeChartFlag: {
      severity: 'none' | 'minor' | 'major';
      label: string;
      detail: string;
      counts?: { major: number; minor: number; compared: number };
    } | null;
  };
  columns: ReportColumn[];
  groups: ReportGroup[];
  /** Null when no platform published a size chart for this product. */
  sizeChart: SizeChartComparison | null;
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

/** One row of the saved-reports list. */
export interface SavedReport {
  id: string;
  brand: string | null;
  title: string | null;
  image: string | null;
  url: string | null;
  matchType: string;
  confidence: number | null;
  bestPlatform: Platform | null;
  matchedCount: number;
  prices: Partial<Record<Platform, number>>;
  cheapest: { platform: Platform; price: number } | null;
  matchedAt: string | null;
  ageHours: number | null;
  /** Within the TTL — a stale row re-scrapes on next open. */
  fresh: boolean;
  expiresInHours: number | null;
  /** 'link' means it was pasted in, so it never appears in the catalog grid. */
  source: 'catalog' | 'link';
}

export interface SavedReportPage {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  ttlHours: number;
  freshCount: number;
  items: SavedReport[];
}

// ── Bulk import ───────────────────────────────────────────────

export type ImportStatus = 'queued' | 'running' | 'done' | 'cancelled' | 'failed';

/** What the parser found, before any scraping is committed to. */
export interface ImportPreview {
  dryRun: true;
  filename: string;
  rowsScanned: number;
  linksFound: number;
  duplicates: number;
  total: number;
  withHints: number;
  sample: { id: string; sheet: string; row: number; hints: Record<string, string> }[];
}

export interface ImportRow {
  id: string;
  sheet: string;
  row: number;
  sourceRows: number[];
  hints: Record<string, string>;
  state: 'pending' | 'done' | 'error';
  status: 'matched' | 'no_match' | 'error' | null;
  error: string | null;
  cached: boolean;
  /** Whether our match agreed with a competitor URL the sheet supplied. */
  agreement: 'agreed' | 'disagreed' | null;
  brand?: string;
  title?: string;
  matchedCount?: number;
  prices?: Partial<Record<Platform, number>>;
}

export interface ImportJob {
  id: string;
  filename: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  status: ImportStatus;
  rowsScanned: number;
  linksFound: number;
  duplicates: number;
  total: number;
  done: number;
  matched: number;
  noMatch: number;
  failed: number;
  fromCache: number;
  hintAgreed: number;
  hintDisagreed: number;
  concurrency: number;
  percent: number;
  remaining: number;
  etaSeconds: number | null;
  note?: string;
  error?: string;
  rows?: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
    items: ImportRow[];
  };
}

// ── Excel export ──────────────────────────────────────────────

/** One selectable filter value, with how many saved comparisons carry it. */
export interface Facet {
  value: string;
  label: string;
  count: number;
}

export interface ExportFacets {
  /** Rows the current filter selects. */
  total: number;
  /** Rows saved in total, whatever the filter — drives the "nothing saved" state. */
  savedTotal: number;
  categories: Facet[];
  genders: Facet[];
  /** Sizes the matched Myntra/Ajio listings offer — CLIQ's PDP publishes none. */
  sizes: Facet[];
  brands: Facet[];
  positions: Facet[];
  matchedCount: number;
  freshCount: number;
  priceRange: { min: number; max: number } | null;
}

/** Competitive position of CLIQ against the cheapest matched rival. */
export type Posture = 'all' | 'undercut' | 'winning' | 'parity';

/** Both formats carry the same rows; they differ in who reads them. */
export type ExportFormat = 'xlsx' | 'pdf';

export interface ExportFilters {
  q: string;
  categories: string[];
  genders: string[];
  sizes: string[];
  brands: string[];
  position: Posture;
  matched: 'all' | 'matched' | 'unmatched';
  freshOnly: boolean;
  minPrice: number | null;
  maxPrice: number | null;
}

/** What a filter set selects, answered before the workbook is built. */
export interface ExportPreview {
  count: number;
  matched: number;
  undercut: number;
  cliqCheapest: number;
  totalGap: number;
  filename: string;
  pdfFilename: string;
  description: string;
  sample: {
    brand: string | null;
    title: string | null;
    categoryLabel: string;
    cliqPrice: number | null;
    priceGap: number | null;
    position: string;
  }[];
}
