'use client';
import { Search, SlidersHorizontal } from 'lucide-react';

const SORTS = [
  { v: 'relevance', l: 'Relevance' },
  { v: 'price_asc', l: 'Price ↑' },
  { v: 'price_desc', l: 'Price ↓' },
  { v: 'discount', l: 'Discount' },
  { v: 'rating', l: 'Rating' },
];

export function Controls({
  q,
  sort,
  comparedOnly,
  onQ,
  onSort,
  onComparedOnly,
}: {
  q: string;
  sort: string;
  comparedOnly: boolean;
  onQ: (v: string) => void;
  onSort: (v: string) => void;
  onComparedOnly: (v: boolean) => void;
}) {
  return (
    <div className="sticky top-3 z-30 flex flex-col gap-3 rounded-2xl glass p-3 sm:flex-row sm:items-center">
      <div className="flex flex-1 items-center gap-2 rounded-xl bg-slate-100 dark:bg-white/[0.06] px-3">
        <Search size={16} className="text-slate-400 dark:text-white/40" />
        <input
          value={q}
          onChange={(e) => onQ(e.target.value)}
          placeholder="Search 2,000+ products — brand, category, colour…"
          className="w-full bg-transparent py-2.5 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-white/30 focus:outline-none"
        />
      </div>

      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1 rounded-xl bg-slate-100 dark:bg-white/[0.06] p-1">
          <SlidersHorizontal size={14} className="ml-1.5 text-slate-400 dark:text-white/40" />
          <select
            value={sort}
            onChange={(e) => onSort(e.target.value)}
            className="cursor-pointer bg-transparent py-1.5 pr-2 text-sm text-slate-700 dark:text-white/80 focus:outline-none [&>option]:bg-white dark:[&>option]:bg-ink-800"
          >
            {SORTS.map((s) => (
              <option key={s.v} value={s.v}>
                {s.l}
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={() => onComparedOnly(!comparedOnly)}
          className={`whitespace-nowrap rounded-xl px-3.5 py-2.5 text-sm font-medium transition ${
            comparedOnly
              ? 'bg-cliq text-slate-900 dark:text-white shadow-glow-cliq'
              : 'bg-slate-100 dark:bg-white/[0.06] text-slate-600 dark:text-white/70 hover:bg-slate-200 dark:hover:bg-white/[0.12]'
          }`}
        >
          Compared only
        </button>
      </div>
    </div>
  );
}
