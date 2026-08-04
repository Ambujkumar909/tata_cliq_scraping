'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Github, Zap } from 'lucide-react';
import { api } from '@/lib/api';
import type { ProductListItem, Stats } from '@/lib/types';
import { Logo } from '@/components/ui';
import { StatsBar } from '@/components/StatsBar';
import { Intelligence } from '@/components/Intelligence';
import { Controls } from '@/components/Controls';
import { UrlLookup } from '@/components/UrlLookup';
import { ThemeToggle } from '@/components/ThemeToggle';
import { ProductCard } from '@/components/ProductCard';
import { CompareModal } from '@/components/CompareModal';

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
  const debounce = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    api.stats().then(setStats).catch(() => {});
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
          <span className="chip bg-slate-100 dark:bg-white/[0.06]">
            <Zap size={12} className="text-amber-500 dark:text-gold" /> Live from CLIQ · Myntra · Ajio
          </span>
          <ThemeToggle />
        </div>
      </nav>

      {/* Hero */}
      <section className="mt-10 mb-8">
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-3xl font-display text-4xl font-extrabold leading-[1.05] tracking-tight text-slate-900 dark:text-white sm:text-6xl"
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
          className="mt-4 max-w-2xl text-base text-slate-500 dark:text-white/50 sm:text-lg"
        >
          PriceLens finds the same item on Myntra and Ajio for every Tata CLIQ listing — so you know,
          instantly, where you win on price and where dealers undercut you.
        </motion.p>
      </section>

      <UrlLookup />

      <div className="mt-10">
        <StatsBar stats={stats} />
      </div>

      <Intelligence stats={stats} onOpen={setOpenId} />

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

      {openId ? <CompareModal productId={openId} onClose={() => setOpenId(null)} /> : null}
    </main>
  );
}
