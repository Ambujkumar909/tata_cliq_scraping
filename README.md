<div align="center">

# 🔍 PriceLens

### Competitive Price Intelligence for Tata CLIQ

**For every Tata CLIQ product, find the *exact same SKU* on Myntra and Ajio, prove it is the same item, and show its live price — so CLIQ knows instantly where it wins on price and where dealers undercut it.**

![Node](https://img.shields.io/badge/Node-%E2%89%A520-339933?logo=node.js&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-14-000000?logo=next.js&logoColor=white)
![Fastify](https://img.shields.io/badge/Fastify-4-202020?logo=fastify&logoColor=white)
![Precision](https://img.shields.io/badge/exact--SKU_precision-96%25-10b981)
![No Headless Browser](https://img.shields.io/badge/scraping-pure_HTTP-2f80ed)

*Built by **Ambuj Kumar***

</div>

---

## Why this exists

Marketplace pricing teams fly blind: the same style sells on three platforms under three different titles, three different colour names, and sometimes three different MRPs. PriceLens turns any Tata CLIQ product link into a **provable, evidence-backed three-way comparison** — matched at the SKU level, not the "looks similar" level, with every claim one click from the live listing.

```
┌──────────────┐     HTTP      ┌─────────────────────────────┐
│  Next.js web │ ────────────▶ │  Fastify API (modular)      │
│  (port 3000) │               │  • catalog store            │
└──────────────┘               │  • matching engine (v5)     │
                               │  • comparison report        │
                               │  • source adapters ─────────┼──▶ Tata CLIQ  (searchbff + PDP)
                               │                             │──▶ Myntra     (gateway + PDP)
                               └─────────────────────────────┘──▶ Ajio       (search API)
```

## Highlights

- 🎯 **Exact-SKU matching, measured** — 96% precision on independent live audits (details below)
- 🔗 **Paste any CLIQ link** — products outside the ingested catalog are fetched and matched live
- 📊 **Full comparison report** — Product · Pricing & Offers · Specifications · Content Quality · AI scores, with an AI decision summary and one-click *Verify on Myntra/Ajio* links
- 🖨️ **One-page PDF export** — compact, print-optimised, empty fields auto-omitted
- 📗 **Excel *and* PDF export for the business** — dropdown filters (category, gender, brand, competitive position, price band), then download a 3-sheet workbook or a landscape PDF report. Both lead with who is cheapest and who is dearest, the ₹ gap and the recommendation — not a raw comparison dump
- 🌓 **Dual theme** — light/dark with a top-right toggle, persisted, flash-free
- 🧠 **Semantic matching without an ML model** — IDF-weighted tokens + character trigrams + domain-concept overlap; a `setEmbedder()` seam exists for upgrading
- 🧬 **Category-universal by design** — vocabulary is data (`taxonomy.mjs` + drop-in JSON), brand-issued model codes (`541`, `WH-CH520`) work for any category, and unknown vocabulary can never produce a wrong verdict
- 🚦 **Honest by construction** — the engine says **no match** or **ambiguous — verify** instead of guessing; *missing data ≠ different data* everywhere

## How the data works (verified, not theoretical)

Every source has a **listing tier** (find candidates) and a **PDP detail tier** (specs, description, fulfilment):

| Source | Listing tier | Detail tier |
|---|---|---|
| **Tata CLIQ** | `searchbff` gateway — the anchor catalog | ✅ attributes, fabric, wash care, origin, returns, delivery, stock |
| **Myntra** | cookie-warmed search gateway + HTML fallback | ✅ `articleAttributes`, descriptors, offers, serviceability, media |
| **Ajio** | ✅ search API | ❌ Akamai-blocked from datacenter IPs — needs `SCRAPE_PROXY` |

Everything is **pure HTTP** — no headless browser anywhere in the stack. Ajio's blocked detail tier renders as *"not available"*, never as a fabricated difference (verify proxy setup any time with `node scripts/test-proxy.mjs`).

## The matching engine (v5)

```
Layer 1  RETRIEVAL   complementary queries per source, unioned + deduped
Layer 2  HARD GATES  brand · gender (sex AND age) · garment · fit    ← only "proves a different product"
Layer 3  EVIDENCE    MRP · specs · title · image · model codes · description → weighted score
```

Signals that are missing get **renormalised away**, never zeroed — so Ajio isn't punished for hiding its PDP. Confidence tiers: **EXACT ≥ 0.85 · CLOSE ≥ 0.72 · PARTIAL ≥ 0.58**.

### What makes it exact-SKU rather than "similar"

- **Strict mode** (default): nothing below 0.70 surfaces, MRP must agree within 6% (15% when a shared model code + agreeing colour proves identity), colour-family conflicts are rejected outright, conflicting model codes are rejected
- **Ambiguity detection**: when near-tied candidates disagree on price ("navy slim jeans" and its siblings), the engine refuses to pick and lists them for a human glance — same-price ties surface normally since the price answer is identical
- **Backdrop-learned image colour**: the garment shade is read from the dominant pixel cluster after excluding the studio backdrop (learned from the image border) — this is what catches wrong-colourway look-alikes that share every text attribute
- **Colour-truth hierarchy**: two retailers *agreeing* on a colour name outranks noisy pixels (model-shot vs flat-lay lighting); *conflicting* names demand strict pixel proof
- **Gender is read, never inferred from a code** (v5): the anchor's gender comes from the title, then CLIQ's PDP `gender` field, then the breadcrumb — and stays **unknown** when none of them says. Earlier versions fell back to the category code's first letter, which CLIQ's hierarchy does not encode (`MSH10` holds women's product, `MSH21` kids'), so every gender-silent title resolved to "men" — arming the gender gate backwards *and* searching the wrong department (`lov men top` for a women's top). `scripts/verify-gender.mjs` now proves the prefix rule false against the live catalog rather than assuming it

### Canonical attributes

Platforms describe one garment three ways; PriceLens compares meaning, not phrasing:

```
CLIQ    Fabric:  "Single Jersey, 100% Cotton"   →  cotton @ 100%  ┐
Myntra  Fabrics: "Pure Cotton"                  →  cotton @ 100%  ┘  match
```

Plus the discriminators that separate commodity denim: **fade / wash / distress / rise / stretch**.

## Measured accuracy

Three audit rounds, each on a **fresh random 110 live CLIQ products** (220 anchor×source decisions, zero overlap with the ingested catalog), graded by an independent identity checklist — STRICT is a knowingly conservative lower bound, STANDARD the upper bound. Reproduce any time:

```bash
node scripts/audit-accuracy.mjs 110
```

| Round | Engine | Precision (std) | Recall (std) |
|---|---|---|---|
| 1 | weighted evidence | 89% | 86% |
| 2 | + strict gates | 94% | 73% |
| 3 | + recall fixes (label-agree colour, deeper enrichment, model-code override, footwear taxonomy) | **96%** | **78%** |

Round 3 per source: **Myntra 95% · Ajio 97%** precision — 5 false positives in 220 decisions, all borderline. Thresholds (0.70 tier, 6% MRP) were **derived from the audit's bucket analysis**, not invented, and are re-derivable whenever the category mix changes.

> **The honest ceiling:** 100% exact-SKU certainty is not achievable by anyone from public storefront data — retailers publish contradictory labels and no platform exposes EAN/GTIN publicly (verified empirically). PriceLens's differentiator is that it is **never confidently wrong**: unprovable cases surface as `no match` / `ambiguous`, with the nearest candidates linked for manual verification.

## Quick start

```bash
# Option A — Docker
cp .env.example .env
docker compose up --build      # web → :3000 · api → :4010/api/health

# Option B — Local dev
cd apps/api && npm install
npm run ingest                 # ~2000 CLIQ products → data/tatacliq.products.json
npm run match 150              # precompute comparisons → data/comparisons.json
npm start                      # http://localhost:4010

cd ../web && npm install
npm run dev                    # http://localhost:3000
```

Then paste any Tata CLIQ product link into the dashboard — products outside the precomputed batch match live on demand.

## Configuration (`.env`)

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `4010` | API port |
| `MATCH_MIN_SCORE` | `0.58` | Min evidence score to surface (PARTIAL tier) |
| `STRICT_SKU` | `true` | Exact-SKU mode — reject colour-family conflicts outright |
| `INGEST_TARGET_COUNT` | `2000` | CLIQ products to ingest |
| `INGEST_TERMS` | *(20 categories)* | Seed search terms |
| `SCRAPE_PROXY` | — | Indian residential proxy; unlocks Ajio's detail tier |
| `PROXY_HOSTS` | `ajio.com` | Hosts routed through the proxy (suffix match) |
| `HTTP_TIMEOUT_MS` | `20000` | Per-request deadline (every network call has one) |
| `REPORT_TTL_HOURS` | `168` (7 days) | How long a saved comparison is replayed before re-scraping |
| `CACHE_DIR` | `apps/api/data` | Where the fallback comparison snapshot is written |

Every one of these is read from `.env` by both `npm run dev` and `docker compose`
(the compose file interpolates them rather than hardcoding), so `.env` is the
single place to change behaviour.

## Saved comparisons

A comparison costs three storefronts' worth of scraping plus image hashing —
seconds of wall time and a slice of the proxy budget — so **every generated
comparison is persisted and replayed** instead of being recomputed:

- **Written through** on every live match, to Redis (per-key TTL, named volume)
  or to a JSON snapshot in `CACHE_DIR` when Redis is unreachable.
- **Survives** API restarts, container rebuilds and redeploys; the store replays
  the cache on boot, so the catalog grid keeps its comparison badges.
- **Expires after `REPORT_TTL_HOURS`** (168h — 7 days). This is a pricing tool: a saved
  report is a recording, not a live quote, and the UI labels it as such
  ("Saved report · matched 3 h ago"). **Refresh live** always bypasses it.
- **Fingerprinted** by matcher version + `STRICT_SKU` + `MATCH_MIN_SCORE`, so
  changing how matching works re-matches rather than serving verdicts the
  current settings would never have produced.
- **Ad-hoc anchors** (products pasted as URLs, absent from the catalog) are
  persisted too, so a shared `/report/<id>` link keeps working after a restart.

**Where to see them:** `/reports` lists every saved comparison — newest first,
with match verdict, confidence, the three prices, how long ago it was matched
and how much of its TTL is left. Searchable, filterable to still-fresh, and
linked from the dashboard nav. It reads the comparison store rather than the
catalog on purpose: link-sourced products are deliberately absent from the
catalog grid, so this page is the only way back to those reports.

Cache state is visible at `GET /api/cache`. Losing the cache costs time, never
correctness.

## Export — Excel and PDF

The screen answers "is this the same product?". The spreadsheet answers "what
do we do about it?" — so **Export to Excel** (dashboard nav, and `/reports`)
turns saved comparisons into a workbook a category manager can pivot.

**Built to be read as analysis, not as a data dump.** A comparison carries
specifications, content-quality counts, four sub-scores and per-attribute
agreement; all of that justifies the verdict on screen and buries the decision
in a sheet. What survives is what changes a decision:

| Block | Columns |
|---|---|
| What it is | Brand, product, category, gender, MRP |
| What the market charges | Tata CLIQ, Myntra, Ajio — side by side, ranked in place by colour: **cheapest green, middle orange, dearest red** |
| The verdict | Position (CLIQ cheapest / Undercut / Parity), carrying the same three colours |
| What to do | Match confidence, and the **recommendation** — the same `recommendedAction` string the report UI shows, reused rather than re-derived |
| Provenance | The date each row was priced, and a link to each live listing |

"Cheapest on", "Dearest on", the rupee gap, the gap percentage and the price
index were all removed. Not because they were wrong — because the three-tier
colour already says which platform is cheapest and which is dearest, and the
recommendation states the gap in words. Six columns restating what the reader
can already see is what stops a sheet being scanned.

A blank competitor price says *why* it is blank ("Not listed", "Blocked —
retry") rather than reading as free. Cheapest and dearest are left empty when
there is only one listing or the prices are equal — naming a winner there
reported Tata CLIQ as simultaneously cheapest and dearest.

**Three sheets:**

| Sheet | What it is |
|---|---|
| `Summary` | The filters used (so a forwarded file explains itself), coverage and match rate, price-position split, total ₹ exposure, then the same questions broken down by category, gender and brand |
| `Comparison` | One row per product, frozen header + autofilter, real number formats (sums work), red/green fills on position and gap |
| `Action List` | Only the SKUs a rival undercuts, worst first — omitted when it would duplicate sheet 2 |

**Filters** are dropdown menus — multi-select for category, gender and brand
(with a search box once a list runs long), single-select for position, match
status and freshness, plus a price band and free-text search. All combinable,
all reflected in the filename and in the file itself. The dialog shows the row
count, the ₹ exposure and a five-row sample **before** building anything — no
one should have to open a file to discover it was empty.

The PDF leads with a KPI strip and a **who-is-cheapest / who-is-dearest split
by platform**, then the largest gaps, then the full table across landscape
pages. It needs a font carrying ₹, so the API image installs `font-noto`; the
exporter falls back to "Rs." rather than printing blank boxes if that is ever
missing.

Category and gender are derived, not stored: category from the PDP breadcrumb
then the brand-stripped title (the taxonomy's garment rules, so extending
`taxonomy.custom.json` extends the filter too). Gender reads the title and
breadcrumb only — the CLIQ category code is *not* a gender marker on this
catalog (`MSH10` holds women's product), so a product that never says gets
`Unspecified` rather than a confident wrong answer.

## API

| Method | Route | Description |
|---|---|---|
| `GET` | `/api/health` | Liveness + catalog size |
| `GET` | `/api/cache` | Saved-comparison backend, entry count, TTL, fingerprint |
| `GET` | `/api/reports?q=&page=&freshOnly=` | Saved comparisons, newest first (backs `/reports`) |
| `GET` | `/api/stats` | Dashboard KPIs |
| `GET` | `/api/insights?limit=` | Biggest dealer undercuts / CLIQ wins |
| `GET` | `/api/resolve?url=` | Resolve a pasted CLIQ product link (fetches live if uncatalogued) |
| `GET` | `/api/products?q=&brand=&sort=&page=` | Paginated catalog + summaries |
| `GET` | `/api/products/:id` | 3-way comparison (live on cache miss) |
| `GET` | `/api/products/:id/report` | **Full comparison report** (`?refresh=true` re-matches) |
| `POST` | `/api/products/:id/match` | Force a fresh live re-match |
| `GET` | `/api/brands` | Brand facets |
| `GET` | `/api/export/facets` | Export filter vocabulary with counts (only values that have rows) |
| `GET` | `/api/export/preview?…` | Row count, ₹ exposure and a sample for a filter set — no file built |
| `GET` | `/api/export/comparisons.xlsx?…` | **The workbook.** `category`, `gender`, `brand` (repeatable or comma-separated), `position`, `matched`, `freshOnly`, `minPrice`, `maxPrice`, `q` |
| `GET` | `/api/export/comparisons.pdf?…` | **The PDF report.** Same filter vocabulary, same rows |

## Project layout

```
apps/
  api/
    src/
      lib/         taxonomy (ALL category vocab, runtime-extensible) · normalize · attributes
                   semantic · imagecolor · imagesim · http · format
      sources/     tatacliq · myntra · ajio      (each: listing tier + detail tier)
      matching/    evidence (gates + weights) · matcher (orchestration) · report (builder)
      export/      rows (comparison → business row) · workbook (xlsx) · pdf (report)
      routes/      products · export · meta
      store.mjs    in-memory catalog, comparison cache, IDF training
    scripts/       ingest-cliq · match-competitors · audit-accuracy · test-proxy
                   verify-gender · verify-lp · imgcolor-test
  web/
    app/           dashboard · reports (saved) · report/[id] (deep-linkable, print-optimised)
    components/    MatchReport · CompareModal · ExportModal · UrlLookup · ThemeToggle · StatsBar · …
```

### Extending to a new category — zero code

Drop a `apps/api/data/taxonomy.custom.json`:

```json
{
  "GARMENT_RULES": [["lipstick", "\\blip\\s?sticks?\\b"]],
  "COLOR_FAMILY": { "seafoam": "green" }
}
```

Unknown vocabulary degrades to the universal signals (brand, MRP, model codes, semantics, image) — it can *add* precision but never *create* a wrong verdict.

## Verification & tooling

```bash
node scripts/audit-accuracy.mjs 110   # full live accuracy audit with confusion matrix
node scripts/verify-gender.mjs        # gender-compatibility matrix + leak audit
node scripts/verify-lp.mjs            # the verified Louis Philippe cross-platform pair
node scripts/test-proxy.mjs           # Ajio proxy self-test
```

## Roadmap

- **EAN/style-code feeds** — CLIQ owns its half of the join internally; a seller-side column makes matching exact *by definition* (`eanMatch` signal slot is ready)
- **Residential proxy** — unlocks Ajio specs, descriptions and style codes (`SCRAPE_PROXY`)
- **Redis persistence** — the store is in-memory by design; the bundled Redis scales it horizontally
- **Embedding upgrade** — `setEmbedder()` in `semantic.mjs` accepts any encoder when the latency budget allows

## Ethics

Prices are read from public storefronts for internal price intelligence. Respect target sites' terms and rate limits; prefer official partner feeds where available.

---

<div align="center">

**Author: Ambuj Kumar**

*Fast, robust, and honest about where the data comes from — and where it is missing.*

</div>
