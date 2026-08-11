/**
 * PDF export — the same filtered comparison set as the Excel workbook, laid out
 * to be read rather than sorted.
 *
 * The two formats answer different needs and neither replaces the other: the
 * workbook is for someone who will pivot and re-sort, the PDF is for someone
 * who will read it in a meeting or forward it to a buyer. So this is not a
 * dump of the sheet — it leads with the portfolio position, then the products
 * that cost money, then the full table.
 *
 * Landscape A4, because a price comparison is inherently wide.
 */
import { existsSync } from 'node:fs';
import PDFDocument from 'pdfkit';
import { CATEGORY_LABELS, GENDER_LABELS, PLATFORMS } from './rows.mjs';
import { describeFilters } from './workbook.mjs';

const NAVY = '#14304F';
const NAVY_SOFT = '#7C9CBB';
const NAVY_PALE = '#E8EEF4';
const ROSE = '#E11D48';
const GREEN = '#0F766E';
const GREEN_BG = '#E3F2EF';
const RED = '#B3261E';
const RED_BG = '#FBE9E7';
const AMBER = '#B45309';
const AMBER_BG = '#FDF3E3';
const INK = '#111111';
const GREY = '#5A5A5A';
const RULE = '#C3CFDA';

/**
 * PDF's built-in Helvetica has no rupee glyph. Noto Sans (installed in the
 * image) does; if it is ever missing we fall back to Helvetica AND to writing
 * "Rs." instead, so the document degrades to something still correct rather
 * than printing blank boxes where the prices should be.
 */
const NOTO = '/usr/share/fonts/noto/NotoSans-Regular.ttf';
const NOTO_BOLD = '/usr/share/fonts/noto/NotoSans-Bold.ttf';
const HAS_NOTO = existsSync(NOTO) && existsSync(NOTO_BOLD);
const RUPEE = HAS_NOTO ? '₹' : 'Rs.';

const money = (v) => (typeof v === 'number' ? `${RUPEE}${Math.round(v).toLocaleString('en-IN')}` : '—');
const pct = (v) => (typeof v === 'number' ? `${Math.round(v)}%` : '—');

/** Column plan — widths sum to the printable width of landscape A4. */
const COLUMNS = [
  { key: 'brand', head: 'Brand', w: 66, get: (r) => r.brand ?? '—' },
  { key: 'title', head: 'Product', w: 196, get: (r) => r.title ?? '—' },
  { key: 'category', head: 'Category', w: 56, get: (r) => r.categoryLabel },
  { key: 'gender', head: 'Gender', w: 44, get: (r) => r.genderLabel },
  { key: 'mrp', head: 'MRP', w: 48, align: 'right', get: (r) => money(r.cliqMrp) },
  { key: 'cliq', head: 'Tata CLIQ', w: 52, align: 'right', price: true, get: (r) => money(r.cliqPrice), raw: (r) => r.cliqPrice },
  { key: 'myntra', head: 'Myntra', w: 52, align: 'right', price: true, get: (r) => money(r.competitors.myntra.price), raw: (r) => r.competitors.myntra.price },
  { key: 'ajio', head: 'Ajio', w: 52, align: 'right', price: true, get: (r) => money(r.competitors.ajio.price), raw: (r) => r.competitors.ajio.price },
  { key: 'position', head: 'Position', w: 60, get: (r) => POSITION_SHORT[r.position] ?? r.position },
  { key: 'action', head: 'Recommendation', w: 160, get: (r) => r.recommendation ?? '—' },
];

/** One line per row means the long-form position label has to shorten. */
const POSITION_SHORT = {
  'CLIQ cheapest': 'CLIQ cheapest',
  Undercut: 'Undercut',
  Parity: 'Parity',
  'No competitor data': 'No rival data',
};

/**
 * Clip to the column, with an ellipsis.
 *
 * pdfkit's own `ellipsis` needs a bounded height and still reflows; measuring
 * and cutting is deterministic, which is what a fixed-height table row needs —
 * one long product title wrapping silently overlaps the row beneath it.
 */
function clip(doc, text, width) {
  const s = String(text ?? '');
  if (doc.widthOfString(s) <= width) return s;
  let lo = 0, hi = s.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (doc.widthOfString(`${s.slice(0, mid)}…`) <= width) lo = mid;
    else hi = mid - 1;
  }
  return `${s.slice(0, lo)}…`;
}

function useFont(doc, bold = false) {
  if (HAS_NOTO) doc.font(bold ? NOTO_BOLD : NOTO);
  else doc.font(bold ? 'Helvetica-Bold' : 'Helvetica');
}

/**
 * Running header and footer.
 *
 * The margins are suppressed for the duration. pdfkit starts a NEW PAGE the
 * moment text is written past the bottom margin, so drawing a footer in the
 * margin area silently paginates — which showed up as an empty first page and
 * twice the expected page count, because every subsequent draw landed on the
 * page the footer had just created.
 */
function pageChrome(doc, meta, page) {
  const { left, right, top, bottom } = doc.page.margins;
  const w = doc.page.width - left - right;
  doc.page.margins = { left, right, top: 0, bottom: 0 };

  useFont(doc, true);
  doc.fontSize(7).fillColor(ROSE).text('PRICELENS', left, 22, { width: w, lineBreak: false });
  useFont(doc);
  doc.fontSize(7).fillColor(GREY)
    .text('Competitive Price Intelligence for Tata CLIQ', left, 22, { width: w, align: 'right', lineBreak: false });
  doc.moveTo(left, 34).lineTo(left + w, 34).lineWidth(0.5).strokeColor(RULE).stroke();

  const footY = doc.page.height - 26;
  doc.moveTo(left, footY).lineTo(left + w, footY).lineWidth(0.5).strokeColor(RULE).stroke();
  doc.fontSize(6.8).fillColor('#8A8A8A')
    .text(`Generated ${new Date(meta.generatedAt).toLocaleString('en-IN')}  ·  Confidential`,
          left, footY + 6, { width: w, lineBreak: false });
  doc.fontSize(6.8).fillColor('#8A8A8A')
    .text(`Page ${page}`, left, footY + 6, { width: w, align: 'right', lineBreak: false });

  doc.page.margins = { left, right, top, bottom };
}

function sectionTitle(doc, text, y) {
  const { left, right } = doc.page.margins;
  const w = doc.page.width - left - right;
  doc.moveTo(left, y).lineTo(left + w, y).lineWidth(0.9).strokeColor(NAVY).stroke();
  useFont(doc, true);
  doc.fontSize(10).fillColor(NAVY).text(text, left, y + 4, { width: w });
  return y + 18;
}

/** The four numbers a reader wants before any table. */
function kpiStrip(doc, rows, y) {
  const { left, right } = doc.page.margins;
  const w = doc.page.width - left - right;
  const undercut = rows.filter((r) => r.posture === 'undercut');
  const exposure = undercut.reduce((a, r) => a + (r.priceGap ?? 0), 0);
  const items = [
    [String(rows.length), 'products in this report', NAVY],
    [String(rows.filter((r) => r.posture === 'winning').length), 'where Tata CLIQ is cheapest', GREEN],
    [String(undercut.length), 'where a rival undercuts CLIQ', RED],
    [money(exposure), 'total gap on undercut products', RED],
  ];
  const cw = w / items.length;
  doc.rect(left, y, w, 40).fill(NAVY_PALE);
  items.forEach(([big, small, hue], i) => {
    const x = left + i * cw;
    if (i) doc.moveTo(x, y + 5).lineTo(x, y + 35).lineWidth(0.5).strokeColor(RULE).stroke();
    useFont(doc, true);
    doc.fontSize(15).fillColor(hue).text(big, x + 8, y + 8, { width: cw - 16 });
    useFont(doc);
    doc.fontSize(7).fillColor(GREY).text(small, x + 8, y + 26, { width: cw - 16 });
  });
  return y + 52;
}

/** Where the cheapest and the dearest price sits, by platform. */
function platformSplit(doc, rows, y) {
  const { left, right } = doc.page.margins;
  const w = doc.page.width - left - right;
  const count = (key) => {
    const m = new Map();
    for (const r of rows) if (r[key]) m.set(r[key], (m.get(r[key]) || 0) + 1);
    return m;
  };
  const cheap = count('cheapestPlatform');
  const dear = count('dearestPlatform');
  const names = [...new Set([...cheap.keys(), ...dear.keys()])];

  useFont(doc, true);
  doc.fontSize(7.4).fillColor(GREY)
    .text('PLATFORM', left, y, { width: 90 })
    .text('CHEAPEST ON', left + 95, y, { width: 70 })
    .text('DEAREST ON', left + 175, y, { width: 70 });
  y += 12;
  for (const name of names) {
    useFont(doc);
    doc.fontSize(8.6).fillColor(INK).text(name, left, y, { width: 90 });
    useFont(doc, true);
    doc.fillColor(GREEN).text(String(cheap.get(name) ?? 0), left + 95, y, { width: 70 });
    doc.fillColor(RED).text(String(dear.get(name) ?? 0), left + 175, y, { width: 70 });
    y += 13;
  }
  useFont(doc);
  doc.fontSize(7.4).fillColor(GREY).text(
    'Counted across every product in this report, Tata CLIQ included. A platform that is '
    + 'cheapest often and dearest rarely is the one setting the market price.',
    left + 260, y - names.length * 13 - 12, { width: w - 260 });
  return y + 6;
}

function tableHeader(doc, y) {
  const { left } = doc.page.margins;
  const h = 16;
  let x = left;
  doc.rect(left, y, COLUMNS.reduce((a, c) => a + c.w, 0), h).fill(NAVY);
  useFont(doc, true);
  doc.fontSize(7).fillColor('#FFFFFF');
  for (const c of COLUMNS) {
    doc.text(c.head, x + 3, y + 5, { width: c.w - 6, align: c.align === 'right' ? 'right' : 'left', lineBreak: false });
    x += c.w;
  }
  return y + h;
}

function tableRow(doc, r, y, zebra) {
  const { left } = doc.page.margins;
  const total = COLUMNS.reduce((a, c) => a + c.w, 0);
  const h = 18;
  if (zebra) doc.rect(left, y, total, h).fill('#F7FAFC');

  // Cheapest and dearest of the three prices, tinted in place — the same
  // signal the workbook gives, so the two exports read identically.
  const priced = COLUMNS.filter((c) => c.price).map((c) => ({ c, v: c.raw(r) }))
    .filter((x) => typeof x.v === 'number');
  const lo = priced.length > 1 ? Math.min(...priced.map((x) => x.v)) : null;
  const hi = priced.length > 1 ? Math.max(...priced.map((x) => x.v)) : null;

  let x = left;
  for (const c of COLUMNS) {
    const v = c.get(r);
    let colour = INK;
    // Cheapest green, middle orange, dearest red — the same three tiers the
    // workbook uses, so the two exports are read the same way.
    if (c.price && lo !== hi && typeof c.raw(r) === 'number') {
      const raw = c.raw(r);
      const [bg, fg] = raw === lo ? [GREEN_BG, GREEN] : raw === hi ? [RED_BG, RED] : [AMBER_BG, AMBER];
      doc.rect(x + 1, y + 1, c.w - 2, h - 2).fill(bg);
      colour = fg;
    }
    if (c.key === 'position') {
      colour = r.posture === 'undercut' ? RED : r.posture === 'winning' ? GREEN : r.posture === 'parity' ? AMBER : GREY;
    }

    useFont(doc, c.price || c.key === 'position');
    doc.fontSize(7.2).fillColor(colour)
      .text(clip(doc, v, c.w - 6), x + 3, y + 5, {
        width: c.w - 6, align: c.align === 'right' ? 'right' : 'left', lineBreak: false,
      });
    x += c.w;
  }
  doc.moveTo(left, y + h).lineTo(left + total, y + h).lineWidth(0.3).strokeColor('#E5EAF0').stroke();
  return y + h;
}

/**
 * Build the report. Returns a Buffer.
 *
 * Assembled in memory rather than streamed to the response: the row count is
 * bounded by saved comparisons, and a half-written PDF is a corrupt file.
 */
export async function buildPdf(rows, { filters = {}, ttlHours = 168 } = {}) {
  const doc = new PDFDocument({
    size: 'A4', layout: 'landscape', margins: { top: 44, bottom: 40, left: 28, right: 28 },
    info: { Title: 'PriceLens — Competitive Price Report', Author: 'PriceLens' },
  });

  const chunks = [];
  doc.on('data', (d) => chunks.push(d));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const meta = { generatedAt: new Date().toISOString(), ttlHours };
  const { left, right } = doc.page.margins;
  const width = doc.page.width - left - right;
  let page = 1;
  pageChrome(doc, meta, page);

  // ── Cover block
  useFont(doc, true);
  doc.fontSize(20).fillColor(NAVY).text('Competitive Price Report', left, 52, { width });
  useFont(doc);
  doc.fontSize(10).fillColor(GREY)
    .text('Tata CLIQ against Myntra and Ajio, product by product', left, 76, { width });
  doc.moveTo(left, 94).lineTo(left + width, 94).lineWidth(1.4).strokeColor(ROSE).stroke();
  doc.fontSize(8.4).fillColor(INK).text(describeFilters(filters), left, 102, { width });

  let y = 124;
  y = kpiStrip(doc, rows, y);
  y = sectionTitle(doc, 'Who is cheapest, who is dearest', y);
  y = platformSplit(doc, rows, y);

  // ── Action list: the rows that cost money, worst first
  const undercut = rows.filter((r) => r.posture === 'undercut').slice(0, 8);
  if (undercut.length) {
    y = sectionTitle(doc, 'Largest gaps — where a competitor undercuts Tata CLIQ', y + 6);
    for (const r of undercut) {
      useFont(doc, true);
      doc.fontSize(8.4).fillColor(RED).text(money(r.priceGap), left, y, { width: 54, align: 'right' });
      useFont(doc);
      doc.fontSize(8.4).fillColor(INK)
        .text(clip(doc, `${r.brand} — ${r.title}`, width - 320), left + 62, y,
              { width: width - 320, lineBreak: false });
      doc.fontSize(8.4).fillColor(GREY)
        .text(`${money(r.cliqPrice)} vs ${money(r.cheapestPrice)} on ${r.cheapestPlatform}`,
              left + width - 230, y, { width: 230, align: 'right' });
      y += 14;
    }
  }

  // ── Full table, paginated
  doc.addPage();
  pageChrome(doc, meta, ++page);
  y = sectionTitle(doc, 'Every product in this report', 48);
  y = tableHeader(doc, y);
  let zebra = false;
  for (const r of rows) {
    if (y > doc.page.height - 60) {
      doc.addPage();
      pageChrome(doc, meta, ++page);
      y = tableHeader(doc, 48);
      zebra = false;
    }
    y = tableRow(doc, r, y, zebra);
    zebra = !zebra;
  }

  useFont(doc);
  doc.fontSize(7).fillColor(GREY).text(
    `Prices are as at each product's match date, not live quotes; saved comparisons are replayed for `
    + `${ttlHours} hours before re-scraping. A blank price means no comparable listing was proven on that `
    + `platform — never that the product is unavailable.`,
    left, y + 8, { width });

  doc.end();
  return done;
}

/** Filename that says what is inside without opening it. */
export function pdfFilename(filters = {}) {
  const parts = ['pricelens'];
  if (filters.genders?.length === 1) parts.push(filters.genders[0]);
  if (filters.categories?.length === 1) parts.push(filters.categories[0]);
  if (filters.brands?.length === 1) parts.push(filters.brands[0].toLowerCase().replace(/[^a-z0-9]+/g, '-'));
  if (filters.position && filters.position !== 'all') parts.push(filters.position);
  parts.push(new Date().toISOString().slice(0, 10));
  return `${parts.join('-')}.pdf`;
}
