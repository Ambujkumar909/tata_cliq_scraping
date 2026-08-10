#!/usr/bin/env node
/**
 * Pilot / batch matcher: for the first N Tata CLIQ anchor products, find the
 * same item on Myntra + Ajio and write a price-comparison dataset.
 *
 *   node scripts/match-competitors.mjs [limit]
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { matchMany } from '../src/matching/matcher.mjs';
import { fingerprint } from '../src/cache/persistence.mjs';
import { buildIdf } from '../src/lib/semantic.mjs';
import { config } from '../src/config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '..', 'data');
const IN = resolve(DATA_DIR, 'tatacliq.products.json');
const OUT = resolve(DATA_DIR, 'comparisons.json');

const LIMIT = Number(process.argv[2] || process.env.MATCH_LIMIT || 100);

async function main() {
  const { products } = JSON.parse(await readFile(IN, 'utf8'));
  const anchors = products.slice(0, LIMIT);

  // Train the semantic IDF model on the FULL catalog (not just the batch) so
  // title/description scoring matches what the running API does.
  buildIdf(products.map((p) => `${p.brand} ${p.title}`));

  console.log(`\n🔎 Matching ${anchors.length} Tata CLIQ products against Myntra + Ajio...`);
  console.log(`   minScore=${config.matchMinScore}  ·  IDF trained on ${products.length} titles\n`);

  const t0 = Date.now();
  const results = await matchMany(anchors, {
    concurrency: 5,
    minScore: config.matchMinScore,
    strictSku: config.strictSku,
    onProgress: (done, total, r) => {
      const m = r.competitors?.myntra;
      const tag =
        m?.status === 'matched'
          ? `✓ ₹${m.product.price} (${Math.round(m.score * 100)}% ${m.matchType})`
          : `· ${m?.status ?? 'error'}`;
      process.stdout.write(`\r  [${done}/${total}] ${r.anchor.brand} — ${tag}                              `);
    },
  });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  // Stats
  const statusOf = (r, k) => r.competitors?.[k]?.status ?? 'error';
  const matchedOn = (k) => results.filter((r) => statusOf(r, k) === 'matched');
  const myntraMatched = matchedOn('myntra').length;
  const ajioMatched = matchedOn('ajio').length;
  const imgConfirmed = results.filter((r) => r.competitors?.myntra?.imageCheck?.colorConfirmed).length;
  const ajioBlocked = results.filter((r) => statusOf(r, 'ajio') === 'blocked').length;
  const eitherMatched = results.filter(
    (r) => statusOf(r, 'myntra') === 'matched' || statusOf(r, 'ajio') === 'matched',
  ).length;

  const tierCount = {};
  for (const r of results) {
    for (const k of ['myntra', 'ajio']) {
      const m = r.competitors?.[k];
      if (m?.status === 'matched') tierCount[m.matchType] = (tierCount[m.matchType] || 0) + 1;
    }
  }

  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(
    OUT,
    // Stamp the engine identity: the store refuses a snapshot built by a
    // different matcher rather than replaying verdicts it would not reach.
    JSON.stringify(
      { count: results.length, generatedAt: new Date().toISOString(), fingerprint: fingerprint(), results },
      null,
      2,
    ),
  );

  const pc = (n) => `${Math.round((n / results.length) * 100)}%`;
  console.log('\n');
  console.log('─'.repeat(70));
  console.log(`  Matched in ${secs}s  (${(secs / results.length).toFixed(2)}s/product)`);
  console.log(`  Myntra matches      : ${myntraMatched}/${results.length}  (${pc(myntraMatched)})`);
  console.log(`     · image-colour confirmed : ${imgConfirmed}`);
  console.log(`  Ajio matches        : ${ajioMatched}/${results.length}  (${pc(ajioMatched)})  [blocked: ${ajioBlocked}]`);
  console.log(`  Any competitor      : ${eitherMatched}/${results.length}  (${pc(eitherMatched)})`);
  console.log(`  Confidence tiers    : ${Object.entries(tierCount).map(([k, v]) => `${k} ${v}`).join(' · ') || '—'}`);
  console.log('─'.repeat(70));

  console.log('\n  SAMPLE MATCHES (CLIQ vs Myntra):\n');
  let shown = 0;
  for (const r of results) {
    const m = r.competitors?.myntra;
    if (m?.status !== 'matched' || shown >= 8) continue;
    shown++;
    const diff = r.anchor.price - m.product.price;
    const cheaper = diff > 0 ? 'Myntra cheaper' : diff < 0 ? 'CLIQ cheaper' : 'price parity';
    const s = m.scores || {};
    const fmt = (v) => (v == null ? ' — ' : `${Math.round(v * 100)}%`);
    console.log(`  • ${r.anchor.brand} — ${r.anchor.title.slice(0, 44)}`);
    console.log(`      ↳ ${m.product.title.slice(0, 56)}`);
    console.log(
      `      CLIQ ₹${r.anchor.price} | Myntra ₹${m.product.price} → ${cheaper} ₹${Math.abs(diff)}` +
        `   [${m.matchType} ${Math.round(m.score * 100)}%]`,
    );
    console.log(
      `      title ${fmt(s.title)} · desc ${fmt(s.description)} · attrs ${fmt(s.attributes)} · image ${fmt(s.image)}`,
    );
  }
  console.log(`\n✅ Wrote ${OUT}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
