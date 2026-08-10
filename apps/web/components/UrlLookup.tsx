'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Link2, ArrowRight, Loader2, AlertCircle, Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import { img } from '@/lib/format';
import type { ProductListItem } from '@/lib/types';

/**
 * Paste any Tata CLIQ product link and jump straight to its comparison report.
 *
 * Works for products outside the ingested catalog too — those are fetched from
 * their PDP on demand, so the corpus is a starting point rather than a limit.
 */
export function UrlLookup() {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<{ product: ProductListItem; inCatalog: boolean } | null>(null);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const url = value.trim();
    if (!url || busy) return;
    setBusy(true);
    setError(null);
    setFound(null);
    try {
      const res = await api.resolve(url);
      setFound({ product: res.product, inCatalog: res.inCatalog });
      router.push(`/report/${res.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resolve that link.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-8">
      <form onSubmit={submit} className="rounded-2xl glass p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex flex-1 items-center gap-2 rounded-xl bg-slate-100 dark:bg-white/[0.06] px-3">
            <Link2 size={16} className="shrink-0 text-cliq" />
            <input
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                if (error) setError(null);
              }}
              placeholder="Paste a Tata CLIQ product link — e.g. tatacliq.com/…/p-mp000000024358256"
              spellCheck={false}
              aria-label="Tata CLIQ product link"
              className="w-full bg-transparent py-2.5 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-white/30 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={busy || !value.trim()}
            className="flex items-center justify-center gap-1.5 whitespace-nowrap rounded-xl bg-cliq px-5 py-2.5 text-sm font-semibold text-slate-900 dark:text-white shadow-glow-cliq transition hover:brightness-110 disabled:opacity-40 disabled:shadow-none"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {busy ? 'Resolving…' : 'Compare this product'}
          </button>
        </div>

        <AnimatePresence>
          {error ? (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="flex items-start gap-2 px-1 pt-2.5 text-xs text-rose-600 dark:text-rose-300"
            >
              <AlertCircle size={13} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </motion.div>
          ) : null}

          {found ? (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-2.5 flex items-center gap-3 rounded-xl bg-white dark:bg-white/[0.04] px-3 py-2"
            >
              {found.product.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={img(found.product.image)} alt="" className="h-10 w-8 rounded object-cover" />
              ) : null}
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs text-slate-700 dark:text-white/80">
                  <span className="text-slate-400 dark:text-white/40">{found.product.brand}</span> · {found.product.title}
                </div>
                <div className="text-[11px] text-slate-400 dark:text-white/40">
                  {found.inCatalog ? 'In catalog' : 'Fetched live from Tata CLIQ'} — opening report…
                </div>
              </div>
              <ArrowRight size={14} className="shrink-0 text-slate-400 dark:text-white/40" />
            </motion.div>
          ) : null}
        </AnimatePresence>
      </form>

      <p className="mt-2.5 text-center text-[11px] text-slate-400 dark:text-white/40">
        Works for any CLIQ product — even one outside the catalog.
      </p>
    </section>
  );
}
