export const config = {
  port: Number(process.env.PORT || 4010),
  host: process.env.HOST || '0.0.0.0',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  env: process.env.NODE_ENV || 'development',
  // Surface threshold for the v4 evidence score. Aligns with the PARTIAL MATCH
  // tier in matching/evidence.mjs — below this nothing is reported as a match.
  matchMinScore: Number(process.env.MATCH_MIN_SCORE || 0.58),

  /**
   * Exact-SKU mode. When on, a colour-FAMILY conflict is rejected outright
   * instead of surviving on strong image proof.
   *
   * Defaults ON because the product question is "is this the same SKU?", and a
   * grey-vs-black label disagreement means the colourway is unproven even when
   * the two photos sample to the same shade. Set STRICT_SKU=false to trade
   * precision for coverage.
   */
  strictSku: process.env.STRICT_SKU !== 'false',

  /**
   * Harvest Ajio's Akamai cookies with a headless browser so its PDP (specs,
   * fabric, description) becomes readable. OFF by default: it needs a Chrome
   * binary on the host, which the pure-HTTP stack otherwise never requires.
   * See sources/ajio-session.mjs for why no proxy can substitute for this.
   */
  ajioBrowserCookies: process.env.AJIO_BROWSER_COOKIES === 'true',
  /** Explicit browser binary for the Ajio session (Linux: /usr/bin/chromium). */
  chromePath: process.env.CHROME_PATH || '',
  httpTimeoutMs: Number(process.env.HTTP_TIMEOUT_MS || 20000),

  /**
   * How long a saved comparison is reused before the next view re-scrapes it.
   *
   * A comparison is expensive (three storefronts + image hashing), so it is
   * persisted and replayed rather than recomputed. It cannot be kept forever
   * though: this is a *pricing* tool, and Myntra/Ajio prices move daily, so a
   * month-old saved price would be reported as today's. 7 days is the
   * compromise; "Refresh live" always bypasses it.
   */
  reportTtlHours: Number(process.env.REPORT_TTL_HOURS || 168),

  /**
   * How long a product compared from a pasted link stays pinned to the top of
   * the catalog as a recent search.
   *
   * Deliberately shorter than the report TTL: the saved *report* is still worth
   * replaying for a week, but "recent" stops meaning anything after a couple of
   * days, and a strip that never clears is a second catalog rather than a
   * shortcut back to what you were just looking at.
   */
  recentTtlHours: Number(process.env.RECENT_TTL_HOURS || 48),

  /** Cards the recent-searches strip shows before it stops growing. */
  recentLimit: Number(process.env.RECENT_LIMIT || 12),

  /**
   * Bulk import: how many products are compared in parallel.
   *
   * The ceiling here is Myntra's and Ajio's tolerance, not our CPU — each row
   * is three storefronts plus image hashing, and a burst is exactly what trips
   * Akamai. 4 measured ~1.2s/product end to end while staying unblocked; raise
   * it only behind a residential proxy.
   */
  importConcurrency: Number(process.env.IMPORT_CONCURRENCY || 4),

  /** Rows accepted from one sheet. A guard against an accidental 500k upload. */
  importMaxRows: Number(process.env.IMPORT_MAX_ROWS || 20000),

  /** Upload size ceiling (MB) for the raw spreadsheet body. */
  importMaxUploadMb: Number(process.env.IMPORT_MAX_UPLOAD_MB || 25),

  /** How long a finished import job and its row-level results are kept. */
  importJobTtlHours: Number(process.env.IMPORT_JOB_TTL_HOURS || 24 * 30),
};
