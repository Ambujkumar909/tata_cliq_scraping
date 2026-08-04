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

console.log('\n=== 2. CLIQ category → gender inference ===');
for (const code of ['MSH1116', 'WSH1102', 'BSH11', 'GSH11', 'ACC99']) {
  console.log(`  ${code} → ${genderFromCategory(code) || 'unknown'}`);
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
