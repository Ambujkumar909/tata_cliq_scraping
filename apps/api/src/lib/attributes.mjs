/**
 * Canonical attribute layer.
 *
 * Every platform describes the same garment in its own vocabulary:
 *
 *   CLIQ    Fabric: "Single Jersey, 100% Cotton"   Fit: "Regular"       Neck/Collar: "Round Neck"
 *   Myntra  Fabrics: "Pure Cotton"                 Fit: "Regular Fit"   Neck: "Round Neck"
 *   Ajio    (no PDP — attributes must come from the title)
 *
 * Comparing those raw strings would report differences that do not exist. This
 * module resolves all three into ONE vocabulary so the report compares meaning,
 * not phrasing, and so "100% Cotton" vs "Pure Cotton" scores as agreement.
 *
 * Every extractor also falls back to the title, which is what keeps Ajio — hard
 * 403 on its PDP — comparable on the attributes a title can carry.
 */
import { normalizeText, detectFit, detectPattern } from './normalize.mjs';

// ── Platform key aliases ──────────────────────────────────────
// Canonical field → the key each platform files it under. Data lives in
// taxonomy.mjs; extend via data/taxonomy.custom.json, never by editing logic.
import { KEY_ALIASES, FADE_RULES, DISTRESS_RULES } from './taxonomy.mjs';

/** Look a canonical field up across a platform's raw attribute bag. */
function raw(attrs, field) {
  if (!attrs) return null;
  for (const k of KEY_ALIASES[field] || []) {
    if (attrs[k] != null && String(attrs[k]).trim()) return String(attrs[k]).trim();
  }
  return null;
}

const firstMatch = (text, rules) => {
  const t = ` ${normalizeText(text)} `;
  for (const [value, re] of rules) if (re.test(t)) return value;
  return null;
};

// ── Fabric composition ────────────────────────────────────────
// Weave/knit words are construction, not fibre — they must not be read as a
// material or "Single Jersey, 100% Cotton" would look unlike "Pure Cotton".
const WEAVE_WORDS = /\b(single jersey|jersey|knitted|woven|twill|poplin|denim|fleece|terry|pique|rib|interlock|corduroy|satin|chiffon|georgette|crepe)\b/gi;

const FIBRES = [
  'cotton', 'polyester', 'elastane', 'spandex', 'lycra', 'viscose', 'rayon', 'nylon',
  'linen', 'wool', 'silk', 'modal', 'acrylic', 'lyocell', 'tencel', 'bamboo', 'cashmere',
  'polyamide', 'leather', 'denim',
];

/**
 * Parse a fabric string into a normalised composition.
 *   "98% Cotton, 2% Elastane" → [{cotton,98},{elastane,2}]
 *   "Pure Cotton" / "100% Cotton" / "Single Jersey, 100% Cotton" → [{cotton,100}]
 *   "Cotton Blend" → [{cotton,null}] blend:true
 */
export function parseFabric(text) {
  if (!text) return null;
  const cleaned = String(text).replace(WEAVE_WORDS, ' ');
  const t = cleaned.toLowerCase();
  const composition = [];

  // Explicit percentages first.
  const re = /(\d{1,3}(?:\.\d+)?)\s*%\s*([a-z]+)/g;
  let m;
  while ((m = re.exec(t))) {
    const fibre = FIBRES.find((f) => m[2].startsWith(f.slice(0, 5)));
    if (fibre) composition.push({ material: fibre, pct: Number(m[1]) });
  }

  if (!composition.length) {
    const pure = /\b(pure|100)\b/.test(t);
    const blend = /\bblend(ed)?\b/.test(t);
    for (const f of FIBRES) {
      if (new RegExp(`\\b${f}\\b`).test(t)) composition.push({ material: f, pct: pure && !blend ? 100 : null });
    }
    if (!composition.length) return null;
    return {
      composition,
      primary: composition[0].material,
      blend: blend || composition.length > 1,
      raw: String(text),
    };
  }

  composition.sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0));
  return {
    composition,
    primary: composition[0].material,
    blend: composition.length > 1,
    raw: String(text),
  };
}

/** Elastane/spandex/lycra content decides stretch. */
export function stretchFrom(fabric, text) {
  const el = fabric?.composition?.find((c) => ['elastane', 'spandex', 'lycra'].includes(c.material));
  if (el) {
    if (el.pct == null) return 'stretchable';
    return el.pct >= 3 ? 'stretchable' : 'slight stretch';
  }
  const t = ` ${normalizeText(text)} `;
  if (/\b(stretchable|stretch)\b/.test(t)) return 'stretchable';
  if (/\bnon stretch\b/.test(t)) return 'non stretch';
  return fabric ? 'non stretch' : null;
}

// ── Individual attribute extractors ───────────────────────────
// Wash/fade and distress — the discriminators that separate two same-brand,
// same-colour, same-fit jeans. Audit-observed failure class: commodity denim.
export const detectFade = (t) => firstMatch(t, FADE_RULES);
export const detectDistress = (t) => firstMatch(t, DISTRESS_RULES);

export const detectRise = (t) =>
  firstMatch(t, [
    ['mid rise', /\b(mid|medium)[\s-]?rise\b/],
    ['high rise', /\b(high|higher)[\s-]?rise\b/],
    ['low rise', /\b(low|lower)[\s-]?rise\b/],
  ]);

export const detectNeck = (t) =>
  firstMatch(t, [
    ['polo collar', /\bpolo\b|\bcollar\b(?!.*\bround\b)/],
    ['round neck', /\bround[\s-]?neck\b|\bcrew[\s-]?neck\b/],
    ['v neck', /\bv[\s-]?neck\b/],
    ['henley', /\bhenley\b/],
    ['mandarin', /\bmandarin\b|\bchinese collar\b/],
    ['hooded', /\bhood(ed)?\b/],
    ['boat neck', /\bboat[\s-]?neck\b/],
    ['square neck', /\bsquare[\s-]?neck\b/],
    ['spread collar', /\bspread collar\b/],
  ]);

export const detectSleeve = (t) =>
  firstMatch(t, [
    ['sleeveless', /\bsleeve[\s-]?less\b|\btank\b/],
    ['three quarter', /\bthree[\s-]?quarter\b|\b3\/4\b/],
    ['short sleeves', /\bshort[\s-]?sleeves?\b|\bhalf[\s-]?sleeves?\b|\bshort\b/],
    ['long sleeves', /\blong[\s-]?sleeves?\b|\bfull[\s-]?sleeves?\b/],
  ]);

export const detectClosure = (t) =>
  firstMatch(t, [
    ['button & zip', /\bbutton\b.*\bzip\b|\bzip\b.*\bbutton\b/],
    ['zip', /\bzip(per|ped)?\b/],
    ['button', /\bbutton(ed)?\b/],
    ['drawstring', /\bdraw[\s-]?string\b/],
    ['elastic', /\belastic(ated)?\b/],
    ['pull on', /\bpull[\s-]?on\b|\bslip[\s-]?on\b/],
    ['hook', /\bhook\b/],
  ]);

/** Pockets can be a count ("5"), a phrase ("Two Pockets") or absent. */
export function detectPockets(value, text) {
  const src = value != null ? String(value) : '';
  const num = src.match(/\b(\d{1,2})\b/);
  if (num) return Number(num[1]);
  const words = { no: 0, zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
  const w = normalizeText(src).split(' ').find((x) => x in words);
  if (w) return words[w];
  const t = normalizeText(text || '');
  const tw = t.match(/\b(one|two|three|four|five|six|\d{1,2})\s+pockets?\b/);
  if (tw) return tw[1] in words ? words[tw[1]] : Number(tw[1]);
  return null;
}

export const detectOccasion = (t) =>
  firstMatch(t, [
    ['formal', /\bformal\b|\boffice\b|\bbusiness\b/],
    ['party', /\bparty\b|\bevening\b/],
    ['sports', /\bsports?\b|\bactive\b|\bgym\b|\btraining\b|\bworkout\b/],
    ['ethnic', /\bethnic\b|\bfestive\b|\bwedding\b/],
    ['casual', /\bcasual\b|\bcasuals\b|\beveryday\b|\blounge\b/],
  ]);

// A "Regular Fit" and a "Regular" are the same fit; normalise the suffix away.
const FIT_CANON = { comfort: 'regular', athletic: 'athletic tapered', straight: 'regular' };
function canonFit(value, title) {
  const v = normalizeText(value || '').replace(/\bfit\b/g, '').trim();
  const direct = v ? detectFit(v) || v.split(' ')[0] : null;
  const f = direct || detectFit(title);
  return f ? FIT_CANON[f] || f : null;
}

/**
 * Resolve one platform's product + PDP detail into the canonical attribute set
 * the report renders and the matcher scores.
 */
export function canonicalAttributes(product = {}, detail = {}) {
  const attrs = detail?.attributes || null;
  const title = product.title || '';
  const desc = detail?.description || '';
  // Title first for garment shape words, description as a weaker backstop.
  const text = `${title} ${desc}`;

  const fabricRaw = raw(attrs, 'fabric');
  const fabric = parseFabric(fabricRaw || text);
  const patternRaw = raw(attrs, 'pattern');

  return {
    fit: canonFit(raw(attrs, 'fit'), title),
    rise: detectRise(raw(attrs, 'rise') || text),
    fade: detectFade(text),
    distress: detectDistress(text),
    pattern: patternRaw ? detectPattern(patternRaw) || normalizeText(patternRaw) : detectPattern(title),
    color: product.color ? normalizeText(product.color) : null,
    material: fabric?.primary || null,
    fabricComposition: fabric,
    stretch: stretchFrom(fabric, text),
    closure: detectClosure(raw(attrs, 'closure') || text),
    pockets: detectPockets(raw(attrs, 'pockets'), text),
    neck: detectNeck(raw(attrs, 'neck') || title),
    sleeve: detectSleeve(raw(attrs, 'sleeve') || title),
    washCare: raw(attrs, 'washCare') ? normalizeText(raw(attrs, 'washCare')) : null,
    weave: raw(attrs, 'weave') ? normalizeText(raw(attrs, 'weave')) : null,
    occasion: detectOccasion(raw(attrs, 'occasion') || text),
    countryOfOrigin: detail?.countryOfOrigin ? normalizeText(detail.countryOfOrigin) : null,
  };
}

/**
 * Content-quality metrics — the report's "Content Quality" band.
 *
 * When the PDP could not be read (Ajio is hard-403), every metric is UNKNOWN,
 * not zero. Returning zeros would render as "0 words / 0 specifications" in red
 * and read as "this retailer has poor content", when the truth is that we could
 * not see it. Unknown must stay unknown.
 */
export function contentQuality(product = {}, detail = {}) {
  if (!detail?.available) {
    return {
      descriptionWords: null,
      bulletPoints: null,
      specificationsListed: null,
      imageCount: null,
      videoAvailable: null,
      available: false,
    };
  }
  const desc = detail?.description || '';
  const words = desc ? desc.split(/\s+/).filter(Boolean).length : 0;
  const specs = detail?.attributes ? Object.keys(detail.attributes).length : 0;
  return {
    descriptionWords: words,
    bulletPoints: detail?.bulletPoints ?? specs,
    specificationsListed: specs,
    imageCount: detail?.imageCount ?? (product.image ? 1 : 0),
    videoAvailable: Boolean(detail?.videoAvailable),
    available: true,
  };
}

// ── Attribute agreement scoring ───────────────────────────────
// Weighted because these attributes are not equally identifying: a fit or rise
// mismatch means a different product, an occasion mismatch is mostly noise.
const ATTR_WEIGHTS = {
  fit: 1.6, rise: 1.4, material: 1.5, pattern: 1.3, fade: 1.3, neck: 1.2,
  distress: 1.1, sleeve: 1.0, closure: 0.9, pockets: 0.8, stretch: 0.8,
  weave: 0.6, washCare: 0.5, occasion: 0.4, countryOfOrigin: 0.4,
};

// Free-text attributes are phrased loosely — CLIQ "gentle machine wash" vs
// Myntra "machine wash" is the same instruction, not a difference. Score those
// by token containment/overlap instead of string equality.
const FUZZY_TEXT_FIELDS = new Set(['washCare', 'weave', 'occasion']);

function textAgreement(a, b) {
  const na = normalizeText(a), nb = normalizeText(b);
  if (na && na === nb) return 1;
  const ta = new Set(na.split(' ').filter(Boolean));
  const tb = new Set(nb.split(' ').filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  if (!inter) return 0;
  // One phrase fully containing the other = same instruction, extra qualifier.
  if (inter === ta.size || inter === tb.size) return 0.9;
  return inter / (ta.size + tb.size - inter);
}

function fabricAgreement(a, b) {
  if (!a || !b) return null;
  if (a.primary !== b.primary) return 0;
  const pa = a.composition.find((c) => c.material === a.primary)?.pct;
  const pb = b.composition.find((c) => c.material === b.primary)?.pct;
  if (pa == null || pb == null) return 0.85; // same primary fibre, unknown ratio
  return Math.abs(pa - pb) <= 2 ? 1 : Math.abs(pa - pb) <= 10 ? 0.75 : 0.4;
}

/**
 * Compare two canonical attribute sets.
 * Only fields BOTH sides declare are scored — an attribute the competitor never
 * published is unknown, not a difference, and is reported as 'na'.
 */
export function attributeMatch(a = {}, b = {}) {
  const fields = [];
  let num = 0, den = 0;

  for (const [key, weight] of Object.entries(ATTR_WEIGHTS)) {
    const av = key === 'material' ? a.fabricComposition?.primary ?? a.material : a[key];
    const bv = key === 'material' ? b.fabricComposition?.primary ?? b.material : b[key];

    if (av == null || bv == null) {
      fields.push({ key, a: av ?? null, b: bv ?? null, verdict: 'na', agreement: null });
      continue;
    }

    let agreement;
    if (key === 'material') {
      agreement = fabricAgreement(a.fabricComposition, b.fabricComposition);
      if (agreement == null) agreement = av === bv ? 1 : 0;
    } else if (key === 'pockets') {
      agreement = av === bv ? 1 : Math.abs(av - bv) === 1 ? 0.5 : 0;
    } else if (FUZZY_TEXT_FIELDS.has(key)) {
      agreement = textAgreement(av, bv);
    } else {
      agreement = String(av) === String(bv) ? 1 : 0;
    }

    num += agreement * weight;
    den += weight;
    fields.push({
      key,
      a: av,
      b: bv,
      agreement,
      verdict: agreement >= 0.99 ? 'match' : agreement >= 0.5 ? 'partial' : 'differ',
    });
  }

  return {
    score: den ? Number((num / den).toFixed(4)) : null,
    compared: fields.filter((f) => f.verdict !== 'na').length,
    agreed: fields.filter((f) => f.verdict === 'match').length,
    differing: fields.filter((f) => f.verdict === 'differ'),
    fields,
  };
}
