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
  httpTimeoutMs: Number(process.env.HTTP_TIMEOUT_MS || 20000),
};
