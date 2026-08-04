import { garmentColor, deltaE } from '../src/lib/imagecolor.mjs';
import { readFile } from 'node:fs/promises';

const SP = 'C:/Users/ambuj/AppData/Local/Temp/claude/C--Users-ambuj-Downloads-tata-cliq/43da2add-74b8-430b-b045-7a86510ff690/scratchpad';

const cliq = await garmentColor(await readFile(SP + '/cliq_prod.jpg'));
const myn = await garmentColor(await readFile(SP + '/myntra_prod.jpg'));
console.log('CLIQ   garment rgb', cliq.rgb, 'lab', cliq.lab.map((x) => +x.toFixed(1)), 'px', cliq.sampled);
console.log('MYNTRA garment rgb', myn.rgb, 'lab', myn.lab.map((x) => +x.toFixed(1)), 'px', myn.sampled);
console.log('\n>>> Delta-E (CLIQ "Orange" vs Myntra "Yellow"):', deltaE(cliq.lab, myn.lab), '  (<12 = same colourway ✓)');

// Synthetic negatives — same as CLIQ but recoloured, to show discrimination
import { garmentColor as gc } from '../src/lib/imagecolor.mjs';
import sharp from 'sharp';
async function tint(buf, r, g, b) {
  return sharp(buf).modulate({ saturation: 0.2 }).tint({ r, g, b }).jpeg().toBuffer();
}
const buf = await readFile(SP + '/myntra_prod.jpg');
const blue = await gc(await tint(buf, 40, 60, 200));
const black = await gc(await tint(buf, 20, 20, 20));
console.log('\nControl — recoloured versions of the same shirt:');
console.log('  vs BLUE  tint: Delta-E', deltaE(cliq.lab, blue.lab), '(should be LARGE → rejected)');
console.log('  vs BLACK tint: Delta-E', deltaE(cliq.lab, black.lab), '(should be LARGE → rejected)');
