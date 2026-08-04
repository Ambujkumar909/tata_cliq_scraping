'use client';
import { Star } from 'lucide-react';

export function Rating({ value, count }: { value: number | null; count?: number | null }) {
  if (!value) return null;
  return (
    <span className="chip bg-slate-100 dark:bg-white/[0.06] text-emerald-600 dark:text-emerald-300">
      <Star size={12} className="fill-emerald-500 dark:fill-emerald-300 text-emerald-600 dark:text-emerald-300" />
      {value.toFixed(1)}
      {count ? <span className="text-slate-400 dark:text-white/40">({count})</span> : null}
    </span>
  );
}

export function PlatformDot({ color }: { color: string }) {
  return <span className="h-2 w-2 rounded-full" style={{ background: color }} />;
}

export function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="relative grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-cliq to-myntra shadow-glow-cliq">
        <div className="h-3.5 w-3.5 rounded-full border-2 border-white" />
        <div className="absolute -right-0.5 -bottom-0.5 h-2 w-2 rounded-full bg-ajio ring-2 ring-white dark:ring-ink-950" />
      </div>
      <div className="leading-none">
        <div className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-white">PriceLens</div>
        <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-slate-400 dark:text-white/40">
          for Tata CLIQ
        </div>
      </div>
    </div>
  );
}

export function Badge({
  children,
  color = 'rgba(255,255,255,0.1)',
  text = '#fff',
}: {
  children: React.ReactNode;
  color?: string;
  text?: string;
}) {
  return (
    <span className="chip font-semibold" style={{ background: color, color: text }}>
      {children}
    </span>
  );
}
