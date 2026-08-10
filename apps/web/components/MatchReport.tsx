'use client';
import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Tag, IndianRupee, FileText, Layers, Brain, CheckCircle2, AlertTriangle,
  Lightbulb, ExternalLink, RefreshCw, Ban, Info, Printer, ShieldCheck, Archive, Zap,
} from 'lucide-react';
import type { MatchReport as Report, ReportGroup, ReportRow, ReportCell, Verdict, ReportColumn } from '@/lib/types';
import { api, PLATFORM_META } from '@/lib/api';

// Legend colours. Grey ('na') deliberately reads as "no data", never as a
// difference — most Ajio specification cells are genuinely unknown because its
// PDP is blocked, and colouring those red would invent differences.
const VERDICT_STYLE: Record<Verdict, { text: string; dot: string; label: string }> = {
  best: { text: 'text-emerald-600 dark:text-emerald-300', dot: 'bg-emerald-400', label: 'Best / Higher' },
  moderate: { text: 'text-amber-600 dark:text-amber-300', dot: 'bg-amber-400', label: 'Moderate / Lower' },
  low: { text: 'text-rose-600 dark:text-rose-300', dot: 'bg-rose-400', label: 'Low / Not Matching' },
  na: { text: 'text-slate-400 dark:text-white/40', dot: 'bg-slate-300 dark:bg-white/25', label: 'Not Applicable' },
};

const GROUP_ICON: Record<string, { icon: typeof Tag; color: string }> = {
  product: { icon: Tag, color: '#6366f1' },
  pricing: { icon: IndianRupee, color: '#10b981' },
  specifications: { icon: Layers, color: '#38bdf8' },
  content: { icon: FileText, color: '#f59e0b' },
  scores: { icon: Brain, color: '#a855f7' },
};

// "matched 3.4h ago" reads as staler than "matched 3 hours ago" is meant to —
// round to the unit a merchandiser actually thinks in.
const freshness = (ageHours?: number | null) => {
  if (ageHours == null) return 'earlier';
  if (ageHours < 1 / 60) return 'moments ago';
  if (ageHours < 1) return `${Math.round(ageHours * 60)} min ago`;
  if (ageHours < 24) return `${Math.round(ageHours)} h ago`;
  return `${Math.round(ageHours / 24)} d ago`;
};

const matchTypeTone = (t?: string | null) =>
  t === 'EXACT MATCH' ? 'bg-emerald-500 text-ink-950'
  : t === 'CLOSE MATCH' ? 'bg-sky-500 text-ink-950'
  : t === 'PARTIAL MATCH' ? 'bg-amber-500 text-ink-950'
  : 'bg-slate-200 dark:bg-white/[0.1] text-slate-600 dark:text-white/70';

/**
 * Circular confidence gauge.
 * The animated SVG does not print reliably (framer-motion's stroke offset can
 * be captured mid-state by the print engine), so print swaps it for a static
 * text badge via .no-print / .print-only.
 */
function ConfidenceDonut({ value }: { value: number | null }) {
  const pct = value == null ? 0 : Math.round(value * 100);
  const r = 46;
  const circ = 2 * Math.PI * r;
  const tone = pct >= 85 ? '#10b981' : pct >= 72 ? '#38bdf8' : pct >= 58 ? '#f59e0b' : '#f43f5e';
  return (
    <>
      <div className="no-print relative grid place-items-center">
        <svg width="120" height="120" className="-rotate-90">
          <circle cx="60" cy="60" r={r} fill="none" stroke="var(--ring-track)" strokeWidth="10" />
          <motion.circle
            cx="60" cy="60" r={r} fill="none" stroke={tone} strokeWidth="10" strokeLinecap="round"
            strokeDasharray={circ}
            initial={{ strokeDashoffset: circ }}
            animate={{ strokeDashoffset: circ - (circ * pct) / 100 }}
            transition={{ duration: 1, ease: 'easeOut' }}
          />
        </svg>
        <div className="absolute text-center">
          <div className="font-display text-2xl font-bold text-slate-900 dark:text-white">{value == null ? '—' : `${pct}%`}</div>
        </div>
      </div>
      {value != null ? (
        <span
          className="print-only rounded-full px-3 py-1 text-base font-bold"
          style={{ color: tone, boxShadow: `inset 0 0 0 2px ${tone}` }}
        >
          {pct}%
        </span>
      ) : null}
    </>
  );
}

function Cell({ cell, isSource, emphasis }: { cell: ReportCell; isSource: boolean; emphasis?: boolean }) {
  const style = VERDICT_STYLE[cell.verdict] ?? VERDICT_STYLE.na;
  const empty = cell.value == null || cell.value === '';
  return (
    <td className="border-t border-slate-200 dark:border-white/[0.08] px-3 py-2.5 align-top">
      <span
        className={`text-sm ${empty ? 'text-slate-300 dark:text-white/25' : isSource ? 'text-slate-800 dark:text-white/90' : style.text} ${
          emphasis ? 'font-bold' : ''
        }`}
        title={cell.deltaE != null ? `Image Δe ${cell.deltaE}` : undefined}
      >
        {empty ? '—' : cell.value}
      </span>
    </td>
  );
}

function GroupBand({ group, columns }: { group: ReportGroup; columns: ReportColumn[] }) {
  const meta = GROUP_ICON[group.id] ?? GROUP_ICON.product;
  const Icon = meta.icon;
  // Print is compact: a row with no competitor-side value compares nothing and
  // just spends paper — keep it on screen (context) but drop it from the PDF.
  // If nothing in the whole group compares, its band header goes too.
  const rowComparable = (r: ReportRow) =>
    r.cells.some((c, i) => i > 0 && c.value != null && c.value !== '');
  const groupComparable = group.rows.some(rowComparable);
  return (
    <>
      <tr className={groupComparable ? undefined : 'no-print'}>
        <td colSpan={columns.length + 1} className="px-3 pb-1 pt-6">
          <span className="inline-flex items-center gap-2">
            <span
              className="grid h-7 w-7 place-items-center rounded-full"
              style={{ background: `${meta.color}22`, boxShadow: `inset 0 0 0 1px ${meta.color}55` }}
            >
              <Icon size={14} style={{ color: meta.color }} />
            </span>
            <span className="text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: meta.color }}>
              {group.title}
            </span>
          </span>
        </td>
      </tr>
      {group.rows.map((r) => (
        <tr
          key={`${group.id}-${r.label}`}
          className={`hover:bg-slate-50 dark:hover:bg-white/[0.05]${rowComparable(r) ? '' : ' no-print'}`}
        >
          <th
            scope="row"
            className={`w-52 border-t border-slate-200 dark:border-white/[0.08] px-3 py-2.5 text-left align-top text-xs font-medium ${
              r.emphasis ? 'text-slate-900 dark:text-white' : 'text-slate-500 dark:text-white/50'
            }`}
          >
            {r.label}
          </th>
          {r.cells.map((c, i) => {
            if (r.label === 'Product Image') {
              return (
                <td key={c.column} className="border-t border-slate-200 dark:border-white/[0.08] px-3 py-2.5">
                  {c.value ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.value} alt="" className="h-28 w-24 rounded-lg object-cover" />
                  ) : (
                    <div className="grid h-28 w-24 place-items-center rounded-lg bg-white dark:bg-white/[0.04] text-[10px] text-slate-400 dark:text-white/40">
                      No image
                    </div>
                  )}
                </td>
              );
            }
            return <Cell key={c.column} cell={c} isSource={i === 0} emphasis={r.emphasis} />;
          })}
        </tr>
      ))}
    </>
  );
}

function SidebarList({
  title, icon, items, tone,
}: { title: string; icon: React.ReactNode; items: string[]; tone: string }) {
  if (!items?.length) return null;
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5">
        {icon}
        <h4 className={`text-xs font-bold uppercase tracking-wide ${tone}`}>{title}</h4>
      </div>
      <ul className="flex flex-col gap-1.5">
        {items.map((t, i) => (
          <li key={i} className="flex gap-2 text-xs leading-relaxed text-slate-600 dark:text-white/70">
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-300 dark:bg-white/25" />
            {t}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MatchReport({ productId, onClose }: { productId: string; onClose?: () => void }) {
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (refresh = false) => {
    refresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      setData(await api.report(productId, refresh));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load report');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  // Browsers name the saved PDF after document.title, so make it a filename
  // worth keeping rather than "PriceLens — Competitive Price Intelligence".
  useEffect(() => {
    if (!data) return;
    const prev = document.title;
    const slug = [data.header.brand, data.header.title].filter(Boolean).join(' ').slice(0, 70);
    document.title = `PriceLens Report — ${slug || data.header.listingId}`;
    return () => {
      document.title = prev;
    };
  }, [data]);

  const blocked = useMemo(
    () => (data?.columns ?? []).filter((c) => c.role !== 'source' && !c.detailAvailable && c.detailReason),
    [data],
  );

  if (loading) {
    return (
      <div className="grid gap-4 p-6">
        <div className="skeleton h-10 w-2/3 rounded-lg" />
        <div className="skeleton h-64 rounded-2xl" />
        <p className="text-center text-sm text-slate-400 dark:text-white/40">Building comparison report — matching live…</p>
      </div>
    );
  }
  if (error || !data) {
    return <p className="py-12 text-center text-sm text-rose-600 dark:text-rose-300">{error ?? 'Report unavailable.'}</p>;
  }

  const { header, columns, groups, decision, legend } = data;

  return (
    <div className="report-scale flex flex-col gap-4">
      {/* Title */}
      <div className="relative text-center">
        <h2 className="font-display text-xl font-extrabold tracking-tight text-slate-900 dark:text-white sm:text-2xl">
          Product Match Comparison Report
        </h2>
        {/* Provenance line — only meaningful once the report leaves the screen. */}
        <p className="print-only mt-1 text-xs text-slate-500 dark:text-white/50">
          {header.brand} · {header.title} · Listing {header.listingId} · Generated{' '}
          {new Date(data.generatedAt).toLocaleString('en-IN')}
        </p>
        {/* Where these prices came from. A replayed report is cheap and instant,
            but the user has to know it is a recording, not a live quote. */}
        <p className="no-print mt-1 text-[11px] text-slate-400 dark:text-white/40">
          {data.cached ? (
            <>
              <Archive size={11} className="mr-1 inline align-[-1px]" />
              Saved report · matched {freshness(data.ageHours)} · re-scrapes after {data.ttlHours ?? 24}h
            </>
          ) : (
            <>
              <Zap size={11} className="mr-1 inline align-[-1px] text-amber-500" />
              Matched live just now · saved for the next {data.ttlHours ?? 24}h
            </>
          )}
        </p>
        <button
          onClick={() => window.print()}
          className="no-print absolute right-0 top-0 flex items-center gap-1.5 rounded-full bg-slate-100 dark:bg-white/[0.06] px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-white/80 transition hover:bg-slate-200 dark:hover:bg-white/[0.12] hover:text-slate-900 dark:hover:text-white"
          title="Export this report as a PDF"
        >
          <Printer size={13} /> Export PDF
        </button>
      </div>

      {/* Source header band */}
      <div className="grid gap-4 rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.04] p-4 sm:grid-cols-[1.4fr_auto_1.4fr]">
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-cliq">Source Product</span>
          <span className="text-xs text-slate-500 dark:text-white/50">Tata CLIQ Listing</span>
          <div className="mt-1 text-xs text-slate-600 dark:text-white/70">
            <span className="text-slate-400 dark:text-white/40">Listing ID: </span>
            <span className="font-mono">{header.listingId}</span>
          </div>
          {header.url ? (
            <a
              href={header.url}
              target="_blank"
              rel="noreferrer"
              className="truncate text-xs text-sky-600 dark:text-sky-300 hover:underline"
            >
              {header.url}
            </a>
          ) : null}
        </div>

        <div className="flex flex-col items-center justify-center gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400 dark:text-white/40">
            Overall Match Confidence
          </span>
          <span className="font-display text-4xl font-extrabold text-emerald-600 dark:text-emerald-300">
            {header.overallConfidence == null ? '—' : `${Math.round(header.overallConfidence * 100)}%`}
          </span>
          <span className={`chip font-bold ${matchTypeTone(header.matchType)}`}>{header.matchType}</span>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400 dark:text-white/40">Match Reason</span>
          <p className="text-xs leading-relaxed text-slate-600 dark:text-white/70">{header.matchReason}</p>
        </div>
      </div>

      {/* Blocked-source notice — explains grey cells honestly */}
      {blocked.length ? (
        <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 dark:border-amber-500/20 dark:bg-amber-500/[0.07] px-3 py-2">
          <Info size={14} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-300" />
          <p className="text-[11px] leading-relaxed text-amber-800 dark:text-amber-100/80">
            {blocked.map((c) => `${c.label} detail unavailable (${c.detailReason})`).join(' · ')}. Those cells
            show <span className="font-semibold">not available</span> rather than a difference.
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        {/* Comparison table */}
        <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-white/[0.08]">
          <table className="w-full min-w-[640px] border-collapse">
            <thead>
              <tr>
                <th className="w-52 bg-white dark:bg-white/[0.04] px-3 py-3" />
                {columns.map((c) => {
                  const meta = PLATFORM_META[c.platform];
                  const isSource = c.role === 'source';
                  return (
                    <th
                      key={c.key}
                      className="px-3 py-3 text-left"
                      style={{ background: `${meta?.color ?? '#666'}${isSource ? '2e' : '1f'}` }}
                    >
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-white/50">
                          {isSource ? 'Source' : `Target Site`}
                        </span>
                        <span className="text-sm font-bold text-slate-900 dark:text-white">{c.label}</span>
                        {!isSource ? (
                          c.status === 'matched' ? (
                            <span className={`chip w-fit text-[10px] font-bold ${matchTypeTone(c.matchType)}`}>
                              {c.matchType}
                            </span>
                          ) : (
                            <span className="chip w-fit bg-slate-200 dark:bg-white/[0.1] text-[10px] text-slate-500 dark:text-white/50">
                              {c.status === 'blocked' ? <Ban size={10} /> : null}
                              {c.status.replace(/_/g, ' ')}
                            </span>
                          )
                        ) : null}
                        {/* Go and check the match yourself — every claim in this
                            column is one click from the live listing. */}
                        {c.url ? (
                          <a
                            href={c.url}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-0.5 flex w-fit items-center gap-1 text-[11px] font-medium text-slate-600 dark:text-white/70 underline decoration-slate-300 dark:decoration-white/25 underline-offset-2 transition hover:text-slate-900 dark:hover:text-white hover:decoration-slate-500"
                          >
                            {isSource ? 'Open on CLIQ' : `Verify on ${meta?.short ?? c.label}`}
                            <ExternalLink size={10} />
                          </a>
                        ) : null}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <GroupBand key={g.id} group={g} columns={columns} />
              ))}
            </tbody>
          </table>
        </div>

        {/* AI decision sidebar */}
        <aside className="flex flex-col gap-5 rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.04] p-4">
          <div className="flex items-center gap-2">
            <Brain size={16} className="text-violet-600 dark:text-violet-400" />
            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white">AI Decision Summary</h3>
          </div>

          <div className="rounded-xl bg-white dark:bg-white/[0.04] p-3 text-center">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-white/40">Best Match</div>
            <div className="mt-1 font-display text-base font-bold text-slate-900 dark:text-white">
              {decision.bestMatch?.label ?? 'No match'}
            </div>
            {decision.bestMatch?.title ? (
              <div className="mt-1 line-clamp-2 text-[11px] text-slate-500 dark:text-white/50">{decision.bestMatch.title}</div>
            ) : null}
          </div>

          <div>
            <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-400 dark:text-white/40">Match Type</div>
            <span className={`chip font-bold ${matchTypeTone(decision.matchType)}`}>{decision.matchType}</span>
          </div>

          <div className="flex flex-col items-center">
            <div className="mb-1 self-start text-[10px] font-bold uppercase tracking-wide text-slate-400 dark:text-white/40">
              Confidence Score
            </div>
            <ConfidenceDonut value={decision.confidence} />
          </div>

          <SidebarList
            title="Why This Match?"
            icon={<CheckCircle2 size={13} className="text-emerald-600 dark:text-emerald-300" />}
            items={decision.whyThisMatch}
            tone="text-emerald-600 dark:text-emerald-300"
          />
          <SidebarList
            title="Differences Found"
            icon={<AlertTriangle size={13} className="text-amber-600 dark:text-amber-300" />}
            items={decision.differencesFound}
            tone="text-amber-600 dark:text-amber-300"
          />
          <SidebarList
            title="Catalog Insights"
            icon={<Lightbulb size={13} className="text-sky-600 dark:text-sky-300" />}
            items={decision.catalogInsights}
            tone="text-sky-600 dark:text-sky-300"
          />

          {/* On-screen only — the user decided this doesn't belong on paper. */}
          <div className="no-print">
            <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400 dark:text-white/40">
              Recommended Action
            </div>
            <div
              className={`flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs leading-relaxed ${
                decision.posture === 'undercut'
                  ? 'border border-rose-200 bg-rose-50 dark:border-rose-500/20 dark:bg-rose-500/[0.08] text-rose-800 dark:text-rose-100'
                  : decision.posture === 'winning'
                    ? 'border border-emerald-200 bg-emerald-50 dark:border-emerald-500/20 dark:bg-emerald-500/[0.08] text-emerald-800 dark:text-emerald-100'
                    : 'border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.04] text-slate-600 dark:text-white/70'
              }`}
            >
              <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
              {decision.recommendedAction}
            </div>
          </div>

          {/* Verify — the report asserts these are the same product; this is
              how you check that claim against the live listings. */}
          <div className="border-t border-slate-200 dark:border-white/[0.08] pt-3">
            <div className="mb-2 flex items-center gap-1.5">
              <ShieldCheck size={13} className="text-slate-400 dark:text-white/40" />
              <h4 className="text-[10px] font-bold uppercase tracking-wide text-slate-400 dark:text-white/40">
                Verify on the live sites
              </h4>
            </div>
            <div className="flex flex-col gap-1.5">
              {columns.map((c) => {
                const meta = PLATFORM_META[c.platform];
                const isSource = c.role === 'source';
                if (!c.url) {
                  return (
                    <span
                      key={c.key}
                      className="flex items-center justify-between rounded-lg bg-white dark:bg-white/[0.04] px-2.5 py-1.5 text-[11px] text-slate-400 dark:text-white/40"
                    >
                      {c.label}
                      <span>{c.status === 'blocked' ? 'blocked' : 'no match'}</span>
                    </span>
                  );
                }
                return (
                  <a
                    key={c.key}
                    href={c.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-slate-900 dark:text-white transition hover:brightness-125"
                    style={{ background: `${meta?.color}1f`, boxShadow: `inset 0 0 0 1px ${meta?.color}44` }}
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full" style={{ background: meta?.color }} />
                      {isSource ? 'Open on Tata CLIQ' : `Verify on ${meta?.short ?? c.label}`}
                    </span>
                    <ExternalLink size={11} />
                  </a>
                );
              })}
            </div>
            {/* A printed report loses its hyperlinks — spell the URLs out. */}
            <div className="print-only mt-2 flex flex-col gap-1">
              {columns.filter((c) => c.url).map((c) => (
                <p key={c.key} className="break-all text-[9px] leading-snug text-slate-500 dark:text-white/50">
                  <span className="font-semibold">{c.label}:</span> {c.url}
                </p>
              ))}
            </div>
          </div>
        </aside>
      </div>

      {/* Legend + refresh */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.04] px-4 py-3">
        <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400 dark:text-white/40">Legend</span>
        {legend.map((l) => (
          <span key={l.verdict} className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-white/50">
            <span className={`h-2.5 w-2.5 rounded-full ${VERDICT_STYLE[l.verdict].dot}`} />
            {l.label}
          </span>
        ))}
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          className="no-print ml-auto flex items-center gap-1.5 rounded-full bg-slate-100 dark:bg-white/[0.06] px-3 py-1.5 text-[11px] font-medium text-slate-700 dark:text-white/80 transition hover:bg-slate-200 dark:hover:bg-white/[0.12] disabled:opacity-50"
        >
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
          {refreshing ? 'Re-matching…' : 'Refresh live'}
        </button>
        <button
          onClick={() => window.print()}
          className="no-print flex items-center gap-1.5 rounded-full bg-slate-100 dark:bg-white/[0.06] px-3 py-1.5 text-[11px] font-medium text-slate-700 dark:text-white/80 transition hover:bg-slate-200 dark:hover:bg-white/[0.12]"
        >
          <Printer size={12} /> Export PDF
        </button>
        {onClose ? (
          <button
            onClick={onClose}
            className="no-print rounded-full bg-slate-100 dark:bg-white/[0.06] px-3 py-1.5 text-[11px] font-medium text-slate-700 dark:text-white/80 transition hover:bg-slate-200 dark:hover:bg-white/[0.12]"
          >
            Close
          </button>
        ) : null}
        <span className="print-only ml-auto text-[9px] text-slate-400 dark:text-white/40">
          PriceLens · matched {data.matchedAt ? new Date(data.matchedAt).toLocaleString('en-IN') : '—'}
          {data.cached ? ' · saved report' : ''}
        </span>
      </div>
    </div>
  );
}
