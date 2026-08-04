import { matchAnchor } from '../src/matching/matcher.mjs';

const anchor = {
  id: 'MP000000024358256',
  brand: 'Louis Philippe',
  title: 'Louis Philippe Orange Regular Fit Polo T-Shirt',
  color: 'Orange',
  mrp: 1899,
  price: 1310,
  currency: 'INR',
  discountPercent: 31,
  image: '//img.tatacliq.com/images/i21//437Wx649H/MP000000024358243_437Wx649H_202411120457581.jpeg',
  url: 'https://www.tatacliq.com/louis-philippe-orange-regular-fit-polo-tshirt/p-mp000000024358256',
  category: { l1: 'MSH11', l2: 'MSH1116', l3: 'MSH1116100' },
  styleCode: 'orange9656249319425',
};

// Train IDF so semantic scores match the running API.
try {
  const { readFile } = await import('node:fs/promises');
  const { buildIdf } = await import('../src/lib/semantic.mjs');
  const { products } = JSON.parse(await readFile('data/tatacliq.products.json', 'utf8'));
  buildIdf(products.map((p) => `${p.brand} ${p.title}`));
} catch {
  console.log('(no catalog for IDF training — scores will be untrained)\n');
}

const res = await matchAnchor(anchor);
const m = res.competitors.myntra;
console.log('=== LOUIS PHILIPPE: CLIQ "Orange" vs Myntra "Yellow" ===');
console.log('CLIQ  :', anchor.title, '| MRP', anchor.mrp, '| colour Orange');
console.log('query :', m.query);
console.log('status:', m.status, m.matchType ? `(${m.matchType})` : '');

if (m.status === 'matched') {
  const pct = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);
  console.log('MATCHED →', m.product.title);
  console.log('  Myntra MRP', m.product.mrp, '| price', m.product.price, '| colour(name)', m.product.color);
  console.log('  confidence', pct(m.score));
  console.log(`  sub-scores: title ${pct(m.scores.title)} · desc ${pct(m.scores.description)} ·`
    + ` attrs ${pct(m.scores.attributes)} · image ${pct(m.scores.image)}`);
  console.log('  imageCheck: Delta-E', m.imageCheck?.deltaE, '| colourConfirmed:', m.imageCheck?.colorConfirmed);
  console.log('  hard gates:', JSON.stringify(m.reasons));
  // MRP is 1899 (CLIQ) vs 1999 (Myntra) — NOT exact. v3's MRP gate rejected
  // this outright; v4 keeps it because every other signal agrees.
  console.log('  MRP exact?', m.signals?.mrpExact === 1, '→ v4 surfaces it on the remaining evidence');
  console.log('  why:', (m.why || []).join(' · '));
  if ((m.differences || []).length) console.log('  differences:', m.differences.join(' · '));
} else if (m.status === 'ambiguous') {
  // Strict-SKU mode flags this pair rather than auto-picking: two orange LP
  // polos at MRP 1999 whose images cannot be separated (scores 0.72 vs 0.67)
  // but whose prices differ ₹1059 vs ₹1779. Listing both for a human glance
  // IS the correct exact-SKU behaviour — this is how the pair was originally
  // verified too.
  console.log('AMBIGUOUS —', m.reason);
  for (const c of m.candidates || []) {
    console.log(`  • ${Math.round(c.score * 100)}%  ₹${c.price}  MRP ${c.mrp}  ${c.color}  ${c.title.slice(0, 56)}`);
    console.log(`      ${c.url}`);
  }
} else {
  console.log('nearest:', JSON.stringify(m.nearest, null, 2));
}
console.log('\nsummary prices:', res.summary.prices, '| cheapest:', res.summary.cheapest);
