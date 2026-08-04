#!/usr/bin/env node
/**
 * Rigorous exact-SKU accuracy audit.
 *
 *   node scripts/audit-accuracy.mjs [count=110]
 *
 * Sampling
 * --------
 * Anchors are pulled LIVE from Tata CLIQ across ~26 categories at random page
 * offsets, EXCLUDING everything in the ingested 2039-product catalog — so the
 * engine is tested on products it has never seen, the way a merchandiser will
 * actually use it.
 *
 * Scoring — two independent identity checklists, both reported
 * ------------------------------------------------------------
 *   STRICT   brand · garment · fit · colour family BOTH KNOWN AND EQUAL · MRP EXACT
 *   STANDARD brand · garment · fit · no colour-family CONFLICT · MRP within 5%
 *
 * Neither is perfect ground truth, which is why both are printed:
 *   • STRICT under-counts — the verified Louis Philippe pair (same product,
 *     MRP 1899 vs 1999, labelled Orange vs Yellow) FAILS strict.
 *   • STANDARD can over-count when a same-price same-colour sibling style slips
 *     the title tokens.
 * True exact-SKU precision therefore lies BETWEEN the two bounds. Every match
 * is dumped with both URLs for manual spot-checking.
 *
 * Verdicts per (anchor × source):
 *   TP  engine matched a checklist-passing candidate
 *   FP  engine matched a candidate that fails the checklist
 *   FN  engine said no-match but a checklist-passing candidate existed in an
 *       independently retrieved pool
 *   TN  engine said no-match and none existed
 */
import { readFile, writeFile } from 'node:fs/promises';
import { buildIdf } from '../src/lib/semantic.mjs';
import { searchTataCliq, fetchCliqAnchor } from '../src/sources/tatacliq.mjs';
import { searchMyntra } from '../src/sources/myntra.mjs';
import { searchAjio } from '../src/sources/ajio.mjs';
import { matchAnchor } from '../src/matching/matcher.mjs';
import {
  normalizeBrand, detectGarment, detectFit, stripBrand, colorFamily, brandScore,
} from '../src/lib/normalize.mjs';

const TARGET = Number(process.argv[2] || 110);
const OUT = 'data/audit-accuracy.json';

// Broad category spread — bottoms and non-apparel included on purpose; a
// tops-only sample would hide exactly the classes that failed before.
const TERMS = [
  'men slim fit jeans', 'men tapered fit jeans', 'women skinny jeans', 'men regular jeans',
  'men polo t-shirt', 'men printed t-shirt', 'women t-shirt', 'men solid t-shirt',
  'men formal shirt', 'men casual shirt', 'women shirt',
  'women kurta', 'men kurta', 'women dress', 'women top',
  'men sweatshirt', 'men jacket', 'men shorts', 'men chinos trousers', 'men track pants',
  'women handbag', 'men wallet', 'men analog watch', 'women watch',
  'running shoes men', 'women heels', 'men sneakers', 'women flats',
];

const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// ── Identity checklists ───────────────────────────────────────
function identity(anchor, cand) {
  const bs = brandScore(anchor.brand, cand.brand);
  const brandOk = bs >= 0.85 || normalizeBrand(anchor.brand) === normalizeBrand(cand.brand);

  const aG = anchor._garment || detectGarment(stripBrand(anchor.title, anchor.brand));
  const cG = detectGarment(stripBrand(cand.title, cand.brand), cand.articleType);
  const garmentOk = Boolean(aG && cG && aG === cG);

  const aFam = colorFamily(anchor.color) || colorFamily(anchor.title);
  const cFam = colorFamily(cand.color) || colorFamily(cand.title);
  const colorStrict = Boolean(aFam && cFam && aFam === cFam);
  const colorConflict = Boolean(aFam && cFam && aFam !== cFam);

  const aFit = detectFit(anchor.title), cFit = detectFit(cand.title);
  const fitOk = !(aFit && cFit && aFit !== cFit);

  const mrpExact = anchor.mrp != null && cand.mrp != null && Math.round(anchor.mrp) === Math.round(cand.mrp);
  const mrpNear = anchor.mrp != null && cand.mrp != null &&
    Math.abs(anchor.mrp - cand.mrp) / Math.max(anchor.mrp, cand.mrp) <= 0.05;

  return {
    strict: brandOk && garmentOk && fitOk && colorStrict && mrpExact,
    standard: brandOk && garmentOk && fitOk && !colorConflict && mrpNear,
    flags: { brandOk, garmentOk, fitOk, colorStrict, colorConflict, mrpExact, mrpNear, aFam, cFam, aFit, cFit, aG, cG },
  };
}

const SOURCES = { myntra: searchMyntra, ajio: searchAjio };

// ── Random live anchor selection, excluding the ingested catalog ──
async function pickAnchors(knownIds) {
  const seen = new Set();
  const picks = [];
  const perTerm = Math.ceil(TARGET / TERMS.length) + 1;
  for (const term of shuffle([...TERMS])) {
    if (picks.length >= TARGET) break;
    const page = Math.floor(Math.random() * 4); // random depth → different stock each run
    let r = await searchTataCliq(term, { page, pageSize: 30 });
    if (!(r.candidates || []).length && page > 0) r = await searchTataCliq(term, { page: 0, pageSize: 30 });
    const fresh = shuffle((r.candidates || []).filter(
      (c) => c.id && !knownIds.has(c.id) && !seen.has(c.id) && c.price != null && c.mrp != null && c.brand,
    ));
    for (const c of fresh.slice(0, perTerm)) {
      if (picks.length >= TARGET) break;
      seen.add(c.id);
      picks.push({ term, listing: c });
    }
  }
  return picks;
}

async function main() {
  const { products } = JSON.parse(await readFile('data/tatacliq.products.json', 'utf8'));
  const knownIds = new Set(products.map((p) => p.id));
  buildIdf(products.map((p) => `${p.brand} ${p.title}`));

  console.log(`\n🔬 EXACT-SKU AUDIT — ${TARGET} random LIVE Tata CLIQ products (catalog of ${knownIds.size} excluded)`);
  console.log(`   strictSku=ON · ${TERMS.length} categories · random page offsets\n`);

  const picks = await pickAnchors(knownIds);
  const inCatalog = picks.filter((p) => knownIds.has(p.listing.id)).length;
  console.log(`   selected ${picks.length} anchors (${inCatalog} from catalog — must be 0)\n`);

  const rows = [];
  let n = 0;
  // Small worker pool — sequential would take ~1h at 110 anchors. Three keeps
  // total load comparable to one interactive user per site.
  const CONCURRENCY = 3;
  let cursor = 0;
  async function auditOne({ term, listing }) {
    n++;
    let anchor;
    try {
      const got = await fetchCliqAnchor(listing.id);
      anchor = got.ok ? got.anchor : null;
    } catch { anchor = null; }
    if (!anchor) { process.stdout.write(`\r   [${n}/${picks.length}] resolve-failed ${listing.id}   `); return; }

    let cmp;
    try {
      cmp = await matchAnchor(anchor, { minScore: 0.58, strictSku: true });
    } catch (e) {
      rows.push({ id: anchor.id, term, src: 'both', verdict: 'ERROR', error: e.message });
      return;
    }
    // Resolve the anchor's garment the same way the matcher does: title first,
    // then the CLIQ category breadcrumb. Stored on the anchor so identity()
    // sees it for candidates whose own titles omit the garment word.
    let anchorGarment = detectGarment(stripBrand(anchor.title, anchor.brand));
    if (!anchorGarment) {
      for (const seg of [...(cmp.anchor.categoryPath || [])].reverse()) {
        anchorGarment = detectGarment(seg);
        if (anchorGarment) break;
      }
    }
    anchor._garment = anchorGarment;

    for (const [src, search] of Object.entries(SOURCES)) {
      const m = cmp.competitors[src];
      if (!m || m.status === 'blocked' || m.status === 'error') {
        rows.push({ id: anchor.id, term, src, verdict: 'BLOCKED', status: m?.status });
        continue;
      }

      // Independent pool for recall measurement.
      const pool = new Map();
      for (const q of [
        `${anchor.brand} ${anchor.title}`.slice(0, 80),
        `${anchor.brand} ${anchorGarment || term}`.slice(0, 60),
      ]) {
        try {
          const r = await search(q, { limit: 60, pages: 1 });
          for (const c of r.candidates || []) if (!pool.has(c.id)) pool.set(c.id, c);
        } catch { /* pool search failure → smaller pool, never a crash */ }
      }
      const poolArr = [...pool.values()];
      const strictPool = poolArr.filter((c) => identity(anchor, c).strict);
      const stdPool = poolArr.filter((c) => identity(anchor, c).standard);

      const matched = m.status === 'matched' ? m.product : null;
      const idn = matched ? identity(anchor, matched) : null;

      const verdictOf = (level, levelPool) => {
        if (matched && idn[level]) return 'TP';
        if (matched) return levelPool.length ? 'FP_MISSED_BETTER' : 'FP';
        return levelPool.length ? 'FN' : 'TN';
      };

      rows.push({
        id: anchor.id, term, src,
        verdictStrict: verdictOf('strict', strictPool),
        verdictStandard: verdictOf('standard', stdPool),
        status: m.status,
        rejectedBy: m.rejectedBy ?? null,
        nearest: m.nearest ? { title: m.nearest.title, mrp: m.nearest.mrp ?? null, score: m.nearest.score ?? null } : null,
        matchType: m.matchType ?? null,
        score: m.score ?? null,
        deltaE: m.imageCheck?.deltaE ?? null,
        anchor: { brand: anchor.brand, title: anchor.title, mrp: anchor.mrp, price: anchor.price, color: anchor.color, url: anchor.url },
        chosen: matched ? { id: matched.id, title: matched.title, mrp: matched.mrp, price: matched.price, color: matched.color, url: matched.url } : null,
        chosenFlags: idn?.flags ?? null,
        poolSize: poolArr.length,
        strictPoolCount: strictPool.length,
        stdPoolCount: stdPool.length,
        stdPoolExample: stdPool[0] ? { title: stdPool[0].title, mrp: stdPool[0].mrp, color: stdPool[0].color, url: stdPool[0].url } : null,
      });
    }
    process.stdout.write(`\r   [${n}/${picks.length}] ${anchor.brand.slice(0, 18).padEnd(18)}   `);
  }

  async function worker() {
    while (cursor < picks.length) {
      const pick = picks[cursor++];
      try {
        await auditOne(pick);
      } catch (e) {
        rows.push({ id: pick.listing.id, term: pick.term, src: 'both', verdict: 'ERROR', error: e.message });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, picks.length) }, worker));

  await writeFile(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), strictSku: true, rows }, null, 2));

  // ── Report ──────────────────────────────────────────────────
  const decided = rows.filter((r) => r.verdictStrict && r.verdictStrict !== 'BLOCKED' && r.verdictStrict !== 'ERROR');
  const stats = (key) => {
    const t = {};
    for (const r of decided) t[r[key]] = (t[r[key]] || 0) + 1;
    const tp = t.TP || 0, tn = t.TN || 0, fn = t.FN || 0;
    const fp = (t.FP || 0) + (t.FP_MISSED_BETTER || 0);
    return {
      t, tp, tn, fp, fn,
      precision: tp + fp ? tp / (tp + fp) : null,
      recall: tp + fn ? tp / (tp + fn) : null,
      accuracy: decided.length ? (tp + tn) / decided.length : null,
    };
  };
  const S = stats('verdictStrict');
  const D = stats('verdictStandard');
  const pct = (v) => (v == null ? ' — ' : `${Math.round(v * 100)}%`);

  console.log('\n\n' + '═'.repeat(84));
  console.log(`  EXACT-SKU AUDIT RESULT  ·  ${decided.length} decisions (${rows.length - decided.length} blocked/error)`);
  console.log('═'.repeat(84));
  console.log('                       STRICT (lower bound)     STANDARD (upper bound)');
  console.log(`  PRECISION            ${pct(S.precision).padEnd(24)}${pct(D.precision)}`);
  console.log(`  RECALL               ${pct(S.recall).padEnd(24)}${pct(D.recall)}`);
  console.log(`  ACCURACY (TP+TN)     ${pct(S.accuracy).padEnd(24)}${pct(D.accuracy)}`);
  console.log(`  counts strict        ${JSON.stringify(S.t)}`);
  console.log(`  counts standard      ${JSON.stringify(D.t)}`);
  console.log('═'.repeat(84));

  // Per-source split
  for (const src of ['myntra', 'ajio']) {
    const sub = decided.filter((r) => r.src === src);
    const tp = sub.filter((r) => r.verdictStandard === 'TP').length;
    const fp = sub.filter((r) => r.verdictStandard.startsWith('FP')).length;
    const fn = sub.filter((r) => r.verdictStandard === 'FN').length;
    const tn = sub.filter((r) => r.verdictStandard === 'TN').length;
    console.log(`  [${src.padEnd(6)}] standard: TP ${tp} FP ${fp} FN ${fn} TN ${tn}  → precision ${pct(tp + fp ? tp / (tp + fp) : null)}  accuracy ${pct(sub.length ? (tp + tn) / sub.length : null)}`);
  }

  // Failure dumps — every standard-level FP and FN, with URLs to verify by hand.
  const dump = (label, list, max = 20) => {
    if (!list.length) return;
    console.log(`\n  ▼ ${label} (${list.length})`);
    for (const r of list.slice(0, max)) {
      console.log(`   • [${r.src}] ${r.anchor.brand} — ${r.anchor.title.slice(0, 52)}`);
      console.log(`     anchor: MRP ${r.anchor.mrp} | ${r.anchor.color} | ${r.anchor.url}`);
      if (r.chosen) {
        const f = r.chosenFlags;
        const fails = [
          !f.brandOk && 'brand', !f.garmentOk && 'garment', !f.fitOk && 'fit',
          f.colorConflict && 'colourConflict', !f.mrpNear && 'mrp',
        ].filter(Boolean).join(',');
        console.log(`     chose : ${r.chosen.title.slice(0, 52)} | MRP ${r.chosen.mrp} | ${r.chosen.color} | ${r.matchType} ${Math.round((r.score || 0) * 100)}% | fails: ${fails || '(passes standard?)'}`);
        console.log(`             ${r.chosen.url}`);
      } else console.log(`     chose : NO MATCH (${r.status})`);
      if (r.stdPoolExample) console.log(`     pool  : ${r.stdPoolExample.title.slice(0, 52)} | MRP ${r.stdPoolExample.mrp} | ${r.stdPoolExample.color}`);
    }
  };
  dump('FALSE POSITIVES (standard)', decided.filter((r) => r.verdictStandard.startsWith('FP')));
  dump('FALSE NEGATIVES (standard)', decided.filter((r) => r.verdictStandard === 'FN'), 12);

  console.log(`\n✅ Full row-level detail → ${OUT}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
