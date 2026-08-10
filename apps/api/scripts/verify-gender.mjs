import { scoreMatch, detectGender, genderFromCategory } from '../src/lib/normalize.mjs';
import { readFile } from 'node:fs/promises';

console.log('=== 1. SYNTHETIC: identical product, opposite gender ===');
const menAnchor = { brand: 'Nike', title: 'Nike Men Black Regular Fit Solid Polo T-Shirt', color: 'Black', mrp: 1999, gender: 'men' };
const womenCand = { brand: 'Nike', title: 'Nike Women Black Regular Fit Solid Polo T-Shirt', color: 'Black', mrp: 1999, gender: 'women' };
const boysCand = { brand: 'Nike', title: 'Nike Boys Black Regular Fit Solid Polo T-Shirt', color: 'Black', mrp: 1999, gender: 'boys' };
const menCand = { brand: 'Nike', title: 'Nike Men Black Solid Polo Collar T-shirt', color: 'Black', mrp: 1999, gender: 'men' };

// Expected: only MEN→MEN is compatible. MEN→BOYS must now FAIL — adult and kids
// garments are different products. v3 allowed it because EXACT MRP was a hard
// gate that separated them; MRP is weighted evidence now, so age is gated here.
const EXPECT = { 'MEN→WOMEN': false, 'MEN→BOYS': false, 'MEN→MEN': true };
let genderPass = true;
for (const [label, c] of [['MEN→WOMEN', womenCand], ['MEN→BOYS', boysCand], ['MEN→MEN', menCand]]) {
  const s = scoreMatch(menAnchor, c);
  const ok = s.reasons.gender.ok === EXPECT[label];
  if (!ok) genderPass = false;
  console.log(
    `  ${label}: genderOk=${s.reasons.gender.ok} (${s.reasons.gender.anchor}/${s.reasons.gender.cand})` +
      `  expected ${EXPECT[label]} → ${ok ? '✅' : '❌'}`,
  );
}
console.log(`  gender-compatibility matrix: ${genderPass ? 'PASS ✅' : 'FAIL ❌'}`);

console.log('\n=== 2. Category-code → gender inference (NOT used for Tata CLIQ) ===');
for (const code of ['MSH1116', 'WSH1102', 'BSH11', 'GSH11', 'ACC99']) {
  console.log(`  ${code} → ${genderFromCategory(code) || 'unknown'}`);
}
// The prefix convention above is real for retailers that use it — but CLIQ's
// codes are a merchandise hierarchy, not a gender prefix, so the matcher reads
// the PDP gender field and breadcrumb instead. Prove it from the catalog rather
// than asserting it: if any code holds both men's and women's product, the
// first letter cannot be the gender.
try {
  const { products } = JSON.parse(await readFile('data/tatacliq.products.json', 'utf8'));
  const seen = new Map(); // l1 code -> Set of genders stated in titles
  for (const p of products) {
    const g = detectGender(p.title);
    if (!g) continue;
    const code = p.category?.l1;
    if (!code) continue;
    if (!seen.has(code)) seen.set(code, new Set());
    seen.get(code).add(g);
  }
  // Two independent ways the prefix can be shown false: one code holding more
  // than one gender, or a code whose contents contradict its own first letter.
  let contradictions = 0;
  for (const [code, gs] of seen) {
    const claimed = genderFromCategory(code);
    const bad = gs.size > 1 || ![...gs].includes(claimed);
    if (bad) contradictions++;
    console.log(
      `  catalog ${code} holds: ${[...gs].join(', ').padEnd(14)} first letter claims: ${String(claimed).padEnd(6)} ${bad ? '❌ contradicted' : '✓'}`,
    );
  }
  console.log(
    contradictions
      ? `  → ${contradictions}/${seen.size} CLIQ codes contradict the prefix rule — it is NOT a gender marker ✅ (correctly unused)`
      : '  → prefix rule not contradicted in this sample; CLIQ still uses the PDP gender field instead',
  );
} catch {
  console.log('  (no catalog yet — run `npm run ingest`)');
}

console.log('\n=== 3. AUDIT: any cross-gender match in real results? ===');
try {
  const { results } = JSON.parse(await readFile('data/comparisons.json', 'utf8'));
  let leaks = 0, checked = 0;
  for (const r of results) {
    for (const k of ['myntra', 'ajio']) {
      const m = r.competitors[k];
      if (m.status !== 'matched') continue;
      checked++;
      const a = m.reasons?.gender?.anchor, c = m.reasons?.gender?.cand;
      if (a && c && a !== c && a !== 'unisex' && c !== 'unisex') {
        leaks++;
        console.log(`  ⚠ LEAK: ${r.anchor.title.slice(0, 40)} [${a}] → ${m.product.title.slice(0, 40)} [${c}]`);
      }
    }
  }
  console.log(`  checked ${checked} matches → cross-gender leaks: ${leaks} ${leaks === 0 ? '✅' : '❌'}`);
} catch (e) {
  console.log('  (no comparisons.json yet)');
}
