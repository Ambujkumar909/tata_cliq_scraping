'use client';
/**
 * Export dialog — filter on the left, a live read-out of the result on the
 * right, then download as Excel or PDF.
 *
 * Three ideas carry the design:
 *
 *   1. **The result is always visible.** The right panel is pinned and updates
 *      as you filter: the count, the competitive split as an animated meter,
 *      the exposure, a sample. Nobody should build a file to find out what is
 *      in it, so the answer sits beside the controls rather than below them.
 *
 *   2. **Dropdowns, not chip walls.** One menu component serves both the
 *      multi-selects (category, gender, brand) and the single-selects
 *      (position, match, freshness), so every control behaves identically —
 *      hover, keyboard dismiss, flip-up near the viewport edge.
 *
 *   3. **Motion earns its place.** Everything animated marks a state change
 *      you would otherwise have to look for: the segmented meter re-proportions,
 *      numbers roll, applied filters fly in and out, the primary button sweeps
 *      once when it becomes usable.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  X, FileSpreadsheet, FileText, Download, RotateCcw, Loader2, ChevronDown, Check,
  Search, SlidersHorizontal, TrendingDown, Trophy, Minus,
} from 'lucide-react';
import type { ExportFacets, ExportFilters, ExportFormat, ExportPreview, Facet, Posture } from '@/lib/types';
import { api } from '@/lib/api';
import { inr } from '@/lib/format';

const EMPTY: ExportFilters = {
  q: '', categories: [], genders: [], brands: [],
  position: 'all', matched: 'all', freshOnly: false, minPrice: null, maxPrice: null,
};

const SPRING = { type: 'spring' as const, stiffness: 380, damping: 32 };

/* ────────────────────────────────────────────────────────────── */

/**
 * A number that rolls to its new value instead of snapping.
 *
 * Deliberately state-based rather than a MotionValue rendered as a child: the
 * displayed figure is seeded with the real value, so if frames never come —
 * a backgrounded tab, a throttled renderer, reduced motion — the correct number
 * is on screen anyway. A count-up that can strand the UI reading "0" is worse
 * than no count-up at all.
 */
function Rolling({ value, format }: { value: number; format?: (n: number) => string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);

  useEffect(() => {
    const start = from.current;
    if (start === value) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      from.current = value;
      setShown(value);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const dur = 420;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / dur);
      const eased = 1 - (1 - p) ** 3;
      setShown(start + (value - start) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    // If frames never arrive the timeout still lands on the true value.
    const fallback = setTimeout(() => { from.current = value; setShown(value); }, dur + 120);
    return () => { cancelAnimationFrame(raf); clearTimeout(fallback); };
  }, [value]);

  return <span>{format ? format(shown) : String(Math.round(shown))}</span>;
}

/**
 * One dropdown for every filter. `multi` decides whether picking an option
 * toggles it or replaces the selection and closes.
 */
function Dropdown({
  label, options, selected, onChange, allLabel, multi = false, searchable = false, accent,
}: {
  label: string;
  options: Facet[];
  selected: string[];
  onChange: (next: string[]) => void;
  allLabel: string;
  multi?: boolean;
  searchable?: boolean;
  accent?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [flip, setFlip] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  // Open upward when there is not enough room below — otherwise the menu is
  // clipped by the dialog's own scroll container.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    setFlip(window.innerHeight - r.bottom < 260 && r.top > 280);
  }, [open]);

  const shown = useMemo(
    () => (q ? options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())) : options),
    [options, q],
  );

  const summary = selected.length === 0
    ? allLabel
    : selected.length === 1
      ? options.find((o) => o.value === selected[0])?.label ?? selected[0]
      : `${selected.length} selected`;

  const pick = (value: string) => {
    if (!multi) { onChange([value]); setOpen(false); return; }
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  };

  const active = selected.length > 0;

  return (
    <div ref={ref} className="relative">
      <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400 dark:text-white/35">
        {label}
      </span>
      <button
        ref={triggerRef}
        type="button"
        disabled={!options.length}
        onClick={() => setOpen((v) => !v)}
        className={`group relative flex w-full items-center justify-between gap-2 overflow-hidden rounded-xl border px-3 py-2.5 text-left text-xs font-medium transition-all duration-200 disabled:opacity-40
          ${active
            ? 'border-cliq/40 bg-cliq/[0.05] text-slate-900 shadow-[0_0_0_3px_rgba(225,29,72,0.06)] dark:text-white'
            : 'border-slate-200 bg-white text-slate-600 hover:-translate-y-px hover:border-slate-300 hover:shadow-sm dark:border-white/10 dark:bg-white/[0.03] dark:text-white/70 dark:hover:border-white/20 dark:hover:bg-white/[0.06]'}`}
      >
        {/* Accent rail — a quiet way to show a filter is doing something. */}
        <span
          className={`absolute inset-y-0 left-0 w-[2px] origin-top transition-transform duration-300 ${active ? 'scale-y-100' : 'scale-y-0'}`}
          style={{ background: accent ?? '#e11d48' }}
        />
        <span className={`truncate ${active ? '' : 'text-slate-400 dark:text-white/40'}`}>
          {options.length ? summary : 'None available'}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {multi && selected.length > 1 ? (
            <span className="rounded-full bg-cliq px-1.5 py-0.5 text-[9px] font-bold text-white">{selected.length}</span>
          ) : null}
          <ChevronDown
            size={13}
            className={`text-slate-400 transition-transform duration-300 group-hover:text-slate-600 dark:group-hover:text-white/70 ${open ? 'rotate-180' : ''}`}
          />
        </span>
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: flip ? 6 : -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: flip ? 6 : -6, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className={`absolute z-30 w-full min-w-[12rem] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl shadow-slate-900/[0.08] dark:border-white/10 dark:bg-ink-800 dark:shadow-black/40 ${
              flip ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
            }`}
          >
            {searchable && options.length > 8 ? (
              <div className="flex items-center gap-1.5 border-b border-slate-100 px-3 py-2 dark:border-white/10">
                <Search size={12} className="shrink-0 text-slate-400" />
                <input
                  autoFocus
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Type to filter…"
                  className="w-full bg-transparent text-xs text-slate-900 outline-none placeholder:text-slate-400 dark:text-white dark:placeholder:text-white/30"
                />
              </div>
            ) : null}

            <div className="max-h-56 overflow-y-auto py-1">
              <button
                type="button"
                onClick={() => { onChange([]); if (!multi) setOpen(false); }}
                className="group/i flex w-full items-center justify-between px-3 py-2 text-left text-xs text-slate-500 transition hover:bg-slate-50 dark:text-white/50 dark:hover:bg-white/[0.05]"
              >
                <span className="transition-transform duration-200 group-hover/i:translate-x-0.5">{allLabel}</span>
                {selected.length === 0 ? <Check size={12} className="text-cliq" /> : null}
              </button>

              {shown.map((o, i) => {
                const on = selected.includes(o.value);
                return (
                  <motion.button
                    key={o.value}
                    type="button"
                    initial={{ opacity: 0, x: -4 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: Math.min(i * 0.012, 0.12), duration: 0.14 }}
                    onClick={() => pick(o.value)}
                    className="group/i relative flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs transition hover:bg-slate-50 dark:hover:bg-white/[0.05]"
                  >
                    <span
                      className={`absolute inset-y-1 left-0 w-[2px] rounded-full bg-cliq transition-transform duration-200 ${on ? 'scale-y-100' : 'scale-y-0'}`}
                    />
                    <span className="flex min-w-0 items-center gap-2 transition-transform duration-200 group-hover/i:translate-x-0.5">
                      {multi ? (
                        <span
                          className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded-[4px] border transition-all duration-150 ${
                            on ? 'scale-100 border-cliq bg-cliq text-white' : 'border-slate-300 dark:border-white/20'
                          }`}
                        >
                          <AnimatePresence>
                            {on ? (
                              <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}>
                                <Check size={9} strokeWidth={3.5} />
                              </motion.span>
                            ) : null}
                          </AnimatePresence>
                        </span>
                      ) : null}
                      <span className="truncate text-slate-700 dark:text-white/80">{o.label}</span>
                    </span>
                    <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold tabular-nums text-slate-500 transition group-hover/i:bg-slate-200 dark:bg-white/[0.06] dark:text-white/40 dark:group-hover/i:bg-white/[0.12]">
                      {o.count}
                    </span>
                  </motion.button>
                );
              })}
              {!shown.length ? <p className="px-3 py-3 text-xs text-slate-400">Nothing matches</p> : null}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/** The competitive split, as one bar that re-proportions when filters change. */
function SplitMeter({ preview }: { preview: ExportPreview | null }) {
  const cheapest = preview?.cliqCheapest ?? 0;
  const undercut = preview?.undercut ?? 0;
  const matched = preview?.matched ?? 0;
  const total = preview?.count ?? 0;
  const parity = Math.max(0, matched - cheapest - undercut);
  const unmatched = Math.max(0, total - matched);

  const segments = [
    { key: 'win', n: cheapest, color: '#0f766e', label: 'CLIQ cheapest' },
    { key: 'par', n: parity, color: '#7c9cbb', label: 'Parity' },
    { key: 'cut', n: undercut, color: '#b3261e', label: 'Undercut' },
    { key: 'non', n: unmatched, color: '#cbd5e1', label: 'No match' },
  ].filter((s) => s.n > 0);

  return (
    <div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-white/[0.06]">
        {segments.map((s) => (
          <motion.div
            key={s.key}
            // `initial={false}` so the bar is drawn at its true proportions on
            // the first paint and animates only when a filter changes it.
            initial={false}
            animate={{ width: total ? `${(s.n / total) * 100}%` : '0%' }}
            transition={SPRING}
            style={{ background: s.color, width: total ? `${(s.n / total) * 100}%` : 0 }}
            className="h-full first:rounded-l-full last:rounded-r-full"
          />
        ))}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1">
        {segments.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5 text-[10px] text-slate-500 dark:text-white/45">
            <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
            {s.label}
            <span className="font-semibold tabular-nums text-slate-700 dark:text-white/70">{s.n}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────── */

export function ExportModal({ onClose }: { onClose: () => void }) {
  const [facets, setFacets] = useState<ExportFacets | null>(null);
  const [filters, setFilters] = useState<ExportFilters>(EMPTY);
  const [format, setFormat] = useState<ExportFormat>('xlsx');
  const [preview, setPreview] = useState<ExportPreview | null>(null);
  const [previewing, setPreviewing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => { api.exportFacets().then(setFacets).catch((e) => setError(e.message)); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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

  const count = preview?.count ?? 0;
  const dirty = JSON.stringify(filters) !== JSON.stringify(EMPTY);
  const filename = format === 'pdf' ? preview?.pdfFilename : preview?.filename;

  /** Every active filter as a removable pill, so nothing is applied invisibly. */
  const applied = useMemo(() => {
    const out: { key: string; text: string; clear: () => void }[] = [];
    const lbl = (list: Facet[], v: string) => list.find((f) => f.value === v)?.label ?? v;
    for (const v of filters.categories) {
      out.push({ key: `c-${v}`, text: lbl(facets?.categories ?? [], v), clear: () => set('categories', filters.categories.filter((x) => x !== v)) });
    }
    for (const v of filters.genders) {
      out.push({ key: `g-${v}`, text: lbl(facets?.genders ?? [], v), clear: () => set('genders', filters.genders.filter((x) => x !== v)) });
    }
    for (const v of filters.brands) {
      out.push({ key: `b-${v}`, text: v, clear: () => set('brands', filters.brands.filter((x) => x !== v)) });
    }
    if (filters.position !== 'all') {
      out.push({ key: 'pos', text: lbl(facets?.positions ?? [], filters.position), clear: () => set('position', 'all') });
    }
    if (filters.matched !== 'all') {
      out.push({ key: 'm', text: filters.matched === 'matched' ? 'Matched only' : 'Unmatched only', clear: () => set('matched', 'all') });
    }
    if (filters.freshOnly) out.push({ key: 'f', text: 'Fresh only', clear: () => set('freshOnly', false) });
    if (filters.q) out.push({ key: 'q', text: `“${filters.q}”`, clear: () => set('q', '') });
    if (filters.minPrice != null || filters.maxPrice != null) {
      out.push({
        key: 'p',
        text: `${filters.minPrice != null ? inr(filters.minPrice) : 'any'} – ${filters.maxPrice != null ? inr(filters.maxPrice) : 'any'}`,
        clear: () => setFilters((f) => ({ ...f, minPrice: null, maxPrice: null })),
      });
    }
    return out;
  }, [filters, facets, set]);

  const inputCls =
    'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-900 outline-none transition-all duration-200 placeholder:text-slate-400 hover:border-slate-300 focus:border-cliq/50 focus:shadow-[0_0_0_3px_rgba(225,29,72,0.08)] dark:border-white/10 dark:bg-white/[0.03] dark:text-white dark:placeholder:text-white/25 dark:hover:border-white/20';

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 backdrop-blur-md dark:bg-black/75 sm:items-center"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className="relative flex max-h-[94vh] w-full max-w-4xl flex-col overflow-hidden rounded-t-3xl border border-slate-200 bg-white shadow-glow dark:border-white/[0.08] dark:bg-ink-900 sm:rounded-3xl"
          initial={{ y: 32, opacity: 0, scale: 0.985 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 24, opacity: 0, scale: 0.99 }}
          transition={{ type: 'spring', damping: 30, stiffness: 300 }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <header className="relative shrink-0 px-5 pb-4 pt-5 sm:px-7">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="flex items-center gap-2 font-display text-xl font-extrabold tracking-tight text-slate-900 dark:text-white">
                  <span className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-cliq to-myntra text-white shadow-glow-cliq">
                    <Download size={15} />
                  </span>
                  Export comparisons
                </h2>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-500 dark:text-white/45">
                  Prices on all three platforms, who is cheapest and dearest, the gap, and the recommendation.
                </p>
              </div>
              <button
                onClick={onClose}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-500 transition-all duration-200 hover:rotate-90 hover:bg-slate-200 hover:text-slate-900 dark:bg-white/[0.06] dark:text-white/60 dark:hover:bg-white/[0.12] dark:hover:text-white"
              >
                <X size={17} />
              </button>
            </div>
            <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-cliq/40 to-transparent" />
          </header>

          <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[1.12fr_0.88fr]">
            {/* ── Filters ── */}
            <div className="min-h-0 overflow-y-auto px-5 py-5 sm:px-7">
              {error ? (
                <p className="mb-4 rounded-xl bg-rose-500/10 px-3 py-2 text-xs text-rose-600 dark:text-rose-300">{error}</p>
              ) : null}

              {!facets ? (
                <div className="grid gap-3">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-14 rounded-xl" />)}</div>
              ) : facets.total === 0 ? (
                <p className="py-10 text-center text-sm text-slate-500 dark:text-white/50">
                  No comparisons saved yet — generate a few reports and they become exportable here.
                </p>
              ) : (
                <div className="grid gap-4">
                  {/* Format — segmented, with a sliding indicator */}
                  <div>
                    <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400 dark:text-white/35">
                      Format
                    </span>
                    <div className="relative grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-white/[0.05]">
                      {([
                        ['xlsx', FileSpreadsheet, 'Excel', 'pivot & sort'],
                        ['pdf', FileText, 'PDF', 'read & share'],
                      ] as const).map(([value, Icon, title, sub]) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setFormat(value)}
                          className="relative z-10 flex items-center justify-center gap-2 rounded-lg px-3 py-2 transition-colors duration-200"
                        >
                          {format === value ? (
                            <motion.span
                              layoutId="fmt-pill"
                              transition={SPRING}
                              className="absolute inset-0 -z-10 rounded-lg bg-white shadow-sm dark:bg-white/[0.10]"
                            />
                          ) : null}
                          <Icon size={14} className={format === value ? 'text-cliq' : 'text-slate-400 dark:text-white/40'} />
                          <span className={`text-xs font-semibold ${format === value ? 'text-slate-900 dark:text-white' : 'text-slate-500 dark:text-white/50'}`}>
                            {title}
                          </span>
                          <span className="hidden text-[10px] text-slate-400 dark:text-white/30 sm:inline">{sub}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <Dropdown
                      label="Category" options={facets.categories} selected={filters.categories}
                      onChange={(v) => set('categories', v)} allLabel="All categories" multi searchable
                    />
                    <Dropdown
                      label="Gender" options={facets.genders} selected={filters.genders}
                      onChange={(v) => set('genders', v)} allLabel="All genders" multi
                    />
                    <Dropdown
                      label="Brand" options={facets.brands} selected={filters.brands}
                      onChange={(v) => set('brands', v)} allLabel="All brands" multi searchable
                    />
                    <Dropdown
                      label="Price position"
                      options={facets.positions}
                      selected={filters.position === 'all' ? [] : [filters.position]}
                      onChange={(v) => set('position', (v[0] as Posture) ?? 'all')}
                      allLabel="Any position"
                      accent="#b3261e"
                    />
                    <Dropdown
                      label="Match status"
                      options={[
                        { value: 'matched', label: 'With a competitor match', count: facets.matchedCount },
                        { value: 'unmatched', label: 'No match found', count: facets.total - facets.matchedCount },
                      ]}
                      selected={filters.matched === 'all' ? [] : [filters.matched]}
                      onChange={(v) => set('matched', (v[0] as ExportFilters['matched']) ?? 'all')}
                      allLabel="All products"
                    />
                    <Dropdown
                      label="Freshness"
                      options={[{ value: 'fresh', label: 'Still fresh only', count: facets.freshCount }]}
                      selected={filters.freshOnly ? ['fresh'] : []}
                      onChange={(v) => set('freshOnly', v.length > 0)}
                      allLabel="Any age"
                      accent="#0f766e"
                    />
                  </div>

                  <div>
                    <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400 dark:text-white/35">
                      Search
                    </span>
                    <div className="relative">
                      <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        value={filters.q}
                        onChange={(e) => set('q', e.target.value)}
                        placeholder="Brand or product name…"
                        className={`${inputCls} pl-8`}
                      />
                    </div>
                  </div>

                  <div>
                    <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400 dark:text-white/35">
                      Tata CLIQ price
                    </span>
                    <div className="flex items-center gap-2">
                      <input
                        type="number" inputMode="numeric"
                        placeholder={facets.priceRange ? String(facets.priceRange.min) : 'min'}
                        value={filters.minPrice ?? ''}
                        onChange={(e) => set('minPrice', e.target.value === '' ? null : Number(e.target.value))}
                        className={inputCls}
                      />
                      <Minus size={12} className="shrink-0 text-slate-300 dark:text-white/20" />
                      <input
                        type="number" inputMode="numeric"
                        placeholder={facets.priceRange ? String(facets.priceRange.max) : 'max'}
                        value={filters.maxPrice ?? ''}
                        onChange={(e) => set('maxPrice', e.target.value === '' ? null : Number(e.target.value))}
                        className={inputCls}
                      />
                    </div>
                  </div>

                  {/* Applied filters */}
                  <AnimatePresence>
                    {applied.length ? (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3 dark:border-white/[0.07]">
                          <SlidersHorizontal size={11} className="text-slate-400" />
                          <AnimatePresence mode="popLayout">
                            {applied.map((a) => (
                              <motion.button
                                key={a.key}
                                layout
                                initial={{ opacity: 0, scale: 0.85 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.85 }}
                                transition={SPRING}
                                onClick={a.clear}
                                className="group/p flex items-center gap-1 rounded-full border border-cliq/25 bg-cliq/[0.07] py-1 pl-2.5 pr-1.5 text-[10px] font-medium text-cliq transition hover:bg-cliq hover:text-white"
                              >
                                {a.text}
                                <X size={9} className="opacity-50 transition group-hover/p:opacity-100" />
                              </motion.button>
                            ))}
                          </AnimatePresence>
                          <button
                            onClick={() => setFilters(EMPTY)}
                            className="group/r ml-auto flex items-center gap-1 text-[10px] font-medium text-slate-400 transition hover:text-slate-700 dark:hover:text-white"
                          >
                            <RotateCcw size={10} className="transition-transform duration-300 group-hover/r:-rotate-180" />
                            Reset
                          </button>
                        </div>
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </div>
              )}
            </div>

            {/* ── Live result ── */}
            <aside className="relative min-h-0 overflow-y-auto border-t border-slate-100 bg-slate-50/70 px-5 py-5 dark:border-white/[0.07] dark:bg-white/[0.02] sm:px-6 md:border-l md:border-t-0">
              <div className="pointer-events-none absolute inset-0 bg-mesh opacity-60" />
              <div className="relative">
                <div className="flex items-baseline justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400 dark:text-white/35">
                    This export
                  </span>
                  {previewing ? <Loader2 size={12} className="animate-spin text-cliq" /> : null}
                </div>

                <div className="mt-2 flex items-end gap-2">
                  <span className="font-display text-5xl font-extrabold leading-none tracking-tight text-slate-900 dark:text-white">
                    <Rolling value={count} />
                  </span>
                  <span className="pb-1 text-xs text-slate-400 dark:text-white/40">
                    {count === 1 ? 'product' : 'products'}
                  </span>
                </div>

                <div className="mt-4">
                  <SplitMeter preview={preview} />
                </div>

                <AnimatePresence mode="popLayout">
                  {preview && preview.undercut > 0 ? (
                    <motion.div
                      key="exposure"
                      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                      className="mt-4 rounded-xl border border-rose-200/70 bg-rose-50 p-3 dark:border-rose-500/20 dark:bg-rose-500/[0.07]"
                    >
                      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-rose-600 dark:text-rose-300">
                        <TrendingDown size={11} /> Price exposure
                      </div>
                      <div className="mt-1 font-display text-xl font-bold text-rose-700 dark:text-rose-200">
                        <Rolling value={preview.totalGap} format={(n) => inr(n)} />
                      </div>
                      <p className="mt-0.5 text-[10px] text-rose-600/80 dark:text-rose-300/70">
                        across {preview.undercut} undercut {preview.undercut === 1 ? 'product' : 'products'}
                      </p>
                    </motion.div>
                  ) : preview && preview.cliqCheapest > 0 ? (
                    <motion.div
                      key="win"
                      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                      className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-200/70 bg-emerald-50 p-3 text-xs text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/[0.07] dark:text-emerald-300"
                    >
                      <Trophy size={13} /> No competitor undercuts CLIQ here.
                    </motion.div>
                  ) : null}
                </AnimatePresence>

                {preview?.sample?.length ? (
                  <div className="mt-4">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400 dark:text-white/35">
                      Sample
                    </span>
                    <ul className="mt-1.5 space-y-0.5">
                      {preview.sample.map((s, i) => (
                        <motion.li
                          key={`${s.brand}-${i}`}
                          initial={{ opacity: 0, x: -6 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.03, duration: 0.18 }}
                          className="group/s flex cursor-default items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-[11px] transition hover:bg-white dark:hover:bg-white/[0.05]"
                        >
                          <span className="min-w-0 truncate text-slate-600 transition-transform duration-200 group-hover/s:translate-x-0.5 dark:text-white/60">
                            <span className="font-semibold text-slate-800 dark:text-white/85">{s.brand}</span>{' '}
                            {s.title}
                          </span>
                          <span className="shrink-0 tabular-nums text-slate-500 dark:text-white/50">
                            {s.cliqPrice != null ? inr(s.cliqPrice) : '—'}
                            {s.priceGap != null && s.priceGap > 0 ? (
                              <span className="ml-1 font-semibold text-rose-500">+{inr(s.priceGap)}</span>
                            ) : null}
                          </span>
                        </motion.li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </aside>
          </div>

          {/* Footer */}
          <footer className="flex shrink-0 items-center justify-between gap-4 border-t border-slate-100 px-5 py-4 dark:border-white/[0.07] sm:px-7">
            <div className="min-w-0">
              <p className="truncate text-[11px] font-medium text-slate-600 dark:text-white/55">
                {format === 'pdf' ? 'PDF report' : 'Excel workbook'}
              </p>
              {/* No mode="wait" here: a decorative crossfade must never be able
                  to hold a stale filename beside the chosen format. */}
              <motion.p
                key={filename}
                initial={{ opacity: 0.4 }} animate={{ opacity: 1 }}
                className="truncate font-mono text-[10px] text-slate-400 dark:text-white/30"
              >
                {filename ?? '—'}
              </motion.p>
            </div>

            <a
              href={count ? api.exportUrl(filters, format) : undefined}
              onClick={(e) => { if (!count) e.preventDefault(); }}
              className={`group/d relative flex shrink-0 items-center gap-2 overflow-hidden rounded-full px-6 py-3 text-sm font-semibold transition-all duration-200 ${
                count
                  ? 'bg-gradient-to-r from-cliq to-myntra text-white shadow-glow-cliq hover:-translate-y-0.5 hover:shadow-[0_14px_44px_-10px_rgba(225,29,72,0.6)] active:translate-y-0'
                  : 'cursor-not-allowed bg-slate-100 text-slate-400 dark:bg-white/[0.05] dark:text-white/25'
              }`}
            >
              {count ? (
                <span className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 bg-white/25 opacity-0 group-hover/d:animate-sheen group-hover/d:opacity-100" />
              ) : null}
              {format === 'pdf' ? <FileText size={15} /> : <FileSpreadsheet size={15} />}
              {count ? `Download ${count}` : 'Nothing to export'}
            </a>
          </footer>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
