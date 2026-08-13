'use client';
import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { History, X } from 'lucide-react';
import { api } from '@/lib/api';
import type { RecentSearch } from '@/lib/types';
import { ProductCard } from '@/components/ProductCard';
import { since } from '@/lib/format';

/**
 * Recently compared products — pasted links and bulk-imported rows alike —
 * pinned above the catalog grid until they age out.
 *
 * A link- or import-sourced product is deliberately kept out of the catalog
 * itself (it would inflate the KPIs and brand facets), which leaves it with no
 * route back once the report tab is closed. This strip is that route — and for
 * a catalog product it saves searching a 10k grid for the thing you looked at
 * an hour ago.
 *
 * The strip is capped server-side, so importing 10,000 products surfaces the
 * most recent of them rather than 10,000 cards.
 */
export function RecentSearches({
  onOpen,
  version = 0,
}: {
  onOpen: (id: string) => void;
  /** Bumped by the page when a lookup lands, so the strip refetches. */
  version?: number;
}) {
  const [items, setItems] = useState<RecentSearch[]>([]);
  const [ttlHours, setTtlHours] = useState(48);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(() => {
    api
      .recent()
      .then((res) => {
        setItems(res.items);
        setTtlHours(res.ttlHours);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  useEffect(load, [load, version]);

  /**
   * Dismiss optimistically: the card is gone from the user's point of view the
   * moment they click, and a failed unpin costs them nothing worse than the
   * card returning on the next load.
   */
  const forget = useCallback(
    (id: string) => {
      setItems((prev) => prev.filter((p) => p.id !== id));
      api.forgetRecent(id).catch(() => {});
    },
    [],
  );

  // Nothing pinned yet is the normal first-run state, not an empty result worth
  // announcing — render nothing at all.
  if (!loaded || !items.length) return null;

  const days = Math.round(ttlHours / 24);

  return (
    <section className="mt-12">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold tracking-tight text-slate-900 dark:text-white">
          <History size={16} className="text-cliq" />
          Recent searches
        </h2>
        <span className="text-xs text-slate-400 dark:text-white/40">
          Recently compared — pasted links and imported sheets — kept for{' '}
          {days === 1 ? 'a day' : `${days} days`}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <AnimatePresence initial={false}>
          {items.map((p, i) => (
            <motion.div
              key={p.id}
              layout
              exit={{ opacity: 0, scale: 0.96 }}
              className="group/recent relative"
            >
              <ProductCard
                p={p}
                index={i}
                onOpen={() => onOpen(p.id)}
                badge={
                  <span className="chip bg-black/55 font-semibold text-white backdrop-blur">
                    {since(p.searchedAt)}
                  </span>
                }
              />

              {/* Sibling of the card, not a child: ProductCard is itself a
                  button, and a button inside a button is invalid markup that
                  browsers resolve unpredictably. Floated into the grid gutter
                  so it never lands on the discount or "cheapest" pills. */}
              <button
                type="button"
                onClick={() => forget(p.id)}
                aria-label={`Remove ${p.title} from recent searches`}
                title="Remove from recent searches"
                className="absolute -right-2 -top-2 z-10 grid h-7 w-7 place-items-center rounded-full bg-slate-900 text-white opacity-0 shadow-lg ring-2 ring-white transition hover:bg-slate-700 focus-visible:opacity-100 group-hover/recent:opacity-100 dark:bg-white dark:text-ink-950 dark:ring-ink-950 dark:hover:bg-white/80"
              >
                <X size={13} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </section>
  );
}
