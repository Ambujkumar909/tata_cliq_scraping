/**
 * Cross-platform size-chart comparison.
 *
 * Each source adapter publishes its chart in ONE canonical shape:
 *
 *   { imageUrl, dimensions:[axis…], units:['inch','cm'], rows,
 *     table:[{ size, brandSize, available, measurements:{ axis:{inch,cm} } }] }
 *
 * This module aligns those charts across Tata CLIQ / Myntra / Ajio and decides,
 * cell by cell, whether the platforms agree on the garment's measurements. A
 * disagreement here is a real merchandising defect — the same SKU listed with a
 * 41" chest on one platform and 40" on another means one of them will generate
 * returns — so the comparison is deliberately conservative:
 *
 *   1. MISSING ≠ MISMATCH. An axis or size one platform never published is
 *      'na' (grey), exactly as in the main report. Only two real numbers can
 *      disagree.
 *   2. UNIT ROUNDING IS NOT A MISMATCH. CLIQ stores centimetres and derives
 *      inches (97cm → 38.19"), Myntra publishes 38.0" flat. That 0.19" gap is
 *      an artefact of arithmetic, not a difference in the garment, so the
 *      match tolerance sits above it.
 *   3. BODY ≠ GARMENT. "To Fit Waist" is the wearer; "Waist" on a size chart is
 *      the cloth. Comparing the two invents a mismatch, so axes are compared
 *      only when their measurement basis agrees.
 */

/** Inches. Below this, two values are the same measurement. */
const MATCH_TOLERANCE_IN = Number(process.env.SIZECHART_TOLERANCE_IN || 0.4);
/** Inches. At or above this, the gap is a hard flag rather than a caution. */
const MAJOR_TOLERANCE_IN = Number(process.env.SIZECHART_MAJOR_IN || 1.0);

const PLATFORM_ORDER = ['tatacliq', 'myntra', 'ajio'];
const PLATFORM_LABEL = { tatacliq: 'Tata CLIQ', myntra: 'Myntra', ajio: 'Ajio' };

/**
 * Axis synonyms — STRICT equivalents only.
 *
 * "Length" is intentionally NOT folded into "Front Length": on a kurta or a
 * dress those are different measurements, and silently equating them would
 * manufacture both false matches and false mismatches. Unmatched axes render
 * as "not published" instead, which is honest.
 */
const AXIS_ALIASES = {
  Chest: ['chest', 'bust', 'to fit chest', 'to fit bust', 'chest width'],
  Waist: ['waist', 'to fit waist', 'waist width'],
  Hip: ['hip', 'hips', 'to fit hip', 'to fit hips'],
  Shoulder: ['shoulder', 'across shoulder', 'shoulder width', 'across shoulders'],
  'Front Length': ['front length', 'length front'],
  'Back Length': ['back length', 'length back'],
  Length: ['length', 'garment length', 'total length'],
  'Sleeve Length': ['sleeve length', 'sleeve', 'sleeves length'],
  Inseam: ['inseam', 'inseam length', 'inside leg', 'inside leg length'],
  Thigh: ['thigh', 'thigh width'],
  'Leg Opening': ['leg opening', 'bottom hem', 'hem', 'bottom width'],
  Neck: ['neck', 'collar', 'neck size'],
  'Foot Length': ['foot length', 'to fit foot length', 'footlength'],
  Cuff: ['cuff', 'cuff width'],
};

const AXIS_LOOKUP = new Map();
for (const [canonical, aliases] of Object.entries(AXIS_ALIASES)) {
  for (const a of aliases) AXIS_LOOKUP.set(a, canonical);
}

/** Display order — roughly top-of-garment to bottom, as size charts are drawn. */
const AXIS_ORDER = Object.keys(AXIS_ALIASES);

/**
 * "1. ACROSS SHOULDER" / "to fit waist" / "Chest (in)" → { axis, basis }.
 *
 * `basis` is 'body' for "to fit …" phrasing (CLIQ's marker for a wearer
 * measurement) and 'garment' otherwise, unless the adapter already said.
 */
export function canonicalAxis(raw, basisHint = null) {
  const cleaned = String(raw || '')
    .replace(/^\s*\d+\s*[.)]\s*/, '')       // ordinal prefix: "1. CHEST"
    .replace(/\((?:in|inch|inches|cm|cms)\)/gi, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (!cleaned) return null;
  const basis = basisHint || (/^to fit\b/.test(cleaned) ? 'body' : 'garment');
  const axis = AXIS_LOOKUP.get(cleaned) || null;
  if (axis) return { axis, basis };
  // Unknown axis: keep it, title-cased, so it still shows in the table. It
  // simply will not align with anything unless the other platform spells it
  // identically.
  return { axis: cleaned.replace(/\b[a-z]/g, (m) => m.toUpperCase()), basis };
}

/**
 * Size labels across platforms: "XXL" here, "2XL" there, " xl " somewhere else.
 * Numeric sizes (28, 32, 40) pass through untouched.
 */
export function canonicalSize(raw) {
  const s = String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!s) return null;
  if (/^(FREE|FREESIZE|ONESIZE|OS)$/.test(s)) return 'FREE';
  // XXL ⇄ 2XL, XXXL ⇄ 3XL, … — normalise onto the numeric form.
  const repeated = s.match(/^(X{2,})L$/);
  if (repeated) return `${repeated[1].length}XL`;
  const numeric = s.match(/^(\d+)XL$/);
  if (numeric) return `${Number(numeric[1])}XL`;
  return s;
}

/** Sort key so S < M < L < XL < 2XL, and numeric sizes sort numerically. */
const ALPHA_ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL'];
function sizeRank(size) {
  const i = ALPHA_ORDER.indexOf(size);
  if (i >= 0) return i;
  const nx = size.match(/^(\d+)XL$/);
  if (nx) return ALPHA_ORDER.length + Number(nx[1]);
  const num = Number(size);
  if (Number.isFinite(num)) return 1000 + num;
  return 2000;
}

/**
 * Both units where possible: CLIQ ships both, Myntra ships inches only.
 *
 * A measurement is an INTERVAL, not a point — plenty of CLIQ charts publish
 * "36 - 38" and Myntra ships minValue/maxValue. A point is simply [v, v]. The
 * interval is what the verdict is computed on; `inch`/`cm` remain the midpoint
 * so anything that just wants a number still works.
 */
function toBothUnits(m) {
  if (!m) return null;
  const inch = Number.isFinite(m.inch) ? m.inch : Number.isFinite(m.cm) ? m.cm / 2.54 : null;
  const cm = Number.isFinite(m.cm) ? m.cm : Number.isFinite(m.inch) ? m.inch * 2.54 : null;
  if (inch == null && cm == null) return null;
  const inchRange =
    m.inchRange ? m.inchRange
    : m.cmRange ? m.cmRange.map((v) => v / 2.54)
    : [inch, inch];
  const cmRange =
    m.cmRange ? m.cmRange
    : m.inchRange ? m.inchRange.map((v) => v * 2.54)
    : [cm, cm];
  return { inch, cm, inchRange, cmRange };
}

const round = (v, dp = 2) => (v == null ? null : Math.round(v * 10 ** dp) / 10 ** dp);

/**
 * Flatten one platform's chart into { sizeKey → { axisKey → {inch,cm} } },
 * plus the axis metadata encountered.
 */
function indexChart(guide) {
  const bySize = new Map();
  const axes = new Map(); // axisKey → { axis, basis, label }
  for (const row of guide?.table || []) {
    const size = canonicalSize(row?.size);
    if (!size) continue;
    const entry = bySize.get(size) || {
      label: row.size,
      brandSize: row.brandSize ?? null,
      available: row.available ?? null,
      scales: row.scales ?? null,
      m: {},
    };
    for (const [rawAxis, value] of Object.entries(row.measurements || {})) {
      const c = canonicalAxis(rawAxis, row.basis?.[rawAxis] ?? null);
      if (!c) continue;
      const key = `${c.axis}|${c.basis}`;
      const units = toBothUnits(value);
      if (!units) continue;
      axes.set(key, { key, axis: c.axis, basis: c.basis });
      // A duplicated size row (CLIQ lists XXL and 2XL separately) keeps the
      // first value — they carry identical measurements in practice, and
      // averaging two "authoritative" numbers would be worse than picking one.
      if (entry.m[key] == null) entry.m[key] = units;
    }
    bySize.set(size, entry);
  }
  return { bySize, axes };
}

/** One cell's verdict across the platforms that published a value for it. */
function judgeCell(values) {
  const present = Object.entries(values).filter(([, v]) => v && Number.isFinite(v.inch));
  if (present.length === 0) return { status: 'na', delta: null, severity: null };
  if (present.length === 1) return { status: 'single', delta: null, severity: null };

  // Interval arithmetic: the gap is the distance between the two intervals,
  // and is ZERO when they overlap. A CLIQ "36 - 38" chest and a Myntra flat 38"
  // describe the same garment — scoring that as a 1" mismatch would flag every
  // range-published chart in the catalog.
  const spans = present.map(([, v]) => v.inchRange ?? [v.inch, v.inch]);
  const highestLow = Math.max(...spans.map(([lo]) => lo));
  const lowestHigh = Math.min(...spans.map(([, hi]) => hi));
  const delta = Math.max(0, highestLow - lowestHigh);
  const inches = present.map(([, v]) => v.inch);
  const min = Math.min(...inches);
  const max = Math.max(...inches);

  if (delta <= MATCH_TOLERANCE_IN) return { status: 'match', delta: round(delta), severity: null };
  return {
    status: 'mismatch',
    delta: round(delta),
    severity: delta >= MAJOR_TOLERANCE_IN ? 'major' : 'minor',
    // Who sits at each end — the report says "Myntra runs 1.0" smaller", which
    // is the sentence a merchandiser can act on.
    low: present.find(([, v]) => v.inch === min)?.[0] ?? null,
    high: present.find(([, v]) => v.inch === max)?.[0] ?? null,
  };
}

/**
 * Compare the size charts of every platform in `charts`.
 *
 * `charts` is { tatacliq: {guide, status}, myntra: {...}, ajio: {...} } where a
 * missing/blocked platform still appears, carrying the REASON it has no chart —
 * "Ajio blocked" and "Ajio publishes no chart" are different facts and the
 * report must not blur them.
 *
 * Returns null when fewer than one chart exists at all, so the caller can omit
 * the section entirely rather than render an empty table.
 */
export function compareSizeCharts(charts = {}) {
  const indexed = {};
  const axisMeta = new Map();
  const platforms = [];
  const unavailable = {};

  for (const p of PLATFORM_ORDER) {
    const entry = charts[p];
    const guide = entry?.guide ?? null;
    if (!guide?.table?.length) {
      unavailable[p] = entry?.reason || (entry?.guide ? 'no_table' : 'not_published');
      continue;
    }
    const { bySize, axes } = indexChart(guide);
    if (!bySize.size) {
      unavailable[p] = 'no_table';
      continue;
    }
    indexed[p] = { bySize, imageUrl: guide.imageUrl ?? null };
    platforms.push(p);
    for (const [k, meta] of axes) if (!axisMeta.has(k)) axisMeta.set(k, meta);
  }

  if (!platforms.length) return null;

  // Axis columns, in garment order; unknown axes trail alphabetically.
  const allAxes = [...axisMeta.values()].sort((a, b) => {
    const ai = AXIS_ORDER.indexOf(a.axis);
    const bi = AXIS_ORDER.indexOf(b.axis);
    return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi) || a.axis.localeCompare(b.axis);
  }).map((a) => ({
    ...a,
    // "Waist (to fit)" makes the body-vs-garment distinction visible instead of
    // leaving two same-named columns looking like a bug.
    label: a.basis === 'body' ? `${a.axis} (to fit)` : a.axis,
  }));

  const allSizeKeys = [...new Set(platforms.flatMap((p) => [...indexed[p].bySize.keys()]))]
    .sort((a, b) => sizeRank(a) - sizeRank(b) || a.localeCompare(b));

  /**
   * EVERY axis and EVERY size from EVERY platform is shown.
   *
   * An earlier revision scoped the table to what the CLIQ anchor publishes, on
   * the grounds that a CLIQ-less column can never produce a comparison. That is
   * true but not what the report is for: a measurement only Myntra or Ajio
   * publishes is itself a finding — it is content CLIQ could add — and hiding
   * it made the report answer a narrower question than the merchandiser asked.
   * Cells with no value on a platform stay grey, never red.
   */
  const axes = allAxes;
  const sizeKeys = allSizeKeys;

  const rows = [];
  const flags = [];
  let compared = 0, matched = 0, minor = 0, major = 0;

  for (const size of sizeKeys) {
    const present = platforms.filter((p) => indexed[p].bySize.has(size));
    const cells = {};
    for (const axis of axes) {
      const values = {};
      for (const p of platforms) {
        const v = indexed[p].bySize.get(size)?.m?.[axis.key] ?? null;
        // Ranges are carried through to the cell so the verdict is computed on
        // the interval and the UI can render "36 - 38" rather than a midpoint
        // the platform never published.
        const isRange = v && v.inchRange && v.inchRange[0] !== v.inchRange[1];
        values[p] = v
          ? {
              inch: round(v.inch),
              cm: round(v.cm, 1),
              ...(isRange
                ? {
                    inchRange: v.inchRange.map((x) => round(x)),
                    cmRange: v.cmRange.map((x) => round(x, 1)),
                  }
                : {}),
            }
          : null;
      }
      const verdict = judgeCell(values);
      if (verdict.status === 'match') { compared++; matched++; }
      else if (verdict.status === 'mismatch') {
        compared++;
        if (verdict.severity === 'major') major++; else minor++;
        flags.push({
          size,
          axis: axis.label,
          delta: verdict.delta,
          severity: verdict.severity,
          low: verdict.low,
          high: verdict.high,
          text:
            `${PLATFORM_LABEL[verdict.high]} lists ${size} ${axis.label.toLowerCase()} at ` +
            `${values[verdict.high].inch}" vs ${PLATFORM_LABEL[verdict.low]} ${values[verdict.low].inch}" ` +
            `— ${verdict.delta}" apart.`,
        });
      }
      cells[axis.key] = { values, ...verdict };
    }
    rows.push({
      size,
      labels: Object.fromEntries(platforms.map((p) => [p, indexed[p].bySize.get(size)?.label ?? null])),
      brandSizes: Object.fromEntries(platforms.map((p) => [p, indexed[p].bySize.get(size)?.brandSize ?? null])),
      available: Object.fromEntries(platforms.map((p) => [p, indexed[p].bySize.get(size)?.available ?? null])),
      // Footwear only: { uk, us, euro } as each platform labels this shoe.
      scales: Object.fromEntries(platforms.map((p) => [p, indexed[p].bySize.get(size)?.scales ?? null])),
      // A size only one platform sells is a catalog gap, not a measurement
      // mismatch, and is reported as such.
      onlyOn: present.length === 1 && platforms.length > 1 ? present[0] : null,
      cells,
    });
  }

  flags.sort((a, b) => (b.severity === 'major' ? 1 : 0) - (a.severity === 'major' ? 1 : 0) || b.delta - a.delta);

  const verdict =
    platforms.length < 2 ? 'single_source'
    : major ? 'mismatch'
    : minor ? 'minor_variance'
    : compared ? 'consistent'
    : 'not_comparable';

  return {
    platforms,
    unavailable,
    axes,
    unit: 'inch',
    tolerance: { matchIn: MATCH_TOLERANCE_IN, majorIn: MAJOR_TOLERANCE_IN },
    images: Object.fromEntries(platforms.map((p) => [p, indexed[p].imageUrl])),
    rows,
    flags,
    summary: {
      comparedCells: compared,
      matched,
      minor,
      major,
      sizesOnlyOnOnePlatform: rows.filter((r) => r.onlyOn).map((r) => ({ size: r.size, platform: r.onlyOn })),
      verdict,
    },
  };
}

export { PLATFORM_LABEL as SIZECHART_PLATFORM_LABEL };
