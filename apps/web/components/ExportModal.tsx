'use client';
/**
 * Export dialog — filter, preview, then download as Excel or PDF.
 *
 * Two design rules:
 *
 *   1. No blind downloads. Every filter change re-asks the API how many
 *      products it selects and what they are worth, so the row count, the
 *      exposure and a sample are on screen BEFORE a file is built. Nobody
 *      should open a workbook to discover it was empty.
 *
 *   2. Filters are dropdowns, not chip rows. A chip per brand was fine at
 *      sixteen brands and unusable at two hundred; a menu stays one line high
 *      however long the list grows, and carries a search box of its own.
 *
 * Facet values come from the API, so only categories with saved comparisons
 * behind them are offered, each with its count.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, FileSpreadsheet, FileText, Download, Filter, RotateCcw, TrendingDown, Trophy,
  Loader2, ChevronDown, Check, Search,
} from 'lucide-react';
import type { ExportFacets, ExportFilters, ExportFormat, ExportPreview, Facet, Posture } from '@/lib/types';
import { api } from '@/lib/api';
import { inr } from '@/lib/format';

const EMPTY: ExportFilters = {
  q: '', categories: [], genders: [], brands: [],
  position: 'all', matched: 'all', freshOnly: false, minPrice: null, maxPrice: null,
};

/**
 * A multi-select dropdown. Closed it shows a summary ("3 selected"); open it
 * shows the options with counts, and a search box once the list is long enough
 * to be worth filtering.
 */
function MultiSelect({
  label, facets, selected, onChange, allLabel, searchable = false,
}: {
  label: string;
  facets: Facet[];
  selected: string[];
  onChange: (next: string[]) => void;
  allLabel: string;
  searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const shown = useMemo(
    () => (q ? facets.filter((f) => f.label.toLowerCase().includes(q.toLowerCase())) : facets),
    [facets, q],
  );

  const summary = selected.length === 0
    ? allLabel
    : selected.length === 1
      ? facets.find((f) => f.value === selected[0])?.label ?? selected[0]
      : `${selected.length} selected`;

  const toggle = (value: string) =>
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);

  return (
    <div ref={ref} className="relative">
      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">
        {label}
      </label>
      <button
        type="button"
        disabled={!facets.length}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-xs font-medium text-slate-700 transition hover:border-slate-300 disabled:opacity-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/80 dark:hover:border-white/20"
      >
        <span className={`truncate ${selected.length ? 'text-slate-900 dark:text-white' : 'text-slate-400 dark:text-white/40'}`}>
          {facets.length ? summary : 'None available'}
        </span>
        <ChevronDown size={13} className={`shrink-0 transition ${open ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-white/10 dark:bg-ink-900"
          >
            {searchable && facets.length > 8 ? (
              <div className="flex items-center gap-1.5 border-b border-slate-100 px-2.5 py-1.5 dark:border-white/10">
                <Search size={12} className="shrink-0 text-slate-400" />
                <input
                  autoFocus
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Filter…"
                  className="w-full bg-transparent py-0.5 text-xs text-slate-900 outline-none placeholder:text-slate-400 dark:text-white"
                />
              </div>
            ) : null}

            <div className="max-h-56 overflow-y-auto py-1">
              <button
                type="button"
                onClick={() => onChange([])}
                className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs text-slate-500 hover:bg-slate-50 dark:text-white/50 dark:hover:bg-white/[0.06]"
              >
                <span>{allLabel}</span>
                {selected.length === 0 ? <Check size={12} className="text-cliq" /> : null}
              </button>
              {shown.map((f) => {
                const on = selected.includes(f.value);
                return (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => toggle(f.value)}
                    className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs hover:bg-slate-50 dark:hover:bg-white/[0.06]"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded border ${
                          on ? 'border-cliq bg-cliq text-white' : 'border-slate-300 dark:border-white/20'
                        }`}
                      >
                        {on ? <Check size={9} /> : null}
                      </span>
                      <span className="truncate text-slate-700 dark:text-white/80">{f.label}</span>
                    </span>
                    <span className="shrink-0 text-[10px] tabular-nums text-slate-400 dark:text-white/35">{f.count}</span>
                  </button>
                );
              })}
              {!shown.length ? (
                <p className="px-3 py-2 text-xs text-slate-400">No match</p>
              ) : null}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/** Single-choice dropdown for the mutually exclusive filters. */
function Select({
  label, value, options, onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string; count?: number }[];
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">
        {label}
      </label>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full appearance-none rounded-xl border border-slate-200 bg-white px-3 py-2 pr-8 text-xs font-medium text-slate-900 outline-none transition hover:border-slate-300 dark:border-white/10 dark:bg-white/[0.04] dark:text-white dark:hover:border-white/20"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}{o.count != null ? `  (${o.count})` : ''}
            </option>
          ))}
        </select>
        <ChevronDown size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  const color = tone === 'bad'
    ? 'text-rose-600 dark:text-rose-300'
    : tone === 'good'
      ? 'text-emerald-600 dark:text-emerald-300'
      : 'text-slate-900 dark:text-white';
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-white/[0.04]">
      <div className={`font-display text-lg font-bold leading-tight ${color}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-white/40">{label}</div>
    </div>
  );
}

export function ExportModal({ onClose }: { onClose: () => void }) {
  const [facets, setFacets] = useState<ExportFacets | null>(null);
  const [filters, setFilters] = useState<ExportFilters>(EMPTY);
  const [format, setFormat] = useState<ExportFormat>('xlsx');
  const [preview, setPreview] = useState<ExportPreview | null>(null);
  const [previewing, setPreviewing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    api.exportFacets().then(setFacets).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Debounced because the price inputs and the search box fire per keystroke.
  useEffect(() => {
    setPreviewing(true);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      api.exportPreview(filters)
        .then((p) => { setPreview(p); setError(null); })
        .catch((e) => setError(e.message))
        .finally(() => setPreviewing(false));
    }, 200);
    return () => clearTimeout(debounce.current);
  }, [filters]);

  const set = useCallback(<K extends keyof ExportFilters>(key: K, value: ExportFilters[K]) => {
    setFilters((f) => ({ ...f, [key]: value }));
  }, []);

  const dirty = JSON.stringify(filters) !== JSON.stringify(EMPTY);
  const count = preview?.count ?? 0;
  const filename = format === 'pdf' ? preview?.pdfFilename : preview?.filename;

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
          className="relative flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-3xl glass shadow-glow sm:rounded-3xl"
          initial={{ y: 40, opacity: 0, scale: 0.98 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 40, opacity: 0 }}
          transition={{ type: 'spring', damping: 26, stiffness: 260 }}
          onClick={(e) => e.stopPropagation()}
        >
          <header className="flex items-start justify-between gap-4 border-b border-slate-200/70 px-5 py-4 dark:border-white/[0.08] sm:px-7">
            <div>
              <h2 className="flex items-center gap-2 font-display text-xl font-extrabold tracking-tight text-slate-900 dark:text-white">
                <Download size={19} className="text-cliq" /> Export comparisons
              </h2>
              <p className="mt-1 text-xs text-slate-500 dark:text-white/50">
                Business columns only — prices on all three platforms, who is cheapest and dearest, the
                gap, and the recommendation. Filter first; the file records what you picked.
              </p>
            </div>
            <button
              onClick={onClose}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-600 transition hover:bg-slate-200 hover:text-slate-900 dark:bg-white/[0.06] dark:text-white/70 dark:hover:bg-white/[0.12] dark:hover:text-white"
            >
              <X size={18} />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-7">
            {error ? (
              <p className="mb-4 rounded-xl bg-rose-500/10 px-3 py-2 text-sm text-rose-600 dark:text-rose-300">{error}</p>
            ) : null}

            {!facets ? (
              <div className="grid gap-3">
                {[0, 1, 2].map((i) => <div key={i} className="skeleton h-16 rounded-xl" />)}
              </div>
            ) : facets.total === 0 ? (
              <p className="py-8 text-center text-sm text-slate-500 dark:text-white/50">
                No comparisons saved yet — generate a few reports and they become exportable here.
              </p>
            ) : (
              <div className="grid gap-4">
                {/* Format */}
                <div>
                  <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">
                    Format
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      ['xlsx', FileSpreadsheet, 'Excel workbook', 'Sortable, filterable, pivot-ready'],
                      ['pdf', FileText, 'PDF report', 'Laid out to read or forward'],
                    ] as const).map(([value, Icon, title, sub]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setFormat(value)}
                        className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition ${
                          format === value
                            ? 'border-cliq bg-cliq/[0.06]'
                            : 'border-slate-200 hover:border-slate-300 dark:border-white/10 dark:hover:border-white/20'
                        }`}
                      >
                        <Icon size={16} className={format === value ? 'text-cliq' : 'text-slate-400'} />
                        <span className="min-w-0">
                          <span className="block text-xs font-semibold text-slate-900 dark:text-white">{title}</span>
                          <span className="block text-[10px] text-slate-500 dark:text-white/45">{sub}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Dropdown filters */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <MultiSelect
                    label="Category" facets={facets.categories} selected={filters.categories}
                    onChange={(v) => set('categories', v)} allLabel="All categories"
                  />
                  <MultiSelect
                    label="Gender" facets={facets.genders} selected={filters.genders}
                    onChange={(v) => set('genders', v)} allLabel="All genders"
                  />
                  <MultiSelect
                    label="Brand" facets={facets.brands} selected={filters.brands}
                    onChange={(v) => set('brands', v)} allLabel="All brands" searchable
                  />
                  <Select
                    label="Price position" value={filters.position}
                    onChange={(v) => set('position', v as Posture)}
                    options={[
                      { value: 'all', label: 'Any position', count: facets.total },
                      ...facets.positions.map((p) => ({ value: p.value, label: p.label, count: p.count })),
                    ]}
                  />
                  <Select
                    label="Match status" value={filters.matched}
                    onChange={(v) => set('matched', v as ExportFilters['matched'])}
                    options={[
                      { value: 'all', label: 'All products', count: facets.total },
                      { value: 'matched', label: 'With a competitor match', count: facets.matchedCount },
                      { value: 'unmatched', label: 'No match found', count: facets.total - facets.matchedCount },
                    ]}
                  />
                  <Select
                    label="Data freshness" value={filters.freshOnly ? 'fresh' : 'all'}
                    onChange={(v) => set('freshOnly', v === 'fresh')}
                    options={[
                      { value: 'all', label: 'Any age', count: facets.total },
                      { value: 'fresh', label: 'Still fresh only', count: facets.freshCount },
                    ]}
                  />
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">
                      Search
                    </label>
                    <input
                      value={filters.q}
                      onChange={(e) => set('q', e.target.value)}
                      placeholder="Brand or product name…"
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 outline-none placeholder:text-slate-400 dark:border-white/10 dark:bg-white/[0.04] dark:text-white dark:placeholder:text-white/30"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">
                      Tata CLIQ price range
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number" inputMode="numeric"
                        placeholder={facets.priceRange ? String(facets.priceRange.min) : 'min'}
                        value={filters.minPrice ?? ''}
                        onChange={(e) => set('minPrice', e.target.value === '' ? null : Number(e.target.value))}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 outline-none dark:border-white/10 dark:bg-white/[0.04] dark:text-white"
                      />
                      <span className="text-xs text-slate-400">to</span>
                      <input
                        type="number" inputMode="numeric"
                        placeholder={facets.priceRange ? String(facets.priceRange.max) : 'max'}
                        value={filters.maxPrice ?? ''}
                        onChange={(e) => set('maxPrice', e.target.value === '' ? null : Number(e.target.value))}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 outline-none dark:border-white/10 dark:bg-white/[0.04] dark:text-white"
                      />
                    </div>
                  </div>
                </div>

                {/* What the filter actually selects, before anything is built. */}
                <div className="rounded-2xl border border-slate-200/70 p-4 dark:border-white/[0.08]">
                  <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">
                    <Filter size={12} /> This export
                    {previewing ? <Loader2 size={12} className="animate-spin" /> : null}
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Stat label="Products" value={String(count)} />
                    <Stat label="With a match" value={String(preview?.matched ?? 0)} />
                    <Stat label="CLIQ cheapest" value={String(preview?.cliqCheapest ?? 0)} tone="good" />
                    <Stat label="Undercut" value={String(preview?.undercut ?? 0)} tone="bad" />
                  </div>
                  {preview && preview.undercut > 0 ? (
                    <p className="mt-3 flex items-center gap-1.5 text-xs text-rose-600 dark:text-rose-300">
                      <TrendingDown size={13} /> {inr(preview.totalGap)} of price exposure across{' '}
                      {preview.undercut} SKUs.
                    </p>
                  ) : preview && preview.cliqCheapest > 0 ? (
                    <p className="mt-3 flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-300">
                      <Trophy size={13} /> No competitor undercuts CLIQ in this selection.
                    </p>
                  ) : null}

                  {preview?.sample?.length ? (
                    <ul className="mt-3 space-y-1 border-t border-slate-200/70 pt-3 dark:border-white/[0.08]">
                      {preview.sample.map((s, i) => (
                        <li key={i} className="flex items-center justify-between gap-3 text-[11px] text-slate-500 dark:text-white/50">
                          <span className="truncate">
                            <span className="font-medium text-slate-700 dark:text-white/80">{s.brand}</span> · {s.title}
                          </span>
                          <span className="shrink-0 tabular-nums">
                            {s.cliqPrice != null ? inr(s.cliqPrice) : '—'}
                            {s.priceGap != null && s.priceGap > 0 ? (
                              <span className="ml-1.5 text-rose-500">+{inr(s.priceGap)}</span>
                            ) : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </div>
            )}
          </div>

          <footer className="flex items-center justify-between gap-3 border-t border-slate-200/70 px-5 py-4 dark:border-white/[0.08] sm:px-7">
            <div className="min-w-0">
              <button
                onClick={() => setFilters(EMPTY)}
                disabled={!dirty}
                className="flex items-center gap-1.5 text-xs font-medium text-slate-500 transition hover:text-slate-900 disabled:opacity-40 dark:text-white/50 dark:hover:text-white"
              >
                <RotateCcw size={12} /> Reset filters
              </button>
              {filename ? (
                <p className="mt-1 truncate text-[10px] text-slate-400 dark:text-white/30">{filename}</p>
              ) : null}
            </div>
            <a
              href={count ? api.exportUrl(filters, format) : undefined}
              onClick={(e) => { if (!count) e.preventDefault(); }}
              className={`flex shrink-0 items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition ${
                count
                  ? 'bg-cliq text-white hover:brightness-110'
                  : 'cursor-not-allowed bg-slate-200 text-slate-400 dark:bg-white/[0.06] dark:text-white/30'
              }`}
            >
              {format === 'pdf' ? <FileText size={15} /> : <FileSpreadsheet size={15} />}
              {count
                ? `Download ${count} ${count === 1 ? 'product' : 'products'}`
                : 'Nothing to export'}
            </a>
          </footer>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
