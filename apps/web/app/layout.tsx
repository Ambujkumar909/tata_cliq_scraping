import type { Metadata } from 'next';
import { Inter, Sora } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });
const sora = Sora({ subsets: ['latin'], variable: '--font-display', display: 'swap' });

export const metadata: Metadata = {
  title: 'PriceLens — Competitive Price Intelligence for Tata CLIQ',
  description:
    'See every Tata CLIQ product side-by-side with its live price on Myntra and Ajio. Know where you win and where dealers undercut you.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the theme script may add .dark before React hydrates.
    <html lang="en" className={`${inter.variable} ${sora.variable}`} suppressHydrationWarning>
      <body className="min-h-screen font-sans antialiased selection:bg-cliq/20 dark:selection:bg-cliq/30">
        {/* Apply the persisted theme before first paint — no flash. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{if(localStorage.getItem('pl-theme')==='dark')document.documentElement.classList.add('dark')}catch(e){}",
          }}
        />
        <div className="pointer-events-none fixed inset-0 -z-10 bg-mesh" />
        {/* Dark-only vignette depth */}
        <div className="pointer-events-none fixed inset-0 -z-10 hidden bg-[radial-gradient(ellipse_at_top,transparent_40%,rgba(0,0,0,0.5))] dark:block" />
        {children}
      </body>
    </html>
  );
}
