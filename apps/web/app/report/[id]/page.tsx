'use client';
import Link from 'next/link';
import { ArrowLeft, Archive } from 'lucide-react';
import { MatchReport } from '@/components/MatchReport';
import { Logo } from '@/components/ui';
import { ThemeToggle } from '@/components/ThemeToggle';

/**
 * Standalone, deep-linkable report page.
 * A comparison report is something a merchandiser shares or prints, so it gets
 * its own URL rather than living only inside the dashboard modal.
 */
export default function ReportPage({ params }: { params: { id: string } }) {
  return (
    <main className="mx-auto max-w-[1400px] px-4 pb-20 pt-6 sm:px-6">
      <nav className="no-print mb-6 flex items-center justify-between">
        <Logo />
        <div className="flex items-center gap-2">
          <Link
            href="/reports"
            className="flex items-center gap-1.5 rounded-full bg-slate-100 dark:bg-white/[0.06] px-3.5 py-2 text-xs font-medium text-slate-600 dark:text-white/70 transition hover:bg-slate-200 dark:hover:bg-white/[0.12] hover:text-slate-900 dark:hover:text-white"
          >
            <Archive size={13} /> Saved reports
          </Link>
          <Link
            href="/"
            className="flex items-center gap-1.5 rounded-full bg-slate-100 dark:bg-white/[0.06] px-3.5 py-2 text-xs font-medium text-slate-600 dark:text-white/70 transition hover:bg-slate-200 dark:hover:bg-white/[0.12] hover:text-slate-900 dark:hover:text-white"
          >
            <ArrowLeft size={13} /> Back to catalog
          </Link>
          <ThemeToggle />
        </div>
      </nav>
      <MatchReport productId={params.id} />
    </main>
  );
}
