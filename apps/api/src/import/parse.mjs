/**
 * Spreadsheet → a list of Tata CLIQ products to compare.
 *
 * Deliberately layout-agnostic. Client sheets arrive with headers on row 2, a
 * numbering column, blank spacer rows, merged title cells and links spread
 * across differently-named columns — so rather than requiring a template, this
 * scans every cell of every sheet and keeps whatever looks like a CLIQ product
 * link. Getting a column name wrong should never mean importing nothing.
 *
 * Competitor URLs (Myntra / Ajio) found on the same row are captured as
 * *hints*. Matching still runs normally; the hint is recorded so the result can
 * say whether the engine independently agreed with the URL the client supplied.
 */
import ExcelJS from 'exceljs';
import { parseCliqProductId } from '../sources/tatacliq.mjs';

/** Every string a cell might be hiding, including its hyperlink target. */
function cellStrings(value) {
  if (value == null) return [];
  if (typeof value === 'string' || typeof value === 'number') return [String(value)];
  if (typeof value !== 'object') return [];
  const out = [];
  // Hyperlink cells: the display text is often truncated ("https://www.tatac…")
  // while the real URL lives on `hyperlink`. Reading only one loses rows.
  if (value.hyperlink) out.push(String(value.hyperlink));
  if (value.text) out.push(String(value.text));
  if (value.result != null) out.push(String(value.result));
  // Rich text runs
  if (Array.isArray(value.richText)) out.push(value.richText.map((r) => r.text || '').join(''));
  return out.filter(Boolean);
}

const COMPETITOR_HOSTS = [
  ['myntra', /(^|\.)myntra\.com/i],
  ['ajio', /(^|\.)ajio\.com/i],
  ['nykaa', /(^|\.)nykaafashion\.com/i],
];

function competitorOf(s) {
  if (!/^https?:\/\//i.test(s)) return null;
  let host;
  try { host = new URL(s).hostname; } catch { return null; }
  for (const [name, re] of COMPETITOR_HOSTS) if (re.test(host)) return name;
  return null;
}

/**
 * Turn one spreadsheet row into an import row, or null if it holds no CLIQ
 * link. `strings` is every text fragment on the row, paired with its column.
 */
function readRow(sheetName, rowNumber, cells) {
  let cliqId = null;
  let cliqUrl = null;
  const hints = {};

  for (const { column, text } of cells) {
    const comp = competitorOf(text);
    if (comp) {
      // First URL per platform wins; later columns are usually duplicates.
      if (!hints[comp]) hints[comp] = text;
      continue;
    }
    if (!cliqId) {
      const id = parseCliqProductId(text);
      // A bare id is only trusted from a cell that looks like an id or a link —
      // parseCliqProductId accepts bare ids, and a stray code in a notes column
      // would otherwise be imported as a product.
      if (id && (/^https?:/i.test(text) || /^[a-z]{2}\d{6,}$/i.test(text.trim()))) {
        cliqId = id;
        cliqUrl = /^https?:/i.test(text) ? text : null;
        void column;
      }
    }
  }

  if (!cliqId) return null;
  return { sheet: sheetName, row: rowNumber, id: cliqId, url: cliqUrl, hints };
}

/** Collect [{column,text}] for one exceljs row. */
function rowCells(row) {
  const cells = [];
  row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    for (const text of cellStrings(cell.value)) cells.push({ column: colNumber, text: text.trim() });
  });
  return cells;
}

async function parseXlsx(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const rows = [];
  let scanned = 0;
  for (const ws of wb.worksheets) {
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      scanned++;
      const parsed = readRow(ws.name, rowNumber, rowCells(row));
      if (parsed) rows.push(parsed);
    });
  }
  return { rows, scanned };
}

function parseCsv(buffer) {
  const text = buffer.toString('utf8');
  const rows = [];
  let scanned = 0;
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    scanned++;
    // Split on commas outside quotes, then unquote.
    const cells = (line.match(/("([^"]|"")*"|[^,]*)(,|$)/g) || [])
      .map((c) => c.replace(/,$/, '').trim().replace(/^"|"$/g, '').replace(/""/g, '"'))
      .filter(Boolean)
      .map((text, column) => ({ column, text }));
    const parsed = readRow('csv', i + 1, cells);
    if (parsed) rows.push(parsed);
  });
  return { rows, scanned };
}

/**
 * Parse an uploaded sheet into products to compare.
 *
 * Duplicates are collapsed: the same product listed twice is one comparison,
 * not two, and the extra source rows are remembered so the export can still
 * report per-original-row. Returns everything the UI needs to show the user
 * what it found *before* committing to hours of scraping.
 */
export async function parseSheet(buffer, filename = '') {
  const isCsv = /\.csv$/i.test(filename);
  const { rows, scanned } = isCsv ? parseCsv(buffer) : await parseXlsx(buffer);

  const byId = new Map();
  let duplicates = 0;
  for (const r of rows) {
    const hit = byId.get(r.id);
    if (hit) {
      duplicates++;
      hit.sourceRows.push(r.row);
      // Keep any hint the first occurrence lacked.
      for (const [k, v] of Object.entries(r.hints)) if (!hit.hints[k]) hit.hints[k] = v;
      continue;
    }
    byId.set(r.id, { ...r, sourceRows: [r.row] });
  }

  const items = [...byId.values()];
  return {
    filename,
    rowsScanned: scanned,
    linksFound: rows.length,
    duplicates,
    total: items.length,
    withHints: items.filter((i) => Object.keys(i.hints).length).length,
    items,
  };
}
