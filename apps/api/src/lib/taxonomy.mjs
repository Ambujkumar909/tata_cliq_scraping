/**
 * Taxonomy — ALL category-specific vocabulary lives here, as data.
 *
 * Design contract
 * ---------------
 * The matching ENGINE (gates, evidence weights, image pipeline, semantics) is
 * category-agnostic. What varies by category — garment words, fit words, shade
 * names, attribute key spellings — is pure data, collected in this one file so
 * that supporting a new category means EXTENDING A TABLE, never editing logic.
 *
 * Every consumer of this data must degrade gracefully on unknown vocabulary:
 * an unrecognised garment/fit/shade yields `null`, `null` means UNKNOWN, and
 * unknown is never treated as a mismatch. The universal signals — brand, MRP,
 * price, model codes, title/description semantics, image colour (backdrop-
 * learned) and image structure — carry the decision when vocabulary is silent.
 * Category vocabulary only ever ADDS precision on top; its absence must never
 * subtract correctness.
 *
 * Runtime extension (no deploy): drop a `data/taxonomy.custom.json` file with
 * any of the keys below — arrays are appended, objects are merged:
 *   {
 *     "GARMENT_RULES": [["lipstick", "\\blip\\s?sticks?\\b"]],
 *     "COLOR_FAMILY": { "seafoam": "green" },
 *     "FIT_TOKENS": ["athletic"],
 *     "SYNONYMS": { "sneaker": "shoes" },
 *     "BRAND_ALIASES": [["marks and spencer", "marks spencer"]]
 *   }
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// ── Brand aliases ─────────────────────────────────────────────
export const BRAND_ALIASES = new Map([
  ['us polo assn', 'u s polo assn'],
  ['the souled store', 'souled store'],
  ['levis', 'levi s'],
  ['louis philippe jeans', 'louis philippe'],
  ['van heusen sport', 'van heusen'],
  ['adidas originals', 'adidas'],
]);

// ── Garment / product types (regex rules, first match wins) ───
export const GARMENT_RULES = [
  ['polo', /\bpolo\b/],
  ['tshirt', /\bt[\s-]?shirts?\b|\btees?\b/],
  ['sweatshirt', /\bsweat[\s-]?shirts?\b|\bhoodies?\b|\bsweaters?\b|\bpullovers?\b/],
  ['jacket', /\bjackets?\b|\bblazers?\b|\bcoats?\b/],
  ['shirt', /\bshirts?\b/],
  ['jeans', /\bjeans?\b/],
  ['trousers', /\btrousers?\b|\bpants?\b|\bchinos?\b|\bjoggers?\b|\btrackpants?\b/],
  ['shorts', /\bshorts?\b/],
  ['kurta', /\bkurtas?\b|\bkurtis?\b/],
  ['saree', /\bsarees?\b|\bsaris?\b/],
  ['dress', /\bdress(es)?\b|\bgowns?\b|\bfrocks?\b/],
  ['top', /\btops?\b|\btunic|\bblouse/],
  ['skirt', /\bskirts?\b/],
  // Footwear SUBTYPES, most specific first — a sandal is not a flat is not a
  // loafer. One "shoes" bucket audit-measurably matched "Casual Sandals" to
  // "Open Toe Flats"; every one of a 220-decision audit's false positives was
  // this single hole. Same-family synonyms stay grouped (slider≈sandal).
  ['heels', /\bheels?\b|\bpumps?\b|\bstilettos?\b|\bwedges?\b/],
  ['flats', /\bflats?\b|\bballerinas?\b|\bballet\s?flats?\b|\bmary\s?janes?\b/],
  ['sandals', /\bsandals?\b|\bsliders?\b|\bflip[\s-]?flops?\b|\bslippers?\b/],
  ['boots', /\bboots?\b/],
  ['loafers', /\bloafers?\b|\bmoccasins?\b|\bmules?\b/],
  ['shoes', /\bshoes?\b|\bsneakers?\b|\btrainers?\b|\boxfords?\b|\bderb(?:y|ies)\b/],
  ['watch', /\bwatch(es)?\b/],
  ['belt', /\bbelts?\b/],
  ['bag', /\bhandbags?\b|\bbackpacks?\b|\bwallets?\b|\bbags?\b/],
];

// ── Fit vocabulary, MOST SPECIFIC FIRST ───────────────────────
export const FIT_TOKENS = [
  'skinny', 'slim', 'bootcut', 'boot cut', 'straight', 'tapered', 'cropped',
  'relaxed', 'oversized', 'loose', 'boxy', 'muscle', 'regular', 'comfort',
];
export const FIT_CANON = { comfort: 'regular', 'boot cut': 'bootcut' };

// ── Base colour words + shade→family map ──────────────────────
export const BASE_COLORS = ['black', 'white', 'blue', 'red', 'green', 'yellow', 'grey',
  'brown', 'pink', 'purple', 'maroon', 'beige', 'orange'];

export const COLOR_WORDS = [...BASE_COLORS, 'navy', 'gray', 'olive', 'cream', 'khaki',
  'teal', 'mustard', 'wine', 'rust', 'lavender', 'peach', 'coral', 'charcoal', 'gold', 'silver'];

export const COLOR_FAMILY = {
  navy: 'blue', teal: 'blue', turquoise: 'blue', denim: 'blue', indigo: 'blue',
  aqua: 'blue', cobalt: 'blue', sky: 'blue', azure: 'blue',
  charcoal: 'grey', gray: 'grey', silver: 'grey', anthracite: 'grey', slate: 'grey',
  graphite: 'grey', gunmetal: 'grey', ash: 'grey', smoke: 'grey', steel: 'grey',
  wine: 'maroon', burgundy: 'maroon', plum: 'maroon', berry: 'maroon',
  rust: 'brown', tan: 'brown', coffee: 'brown', chocolate: 'brown', taupe: 'brown',
  mocha: 'brown', walnut: 'brown', cognac: 'brown', bronze: 'brown', copper: 'brown',
  khaki: 'beige', camel: 'beige', sand: 'beige', nude: 'beige', ecru: 'beige',
  stone: 'beige', oatmeal: 'beige', natural: 'beige',
  cream: 'white', ivory: 'white', offwhite: 'white', pearl: 'white', snow: 'white',
  mustard: 'yellow', gold: 'yellow', lemon: 'yellow', ochre: 'yellow',
  coral: 'pink', peach: 'pink', rose: 'pink', blush: 'pink', magenta: 'pink',
  fuchsia: 'pink', salmon: 'pink',
  lavender: 'purple', lilac: 'purple', violet: 'purple', mauve: 'purple',
  olive: 'green', mint: 'green', sage: 'green', emerald: 'green', forest: 'green',
  lime: 'green', pista: 'green', seagreen: 'green',
  ebony: 'black', onyx: 'black', jet: 'black', midnight: 'black', carbon: 'black',
  crimson: 'red', scarlet: 'red', cherry: 'red', brick: 'red', rouge: 'red',
};

// ── Cross-platform token synonyms (semantic layer) ────────────
export const SYNONYMS = {
  tee: 'tshirt', tees: 'tshirt', tshirts: 'tshirt',
  crew: 'round', crewneck: 'round', roundneck: 'round',
  halfsleeve: 'short', half: 'short', fullsleeve: 'long', full: 'long',
  graphic: 'printed', typography: 'printed', print: 'printed', prints: 'printed',
  printed: 'printed', slogan: 'printed',
  pant: 'trouser', pants: 'trouser', trousers: 'trouser', chino: 'trouser', chinos: 'trouser',
  jean: 'jeans', denims: 'jeans', denim: 'jeans',
  sneaker: 'shoes', sneakers: 'shoes', footwear: 'shoes',
  hoodie: 'sweatshirt', hoodies: 'sweatshirt', pullover: 'sweatshirt', sweater: 'sweatshirt',
  blazer: 'jacket', coat: 'jacket',
  colour: 'color', colours: 'color', coloured: 'color', colorblocked: 'colorblock',
  colourblocked: 'colorblock', block: 'colorblock',
  mens: 'men', man: 'men', gents: 'men',
  womens: 'women', woman: 'women', ladies: 'women',
  relax: 'relaxed', relaxedfit: 'relaxed',
  lycra: 'elastane', spandex: 'elastane',
};

// ── Denim / wash discriminators ───────────────────────────────
// What actually separates two same-brand same-colour jeans: the wash and the
// distress treatment. Most specific first; first match wins.
export const FADE_RULES = [
  ['clean', /\bno[\s-]?fade\b|\bclean[\s-]?look\b|\brinse(d)?[\s-]?wash\b|\bunwashed\b/],
  ['heavy', /\bheav(?:y|ily)[\s-]?(?:fade|faded|wash|washed)\b|\bacid[\s-]?wash\b|\bstone[\s-]?wash\b/],
  ['light', /\blight(?:ly)?[\s-]?(?:fade|faded|wash|washed)\b/],
  ['mid', /\bmid[\s-]?(?:fade|wash)\b|\bmedium[\s-]?wash(?:ed)?\b/],
  ['dark', /\bdark[\s-]?wash(?:ed)?\b/],
];
export const DISTRESS_RULES = [
  ['heavy', /\bhigh(?:ly)?[\s-]?distress(?:ed)?\b|\bripped\b|\bdestroyed\b|\btorn\b/],
  ['light', /\b(?:low|light(?:ly)?)[\s-]?distress(?:ed)?\b/],
  ['clean', /\bnon[\s-]?distress(?:ed)?\b/],
];

// ── Attribute key spellings per platform ──────────────────────
export const KEY_ALIASES = {
  fit: ['Fit'],
  fabric: ['Fabric', 'Fabrics', 'Fabric Composition', 'Material'],
  washCare: ['Wash', 'Wash Care', 'Wash care'],
  neck: ['Neck/Collar', 'Neck', 'Collar'],
  sleeve: ['Sleeve', 'Sleeve Length'],
  pattern: ['Pattern', 'Patterns', 'Print or Pattern Types'],
  closure: ['Closure'],
  pockets: ['Number of Pockets', 'Pockets'],
  occasion: ['Occasions', 'Occasion'],
  weave: ['Weave Type', 'Weave'],
  length: ['Length'],
  rise: ['Rise', 'Waist Rise'],
  sustainable: ['Sustainable'],
};

// ── Image sampling region per product class ───────────────────
// Unknown product types use 'object' — centred box, backdrop-learned exclusion.
export const GARMENT_REGION = {
  jeans: 'bottom', trousers: 'bottom', shorts: 'bottom', skirt: 'bottom',
  shoes: 'footwear', heels: 'footwear', flats: 'footwear', sandals: 'footwear',
  boots: 'footwear', loafers: 'footwear',
  watch: 'object', bag: 'object', belt: 'object',
  tshirt: 'top', polo: 'top', shirt: 'top', sweatshirt: 'top', jacket: 'top',
  kurta: 'top', saree: 'top', dress: 'top', top: 'top',
};

// ── Runtime extension: data/taxonomy.custom.json ──────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  const custom = JSON.parse(
    readFileSync(resolve(__dirname, '..', '..', 'data', 'taxonomy.custom.json'), 'utf8'),
  );
  for (const [name, alias] of custom.BRAND_ALIASES || []) BRAND_ALIASES.set(name, alias);
  for (const [type, re] of custom.GARMENT_RULES || []) GARMENT_RULES.push([type, new RegExp(re)]);
  for (const t of custom.FIT_TOKENS || []) if (!FIT_TOKENS.includes(t)) FIT_TOKENS.push(t);
  Object.assign(COLOR_FAMILY, custom.COLOR_FAMILY || {});
  Object.assign(SYNONYMS, custom.SYNONYMS || {});
  Object.assign(GARMENT_REGION, custom.GARMENT_REGION || {});
  for (const [k, v] of Object.entries(custom.KEY_ALIASES || {})) {
    KEY_ALIASES[k] = [...new Set([...(KEY_ALIASES[k] || []), ...v])];
  }
  console.log('[taxonomy] merged data/taxonomy.custom.json');
} catch { /* no custom taxonomy — defaults only */ }
