import type { Config } from 'tailwindcss';

// Design tokens mirror the mobile app's theme.js (dark/light palettes + teal/orange brand).
// Surfaces and text switch via CSS variables (see index.css); brand accents are constant.
const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: { primary: v('bg-primary'), secondary: v('bg-secondary'), tertiary: v('bg-tertiary'), input: v('bg-input') },
        ink: { primary: v('text-primary'), secondary: v('text-secondary'), muted: v('text-muted'), label: v('text-label') },
        line: { DEFAULT: v('border'), active: v('accent-teal-lt') },
        // brand.teal is the filled-button colour (white text passes contrast in both modes).
        // The others switch shade with the theme so they stay readable on white AND on near-black.
        brand: {
          teal: '#1B7A8A', 'teal-lt': v('accent-teal-lt'), orange: v('accent-orange'), amber: v('c-amber'),
          green: v('c-green'), red: v('c-red'), purple: '#7C3AED', cyan: v('accent-cyan'),
        },
        // The side panel has its own tokens so it can stay deep teal-navy while the page is light.
        side: {
          DEFAULT: v('side-bg'), text: v('side-text'), muted: v('side-muted'), line: v('side-line'),
          hover: v('side-hover'), active: v('side-active-bg'), 'active-text': v('side-active-text'), accent: v('side-accent'),
        },
      },
      fontFamily: {
        // Orbitron: headings, side panel, buttons.  Lexend: everything else (body text, form inputs).
        display: ['Orbitron', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        body: ['Lexend', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['Lexend', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      borderRadius: { sm: '8px', md: '12px', lg: '16px', xl: '24px' },
      boxShadow: { teal: '0 4px 12px rgb(43 168 191 / 0.35)', card: 'var(--shadow-card)' },
    },
  },
  plugins: [],
} satisfies Config;
