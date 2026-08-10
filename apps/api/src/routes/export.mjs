/**
 * Export routes — saved comparisons out of the tool and into the spreadsheet
 * the business actually runs on.
 *
 * Three endpoints, because a good export is a conversation, not a download:
 * the UI asks what filter values exist (`/facets`), shows how many rows a
 * filter set selects before committing (`/preview`), and only then builds the
 * file. Handing someone a 4,000-row workbook they have to open to discover it
 * is empty is the failure mode this avoids.
 */
import { store } from '../store.mjs';
import { buildWorkbook, exportFilename, describeFilters } from '../export/workbook.mjs';
import { buildPdf, pdfFilename } from '../export/pdf.mjs';
import { config } from '../config.mjs';

/** `?category=tshirt,jeans` and `?category=tshirt&category=jeans` both work. */
function list(value) {
  if (value == null) return [];
  const raw = Array.isArray(value) ? value : [value];
  return raw
    .flatMap((v) => String(v).split(','))
    .map((v) => v.trim())
    .filter(Boolean);
}

const num = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const POSITIONS = new Set(['all', 'undercut', 'winning', 'parity']);
const MATCHED = new Set(['all', 'matched', 'unmatched']);

export function parseFilters(query = {}) {
  const position = String(query.position || 'all');
  const matched = String(query.matched || 'all');
  return {
    q: String(query.q || '').trim(),
    categories: list(query.category),
    genders: list(query.gender),
    brands: list(query.brand),
    position: POSITIONS.has(position) ? position : 'all',
    matched: MATCHED.has(matched) ? matched : 'all',
    freshOnly: query.freshOnly === 'true',
    minPrice: num(query.minPrice),
    maxPrice: num(query.maxPrice),
  };
}

export default async function exportRoutes(fastify) {
  /** Filter vocabulary with counts — only values that have rows behind them. */
  fastify.get('/export/facets', async () => store.exportFacets());

  /**
   * Row count and headline numbers for a filter set, without building a file.
   * Cheap enough to run on every checkbox click.
   */
  fastify.get('/export/preview', async (req) => {
    const filters = parseFilters(req.query);
    const rows = store.exportRows(filters);
    const undercut = rows.filter((r) => r.posture === 'undercut');
    return {
      count: rows.length,
      matched: rows.filter((r) => r.matchedCount > 0).length,
      undercut: undercut.length,
      cliqCheapest: rows.filter((r) => r.posture === 'winning').length,
      totalGap: undercut.reduce((a, r) => a + (r.priceGap ?? 0), 0),
      filename: exportFilename(filters),
      pdfFilename: pdfFilename(filters),
      description: describeFilters(filters),
      sample: rows.slice(0, 5).map((r) => ({
        brand: r.brand, title: r.title, categoryLabel: r.categoryLabel,
        cliqPrice: r.cliqPrice, priceGap: r.priceGap, position: r.position,
      })),
    };
  });

  /**
   * The files themselves.
   *
   * Both formats are built in memory and sent whole rather than streamed: the
   * row count is bounded by saved comparisons (thousands, not millions), and a
   * partially written xlsx or pdf is a corrupt file — an all-or-nothing
   * response is the honest shape for this payload.
   *
   * They are separate routes rather than a `?format=` switch so the extension
   * in the URL matches the bytes; browsers, proxies and mail clients all guess
   * from the path, and a .xlsx URL returning a PDF confuses every one of them.
   */
  function fileRoute(path, contentType, build, name) {
    fastify.get(path, async (req, reply) => {
      const filters = parseFilters(req.query);
      const rows = store.exportRows(filters);

      if (!rows.length) {
        return reply.code(404).send({
          error: 'no_rows',
          message: `No saved comparisons match this filter (${describeFilters(filters)}). Generate comparisons first, or widen the filter.`,
        });
      }

      const buffer = await build(rows, { filters, ttlHours: config.reportTtlHours });
      return reply
        .header('Content-Type', contentType)
        .header('Content-Disposition', `attachment; filename="${name(filters)}"`)
        // The filename is the only part of the response the browser shows
        // before the file opens; expose it so fetch() downloads can read it.
        .header('Access-Control-Expose-Headers', 'Content-Disposition')
        .header('Cache-Control', 'no-store')
        .send(buffer);
    });
  }

  fileRoute('/export/comparisons.xlsx',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            buildWorkbook, exportFilename);
  fileRoute('/export/comparisons.pdf', 'application/pdf', buildPdf, pdfFilename);
}
