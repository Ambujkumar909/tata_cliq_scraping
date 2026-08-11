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
 *   2. **Filters follow the storefront order.** Category, then Brand, Gender and
 *      Size, then Price and the competitive cut — the order Myntra and Amazon
 *      put in the left rail, and the order a category manager narrows in: what
 *      the product is, who made it, who it is for, what size, and only then the
 *      commercial slice. Each
 *      group is a collapsible row that states its own selection, one open at a
 *      time, so the panel stays one screen tall whatever the catalog holds; the
 *      chip row above restates the whole selection while they are shut. A group
 *      opens on hover and pins on click.
 *
 *   3. **Motion earns its place.** Everything animated marks a state change you
 *      would otherwise have to look for: the segmented meter re-proportions, the
 *      count rolls, the plus spins into a minus as its group opens, the primary
 *      button sweeps once when it becomes usable.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  X, FileSpreadsheet, FileText, Download, RotateCcw, Loader2, Check,
  Search, TrendingDown, Trophy,
} from 'lucide-react';
import type { ExportFacets, ExportFilters, ExportFormat, ExportPreview, Facet, Posture } from '@/lib/types';
import { api } from '@/lib/api';
import { inr } from '@/lib/format';

const EMPTY: ExportFilters = {
  q: '', categories: [], genders: [], sizes: [], brands: [],
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
 * One collapsible filter group — the storefront pattern (Myntra, Amazon), which
 * is what a merchandiser already has muscle memory for: a stack of named groups
 * in a fixed order, each stating its own selection, only one open at a time.
 *
 * The row is a button plus a sibling clear control rather than nested buttons:
 * a button inside a button is invalid HTML and Safari drops the inner click.
 *
 * It opens on hover as well as on click. Hover is the fast path — sweeping the
 * rail reveals each group with no clicking at all — and click is what makes an
 * open group *stay* open, so the two do not fight: a group you pointed at
 * closes when you leave it, a group you clicked is pinned until you click
 * again. Both timers are short but non-zero, so a cursor crossing the rail on
 * its way somewhere else never flickers three groups open behind it. Touch and
 * keyboard never see any of it: pointers that cannot hover fall back to click.
 */
function Section({
  label, hint, selectedCount, summary, open, onToggle, onHoverOpen, onHoverLeave,
  onClear, disabled = false, children,
}: {
  label: string;
  hint?: string;
  selectedCount: number;
  summary: string;
  open: boolean;
  onToggle: () => void;
  onHoverOpen: () => void;
  onHoverLeave: () => void;
  onClear: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const active = selectedCount > 0;
  const enterTimer = useRef<ReturnType<typeof setTimeout>>();
  const leaveTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => { clearTimeout(enterTimer.current); clearTimeout(leaveTimer.current); }, []);

  const canHover = () => window.matchMedia?.('(hover: hover) and (pointer: fine)').matches ?? false;

  const handleEnter = () => {
    if (disabled || !canHover()) return;
    clearTimeout(leaveTimer.current);
    if (!open) enterTimer.current = setTimeout(onHoverOpen, 110);
  };
  const handleLeave = () => {
    if (disabled || !canHover()) return;
    clearTimeout(enterTimer.current);
    leaveTimer.current = setTimeout(onHoverLeave, 260);
  };

  return (
    <div
      className="border-b border-slate-100 last:border-0 dark:border-white/[0.06]"
      // The whole group, header and body, is the hover target — otherwise the
      // panel would shut the moment the cursor reached the options in it.
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={disabled}
          aria-expanded={open}
          onClick={onToggle}
          className="group flex min-w-0 flex-1 items-center gap-3 py-3 text-left disabled:opacity-40"
        >
          {/* A hairline that grows into a full bar once the group is set — the
              only always-on marker of "this filter is doing something". */}
          <span
            className={`h-7 w-[3px] shrink-0 rounded-full bg-gradient-to-b from-cliq to-myntra transition-all duration-300 ${
              active ? 'opacity-100' : 'scale-y-0 opacity-0'
            }`}
          />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-600 transition-colors group-hover:text-slate-900 dark:text-white/55 dark:group-hover:text-white">
                {label}
              </span>
              <AnimatePresence>
                {active ? (
                  <motion.span
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.6, opacity: 0 }}
                    transition={SPRING}
                    className="rounded-full bg-cliq px-1.5 py-px text-[9px] font-bold leading-4 text-white"
                  >
                    {selectedCount}
                  </motion.span>
                ) : null}
              </AnimatePresence>
            </span>
            <span
              className={`mt-0.5 block truncate text-[11px] ${
                active ? 'font-medium text-slate-700 dark:text-white/70' : 'text-slate-400 dark:text-white/30'
              }`}
            >
              {active ? summary : hint ?? 'Any'}
            </span>
          </span>
          {/* The plus, drawn rather than imported: two hairlines that spin
              into a minus when the group opens. An icon swap would pop; two
              rules that rotate through 180° read as one continuous gesture,
              and at 1px they stay a mark rather than a button. */}
          <span
            className={`relative grid h-4 w-4 shrink-0 place-items-center transition-colors duration-200 ${
              open ? 'text-cliq' : 'text-slate-400 group-hover:text-cliq dark:text-white/35'
            }`}
          >
            <span
              className={`absolute h-px w-3 rounded-full bg-current transition-transform duration-[350ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
                open ? 'rotate-180' : 'rotate-0'
              }`}
            />
            <span
              className={`absolute h-px w-3 rounded-full bg-current transition-transform duration-[350ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
                open ? 'rotate-180' : 'rotate-90'
              }`}
            />
          </span>
        </button>
        {active ? (
          <button
            type="button"
            onClick={onClear}
            aria-label={`Clear ${label}`}
            className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-slate-300 transition hover:bg-slate-100 hover:text-slate-700 dark:text-white/25 dark:hover:bg-white/10 dark:hover:text-white"
          >
            <X size={11} strokeWidth={3} />
          </button>
        ) : null}
      </div>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="pb-4 pl-[15px]">{children}</div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/** A long list — brands, categories — with a search box once it earns one. */
function OptionList({
  label, options, selected, onChange, searchable = false,
}: {
  label: string;
  options: Facet[];
  selected: string[];
  onChange: (next: string[]) => void;
  searchable?: boolean;
}) {
  const [q, setQ] = useState('');
  const shown = useMemo(
    () => (q ? options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())) : options),
    [options, q],
  );
  const toggle = (v: string) =>
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);

  return (
    <div>
      {searchable && options.length > 8 ? (
        <div className="mb-1.5 flex items-center gap-2 rounded-lg bg-slate-100/80 px-2.5 py-1.5 transition focus-within:bg-slate-100 dark:bg-white/[0.05] dark:focus-within:bg-white/[0.08]">
          <Search size={12} className="shrink-0 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search ${label.toLowerCase()}…`}
            className="w-full bg-transparent text-xs text-slate-900 outline-none placeholder:text-slate-400 dark:text-white dark:placeholder:text-white/30"
          />
        </div>
      ) : null}

      <div className="max-h-52 space-y-px overflow-y-auto pr-1">
        {shown.map((o) => {
          const on = selected.includes(o.value);
          // Zero under the current filter: shown, but not selectable. Removing
          // it would make the list jump as you filter; leaving it live would
          // offer a tick that empties the export.
          const dead = o.count === 0 && !on;
          return (
            <button
              key={o.value}
              type="button"
              disabled={dead}
              title={dead ? 'Nothing left under the other filters' : undefined}
              onClick={() => toggle(o.value)}
              className={`group/i flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-xs transition ${
                dead ? 'opacity-35' : on ? 'bg-cliq/[0.07] dark:bg-cliq/[0.14]' : 'hover:bg-slate-50 dark:hover:bg-white/[0.05]'
              }`}
            >
              <span
                className={`grid h-[15px] w-[15px] shrink-0 place-items-center rounded-[5px] border transition-[border-color,color] duration-150 ${
                  on ? 'border-transparent text-white' : 'border-slate-300 text-transparent dark:border-white/25'
                }`}
                style={on ? { background: '#e11d48' } : undefined}
              >
                <Check size={9} strokeWidth={3.5} />
              </span>
              <span
                className={`min-w-0 flex-1 truncate transition-transform duration-200 group-hover/i:translate-x-0.5 ${
                  on ? 'font-semibold text-slate-900 dark:text-white' : 'text-slate-600 dark:text-white/70'
                }`}
              >
                {o.label}
              </span>
              <span className="shrink-0 text-[10px] font-semibold tabular-nums text-slate-400 dark:text-white/35">
                {o.count}
              </span>
            </button>
          );
        })}
        {!shown.length ? <p className="px-2 py-3 text-xs text-slate-400">Nothing matches</p> : null}
      </div>
    </div>
  );
}

/** Short vocabularies — gender, competitive position — as pills. */
function ChipGroup({
  options, selected, onChange, single = false,
}: {
  options: Facet[];
  selected: string[];
  onChange: (next: string[]) => void;
  single?: boolean;
}) {
  const pick = (v: string) => {
    if (single) { onChange(selected.includes(v) ? [] : [v]); return; }
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = selected.includes(o.value);
        const dead = o.count === 0 && !on;
        return (
          <button
            key={o.value}
            type="button"
            disabled={dead}
            title={dead ? 'Nothing left under the other filters' : undefined}
            onClick={() => pick(o.value)}
            className={`relative flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium transition-all duration-200 active:scale-[0.97] ${
              dead
                ? 'border-slate-200 text-slate-400 opacity-40 dark:border-white/10 dark:text-white/30'
                : on
                ? 'border-cliq bg-cliq text-white shadow-glow-cliq'
                : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-white/12 dark:text-white/65 dark:hover:border-white/25 dark:hover:bg-white/[0.06]'
            }`}
          >
            {o.label}
            <span className={`text-[9px] font-bold tabular-nums ${on ? 'text-white/70' : 'text-slate-400 dark:text-white/30'}`}>
              {o.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Sizes as swatch tiles, in size order — the shape every storefront uses. */
function SizeGrid({
  options, selected, onChange,
}: {
  options: Facet[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const toggle = (v: string) =>
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = selected.includes(o.value);
        const dead = o.count === 0 && !on;
        return (
          <button
            key={o.value}
            type="button"
            disabled={dead}
            onClick={() => toggle(o.value)}
            title={dead ? 'Nothing left under the other filters' : `${o.count} product${o.count === 1 ? '' : 's'}`}
            className={`grid h-9 min-w-[2.5rem] place-items-center rounded-lg border px-2 text-[11px] font-semibold uppercase tracking-wide transition-all duration-200 active:scale-95 ${
              dead
                ? 'border-slate-200 text-slate-400 line-through opacity-40 dark:border-white/10 dark:text-white/30'
                : on
                ? 'border-cliq bg-cliq text-white shadow-glow-cliq'
                : 'border-slate-200 text-slate-600 hover:-translate-y-0.5 hover:border-cliq/50 hover:text-slate-900 dark:border-white/12 dark:text-white/65 dark:hover:border-cliq/60 dark:hover:text-white'
            }`}
          >
            {o.label}
          </button>
        );
      })}
      {!options.length ? (
        <p className="text-[11px] text-slate-400 dark:text-white/35">
          No sizes yet — they come from the matched Myntra and Ajio listings.
        </p>
      ) : null}
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /**
   * Preview and facet counts move together, on one debounce.
   *
   * Two requests rather than one because they answer different questions — how
   * many rows this filter selects, and how many each *other* value would select
   * — but they must land together: a count that lags the number beside it by a
   * round trip is read as a contradiction, not as a stale render.
   *
   * `facets` is only replaced on success, so a failed refresh leaves the last
   * good vocabulary on screen instead of emptying the panel under the cursor.
   */
  useEffect(() => {
    setPreviewing(true);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      Promise.all([api.exportPreview(filters), api.exportFacets(filters)])
        .then(([p, f]) => { setPreview(p); setFacets(f); setError(null); })
        .catch((e) => setError(e.message))
        .finally(() => setPreviewing(false));
    }, 200);
    return () => clearTimeout(debounce.current);
  }, [filters]);

  const set = useCallback(<K extends keyof ExportFilters>(key: K, value: ExportFilters[K]) => {
    setFilters((f) => ({ ...f, [key]: value }));
  }, []);

  const count = preview?.count ?? 0;
  const filename = format === 'pdf' ? preview?.pdfFilename : preview?.filename;

  /**
   * One group open at a time. Category leads — it is the widest cut and the one
   * a merchandiser reaches for first — and an accordion keeps the panel one
   * screen tall however many brands are in the catalog.
   *
   * `pinned` is the group the user *clicked*: hovering another group reveals it
   * and leaving shuts it again, but a pinned group stays put until it is
   * clicked shut. Without the distinction, either hover would be useless (it
   * never closes) or clicking would be (the panel vanishes as you reach for
   * the checkbox you came to tick).
   */
  const [openSection, setOpenSection] = useState<string | null>('category');
  const [pinnedSection, setPinnedSection] = useState<string | null>('category');

  const toggleSection = (id: string) => {
    const closing = openSection === id;
    setOpenSection(closing ? null : id);
    setPinnedSection(closing ? null : id);
  };
  // Hovering a different group drops the pin: a pin means "keep THIS one open",
  // and it would otherwise outlive the group it belongs to, so a group the user
  // merely pointed at once would start sticking open later.
  const hoverOpen = (id: string) => {
    setOpenSection(id);
    setPinnedSection((cur) => (cur === id ? cur : null));
  };
  const hoverLeave = (id: string) =>
    setOpenSection((cur) => (cur === id && pinnedSection !== id ? null : cur));

  const labelOf = (list: Facet[] | undefined, v: string) =>
    list?.find((o) => o.value === v)?.label ?? v;
  const names = (list: Facet[] | undefined, values: string[]) =>
    values.map((v) => labelOf(list, v)).join(', ');

  const priceLabel =
    filters.minPrice != null || filters.maxPrice != null
      ? `₹${filters.minPrice ?? 0} – ${filters.maxPrice != null ? `₹${filters.maxPrice}` : 'any'}`
      : '';

  /** Everything currently applied, as one removable row. */
  const chips = useMemo(() => {
    const out: { key: string; label: string; remove: () => void }[] = [];
    const drop = (k: 'brands' | 'genders' | 'sizes' | 'categories', v: string) =>
      setFilters((f) => ({ ...f, [k]: f[k].filter((x) => x !== v) }));

    for (const v of filters.brands) out.push({ key: `brand:${v}`, label: v, remove: () => drop('brands', v) });
    for (const v of filters.genders) {
      out.push({ key: `gender:${v}`, label: labelOf(facets?.genders, v), remove: () => drop('genders', v) });
    }
    for (const v of filters.sizes) out.push({ key: `size:${v}`, label: `Size ${v}`, remove: () => drop('sizes', v) });
    for (const v of filters.categories) {
      out.push({ key: `cat:${v}`, label: labelOf(facets?.categories, v), remove: () => drop('categories', v) });
    }
    if (priceLabel) {
      out.push({
        key: 'price',
        label: priceLabel,
        remove: () => setFilters((f) => ({ ...f, minPrice: null, maxPrice: null })),
      });
    }
    if (filters.position !== 'all') {
      out.push({
        key: 'pos',
        label: labelOf(facets?.positions, filters.position),
        remove: () => setFilters((f) => ({ ...f, position: 'all' })),
      });
    }
    if (filters.q) out.push({ key: 'q', label: `“${filters.q}”`, remove: () => setFilters((f) => ({ ...f, q: '' })) });
    return out;
  }, [facets, filters, priceLabel]);



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
              ) : facets.savedTotal === 0 ? (
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

                  {/* Free-text search sits above the groups, not inside one:
                      it cuts across every facet rather than narrowing one. */}
                  <label className="group block">
                    <span className="flex items-center gap-2 rounded-xl bg-slate-100/80 px-3 py-2.5 transition-colors duration-200 focus-within:bg-white focus-within:ring-2 focus-within:ring-cliq/30 dark:bg-white/[0.05] dark:focus-within:bg-white/[0.08]">
                      <Search size={14} className="shrink-0 text-slate-400 transition group-focus-within:text-cliq" />
                      <input
                        value={filters.q}
                        onChange={(e) => set('q', e.target.value)}
                        placeholder="Search brand or product name…"
                        className="w-full bg-transparent text-xs text-slate-900 outline-none placeholder:text-slate-400 dark:text-white dark:placeholder:text-white/30"
                      />
                      {filters.q ? (
                        <button
                          type="button"
                          onClick={() => set('q', '')}
                          aria-label="Clear search"
                          className="grid h-4 w-4 shrink-0 place-items-center rounded-full text-slate-400 transition hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-white/10 dark:hover:text-white"
                        >
                          <X size={10} strokeWidth={3} />
                        </button>
                      ) : null}
                    </span>
                  </label>

                  {/* Applied filters, as one removable row. With the groups
                      collapsed this is the only place the full selection is
                      visible, so it earns the repetition an always-open bar
                      would not. */}
                  <AnimatePresence initial={false}>
                    {chips.length ? (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                        className="overflow-hidden"
                      >
                        <div className="flex flex-wrap items-center gap-1.5">
                          <AnimatePresence initial={false} mode="popLayout">
                            {chips.map((c) => (
                              <motion.button
                                key={c.key}
                                layout
                                type="button"
                                initial={{ opacity: 0, scale: 0.85 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.85 }}
                                transition={SPRING}
                                onClick={c.remove}
                                className="group/c flex items-center gap-1 rounded-full border border-cliq/25 bg-cliq/[0.08] py-1 pl-2.5 pr-1.5 text-[11px] font-medium text-cliq transition hover:border-cliq/50 hover:bg-cliq/[0.14] dark:border-cliq/30 dark:text-rose-300"
                              >
                                <span className="max-w-[10rem] truncate">{c.label}</span>
                                <X size={10} strokeWidth={3} className="opacity-50 transition group-hover/c:rotate-90 group-hover/c:opacity-100" />
                              </motion.button>
                            ))}
                          </AnimatePresence>
                          <button
                            type="button"
                            onClick={() => setFilters(EMPTY)}
                            className="group/r ml-auto flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-medium text-slate-400 transition hover:text-slate-800 dark:text-white/35 dark:hover:text-white"
                          >
                            <RotateCcw size={11} className="transition-transform duration-500 group-hover/r:-rotate-[360deg]" />
                            Clear all
                          </button>
                        </div>
                      </motion.div>
                    ) : null}
                  </AnimatePresence>

                  {/* The groups, in storefront order — Brand, Gender, Size,
                      then everything else. It is the order Myntra and Amazon
                      use and the order a category manager narrows in: who made
                      it, who it is for, what size, and only then the cut. */}
                  <div className="-mt-1">
                    <Section
                      label="Category"
                      hint="All categories"
                      selectedCount={filters.categories.length}
                      summary={names(facets.categories, filters.categories)}
                      open={openSection === 'category'}
                      onToggle={() => toggleSection('category')}
                      onHoverOpen={() => hoverOpen('category')}
                      onHoverLeave={() => hoverLeave('category')}
                      onClear={() => set('categories', [])}
                      disabled={!facets.categories.length}
                    >
                      <OptionList
                        label="Category" options={facets.categories} selected={filters.categories}
                        onChange={(v) => set('categories', v)} searchable
                      />
                    </Section>

                    <Section
                      label="Brand"
                      hint="All brands"
                      selectedCount={filters.brands.length}
                      summary={names(facets.brands, filters.brands)}
                      open={openSection === 'brand'}
                      onToggle={() => toggleSection('brand')}
                      onHoverOpen={() => hoverOpen('brand')}
                      onHoverLeave={() => hoverLeave('brand')}
                      onClear={() => set('brands', [])}
                      disabled={!facets.brands.length}
                    >
                      <OptionList
                        label="Brand" options={facets.brands} selected={filters.brands}
                        onChange={(v) => set('brands', v)} searchable
                      />
                    </Section>

                    <Section
                      label="Gender"
                      hint="Men, women, kids — all"
                      selectedCount={filters.genders.length}
                      summary={names(facets.genders, filters.genders)}
                      open={openSection === 'gender'}
                      onToggle={() => toggleSection('gender')}
                      onHoverOpen={() => hoverOpen('gender')}
                      onHoverLeave={() => hoverLeave('gender')}
                      onClear={() => set('genders', [])}
                      disabled={!facets.genders.length}
                    >
                      <ChipGroup
                        options={facets.genders} selected={filters.genders}
                        onChange={(v) => set('genders', v)}
                      />
                    </Section>

                    <Section
                      label="Size"
                      hint="Any size"
                      selectedCount={filters.sizes.length}
                      summary={filters.sizes.join(', ')}
                      open={openSection === 'size'}
                      onToggle={() => toggleSection('size')}
                      onHoverOpen={() => hoverOpen('size')}
                      onHoverLeave={() => hoverLeave('size')}
                      onClear={() => set('sizes', [])}
                    >
                      <SizeGrid
                        options={facets.sizes ?? []} selected={filters.sizes}
                        onChange={(v) => set('sizes', v)}
                      />
                      {facets.sizes?.length ? (
                        <p className="mt-2 text-[10px] leading-relaxed text-slate-400 dark:text-white/30">
                          Sizes come from the matched Myntra and Ajio listings — Tata CLIQ&apos;s product
                          page does not publish one, so unmatched products carry no size.
                        </p>
                      ) : null}
                    </Section>

                    <Section
                      label="Price"
                      hint={facets.priceRange ? `₹${facets.priceRange.min} – ₹${facets.priceRange.max}` : 'Any price'}
                      selectedCount={filters.minPrice != null || filters.maxPrice != null ? 1 : 0}
                      summary={priceLabel}
                      open={openSection === 'price'}
                      onToggle={() => toggleSection('price')}
                      onHoverOpen={() => hoverOpen('price')}
                      onHoverLeave={() => hoverLeave('price')}
                      onClear={() => setFilters((f) => ({ ...f, minPrice: null, maxPrice: null }))}
                    >
                      <div className="flex items-center gap-2">
                        {([
                          ['min', filters.minPrice, (n: number | null) => set('minPrice', n)],
                          ['max', filters.maxPrice, (n: number | null) => set('maxPrice', n)],
                        ] as const).map(([which, value, onSet], i) => (
                          <span
                            key={which}
                            className="flex flex-1 items-center gap-1 rounded-lg bg-slate-100/80 px-2.5 py-2 transition focus-within:ring-2 focus-within:ring-cliq/30 dark:bg-white/[0.05]"
                          >
                            <span className="text-[11px] text-slate-400">₹</span>
                            <input
                              type="number"
                              inputMode="numeric"
                              placeholder={
                                facets.priceRange
                                  ? String(i === 0 ? facets.priceRange.min : facets.priceRange.max)
                                  : which
                              }
                              value={value ?? ''}
                              onChange={(e) => onSet(e.target.value === '' ? null : Number(e.target.value))}
                              className="w-full bg-transparent text-xs tabular-nums text-slate-900 outline-none placeholder:text-slate-400 dark:text-white dark:placeholder:text-white/25"
                            />
                          </span>
                        ))}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {([
                          ['Under ₹1,000', null, 999],
                          ['₹1,000 – ₹2,499', 1000, 2499],
                          ['₹2,500 – ₹4,999', 2500, 4999],
                          ['₹5,000+', 5000, null],
                        ] as const).map(([label, lo, hi]) => {
                          const on = filters.minPrice === lo && filters.maxPrice === hi;
                          return (
                            <button
                              key={label}
                              type="button"
                              onClick={() =>
                                setFilters((f) => ({
                                  ...f,
                                  minPrice: on ? null : lo,
                                  maxPrice: on ? null : hi,
                                }))
                              }
                              className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all duration-200 active:scale-[0.97] ${
                                on
                                  ? 'border-cliq bg-cliq text-white shadow-glow-cliq'
                                  : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-white/12 dark:text-white/65 dark:hover:border-white/25 dark:hover:bg-white/[0.06]'
                              }`}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </Section>

                    <Section
                      label="Price position"
                      hint="Every position"
                      selectedCount={filters.position === 'all' ? 0 : 1}
                      summary={labelOf(facets.positions, filters.position)}
                      open={openSection === 'position'}
                      onToggle={() => toggleSection('position')}
                      onHoverOpen={() => hoverOpen('position')}
                      onHoverLeave={() => hoverLeave('position')}
                      onClear={() => set('position', 'all')}
                      disabled={!facets.positions.length}
                    >
                      <ChipGroup
                        options={facets.positions}
                        selected={filters.position === 'all' ? [] : [filters.position]}
                        onChange={(v) => set('position', (v[0] as Posture) ?? 'all')}
                        single
                      />
                    </Section>
                  </div>
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
