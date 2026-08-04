'use client';
import { useEffect, useRef, useState } from 'react';
import { motion, useInView, animate } from 'framer-motion';
import { Package, Store, Trophy, GitCompareArrows } from 'lucide-react';
import type { Stats } from '@/lib/types';

function Counter({ to, suffix = '' }: { to: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!inView) return;
    const controls = animate(0, to, {
      duration: 1.2,
      ease: 'easeOut',
      onUpdate: (v) => setVal(v),
    });
    return () => controls.stop();
  }, [inView, to]);
  return (
    <span ref={ref}>
      {Math.round(val).toLocaleString('en-IN')}
      {suffix}
    </span>
  );
}

const CARDS = [
  { key: 'products', label: 'CLIQ products tracked', icon: Package, color: '#e11d48' },
  { key: 'comparisons', label: 'Live comparisons', icon: GitCompareArrows, color: '#ff3f6c' },
  { key: 'brands', label: 'Brands covered', icon: Store, color: '#2f80ed' },
  { key: 'cliqCheapestPct', label: 'Where CLIQ wins on price', icon: Trophy, color: '#f5c451', suffix: '%' },
] as const;

export function StatsBar({ stats }: { stats: Stats | null }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {CARDS.map((c, i) => {
        const Icon = c.icon;
        const value = stats ? (stats[c.key as keyof Stats] as number) : 0;
        return (
          <motion.div
            key={c.key}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08 }}
            className="relative overflow-hidden rounded-2xl glass p-4"
          >
            <div
              className="absolute -right-6 -top-6 h-20 w-20 rounded-full opacity-20 blur-2xl"
              style={{ background: c.color }}
            />
            <Icon size={18} style={{ color: c.color }} />
            <div className="mt-3 font-display text-2xl font-bold text-slate-900 dark:text-white sm:text-3xl">
              {stats ? <Counter to={value} suffix={'suffix' in c ? c.suffix : ''} /> : '—'}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-white/50">{c.label}</div>
          </motion.div>
        );
      })}
    </div>
  );
}
