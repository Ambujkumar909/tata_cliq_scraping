'use client';
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sun, Moon } from 'lucide-react';

/**
 * Light/dark theme toggle.
 *
 * Light is the default; `.dark` on <html> flips the app (Tailwind darkMode:
 * 'class'). The choice persists in localStorage and is applied pre-paint by an
 * inline script in the root layout, so there is no theme flash.
 *
 * Printing always happens in light: the PDF stylesheet assumes a white page,
 * so `.dark` is lifted for the duration of the print and restored after.
 */
export function ThemeToggle() {
  // null until mounted — avoids a hydration mismatch with the pre-paint script.
  const [dark, setDark] = useState<boolean | null>(null);

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));

    let wasDark = false;
    const before = () => {
      wasDark = document.documentElement.classList.contains('dark');
      if (wasDark) document.documentElement.classList.remove('dark');
    };
    const after = () => {
      if (wasDark) document.documentElement.classList.add('dark');
    };
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
  }, []);

  const toggle = () => {
    const next = !document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem('pl-theme', next ? 'dark' : 'light');
    } catch {
      /* private mode */
    }
    setDark(next);
  };

  return (
    <button
      onClick={toggle}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={dark ? 'Light theme' : 'Dark theme'}
      className="no-print relative grid h-9 w-9 place-items-center overflow-hidden rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-slate-900 dark:border-white/[0.1] dark:bg-white/[0.06] dark:text-white/70 dark:shadow-none dark:hover:bg-white/[0.12] dark:hover:text-white"
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={dark === null ? 'boot' : dark ? 'moon' : 'sun'}
          initial={{ rotate: -90, opacity: 0, scale: 0.6 }}
          animate={{ rotate: 0, opacity: 1, scale: 1 }}
          exit={{ rotate: 90, opacity: 0, scale: 0.6 }}
          transition={{ duration: 0.18 }}
          className="grid place-items-center"
        >
          {dark ? <Moon size={16} /> : <Sun size={16} className="text-amber-500" />}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}
