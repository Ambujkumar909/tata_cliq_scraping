/**
 * Excel export — the comparison store as a workbook a category manager can
 * open, sort and pivot without asking anyone for help.
 *
 * Two sheets, in the order the work actually happens:
 *
 *   1. Summary     — what was exported, under which filters, and the six
 *                    numbers that answer "how are we priced?". A spreadsheet
 *                    that does not state its own filters gets misread the
 *                    moment it is forwarded, so the filter block is part of
 *                    the deliverable, not decoration.
 *   2. Comparison  — one row per product: identity, the three platforms'
 *                    prices and discounts, the gap, and the recommendation.
 *
 * Formatting choices are functional: freeze panes and an autofilter because
 * these files get sorted; real number formats (not pre-formatted strings)
 * because a "₹1,299" text cell cannot be summed; conditional fills on the
 * position column because the eye finds red faster than it reads.
 */
import ExcelJS from 'exceljs';
import { CATEGORY_LABELS, GENDER_LABELS, PLATFORMS } from './rows.mjs';

const CLIQ = 'E11D48';
const INK = '0F172A';
const MUTED = '64748B';
const BAND = 'F1F5F9';
// Three tiers, because a three-platform comparison has three answers: the
// cheapest, the dearest, and the one in between. Leaving the middle uncoloured
// made it read as "no data" next to two tinted cells.
const GREEN = '15803D';
const GREEN_BG = 'DCFCE7';
const AMBER = 'B45309';
const AMBER_BG = 'FEF3C7';
const RED = 'B91C1C';
const RED_BG = 'FEE2E2';

const MONEY = '"₹"#,##0';
const PCT = '0.0"%"';
// Discounts arrive as whole percents (55, not 0.55), so the percent sign is
// literal — Excel's own `0%` format would multiply them by a hundred.
const DISCOUNT = '0"%"';

/**
 * Column plan for the Comparison sheet, ordered as the question is asked:
 * what the product is, what the three platforms charge, who wins and by how
 * much, and what to do about it.
 *
 * Columns that do not change a decision are gone. Per-competitor MRP was three
 * near-identical copies of the CLIQ list price; rating, availability and raw
 * timestamps belong to the product page, not to a pricing analysis. Match
 * confidence and the pricing date went the same way: both describe how the row
 * was produced rather than what to do about it, and the engine already refuses
 * to publish a match it does not trust.
 *
 * "Cheapest on", "Dearest on", the rupee gap, the gap percentage and the price
 * index all went the same way — not because they were wrong, but because the
 * three-tier colour on the price block already says which platform is cheapest
 * and which is dearest, and the Recommendation states the gap in words. Six
 * columns restating what the reader can already see is noise, and noise is what
 * stops a sheet being scanned.
 */
function comparisonColumns() {
  const cols = [
    { header: 'Brand', key: 'brand', width: 18, get: (r) => r.brand },
    { header: 'Product', key: 'title', width: 44, get: (r) => r.title },
    { header: 'Category', key: 'category', width: 16, get: (r) => r.categoryLabel },
    { header: 'Gender', key: 'gender', width: 11, get: (r) => r.genderLabel },
    { header: 'MRP', key: 'cliqMrp', width: 11, get: (r) => r.cliqMrp, fmt: MONEY },
  ];

  // The three selling prices, side by side and in a fixed order — this block is
  // the heart of the sheet, so nothing separates the columns being compared.
  cols.push(
    { header: 'Tata CLIQ', key: 'cliqPrice', width: 12, get: (r) => r.cliqPrice, fmt: MONEY, price: 'tatacliq' },
  );
  for (const { key, label } of PLATFORMS) {
    cols.push({
      header: label, key: `${key}Price`, width: 12,
      get: (r) => r.competitors[key].price, fmt: MONEY, price: key,
      // Why a price is missing, for the cell comment.
      note: (r) => (r.competitors[key].price == null ? r.competitors[key].statusLabel : null),
    });
  }

  cols.push(
    { header: 'Position', key: 'position', width: 15, get: (r) => r.position },
    { header: 'Recommendation', key: 'recommendation', width: 62, get: (r) => r.recommendation },
  );

  // Discount on each platform, in the same platform order as the price block —
  // the second half of a price story. Two listings at ₹1,299 are not the same
  // offer when one is 20% off and the other 60%: the deep discounter has room
  // to cut again, which is what a merchandiser reads a discount column for.
  // They sit immediately before the links so the sheet ends on the two things
  // you leave it for: the numbers, then the pages they came from.
  cols.push(
    { header: 'CLIQ Disc.', key: 'cliqDiscount', width: 11, get: (r) => r.cliqDiscount, fmt: DISCOUNT },
  );
  for (const { key, label } of PLATFORMS) {
    cols.push({
      header: `${label} Disc.`, key: `${key}Discount`, width: 11,
      get: (r) => r.competitors[key].discountPercent, fmt: DISCOUNT,
    });
  }

  cols.push({ header: 'CLIQ Link', key: 'cliqUrl', width: 11, get: (r) => r.cliqUrl, link: true });
  for (const { key, label } of PLATFORMS) {
    cols.push({ header: `${label} Link`, key: `${key}Url`, width: 11, get: (r) => r.competitors[key].url, link: true });
  }
  return cols;
}

function styleHeader(sheet, rowNumber, columnCount) {
  const row = sheet.getRow(rowNumber);
  row.height = 26;
  row.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
  row.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  for (let c = 1; c <= columnCount; c++) {
    row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${CLIQ}` } };
  }
}

function writeComparisonSheet(wb, rows, sheetName, cols) {
  const sheet = wb.addWorksheet(sheetName, {
    views: [{ state: 'frozen', xSplit: 2, ySplit: 1 }],
  });
  sheet.columns = cols.map((c) => ({ key: c.key, width: c.width }));
  sheet.addRow(cols.map((c) => c.header));
  styleHeader(sheet, 1, cols.length);

  const at = (key) => cols.findIndex((c) => c.key === key) + 1;

  for (const r of rows) {
    const row = sheet.addRow(cols.map((c) => c.get(r) ?? null));
    cols.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      if (c.fmt) cell.numFmt = c.fmt;
      if (c.link && cell.value) {
        cell.value = { text: 'Open', hyperlink: String(cell.value) };
        cell.font = { color: { argb: 'FF2F80ED' }, underline: true };
      }
      // A blank price is not the same as a cheap one — say why it is blank.
      if (c.note) {
        const why = c.note(r);
        if (why) {
          cell.value = why;
          cell.font = { color: { argb: `FF${MUTED}` }, italic: true, size: 9 };
          cell.alignment = { horizontal: 'center' };
        }
      }
    });

    /**
     * Rank the price block by colour: cheapest green, middle orange, dearest
     * red. With the ranking columns removed this tinting IS the analysis — a
     * reader scans the three price cells and knows the answer without reading
     * a number, and the traffic-light order needs no legend to interpret.
     *
     * Equal prices are left untinted: at parity there is no winner to mark, and
     * colouring one of two identical numbers green would invent a difference.
     */
    const priced = cols.filter((c) => c.price)
      .map((c) => ({ col: c, v: c.get(r) }))
      .filter((x) => typeof x.v === 'number');
    if (priced.length > 1) {
      const lo = Math.min(...priced.map((x) => x.v));
      const hi = Math.max(...priced.map((x) => x.v));
      if (lo !== hi) {
        for (const { col, v } of priced) {
          const [bg, fg] = v === lo ? [GREEN_BG, GREEN] : v === hi ? [RED_BG, RED] : [AMBER_BG, AMBER];
          const cell = row.getCell(at(col.key));
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${bg}` } };
          cell.font = { color: { argb: `FF${fg}` }, bold: true };
        }
      }
    }

    // The verdict word carries the same three colours, so the row reads
    // identically from either end.
    const posCell = row.getCell(at('position'));
    if (r.posture === 'undercut') {
      posCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${RED_BG}` } };
      posCell.font = { color: { argb: `FF${RED}` }, bold: true };
    } else if (r.posture === 'winning') {
      posCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${GREEN_BG}` } };
      posCell.font = { color: { argb: `FF${GREEN}` }, bold: true };
    } else if (r.posture === 'parity') {
      posCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${AMBER_BG}` } };
      posCell.font = { color: { argb: `FF${AMBER}` }, bold: true };
    }

    row.getCell(at('recommendation')).alignment = { wrapText: true, vertical: 'top' };
    row.getCell(at('title')).alignment = { wrapText: true, vertical: 'top' };
  }

  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  return sheet;
}

/** Human sentence describing the filters, so the file explains itself. */
export function describeFilters(filters = {}) {
  const bits = [];
  if (filters.categories?.length) {
    bits.push(`Category: ${filters.categories.map((c) => CATEGORY_LABELS[c] || c).join(', ')}`);
  }
  if (filters.genders?.length) bits.push(`Gender: ${filters.genders.map((g) => GENDER_LABELS[g] || g).join(', ')}`);
  if (filters.brands?.length) bits.push(`Brand: ${filters.brands.join(', ')}`);
  if (filters.sizes?.length) bits.push(`Size: ${filters.sizes.join(', ')}`);
  if (filters.position && filters.position !== 'all') {
    bits.push(`Position: ${{ undercut: 'Competitor undercuts CLIQ', winning: 'CLIQ is cheapest', parity: 'Price parity' }[filters.position] || filters.position}`);
  }
  if (filters.matched === 'matched') bits.push('Only products with a competitor match');
  if (filters.matched === 'unmatched') bits.push('Only products with no competitor match');
  if (filters.freshOnly) bits.push('Only reports still within the freshness window');
  if (filters.minPrice != null || filters.maxPrice != null) {
    bits.push(`CLIQ price ₹${filters.minPrice ?? 0} – ₹${filters.maxPrice ?? '∞'}`);
  }
  if (filters.q) bits.push(`Search: "${filters.q}"`);
  return bits.length ? bits.join('  ·  ') : 'No filters — every saved comparison';
}

function writeSummarySheet(wb, rows, filters, meta) {
  const sheet = wb.addWorksheet('Summary', { views: [{ showGridLines: false }] });
  sheet.columns = [{ width: 34 }, { width: 18 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 }];

  const title = sheet.addRow(['Tata CLIQ — Competitive Price Intelligence']);
  title.font = { bold: true, size: 18, color: { argb: `FF${CLIQ}` } };
  title.height = 28;
  const sub = sheet.addRow([`Tata CLIQ vs Myntra vs Ajio  ·  generated ${new Date(meta.generatedAt).toLocaleString('en-IN')}`]);
  sub.font = { size: 10, color: { argb: `FF${MUTED}` } };
  const filterRow = sheet.addRow([describeFilters(filters)]);
  filterRow.font = { size: 10, italic: true, color: { argb: `FF${INK}` } };
  sheet.addRow([]);

  const section = (label) => {
    const r = sheet.addRow([label]);
    r.font = { bold: true, size: 12, color: { argb: `FF${INK}` } };
    r.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${BAND}` } };
    return r;
  };
  const kpi = (label, value, fmt) => {
    const r = sheet.addRow([label, value]);
    r.getCell(1).font = { color: { argb: `FF${MUTED}` } };
    r.getCell(2).font = { bold: true, size: 12 };
    if (fmt) r.getCell(2).numFmt = fmt;
    return r;
  };

  const withMatch = rows.filter((r) => r.matchedCount > 0);
  const undercut = rows.filter((r) => r.posture === 'undercut');
  const winning = rows.filter((r) => r.posture === 'winning');
  const parity = rows.filter((r) => r.posture === 'parity');
  const sum = (list, f) => list.reduce((a, r) => a + (f(r) ?? 0), 0);
  const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);

  section('Coverage');
  kpi('Products in this export', rows.length);
  kpi('With at least one competitor match', withMatch.length);
  kpi('Match rate', pct(withMatch.length, rows.length), PCT);
  kpi('Reports still fresh', rows.filter((r) => r.fresh).length);
  sheet.addRow([]);

  // Where the extremes actually sit, by platform — the portfolio version of
  // the two columns the Comparison sheet now leads with.
  section('Who is cheapest, who is dearest');
  const tallyBy = (key) => {
    const m = new Map();
    for (const r of rows) if (r[key]) m.set(r[key], (m.get(r[key]) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const head = sheet.addRow(['', 'Cheapest on', 'Dearest on']);
  head.font = { bold: true, size: 10, color: { argb: `FF${MUTED}` } };
  const dear = new Map(tallyBy('dearestPlatform'));
  for (const [platform, n] of tallyBy('cheapestPlatform')) {
    const r = sheet.addRow([platform, n, dear.get(platform) ?? 0]);
    r.getCell(1).font = { color: { argb: `FF${MUTED}` } };
    r.getCell(2).font = { bold: true, color: { argb: `FF${GREEN}` } };
    r.getCell(3).font = { bold: true, color: { argb: `FF${RED}` } };
  }
  kpi('Widest price spread on one product', rows.length ? Math.max(...rows.map((r) => r.priceSpread ?? 0)) : 0, MONEY);
  kpi('Average spread across the range', rows.length
    ? Math.round(sum(rows, (r) => r.priceSpread) / rows.filter((r) => r.priceSpread != null).length || 0) : 0, MONEY);
  sheet.addRow([]);

  section('Price position');
  kpi('Tata CLIQ is cheapest', winning.length);
  kpi('A competitor undercuts CLIQ', undercut.length);
  kpi('Price parity', parity.length);
  kpi('CLIQ cheapest — share of compared', pct(winning.length, withMatch.length), PCT);
  sheet.addRow([]);

  section('Exposure — where a rival is cheaper');
  kpi('Total gap on undercut SKUs', sum(undercut, (r) => r.priceGap), MONEY);
  kpi('Average gap per undercut SKU', undercut.length ? Math.round(sum(undercut, (r) => r.priceGap) / undercut.length) : 0, MONEY);
  kpi('Largest single gap', undercut.length ? Math.max(...undercut.map((r) => r.priceGap)) : 0, MONEY);
  sheet.addRow([]);

  // ── Breakdowns. These are what turn a list into an analysis: the same
  // question asked per category and per brand, which is how buying decisions
  // are actually organised.
  const breakdown = (label, keyFn) => {
    section(label);
    const head = sheet.addRow(['', 'Products', 'Matched', 'CLIQ cheapest', 'Undercut', 'Avg gap']);
    head.font = { bold: true, size: 10, color: { argb: `FF${MUTED}` } };
    const groups = new Map();
    for (const r of rows) {
      const k = keyFn(r);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    }
    const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 20);
    for (const [name, list] of ordered) {
      const u = list.filter((r) => r.posture === 'undercut');
      const row = sheet.addRow([
        name,
        list.length,
        list.filter((r) => r.matchedCount > 0).length,
        list.filter((r) => r.posture === 'winning').length,
        u.length,
        u.length ? Math.round(sum(u, (r) => r.priceGap) / u.length) : null,
      ]);
      row.getCell(6).numFmt = MONEY;
    }
    sheet.addRow([]);
  };

  breakdown('By category', (r) => r.categoryLabel);
  breakdown('By gender', (r) => r.genderLabel);
  breakdown('By brand', (r) => r.brand || '—');

  section('How to read the Comparison sheet');
  for (const [swatch, text, bg, fg] of [
    ['CHEAPEST', 'Lowest of the three prices for that product', GREEN_BG, GREEN],
    ['MIDDLE', 'Neither cheapest nor dearest', AMBER_BG, AMBER],
    ['DEAREST', 'Highest of the three prices for that product', RED_BG, RED],
    ['No match', 'No comparable listing was proven on that platform — not that the product is unavailable', null, null],
  ]) {
    const r = sheet.addRow([swatch, text]);
    r.getCell(1).font = { bold: true, size: 10, color: { argb: `FF${fg ?? MUTED}` } };
    if (bg) r.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${bg}` } };
    r.getCell(2).font = { size: 10, color: { argb: `FF${MUTED}` } };
  }
  sheet.addRow([]);

  const note = sheet.addRow([
    `Prices are as at the time each comparison was run, not live quotes. Saved comparisons are replayed for ${meta.ttlHours} hours before re-scraping.`,
  ]);
  note.font = { size: 9, italic: true, color: { argb: `FF${MUTED}` } };
  return sheet;
}

/**
 * Build the workbook. Returns a Buffer ready to stream.
 * Pure and synchronous apart from exceljs's own serialisation — every number
 * here comes from an already-saved comparison, so nothing touches the network.
 */
export async function buildWorkbook(rows, { filters = {}, ttlHours = 168 } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'PriceLens — Tata CLIQ Price Intelligence';
  wb.created = new Date();

  const meta = { generatedAt: new Date().toISOString(), ttlHours };
  const cols = comparisonColumns();

  writeSummarySheet(wb, rows, filters, meta);
  // Two sheets only: the numbers, and the summary that frames them. An "Action
  // List" sheet used to repeat the undercut rows; it is a filter, not a
  // document — the Position column sorts to the same set in one click, and the
  // export dialog can select it outright.
  writeComparisonSheet(wb, rows, 'Comparison', cols);

  return wb.xlsx.writeBuffer();
}

/** Filename that says what is inside without opening it. */
export function exportFilename(filters = {}) {
  const parts = ['pricelens'];
  if (filters.genders?.length === 1) parts.push(filters.genders[0]);
  if (filters.categories?.length === 1) parts.push(filters.categories[0]);
  if (filters.brands?.length === 1) parts.push(filters.brands[0].toLowerCase().replace(/[^a-z0-9]+/g, '-'));
  if (filters.sizes?.length === 1) parts.push(filters.sizes[0].toLowerCase().replace(/[^a-z0-9]+/g, '-'));
  if (filters.position && filters.position !== 'all') parts.push(filters.position);
  parts.push(new Date().toISOString().slice(0, 10));
  return `${parts.join('-')}.xlsx`;
}
