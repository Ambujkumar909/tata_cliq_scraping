'use client';
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { TrendingDown, ShieldCheck, AlertTriangle } from 'lucide-react';
import { api, PLATFORM_META } from '@/lib/api';
import type { Insights, Stats, InsightRow, Platform } from '@/lib/types';
import { inr } from '@/lib/format';

function PositioningBar({ stats }: { stats: Stats }) {
  const { win, tie, lose, total, avgUndercut } = stats.positioning;
  const pct = (n: number) => (total ? (n / total) * 100 : 0);
  const seg = [
    { label: 'CLIQ cheapest', n: win, color: '#10b981' },
    { label: 'Tied', n: tie, color: '#64748b' },
    { label: 'Undercut by dealer', n: lose, color: '#e11d48' },
  ];
  return (
    <div className="rounded-2xl glass p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-white">Price positioning</h3>
        <span className="text-xs text-slate-400 dark:text-white/40">{total} matched products</span>
      </div>
      <div className="mt-4 flex h-3 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-white/[0.06]">
        {seg.map((s) => (
          <motion.div
            key={s.label}
            initial={{ width: 0 }}
            animate={{ width: `${pct(s.n)}%` }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
            style={{ background: s.color }}
            title={`${s.label}: ${s.n}`}
          />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs">
        {seg.map((s) => (
          <span key={s.label} className="flex items-center gap-1.5 text-slate-500 dark:text-white/50">
            <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
            {s.label} <span className="font-semibold text-slate-900 dark:text-white">{s.n}</span>
          </span>
        ))}
        <span className="ml-auto text-slate-500 dark:text-white/50">
          Avg dealer undercut <span className="font-semibold text-rose-600 dark:text-rose-300">{inr(avgUndercut)}</span>
        </span>
      </div>
    </div>
  );
}

function InsightList({
  title,
  icon,
  rows,
  tone,
  onOpen,
}: {
  title: string;
  icon: React.ReactNode;
  rows: InsightRow[];
  tone: 'bad' | 'good';
  onOpen: (id: string) => void;
}) {
  return (
    <div className="rounded-2xl glass p-5">
      <div className="mb-3 flex items-center gap-2">
        {icon}
        <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-white">{title}</h3>
      </div>
      <div className="flex flex-col gap-1.5">
        {rows.slice(0, 6).map((r) => {
          const meta = PLATFORM_META[r.competitor.platform as Platform];
          return (
            <button
              key={r.id}
              onClick={() => onOpen(r.id)}
              className="group flex items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-slate-100 dark:hover:bg-white/[0.1]"
            >
              <div className="h-11 w-9 shrink-0 overflow-hidden rounded-md bg-slate-100 dark:bg-white/[0.06]">
                {r.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.image} alt="" className="h-full w-full object-cover" />
                ) : null}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium text-slate-700 dark:text-white/80">
                  <span className="text-slate-500 dark:text-white/50">{r.brand}</span> · {r.title}
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500 dark:text-white/50">
                  CLIQ {inr(r.cliqPrice)}
                  <span style={{ color: meta.soft }}>
                    {meta.short} {inr(r.competitor.price)}
                  </span>
                </div>
              </div>
              <div
                className={`shrink-0 text-sm font-bold ${tone === 'bad' ? 'text-rose-600 dark:text-rose-300' : 'text-emerald-600 dark:text-emerald-300'}`}
              >
                {tone === 'bad' ? '−' : '+'}
                {inr(Math.abs(r.gap))}
              </div>
            </button>
          );
        })}
        {rows.length === 0 ? <p className="px-2 py-4 text-xs text-slate-400 dark:text-white/40">No data yet.</p> : null}
      </div>
    </div>
  );
}

export function Intelligence({
  stats,
  onOpen,
  version = 0,
}: {
  stats: Stats | null;
  onOpen: (id: string) => void;
  /** Bumped by the dashboard when a comparison lands, to refetch the lists. */
  version?: number;
}) {
  const [ins, setIns] = useState<Insights | null>(null);
  useEffect(() => {
    api.insights(12).then(setIns).catch(() => {});
  }, [version]);

  return (
    <section className="mt-8 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <span className="chip bg-cliq/15 text-cliq">Intelligence</span>
        <span className="text-xs text-slate-400 dark:text-white/40">Actionable competitive signals for Tata CLIQ</span>
      </div>
      {stats ? <PositioningBar stats={stats} /> : <div className="skeleton h-28 rounded-2xl" />}
      <div className="grid gap-4 lg:grid-cols-2">
        <InsightList
          title="Where dealers undercut CLIQ"
          icon={<AlertTriangle size={16} className="text-rose-600 dark:text-rose-300" />}
          rows={ins?.undercuts ?? []}
          tone="bad"
          onOpen={onOpen}
        />
        <InsightList
          title="Where CLIQ wins on price"
          icon={<ShieldCheck size={16} className="text-emerald-600 dark:text-emerald-300" />}
          rows={ins?.wins ?? []}
          tone="good"
          onOpen={onOpen}
        />
      </div>
    </section>
  );
}
