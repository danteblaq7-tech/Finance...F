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
        line: { DEFAULT: v('border'), active: '#2BA8BF' },
        brand: {
          teal: '#1B7A8A', 'teal-lt': '#2BA8BF', orange: '#E07B2A', amber: '#F59E0B',
          green: '#22C55E', red: '#EF4444', purple: '#7C3AED', cyan: v('accent-cyan'),
        },
      },
      fontFamily: {
        display: ['Orbitron', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"Space Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      borderRadius: { sm: '8px', md: '12px', lg: '16px', xl: '24px' },
      boxShadow: { teal: '0 4px 12px rgb(43 168 191 / 0.35)', card: '0 2px 8px rgb(0 0 0 / 0.25)' },
    },
  },
  plugins: [],
} satisfies Config;
