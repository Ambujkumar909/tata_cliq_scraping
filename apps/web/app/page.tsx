'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Archive, Zap, FileSpreadsheet, Upload } from 'lucide-react';
import { api } from '@/lib/api';
import type { Comparison, ProductListItem, Stats } from '@/lib/types';
import { Logo } from '@/components/ui';
import { StatsBar } from '@/components/StatsBar';
import { Intelligence } from '@/components/Intelligence';
import { Controls } from '@/components/Controls';
import { UrlLookup } from '@/components/UrlLookup';
import { ThemeToggle } from '@/components/ThemeToggle';
import { ProductCard } from '@/components/ProductCard';
import { RecentSearches } from '@/components/RecentSearches';
import { CompareModal } from '@/components/CompareModal';
import { ExportModal } from '@/components/ExportModal';
import { ImportModal } from '@/components/ImportModal';

const PAGE_SIZE = 24;

export default function Home() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [items, setItems] = useState<ProductListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('relevance');
  const [comparedOnly, setComparedOnly] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  // Bumped whenever a comparison lands, so the derived panels refetch instead of
  // showing the figures they happened to load with.
  const [dataVersion, setDataVersion] = useState(0);
  const debounce = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    api.stats().then(setStats).catch(() => {});
  }, [dataVersion]);

  /**
   * A new comparison invalidates three things at once: the KPI cards, the
   * insight lists, and the compared product's own card. The card is patched
   * from the response in hand rather than refetched — a full page refetch would
   * reset an infinite-scrolled list back to page one.
   */
  const handleCompared = useCallback((id: string, cmp: Comparison) => {
    setItems((prev) =>
      prev.map((p) =>
        p.id === id
          ? {
              ...p,
              comparison: {
                matchedCount: cmp.summary.matchedCount,
                prices: cmp.summary.prices,
                cheapest: cmp.summary.cheapest,
                matchedAt: cmp.matchedAt,
              },
            }
          : p,
      ),
    );
    setDataVersion((v) => v + 1);
  }, []);

  const fetchPage = useCallback(
    async (nextPage: number, replace: boolean) => {
      setLoading(true);
      try {
        const res = await api.products({ q, sort, comparedOnly, page: nextPage, pageSize: PAGE_SIZE });
        setTotal(res.total);
        setItems((prev) => (replace ? res.items : [...prev, ...res.items]));
        setPage(res.page);
      } finally {
        setLoading(false);
      }
    },
    [q, sort, comparedOnly],
  );

  // Refetch (debounced) when filters change
  useEffect(() => {
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => fetchPage(1, true), 250);
    return () => clearTimeout(debounce.current);
  }, [q, sort, comparedOnly, fetchPage]);

  const canLoadMore = items.length < total;

  return (
    <main className="mx-auto max-w-7xl px-4 pb-24 pt-6 sm:px-6">
      {/* Nav */}
      <nav className="flex items-center justify-between">
        <Logo />
        <div className="flex items-center gap-2 text-xs text-slate-400 dark:text-white/40">
          <span className="chip hidden bg-slate-100 dark:bg-white/[0.06] sm:inline-flex">
            <Zap size={12} className="text-amber-500 dark:text-gold" /> Live from CLIQ · Myntra · Ajio
          </span>
          <button
            onClick={() => setImporting(true)}
            className="flex items-center gap-1.5 rounded-full bg-cliq px-3.5 py-2 font-semibold text-white transition hover:brightness-110"
          >
            <Upload size={13} /> Import sheet
          </button>
          <button
            onClick={() => setExporting(true)}
            className="flex items-center gap-1.5 rounded-full bg-emerald-600 px-3.5 py-2 font-semibold text-white transition hover:bg-emerald-700"
          >
            <FileSpreadsheet size={13} /> Export
          </button>
          <Link
            href="/reports"
            className="flex items-center gap-1.5 rounded-full bg-slate-100 px-3.5 py-2 font-medium text-slate-600 transition hover:bg-slate-200 hover:text-slate-900 dark:bg-white/[0.06] dark:text-white/70 dark:hover:bg-white/[0.12] dark:hover:text-white"
          >
            <Archive size={13} /> Saved reports
          </Link>
          <ThemeToggle />
        </div>
      </nav>

      {/* Hero */}
      <section className="mt-12 mb-10 text-center">
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mx-auto max-w-4xl text-balance font-display text-4xl font-extrabold leading-[1.05] tracking-tight text-slate-900 dark:text-white sm:text-6xl"
        >
          Every CLIQ product,{' '}
          <span className="bg-gradient-to-r from-cliq via-myntra to-ajio bg-clip-text text-transparent">
            priced against the competition.
          </span>
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="mx-auto mt-5 max-w-xl text-balance text-base text-slate-500 dark:text-white/50 sm:text-lg"
        >
          Matched live against Myntra and Ajio — see exactly where you win on price, and where
          dealers undercut you.
        </motion.p>
      </section>

      <UrlLookup />

      <div className="mt-10">
        <StatsBar stats={stats} />
      </div>

      <Intelligence stats={stats} onOpen={setOpenId} version={dataVersion} />

      {/* Pinned above the grid: link-sourced products never enter the catalog
          itself, so this is the only way back to one you just compared. */}
      <RecentSearches onOpen={setOpenId} version={dataVersion} />

      <div id="catalog" className="mt-12">
        <Controls
          q={q}
          sort={sort}
          comparedOnly={comparedOnly}
          onQ={setQ}
          onSort={setSort}
          onComparedOnly={setComparedOnly}
        />
      </div>

      {/* Result meta */}
      <div className="mt-5 flex items-center justify-between text-sm text-slate-400 dark:text-white/40">
        <span>
          {total.toLocaleString('en-IN')} products
          {comparedOnly ? ' with live comparisons' : ''}
        </span>
      </div>

      {/* Grid */}
      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((p, i) => (
          <ProductCard key={p.id} p={p} index={i} onOpen={() => setOpenId(p.id)} />
        ))}
        {loading &&
          items.length === 0 &&
          Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="skeleton aspect-[3/5] rounded-2xl" />
          ))}
      </div>

      {items.length === 0 && !loading ? (
        <div className="py-20 text-center text-slate-400 dark:text-white/40">No products match your search.</div>
      ) : null}

      {/* Load more */}
      {canLoadMore ? (
        <div className="mt-10 flex justify-center">
          <button
            onClick={() => fetchPage(page + 1, false)}
            disabled={loading}
            className="rounded-full glass glass-hover px-8 py-3 text-sm font-semibold text-slate-900 dark:text-white disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Load more products'}
          </button>
        </div>
      ) : null}

      {/* Footer */}
      <footer className="mt-20 flex flex-col items-center gap-2 border-t border-slate-200 dark:border-white/[0.08] pt-8 text-center text-xs text-slate-400 dark:text-white/40">
        <Logo />
        <p className="mt-2 max-w-md">
          Competitive price intelligence prototype. Prices scraped live from public storefronts for
          demonstration; product matching is confidence-scored.
        </p>
      </footer>

      {openId ? (
        <CompareModal productId={openId} onClose={() => setOpenId(null)} onCompared={handleCompared} />
      ) : null}

      {exporting ? <ExportModal onClose={() => setExporting(false)} /> : null}

      {/* A finished import can add thousands of comparisons, so the KPIs, the
          insight lists and the catalog grid all need to be re-read. */}
      {importing ? (
        <ImportModal
          onClose={() => setImporting(false)}
          onFinished={() => { setDataVersion((v) => v + 1); fetchPage(1, true); }}
        />
      ) : null}
    </main>
  );
}
