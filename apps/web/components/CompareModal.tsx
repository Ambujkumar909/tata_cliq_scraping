'use client';
import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ExternalLink, RefreshCw, Crown, Ban, SearchX, Sparkles, BadgeCheck, Palette, Tag, FileBarChart } from 'lucide-react';
import type { Comparison, Platform, CompetitorMatch } from '@/lib/types';
import { api, PLATFORM_META } from '@/lib/api';
import { inr } from '@/lib/format';
import { MatchReport } from './MatchReport';

const PLATFORM_ORDER: Platform[] = ['tatacliq', 'myntra', 'ajio'];

function statusLabel(m: CompetitorMatch) {
  switch (m.status) {
    case 'no_match':
      return { icon: <SearchX size={14} />, text: 'No ditto match found', hint: m.nearest?.brand ? `nearest: ${m.nearest.brand}` : undefined };
    case 'color_mismatch':
      return { icon: <Palette size={14} />, text: 'Same style, colour unverified', hint: undefined };
    case 'no_results':
      return { icon: <SearchX size={14} />, text: 'Not found', hint: undefined };
    case 'blocked':
      return { icon: <Ban size={14} />, text: 'Blocked — needs proxy', hint: undefined };
    case 'ambiguous':
      return {
        icon: <SearchX size={14} />,
        text: `${m.candidates?.length ?? 'Multiple'} near-identical candidates — exact SKU unprovable`,
        hint: m.candidates?.[0] ? `e.g. ${m.candidates[0].title}` : undefined,
      };
    default:
      return { icon: <SearchX size={14} />, text: 'Unavailable', hint: undefined };
  }
}

function Evidence({ match }: { match: CompetitorMatch }) {
  if (match.status !== 'matched') return null;
  const ic = match.imageCheck;
  return (
    <div className="flex flex-wrap gap-1.5">
      <span className="chip bg-emerald-500/15 text-[11px] text-emerald-600 dark:text-emerald-300">
        <Tag size={11} /> Exact MRP
      </span>
      {ic?.colorConfirmed ? (
        <span className="chip bg-sky-500/15 text-[11px] text-sky-600 dark:text-sky-300">
          <BadgeCheck size={11} /> Colour verified{ic.deltaE != null ? ` (Δ${ic.deltaE})` : ''}
        </span>
      ) : null}
      {match.colorDiffers ? (
        <span className="chip bg-amber-500/15 text-[11px] text-amber-600 dark:text-amber-300">
          <Palette size={11} /> Colour name differs
        </span>
      ) : null}
    </div>
  );
}

function PriceColumn({
  platform,
  price,
  mrp,
  discount,
  url,
  sizes,
  match,
  isCheapest,
  maxPrice,
}: {
  platform: Platform;
  price: number | null;
  mrp?: number | null;
  discount?: number | null;
  url?: string | null;
  sizes?: string[];
  match?: CompetitorMatch;
  isCheapest: boolean;
  maxPrice: number;
}) {
  const meta = PLATFORM_META[platform];
  const unavailable = platform !== 'tatacliq' && match && match.status !== 'matched';
  const barPct = price && maxPrice ? Math.max(8, (price / maxPrice) * 100) : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative flex flex-col gap-3 rounded-2xl border p-4"
      style={{
        borderColor: isCheapest ? meta.color : 'var(--card-border)',
        background: isCheapest ? `${meta.color}12` : 'var(--card-bg)',
        boxShadow: isCheapest ? `0 12px 40px -16px ${meta.color}` : undefined,
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: meta.color }} />
          <span className="font-semibold text-slate-900 dark:text-white">{meta.label}</span>
        </div>
        {isCheapest ? (
          <span className="chip font-bold" style={{ background: meta.color, color: '#0b0b14' }}>
            <Crown size={12} /> Best price
          </span>
        ) : null}
      </div>

      {unavailable ? (
        <div className="flex flex-col gap-1 py-3 text-slate-400 dark:text-white/40">
          <span className="flex items-center gap-1.5 text-sm">{statusLabel(match!).icon}{statusLabel(match!).text}</span>
          {statusLabel(match!).hint ? (
            <span className="text-xs text-slate-400 dark:text-white/40">Closest: {statusLabel(match!).hint}</span>
          ) : null}
        </div>
      ) : (
        <>
          <div className="flex items-baseline gap-2">
            <span className="font-display text-2xl font-bold text-slate-900 dark:text-white">{inr(price)}</span>
            {mrp && mrp !== price ? <span className="text-sm text-slate-400 dark:text-white/40 line-through">{inr(mrp)}</span> : null}
            {discount ? <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-300">{discount}% off</span> : null}
          </div>
          {/* price bar */}
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-white/[0.06]">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${barPct}%` }}
              transition={{ duration: 0.7, ease: 'easeOut' }}
              className="h-full rounded-full"
              style={{ background: meta.color }}
            />
          </div>
          {match?.status === 'matched' && match.score != null ? (
            <span className="text-[11px] text-slate-400 dark:text-white/40">
              match confidence {Math.round(match.score * 100)}%
            </span>
          ) : null}
          {match ? <Evidence match={match} /> : null}
          {sizes && sizes.length ? (
            <div className="flex flex-wrap gap-1 pt-1">
              {sizes.slice(0, 10).map((s) => (
                <span key={s} className="chip bg-slate-100 dark:bg-white/[0.06] text-[11px] text-slate-600 dark:text-white/70">
                  {s}
                </span>
              ))}
            </div>
          ) : null}
          {url ? (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="mt-auto flex items-center justify-center gap-1.5 rounded-xl py-2 text-sm font-medium text-slate-900 dark:text-white transition-colors"
              style={{ background: `${meta.color}22`, boxShadow: `inset 0 0 0 1px ${meta.color}44` }}
            >
              View on {meta.short} <ExternalLink size={13} />
            </a>
          ) : null}
        </>
      )}
    </motion.div>
  );
}

export function CompareModal({ productId, onClose }: { productId: string; onClose: () => void }) {
  const [data, setData] = useState<Comparison | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = useState<'compare' | 'report'>('compare');

  const load = useCallback(
    async (refresh = false) => {
      refresh ? setRefreshing(true) : setLoading(true);
      try {
        const d = await api.product(productId, refresh);
        setData(d);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [productId],
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const anchor = data?.anchor;
  const prices = data?.summary.prices ?? {};
  const numericPrices = Object.values(prices).filter((v): v is number => typeof v === 'number');
  const maxPrice = numericPrices.length ? Math.max(...numericPrices) : 0;
  const cheapest = data?.summary.cheapest;
  const savings =
    cheapest && numericPrices.length > 1 ? Math.max(...numericPrices) - cheapest.price : 0;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/30 backdrop-blur-sm dark:bg-black/70 sm:items-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className="relative max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-t-3xl glass p-5 shadow-glow sm:rounded-3xl sm:p-7"
          initial={{ y: 40, opacity: 0, scale: 0.98 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 40, opacity: 0 }}
          transition={{ type: 'spring', damping: 26, stiffness: 260 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="no-print absolute right-4 top-4 z-10 flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-full bg-slate-100 dark:bg-white/[0.06] p-1">
              {(['compare', 'report'] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                    view === v ? 'bg-cliq text-slate-900 dark:text-white' : 'text-slate-500 dark:text-white/50 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {v === 'report' ? <FileBarChart size={12} /> : null}
                  {v === 'compare' ? 'Quick compare' : 'Full report'}
                </button>
              ))}
            </div>
            <button
              onClick={onClose}
              className="grid h-9 w-9 place-items-center rounded-full bg-slate-100 dark:bg-white/[0.06] text-slate-600 dark:text-white/70 transition hover:bg-slate-200 dark:hover:bg-white/[0.12] hover:text-slate-900 dark:hover:text-white"
            >
              <X size={18} />
            </button>
          </div>

          {view === 'report' ? (
            <div className="pt-14">
              <MatchReport productId={productId} />
            </div>
          ) : loading ? (
            <div className="grid gap-4">
              <div className="skeleton h-8 w-2/3 rounded-lg" />
              <div className="grid grid-cols-3 gap-3">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="skeleton h-40 rounded-2xl" />
                ))}
              </div>
              <p className="text-center text-sm text-slate-400 dark:text-white/40">Scraping live prices from Myntra &amp; Ajio…</p>
            </div>
          ) : anchor ? (
            <>
              {/* Header */}
              <div className="flex flex-col gap-4 sm:flex-row">
                <div className="h-40 w-32 shrink-0 overflow-hidden rounded-2xl bg-slate-100 dark:bg-white/[0.06]">
                  {anchor.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={anchor.image} alt={anchor.title} className="h-full w-full object-cover" />
                  ) : null}
                </div>
                <div className="flex flex-col gap-2 pr-8">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-white/50">
                    {anchor.brand}
                  </span>
                  <h2 className="font-display text-lg font-bold leading-snug text-slate-900 dark:text-white text-balance">
                    {anchor.title}
                  </h2>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-white/50">
                    {anchor.color ? <span className="chip bg-slate-100 dark:bg-white/[0.06]">{anchor.color}</span> : null}
                    {anchor.rating ? <span className="chip bg-slate-100 dark:bg-white/[0.06]">★ {anchor.rating}</span> : null}
                    {anchor.styleCode ? (
                      <span className="chip bg-slate-100 dark:bg-white/[0.06] font-mono">{anchor.styleCode}</span>
                    ) : null}
                  </div>
                </div>
              </div>

              {/* Savings banner */}
              {cheapest && savings > 0 ? (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-5 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 dark:border-emerald-500/20 dark:bg-emerald-500/[0.08] px-4 py-3"
                >
                  <Sparkles className="text-emerald-600 dark:text-emerald-300" size={18} />
                  <p className="text-sm text-emerald-800 dark:text-emerald-100">
                    Cheapest on{' '}
                    <span className="font-bold" style={{ color: PLATFORM_META[cheapest.platform].soft }}>
                      {PLATFORM_META[cheapest.platform].label}
                    </span>{' '}
                    at <span className="font-bold">{inr(cheapest.price)}</span> — up to{' '}
                    <span className="font-bold">{inr(savings)}</span> cheaper than the priciest platform.
                  </p>
                </motion.div>
              ) : null}

              {/* Price columns */}
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <PriceColumn
                  platform="tatacliq"
                  price={anchor.price}
                  mrp={anchor.mrp}
                  discount={anchor.discountPercent}
                  url={anchor.url}
                  isCheapest={cheapest?.platform === 'tatacliq'}
                  maxPrice={maxPrice}
                />
                {(['myntra', 'ajio'] as const).map((k) => {
                  const m = data!.competitors[k];
                  const prod = m.product;
                  return (
                    <PriceColumn
                      key={k}
                      platform={k}
                      price={prod?.price ?? null}
                      mrp={prod?.mrp}
                      discount={prod?.discountPercent}
                      url={prod?.url}
                      sizes={prod?.sizes}
                      match={m}
                      isCheapest={cheapest?.platform === k}
                      maxPrice={maxPrice}
                    />
                  );
                })}
              </div>

              {/* Footer */}
              <div className="mt-5 flex items-center justify-between text-xs text-slate-400 dark:text-white/40">
                <span>
                  Matched {data!.summary.matchedCount}/2 competitors ·{' '}
                  {new Date(data!.matchedAt).toLocaleString('en-IN')}
                </span>
                <button
                  onClick={() => load(true)}
                  disabled={refreshing}
                  className="flex items-center gap-1.5 rounded-full bg-slate-100 dark:bg-white/[0.06] px-3 py-1.5 font-medium text-slate-700 dark:text-white/80 transition hover:bg-slate-200 dark:hover:bg-white/[0.12] disabled:opacity-50"
                >
                  <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
                  {refreshing ? 'Re-scraping…' : 'Refresh live'}
                </button>
              </div>
            </>
          ) : (
            <p className="py-10 text-center text-slate-500 dark:text-white/50">Could not load comparison.</p>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
