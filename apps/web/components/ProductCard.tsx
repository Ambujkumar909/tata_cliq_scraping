'use client';
import { motion } from 'framer-motion';
import { TrendingDown, TrendingUp, Minus, ArrowRight } from 'lucide-react';
import type { ProductListItem, Platform } from '@/lib/types';
import { inr } from '@/lib/format';
import { api, PLATFORM_META } from '@/lib/api';

// Hover = intent. Prefetch each uncompared product once per session so the
// live match is already running (or done) by the time the click lands.
const prefetched = new Set<string>();
function prefetchOnHover(p: ProductListItem) {
  if (p.comparison || prefetched.has(p.id)) return;
  prefetched.add(p.id);
  api.prefetch(p.id);
}

function CheapestPill({ platform }: { platform: Platform }) {
  const m = PLATFORM_META[platform];
  return (
    <span
      className="chip font-semibold"
      style={{ background: `${m.color}22`, color: m.soft, boxShadow: `inset 0 0 0 1px ${m.color}55` }}
    >
      Cheapest · {m.short}
    </span>
  );
}

export function ProductCard({
  p,
  onOpen,
  index,
  badge,
}: {
  p: ProductListItem;
  onOpen: () => void;
  index: number;
  /** Optional caption laid over the foot of the image — used for "3h ago" on recent searches. */
  badge?: React.ReactNode;
}) {
  const cmp = p.comparison;
  const prices = cmp?.prices;
  const competitorMin = prices
    ? Math.min(...(['myntra', 'ajio'] as Platform[]).map((k) => prices[k] ?? Infinity))
    : Infinity;
  const cliq = p.price ?? Infinity;
  const gap = competitorMin !== Infinity ? cliq - competitorMin : null;

  return (
    <motion.button
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: Math.min(index * 0.02, 0.3) }}
      whileHover={{ y: -6 }}
      onMouseEnter={() => prefetchOnHover(p)}
      onFocus={() => prefetchOnHover(p)}
      onClick={onOpen}
      className="group relative flex flex-col overflow-hidden rounded-2xl glass glass-hover text-left"
    >
      {/* Image */}
      <div className="relative aspect-[3/4] overflow-hidden bg-slate-100 dark:bg-white/[0.06]">
        {p.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={p.image}
            alt={p.title}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
          />
        ) : (
          <div className="grid h-full w-full place-items-center text-slate-300 dark:text-white/25">No image</div>
        )}
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/25 dark:from-ink-900 to-transparent" />
        {p.discountPercent ? (
          <span className="absolute left-3 top-3 chip bg-emerald-500/90 font-bold text-ink-950">
            {p.discountPercent}% OFF
          </span>
        ) : null}
        {cmp?.cheapest ? (
          <div className="absolute right-3 top-3">
            <CheapestPill platform={cmp.cheapest.platform} />
          </div>
        ) : null}
        {/* Sits on the gradient the image already carries, so it stays readable
            whatever the photo behind it. */}
        {badge ? <div className="absolute bottom-2 left-3">{badge}</div> : null}
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-white/50">{p.brand}</span>
          {p.rating ? <span className="text-xs text-emerald-600 dark:text-emerald-300">★ {p.rating.toFixed(1)}</span> : null}
        </div>
        <h3 className="line-clamp-2 text-sm font-medium text-slate-800 dark:text-white/90">{p.title}</h3>

        <div className="mt-auto flex items-baseline gap-2 pt-1">
          <span className="font-display text-xl font-bold text-slate-900 dark:text-white">{inr(p.price)}</span>
          {p.mrp && p.mrp !== p.price ? (
            <span className="text-sm text-slate-400 dark:text-white/40 line-through">{inr(p.mrp)}</span>
          ) : null}
        </div>

        {/* Comparison strip */}
        {cmp && cmp.matchedCount > 0 ? (
          <div className="mt-1 flex items-center gap-3 border-t border-slate-200 dark:border-white/[0.08] pt-2 text-xs">
            {(['myntra', 'ajio'] as Platform[]).map((k) =>
              prices?.[k] != null ? (
                <span key={k} className="flex items-center gap-1.5 text-slate-500 dark:text-white/50">
                  <span className="h-2 w-2 rounded-full" style={{ background: PLATFORM_META[k].color }} />
                  {inr(prices[k])}
                </span>
              ) : null,
            )}
            {gap != null && gap !== 0 ? (
              <span
                className={`ml-auto flex items-center gap-1 font-semibold ${
                  gap > 0 ? 'text-rose-600 dark:text-rose-300' : 'text-emerald-600 dark:text-emerald-300'
                }`}
              >
                {gap > 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                {gap > 0 ? `+${inr(gap)}` : inr(Math.abs(gap))}
              </span>
            ) : (
              <span className="ml-auto flex items-center gap-1 text-slate-400 dark:text-white/40">
                <Minus size={12} /> match
              </span>
            )}
          </div>
        ) : (
          <div className="mt-1 flex items-center gap-1.5 border-t border-slate-200 dark:border-white/[0.08] pt-2 text-xs text-slate-400 dark:text-white/40">
            <ArrowRight size={12} /> Tap to compare live
          </div>
        )}
      </div>
    </motion.button>
  );
}
