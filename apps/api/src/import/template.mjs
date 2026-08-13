/**
 * The import template.
 *
 * Generated rather than shipped as a static file so it can never drift from
 * what the parser actually accepts — the columns, the examples and the stated
 * limits all come from the same code and config the importer uses.
 *
 * Worth being explicit: this template is a convenience, NOT a requirement. The
 * parser scans every cell of every sheet, so a client's own sheet works as-is.
 * The template exists to answer "what should I send you?", not to constrain it.
 */
import ExcelJS from 'exceljs';
import { config } from '../config.mjs';

const HEADER_FILL = 'FF1F2937';
const ACCENT = 'FFE11D48';

/** One example row per supported way of naming a product. */
const EXAMPLES = [
  {
    n: 1,
    cliq: 'https://www.tatacliq.com/us-polo-assn-denim-co-brown-cotton-relaxed-fit-printed-polo-tshirt/p-mp000000030566080',
    myntra: 'https://www.myntra.com/tshirts/u.s.+polo+assn.+denim+co./us-polo-assn-denim-co-brand-logo-printed-polo-collar-pure-cotton-slim-fit-t-shirt/32409751/buy',
    ajio: '',
    note: 'Full CLIQ URL, with a Myntra URL supplied — we will report whether our match agrees with yours.',
  },
  {
    n: 2,
    cliq: 'https://www.tatacliq.com/us-polo-assn-dark-blue-cotton-skinny-fit-jeans/p-mp000000015591452',
    myntra: '',
    ajio: '',
    note: 'Full CLIQ URL only — we search Myntra and Ajio ourselves.',
  },
  {
    n: 3,
    cliq: 'MP000000021772481',
    myntra: '',
    ajio: '',
    note: 'A bare listing ID works too — no URL needed.',
  },
];

export async function buildTemplate() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'PriceLens';
  wb.created = new Date();

  // ── Sheet 1: the sheet the user fills in ──────────────────────
  const ws = wb.addWorksheet('Products', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: '#', key: 'n', width: 6 },
    { header: 'Tata CLIQ URL or Listing ID', key: 'cliq', width: 62 },
    { header: 'Myntra URL (optional)', key: 'myntra', width: 42 },
    { header: 'Ajio URL (optional)', key: 'ajio', width: 42 },
    { header: 'Notes (ignored by the importer)', key: 'note', width: 58 },
  ];

  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
  head.height = 22;
  head.alignment = { vertical: 'middle' };

  for (const ex of EXAMPLES) {
    const row = ws.addRow(ex);
    row.font = { italic: true, color: { argb: 'FF6B7280' } };
    row.getCell('note').alignment = { wrapText: false };
  }

  // A visible boundary between the worked examples and the user's own rows —
  // without it, someone appends to row 5 and ships us our own sample data.
  const marker = ws.addRow({ n: '', cliq: '▼  Delete the three example rows above and paste your own links below  ▼' });
  marker.font = { bold: true, color: { argb: ACCENT } };
  marker.getCell('cliq').alignment = { horizontal: 'left' };

  ws.autoFilter = { from: 'A1', to: 'E1' };

  // ── Sheet 2: how it is read ───────────────────────────────────
  const info = wb.addWorksheet('How this works');
  info.columns = [{ width: 3 }, { width: 108 }];
  const lines = [
    ['h', 'What the importer accepts'],
    ['p', 'You do not have to use this template. Every cell of every sheet is scanned, so your own'],
    ['p', 'spreadsheet almost certainly works as-is — column order and column names do not matter.'],
    ['', ''],
    ['h', 'A product can be named three ways'],
    ['b', 'A full product URL:  https://www.tatacliq.com/<slug>/p-mp000000030566080'],
    ['b', 'A hyperlinked cell — the link target is read, not just the visible text.'],
    ['b', 'A bare listing ID:  MP000000030566080'],
    ['', ''],
    ['h', 'Competitor URLs are optional'],
    ['p', 'If a row also carries a Myntra or Ajio URL, we still search and match independently, then'],
    ['p', 'report whether we landed on the same product you named. Agreements are evidence the'],
    ['p', 'matcher works on your catalogue; disagreements are a shortlist worth reviewing.'],
    ['', ''],
    ['h', 'What happens to your rows'],
    ['b', 'The same product listed twice is compared once; the original row numbers are kept.'],
    ['b', 'Rows with no recognisable CLIQ link are skipped silently — headings and notes are fine.'],
    ['b', 'A product that cannot be read is reported as a failed row; the rest of the sheet continues.'],
    ['', ''],
    ['h', 'Limits and timing'],
    ['b', `Up to ${config.importMaxRows.toLocaleString('en-IN')} products per file, max ${config.importMaxUploadMb} MB.`],
    ['b', 'Formats: .xlsx, .xlsm, .csv'],
    ['b', 'Roughly 1.6 seconds per product, so about 27 minutes per 1,000 links.'],
    ['b', 'Products compared recently are replayed from cache, so a re-upload is far faster.'],
    ['b', 'The run continues in the background — you can close the browser and come back to it.'],
  ];
  for (const [kind, text] of lines) {
    const row = info.addRow(['', kind === 'b' ? `•   ${text}` : text]);
    const cell = row.getCell(2);
    if (kind === 'h') cell.font = { bold: true, size: 12, color: { argb: HEADER_FILL } };
    else if (kind === 'b') cell.font = { size: 11, color: { argb: 'FF374151' } };
    else cell.font = { size: 11, color: { argb: 'FF374151' } };
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}
