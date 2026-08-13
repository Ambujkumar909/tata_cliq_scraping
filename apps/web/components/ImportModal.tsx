'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Upload, FileSpreadsheet, Loader2, AlertCircle, CheckCircle2, X, Download,
  Ban, RotateCcw, ArrowRight,
} from 'lucide-react';
import { api } from '@/lib/api';
import type { ImportJob, ImportPreview, ImportRow } from '@/lib/types';

/**
 * Bulk import: upload a sheet of CLIQ links and compare every one.
 *
 * Three stages, deliberately separated by a confirmation:
 *
 *   pick → preview (what we parsed, no scraping yet) → run (live progress)
 *
 * The preview exists because a 5,000-row sheet is hours of scraping. Showing
 * what was understood *before* starting is the difference between a mistake
 * that costs a click and one that costs an afternoon.
 */
export function ImportModal({ onClose, onFinished }: { onClose: () => void; onFinished?: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [job, setJob] = useState<ImportJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const notified = useRef(false);

  const choose = useCallback(async (f: File) => {
    setFile(f);
    setPreview(null);
    setError(null);
    setBusy(true);
    try {
      setPreview(await api.importPreview(f));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that file.');
    } finally {
      setBusy(false);
    }
  }, []);

  const start = useCallback(async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      setJob(await api.importStart(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the import.');
    } finally {
      setBusy(false);
    }
  }, [file]);

  // Poll while the job runs. Stops on any terminal state, so a finished job
  // costs nothing.
  useEffect(() => {
    if (!job || (job.status !== 'running' && job.status !== 'queued')) return;
    const t = setInterval(async () => {
      try {
        setJob(await api.importJob(job.id));
      } catch {
        /* transient — the next tick retries */
      }
    }, 1000);
    return () => clearInterval(t);
  }, [job]);

  const finished = job && ['done', 'cancelled', 'failed'].includes(job.status);

  // Tell the dashboard once, when the run ends, so its KPIs and the catalog
  // pick up potentially thousands of new comparisons.
  useEffect(() => {
    if (finished && !notified.current) {
      notified.current = true;
      onFinished?.();
      api.importJob(job!.id, { items: true, pageSize: 200, filter: 'all' })
        .then((j) => setRows(j.rows?.items ?? []))
        .catch(() => {});
    }
  }, [finished, job, onFinished]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 dark:bg-ink-950 dark:ring-1 dark:ring-white/10"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white">
              Import a sheet of links
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-white/50">
              Every Tata CLIQ link in the file is compared against Myntra and Ajio.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10">
            <X size={18} />
          </button>
        </div>

        {/* ── Stage 1: pick a file ── */}
        {!job ? (
          <>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const f = e.dataTransfer.files?.[0];
                if (f) choose(f);
              }}
              onClick={() => inputRef.current?.click()}
              className={`mt-5 cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition ${
                dragging
                  ? 'border-cliq bg-cliq/5'
                  : 'border-slate-300 hover:border-slate-400 dark:border-white/15 dark:hover:border-white/30'
              }`}
            >
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.xlsm,.csv"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) choose(f); }}
              />
              <Upload size={22} className="mx-auto text-slate-400 dark:text-white/40" />
              <div className="mt-2 text-sm font-medium text-slate-700 dark:text-white/80">
                {file ? file.name : 'Drop an .xlsx or .csv here, or click to browse'}
              </div>
              <div className="mt-1 text-xs text-slate-400 dark:text-white/40">
                Links can sit in any column, on any sheet — the whole workbook is scanned.
              </div>
            </div>

            {/* Outside the drop zone: clicking it must download the template,
                not open the file picker behind it. */}
            <div className="mt-2 text-center text-xs text-slate-400 dark:text-white/40">
              Not sure of the format?{' '}
              <a
                href={api.importTemplateUrl()}
                className="font-medium text-cliq underline-offset-2 hover:underline"
              >
                Download the template
              </a>{' '}
              — though your own sheet almost certainly works as-is.
            </div>

            {busy && !preview ? (
              <div className="mt-4 flex items-center gap-2 text-sm text-slate-500 dark:text-white/50">
                <Loader2 size={14} className="animate-spin" /> Reading the file…
              </div>
            ) : null}

            {/* ── Stage 2: confirm what we parsed ── */}
            {preview ? (
              <div className="mt-5 rounded-xl bg-slate-50 p-4 dark:bg-white/[0.04]">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                  <FileSpreadsheet size={15} className="text-emerald-500" />
                  Found {preview.total.toLocaleString('en-IN')} products
                </div>
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-white/50 sm:grid-cols-4">
                  <Stat label="Rows scanned" value={preview.rowsScanned} />
                  <Stat label="Links found" value={preview.linksFound} />
                  <Stat label="Duplicates merged" value={preview.duplicates} />
                  <Stat label="With competitor URL" value={preview.withHints} />
                </div>
                <p className="mt-3 text-xs text-slate-400 dark:text-white/40">
                  Roughly {estimate(preview.total)} of scraping. It runs in the background — you can
                  close this window and it keeps going.
                </p>
              </div>
            ) : null}

            {error ? <ErrorLine text={error} /> : null}

            {preview ? (
              <button
                onClick={start}
                disabled={busy}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-cliq px-5 py-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
              >
                {busy ? <Loader2 size={15} className="animate-spin" /> : <ArrowRight size={15} />}
                Compare all {preview.total.toLocaleString('en-IN')} products
              </button>
            ) : null}
          </>
        ) : (
          /* ── Stage 3: live progress ── */
          <div className="mt-5">
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-medium text-slate-900 dark:text-white">
                {job.status === 'running' || job.status === 'queued' ? 'Comparing…'
                  : job.status === 'done' ? 'Import complete'
                  : job.status === 'cancelled' ? 'Import stopped'
                  : 'Import failed'}
              </span>
              <span className="tabular-nums text-slate-500 dark:text-white/50">
                {job.done.toLocaleString('en-IN')} / {job.total.toLocaleString('en-IN')}
              </span>
            </div>

            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
              <motion.div
                className={`h-full ${job.status === 'done' ? 'bg-emerald-500' : job.status === 'running' || job.status === 'queued' ? 'bg-cliq' : 'bg-amber-500'}`}
                animate={{ width: `${job.percent}%` }}
                transition={{ ease: 'easeOut' }}
              />
            </div>

            <div className="mt-1.5 flex justify-between text-xs text-slate-400 dark:text-white/40">
              <span>{job.percent}%</span>
              {job.etaSeconds != null ? <span>about {duration(job.etaSeconds)} left</span> : null}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Tile label="Matched" value={job.matched} tone="emerald" />
              <Tile label="No match" value={job.noMatch} tone="slate" />
              <Tile label="Failed" value={job.failed} tone={job.failed ? 'rose' : 'slate'} />
              <Tile label="From cache" value={job.fromCache} tone="slate" />
            </div>

            {job.hintAgreed + job.hintDisagreed > 0 ? (
              <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-white/[0.04] dark:text-white/50">
                Where your sheet named the competitor product, our match agreed on{' '}
                <strong className="text-emerald-600 dark:text-emerald-300">{job.hintAgreed}</strong> and
                differed on <strong className="text-amber-600 dark:text-amber-300">{job.hintDisagreed}</strong>.
              </p>
            ) : null}

            {job.note ? <p className="mt-3 text-xs text-slate-400 dark:text-white/40">{job.note}</p> : null}
            {job.error ? <ErrorLine text={job.error} /> : null}

            {rows?.length ? <Failures rows={rows} /> : null}

            <div className="mt-5 flex flex-wrap gap-2">
              {job.status === 'running' || job.status === 'queued' ? (
                <button
                  onClick={() => api.importCancel(job.id).then(setJob).catch(() => {})}
                  className="flex items-center gap-1.5 rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-200 dark:bg-white/10 dark:text-white/80 dark:hover:bg-white/20"
                >
                  <Ban size={14} /> Stop
                </button>
              ) : null}

              {job.status === 'cancelled' && job.remaining > 0 ? (
                <button
                  onClick={() => { notified.current = false; api.importResume(job.id).then(setJob).catch(() => {}); }}
                  className="flex items-center gap-1.5 rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-200 dark:bg-white/10 dark:text-white/80 dark:hover:bg-white/20"
                >
                  <RotateCcw size={14} /> Resume {job.remaining.toLocaleString('en-IN')} left
                </button>
              ) : null}

              {job.matched + job.noMatch > 0 ? (
                <a
                  href={api.importExportUrl(job.id)}
                  className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700"
                >
                  <Download size={14} /> Download results
                </a>
              ) : null}

              <button onClick={onClose} className="ml-auto rounded-xl px-4 py-2.5 text-sm text-slate-500 hover:text-slate-900 dark:text-white/50 dark:hover:text-white">
                {finished ? 'Close' : 'Run in background'}
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="font-semibold text-slate-900 dark:text-white">{value.toLocaleString('en-IN')}</div>
      <div>{label}</div>
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: number; tone: 'emerald' | 'rose' | 'slate' }) {
  const colors = {
    emerald: 'text-emerald-600 dark:text-emerald-300',
    rose: 'text-rose-600 dark:text-rose-300',
    slate: 'text-slate-700 dark:text-white/70',
  }[tone];
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2 dark:bg-white/[0.04]">
      <div className={`font-display text-lg font-bold tabular-nums ${colors}`}>{value.toLocaleString('en-IN')}</div>
      <div className="text-[11px] text-slate-400 dark:text-white/40">{label}</div>
    </div>
  );
}

/** Only failures are listed — a wall of successes tells the user nothing. */
function Failures({ rows }: { rows: ImportRow[] }) {
  const bad = rows.filter((r) => r.status === 'error');
  if (!bad.length) {
    return (
      <p className="mt-4 flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-300">
        <CheckCircle2 size={13} /> Every link resolved.
      </p>
    );
  }
  return (
    <div className="mt-4">
      <div className="text-xs font-semibold text-slate-700 dark:text-white/70">
        {bad.length} link{bad.length === 1 ? '' : 's'} could not be read
      </div>
      <ul className="mt-1.5 max-h-32 overflow-y-auto rounded-lg bg-rose-50 p-2 text-[11px] text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
        {bad.slice(0, 50).map((r) => (
          <li key={r.id} className="truncate">
            {r.sheet} row {r.row} — {r.error}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ErrorLine({ text }: { text: string }) {
  return (
    <div className="mt-4 flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
      <AlertCircle size={13} className="mt-0.5 shrink-0" />
      <span>{text}</span>
    </div>
  );
}

/** Rough wall-clock estimate, from the measured ~1.6s per uncached product. */
function estimate(total: number): string {
  return duration(Math.round(total * 1.6));
}

function duration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
