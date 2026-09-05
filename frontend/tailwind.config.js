/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        pitch: 'var(--pitch)',
        panel: 'var(--panel)',
        raised: 'var(--raised)',
        line: 'var(--line)',
        ink: 'var(--ink)',
        muted: 'var(--muted)',
        amber: 'var(--amber)',
        cherry: 'var(--cherry)',
        willow: 'var(--willow)',
      },
      fontFamily: {
        // Tall condensed display, the way a scoreboard nameplate is set.
        display: ['"Big Shoulders Display"', 'Impact', 'sans-serif'],
        body: ['Chivo', 'system-ui', 'sans-serif'],
        // Money and bids are always tabular.
        mono: ['"Chivo Mono"', 'ui-monospace', 'monospace'],
      },
      letterSpacing: {
        tightest: '-0.03em',
        eyebrow: '0.22em',
      },
      keyframes: {
        snap: {
          '0%': { transform: 'translateY(0.35em)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        floodlight: {
          '0%, 100%': { opacity: '0.55' },
          '50%': { opacity: '0.8' },
        },
        sweep: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(200%)' },
        },
      },
      animation: {
        snap: 'snap 220ms cubic-bezier(0.2, 0.9, 0.3, 1)',
        floodlight: 'floodlight 6s ease-in-out infinite',
        sweep: 'sweep 1.6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
