'use client';
import { useMemo, useState } from 'react';
import { Ruler, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import type { Platform, SizeChartComparison, SizeChartCell } from '@/lib/types';
import { PLATFORM_META } from '@/lib/api';

/**
 * Cross-platform size-chart table.
 *
 * One row per size, one column per (measurement × platform), so a merchandiser
 * reads across a row and sees the same garment as each platform describes it.
 *
 * Highlighting follows the same discipline as the main report: only two real
 * numbers can disagree. A measurement a platform never published is grey ("—"),
 * never red — Ajio's PDP is frequently blocked and colouring its blanks as
 * differences would invent defects that do not exist.
 *
 *   rose  — the platforms differ by ≥ the major tolerance (default 1")
 *   amber — they differ, but under it: worth a look, not a defect
 *   plain — agreement within tolerance, including unit-rounding noise
 */

const CELL_TONE: Record<'major' | 'minor', string> = {
  major: 'bg-rose-500/10 text-rose-600 dark:text-rose-300 font-bold ring-1 ring-inset ring-rose-500/30',
  minor: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 font-semibold',
};

const REASON_TEXT: Record<string, string> = {
  'akamai-ip-block': 'blocked at the network edge',
  blocked: 'blocked at the network edge',
  no_match: 'no confirmed match for this product',
  no_results: 'no candidate listings found',
  ambiguous: 'match could not be proven',
  color_mismatch: 'only a different colourway was found',
  not_published: 'publishes no size chart for this product',
  no_table: 'chart image only, no measurements',
};

function VerdictChip({ summary }: { summary: SizeChartComparison['summary'] }) {
  if (summary.verdict === 'mismatch') {
    return (
      <span className="chip bg-rose-500/15 font-bold text-rose-600 dark:text-rose-300">
        <AlertTriangle size={12} /> {summary.major} mismatch{summary.major > 1 ? 'es' : ''}
      </span>
    );
  }
  if (summary.verdict === 'minor_variance') {
    return (
      <span className="chip bg-amber-500/15 font-bold text-amber-700 dark:text-amber-300">
        <Info size={12} /> {summary.minor} minor difference{summary.minor > 1 ? 's' : ''}
      </span>
    );
  }
  if (summary.verdict === 'consistent') {
    return (
      <span className="chip bg-emerald-500/15 font-bold text-emerald-600 dark:text-emerald-300">
        <CheckCircle2 size={12} /> Charts agree
      </span>
    );
  }
  return (
    <span className="chip bg-slate-200 dark:bg-white/[0.08] font-semibold text-slate-500 dark:text-white/50">
      {summary.verdict === 'single_source' ? 'Only one platform published a chart' : 'Not comparable'}
    </span>
  );
}

export default function SizeChartTable({ chart }: { chart: SizeChartComparison }) {
  const [unit, setUnit] = useState<'inch' | 'cm'>('inch');

  // cm is only offered when a platform actually published (or can derive) it —
  // an empty cm column would read as missing data rather than as unused.
  const hasCm = useMemo(
    () => chart.rows.some((r) => Object.values(r.cells).some((c) =>
      Object.values(c.values).some((v) => v?.cm != null))),
    [chart],
  );

  const dp = unit === 'inch' ? 2 : 1;
  const num = (n: number) => Number(n.toFixed(dp));

  // Charts that publish a span ("36 - 38") are rendered as the span. Showing a
  // midpoint would put a number on screen that no platform actually printed.
  const fmt = (v: SizeChartCell['values'][Platform]) => {
    if (!v) return null;
    const range = unit === 'inch' ? v.inchRange : v.cmRange;
    if (range && range[0] !== range[1]) return `${num(range[0])}–${num(range[1])}`;
    const n = unit === 'inch' ? v.inch : v.cm;
    return n == null ? null : `${num(n)}`;
  };

  const missing = Object.entries(chart.unavailable) as [Platform, string][];

  return (
    <section className="rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.04]">
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 dark:border-white/[0.08] px-4 py-3">
        <Ruler size={16} className="text-sky-600 dark:text-sky-400" />
        <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">Size Chart Comparison</h3>
        <VerdictChip summary={chart.summary} />
        <span className="text-[11px] text-slate-400 dark:text-white/40">
          {chart.summary.comparedCells} measurement{chart.summary.comparedCells === 1 ? '' : 's'} compared ·
          {' '}flagged above {chart.tolerance.matchIn}″
        </span>
        {hasCm ? (
          <div className="no-print ml-auto flex rounded-full bg-slate-100 dark:bg-white/[0.06] p-0.5">
            {(['inch', 'cm'] as const).map((u) => (
              <button
                key={u}
                onClick={() => setUnit(u)}
                className={`rounded-full px-3 py-1 text-[11px] font-semibold transition ${
                  unit === u
                    ? 'bg-white dark:bg-white/[0.14] text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-500 dark:text-white/50'
                }`}
              >
                {u === 'inch' ? 'inches' : 'cm'}
              </button>
            ))}
          </div>
        ) : null}
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr>
              <th
                rowSpan={2}
                className="sticky left-0 z-10 bg-white dark:bg-[#12151c] px-3 py-2 text-left text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 dark:text-white/40"
              >
                Size
              </th>
              {chart.axes.map((a) => (
                <th
                  key={a.key}
                  colSpan={chart.platforms.length}
                  className="border-l border-slate-200 dark:border-white/[0.08] px-3 pt-2 text-center text-[11px] font-bold text-slate-700 dark:text-white/80"
                >
                  {a.label}
                  <span className="ml-1 font-normal text-slate-400 dark:text-white/40">
                    ({unit === 'inch' ? 'in' : 'cm'})
                  </span>
                </th>
              ))}
            </tr>
            <tr>
              {chart.axes.flatMap((a) =>
                chart.platforms.map((p, i) => (
                  <th
                    key={`${a.key}-${p}`}
                    className={`px-2 pb-2 text-center text-[10px] font-semibold uppercase tracking-wide ${
                      i === 0 ? 'border-l border-slate-200 dark:border-white/[0.08]' : ''
                    }`}
                    style={{ color: PLATFORM_META[p]?.color }}
                  >
                    {PLATFORM_META[p]?.short ?? p}
                  </th>
                )),
              )}
            </tr>
          </thead>
          <tbody>
            {chart.rows.map((row) => {
              const carriers = chart.platforms.filter((p) => row.labels[p] != null);
              const brandSize = carriers.map((p) => row.brandSizes[p]).find((b) => b && b !== row.size);
              // Shoes: the row label is the UK size, so spell out the US/EU
              // equivalents rather than leaving them out of the report.
              const sc = carriers.map((p) => row.scales?.[p]).find(Boolean);
              const scaleText = sc
                ? [sc.us ? `US ${sc.us}` : null, sc.euro ? `EU ${sc.euro}` : null].filter(Boolean).join(' · ')
                : null;
              return (
                <tr key={row.size} className="border-t border-slate-100 dark:border-white/[0.06]">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-white dark:bg-[#12151c] px-3 py-2 text-left align-middle"
                  >
                    <span className="font-semibold text-slate-900 dark:text-white">
                      {row.size}
                    </span>
                    {brandSize ? (
                      <span className="ml-1.5 text-[10px] text-slate-400 dark:text-white/40">brand {brandSize}</span>
                    ) : null}
                    {scaleText ? (
                      <span className="ml-1.5 text-[10px] text-slate-400 dark:text-white/40">{scaleText}</span>
                    ) : null}
                    {row.onlyOn ? (
                      <span
                        className="ml-1.5 text-[10px] text-slate-400 dark:text-white/40"
                        title={`Only ${PLATFORM_META[row.onlyOn]?.label} lists this size — a catalog gap, not a measurement mismatch.`}
                      >
                        {PLATFORM_META[row.onlyOn]?.short} only
                      </span>
                    ) : null}
                  </th>

                  {chart.axes.flatMap((a) => {
                    const cell = row.cells[a.key];
                    return chart.platforms.map((p, i) => {
                      const text = fmt(cell?.values?.[p] ?? null);
                      const isExtreme =
                        cell?.status === 'mismatch' && (cell.low === p || cell.high === p);
                      const tone = isExtreme && cell.severity ? CELL_TONE[cell.severity] : '';
                      return (
                        <td
                          key={`${a.key}-${p}`}
                          title={
                            cell?.status === 'mismatch'
                              ? `${a.label}: platforms differ by ${cell.delta}″`
                              : undefined
                          }
                          // The tone carries its own text colour; adding the
                          // neutral one alongside it lets Tailwind's cascade
                          // pick the wrong winner, so it is applied only when
                          // the cell is not flagged.
                          className={`px-2 py-2 text-center tabular-nums ${
                            i === 0 ? 'border-l border-slate-200 dark:border-white/[0.08]' : ''
                          } ${
                            tone ||
                            (text == null ? 'text-slate-300 dark:text-white/25' : 'text-slate-700 dark:text-white/80')
                          }`}
                        >
                          {text ?? '—'}
                          {isExtreme && cell.high === p ? (
                            <span className="ml-1 align-super text-[9px] font-bold">+{cell.delta}″</span>
                          ) : null}
                        </td>
                      );
                    });
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {(chart.flags.length > 0 || missing.length > 0) && (
        <footer className="flex flex-col gap-1.5 border-t border-slate-200 dark:border-white/[0.08] px-4 py-3">
          {chart.flags.slice(0, 6).map((f, i) => (
            <p
              key={i}
              className={`flex items-start gap-1.5 text-[11px] ${
                f.severity === 'major'
                  ? 'text-rose-600 dark:text-rose-300'
                  : 'text-amber-700 dark:text-amber-300'
              }`}
            >
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              {f.text}
            </p>
          ))}
          {chart.flags.length > 6 ? (
            <p className="text-[11px] text-slate-400 dark:text-white/40">
              +{chart.flags.length - 6} more differences.
            </p>
          ) : null}
          {missing.map(([p, reason]) => (
            <p key={p} className="flex items-start gap-1.5 text-[11px] text-slate-400 dark:text-white/40">
              <Info size={12} className="mt-0.5 shrink-0" />
              {PLATFORM_META[p]?.label ?? p} {REASON_TEXT[reason] ?? reason} — shown as no data, not as a difference.
            </p>
          ))}
        </footer>
      )}
    </section>
  );
}
