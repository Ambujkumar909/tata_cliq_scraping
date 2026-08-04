import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#07070c',
          900: '#0b0b14',
          800: '#12121f',
          700: '#1b1b2e',
          600: '#26263f',
        },
        // Platform brand accents
        cliq: { DEFAULT: '#e11d48', soft: '#fb7185' },     // Tata CLIQ — rose/wine
        myntra: { DEFAULT: '#ff3f6c', soft: '#ff7aa0' },   // Myntra — pink
        ajio: { DEFAULT: '#2f80ed', soft: '#6fa8ff' },     // Ajio — blue
        gold: '#f5c451',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        // Works on both themes: a hairline ring + soft drop.
        glow: '0 0 0 1px rgba(100,116,139,0.12), 0 24px 60px -18px rgba(15,23,42,0.35)',
        'glow-cliq': '0 10px 40px -12px rgba(225,29,72,0.45)',
      },
      backgroundImage: {
        // Light-theme mesh; the dark variant is overridden in globals.css.
        mesh: 'radial-gradient(60% 60% at 15% 10%, rgba(225,29,72,0.07) 0%, transparent 60%), radial-gradient(50% 50% at 85% 15%, rgba(47,128,237,0.06) 0%, transparent 55%), radial-gradient(60% 60% at 60% 100%, rgba(255,63,108,0.05) 0%, transparent 60%)',
      },
      keyframes: {
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        'fade-up': { '0%': { opacity: '0', transform: 'translateY(12px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
      },
      animation: {
        shimmer: 'shimmer 1.6s infinite',
        'fade-up': 'fade-up 0.5s ease-out both',
      },
    },
  },
  plugins: [],
};
export default config;
