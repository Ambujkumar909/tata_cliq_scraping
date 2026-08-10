'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { ArrowLeft, Archive, Link2, Search, RefreshCw, Clock, ExternalLink } from 'lucide-react';
import { api, PLATFORM_META } from '@/lib/api';
import type { SavedReport, SavedReportPage } from '@/lib/types';
import { inr } from '@/lib/format';
import { Logo } from '@/components/ui';
import { ThemeToggle } from '@/components/ThemeToggle';

const PAGE_SIZE = 24;

const matchTone = (t: string) =>
  t === 'EXACT MATCH' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300'
  : t === 'CLOSE MATCH' ? 'bg-sky-500/15 text-sky-600 dark:text-sky-300'
  : t === 'PARTIAL MATCH' ? 'bg-amber-500/15 text-amber-600 dark:text-amber-300'
  : 'bg-slate-100 dark:bg-white/[0.06] text-slate-500 dark:text-white/50';

const since = (h: number | null) => {
  if (h == null) return '—';
  if (h < 1 / 60) return 'moments ago';
  if (h < 1) return `${Math.round(h * 60)} min ago`;
  if (h < 24) return `${Math.round(h)} h ago`;
  return `${Math.round(h / 24)} d ago`;
};

/**
 * A saved report is only replayed while it is fresh; past the TTL the next open
 * re-scrapes it. Showing the remaining window (rather than just "saved") is what
 * makes the row honest about whether its prices are still current.
 */
function Freshness({ r, ttlHours }: { r: SavedReport; ttlHours: number }) {
  if (!r.fresh) {
    return (
      <span className="flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-300">
        <RefreshCw size={11} /> Expired · re-scrapes on open
      </span>
    );
  }
  const pct = r.expiresInHours == null ? 0 : Math.max(2, (r.expiresInHours / ttlHours) * 100);
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-slate-400 dark:text-white/40">
      <Clock size={11} />
      {r.expiresInHours != null && r.expiresInHours < 1
        ? `${Math.round(r.expiresInHours * 60)} min left`
        : `${Math.round(r.expiresInHours ?? 0)} h left`}
      <span className="h-1 w-10 overflow-hidden rounded-full bg-slate-200 dark:bg-white/[0.08]">
        <span className="block h-full rounded-full bg-emerald-400" style={{ width: `${pct}%` }} />
      </span>
    </span>
  );
}

function ReportRow({ r, ttlHours, index }: { r: SavedReport; ttlHours: number; index: number }) {
  const cheapest = r.cheapest ? PLATFORM_META[r.cheapest.platform] : null;
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.02, 0.3) }}
    >
      <Link
        href={`/report/${r.id}`}
        className="flex items-center gap-4 rounded-2xl glass glass-hover p-3 sm:p-4"
      >
        <div className="h-20 w-16 shrink-0 overflow-hidden rounded-xl bg-slate-100 dark:bg-white/[0.06]">
          {r.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={r.image} alt={r.title ?? ''} className="h-full w-full object-cover" />
          ) : null}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 dark:text-white/40">
              {r.brand}
            </span>
            {/* A pasted-link product is not in the catalog, so this page is the
                only place it can be found again — say so. */}
            {r.source === 'link' ? (
              <span className="chip bg-violet-500/15 px-2 py-0.5 text-[10px] text-violet-600 dark:text-violet-300">
                <Link2 size={10} /> from link
              </span>
            ) : null}
          </div>
          <h3 className="truncate text-sm font-semibold text-slate-900 dark:text-white">{r.title}</h3>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className={`chip px-2 py-0.5 text-[10px] font-bold ${matchTone(r.matchType)}`}>
              {r.matchType}
              {r.confidence != null ? ` · ${Math.round(r.confidence * 100)}%` : ''}
            </span>
            <span className="text-[11px] text-slate-400 dark:text-white/40">
              {r.matchedCount}/2 matched · {since(r.ageHours)}
            </span>
            <Freshness r={r} ttlHours={ttlHours} />
          </div>
        </div>

        <div className="hidden shrink-0 flex-col items-end gap-1 sm:flex">
          {(['tatacliq', 'myntra', 'ajio'] as const).map((p) => {
            const price = r.prices[p];
            const isCheapest = r.cheapest?.platform === p;
            return (
              <span key={p} className="flex items-center gap-1.5 text-[11px]">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: PLATFORM_META[p].color }} />
                <span className="text-slate-400 dark:text-white/40">{PLATFORM_META[p].short}</span>
                <span
                  className={isCheapest ? 'font-bold text-slate-900 dark:text-white' : 'text-slate-500 dark:text-white/50'}
                >
                  {price == null ? '—' : inr(Math.round(price))}
                </span>
              </span>
            );
          })}
        </div>

        {cheapest ? (
          <span
            className="hidden shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold sm:block"
            style={{ background: `${cheapest.color}1f`, color: cheapest.color }}
          >
            Cheapest · {cheapest.short}
          </span>
        ) : null}

        <ExternalLink size={14} className="shrink-0 text-slate-300 dark:text-white/25" />
      </Link>
    </motion.div>
  );
}

/**
 * Every comparison this instance has already generated.
 *
 * The catalog's "Compared only" filter cannot serve this purpose: products
 * resolved from a pasted link are deliberately kept out of the catalog, so
 * without this page their reports are unreachable once the URL is lost.
 */
export default function ReportsPage() {
  const [data, setData] = useState<SavedReportPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [freshOnly, setFreshOnly] = useState(false);
  const [page, setPage] = useState(1);
  const debounce = useRef<ReturnType<typeof setTimeout>>();

  const fetchPage = useCallback(async (nextPage: number) => {
    setLoading(true);
    try {
      setData(await api.savedReports({ q, freshOnly, page: nextPage, pageSize: PAGE_SIZE }));
      setPage(nextPage);
    } finally {
      setLoading(false);
    }
  }, [q, freshOnly]);

  useEffect(() => {
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => fetchPage(1), 250);
    return () => clearTimeout(debounce.current);
  }, [q, freshOnly, fetchPage]);

  const items = data?.items ?? [];

  return (
    <main className="mx-auto max-w-5xl px-4 pb-20 pt-6 sm:px-6">
      <nav className="mb-8 flex items-center justify-between">
        <Logo />
        <div className="flex items-center gap-2">
          <Link
            href="/"
            className="flex items-center gap-1.5 rounded-full bg-slate-100 dark:bg-white/[0.06] px-3.5 py-2 text-xs font-medium text-slate-600 dark:text-white/70 transition hover:bg-slate-200 dark:hover:bg-white/[0.12] hover:text-slate-900 dark:hover:text-white"
          >
            <ArrowLeft size={13} /> Back to catalog
          </Link>
          <ThemeToggle />
        </div>
      </nav>

      <header className="mb-6">
        <h1 className="flex items-center gap-2.5 font-display text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
          <Archive size={26} className="text-cliq" /> Saved reports
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-500 dark:text-white/50">
          Every comparison already generated, newest first. Opening one replays the saved result
          instantly instead of re-scraping — for up to {data?.ttlHours ?? 24}h, after which the next
          open refreshes it.
        </p>
      </header>

      {/* Controls */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-white/30" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search saved reports — brand, product, listing id…"
            className="w-full rounded-full glass py-2.5 pl-10 pr-4 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-slate-300 dark:text-white dark:placeholder:text-white/30"
          />
        </div>
        <button
          onClick={() => setFreshOnly((v) => !v)}
          className={`rounded-full px-4 py-2.5 text-xs font-medium transition ${
            freshOnly
              ? 'bg-cliq text-white'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-white/[0.06] dark:text-white/70 dark:hover:bg-white/[0.12]'
          }`}
        >
          Still fresh only
        </button>
        <button
          onClick={() => fetchPage(page)}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-full bg-slate-100 px-4 py-2.5 text-xs font-medium text-slate-600 transition hover:bg-slate-200 disabled:opacity-50 dark:bg-white/[0.06] dark:text-white/70 dark:hover:bg-white/[0.12]"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Reload
        </button>
      </div>

      {data ? (
        <p className="mb-4 text-xs text-slate-400 dark:text-white/40">
          {data.total.toLocaleString('en-IN')} saved · {data.freshCount.toLocaleString('en-IN')} still fresh
        </p>
      ) : null}

      <div className="flex flex-col gap-3">
        {loading && !items.length
          ? Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton h-28 rounded-2xl" />)
          : items.map((r, i) => <ReportRow key={r.id} r={r} ttlHours={data?.ttlHours ?? 24} index={i} />)}
      </div>

      {!loading && !items.length ? (
        <div className="rounded-2xl glass py-16 text-center">
          <Archive size={28} className="mx-auto mb-3 text-slate-300 dark:text-white/20" />
          <p className="text-sm text-slate-500 dark:text-white/50">
            {q || freshOnly ? 'No saved report matches that filter.' : 'No reports saved yet.'}
          </p>
          <p className="mt-1 text-xs text-slate-400 dark:text-white/40">
            Compare a product from the catalog — every comparison lands here automatically.
          </p>
        </div>
      ) : null}

      {data && data.totalPages > 1 ? (
        <div className="mt-8 flex items-center justify-center gap-3 text-xs">
          <button
            onClick={() => fetchPage(page - 1)}
            disabled={page <= 1 || loading}
            className="rounded-full bg-slate-100 px-4 py-2 font-medium text-slate-600 disabled:opacity-40 dark:bg-white/[0.06] dark:text-white/70"
          >
            Previous
          </button>
          <span className="text-slate-400 dark:text-white/40">
            Page {page} of {data.totalPages}
          </span>
          <button
            onClick={() => fetchPage(page + 1)}
            disabled={page >= data.totalPages || loading}
            className="rounded-full bg-slate-100 px-4 py-2 font-medium text-slate-600 disabled:opacity-40 dark:bg-white/[0.06] dark:text-white/70"
          >
            Next
          </button>
        </div>
      ) : null}
    </main>
  );
}
