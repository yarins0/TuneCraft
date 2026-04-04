/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Maps CSS variables to Tailwind utility classes
        // e.g. bg-bg-primary, text-accent, border-border
        'bg-primary': 'var(--color-bg-primary)',
        'bg-secondary': 'var(--color-bg-secondary)',
        'bg-card': 'var(--color-bg-card)',
        'accent': 'var(--color-accent)',
        'accent-hover': 'var(--color-accent-hover)',
        'text-primary': 'var(--color-text-primary)',
        'text-muted': 'var(--color-text-muted)',
        'border-color': 'var(--color-border)',
        // Warning / destructive — mirrors --color-warning; enables text-warning, bg-warning, etc.
        'warning': 'var(--color-warning)',
        // Unassigned bucket — amber highlight for the overflow group in the Split modal.
        'unassigned': 'var(--color-unassigned)',
        // Subtle hover overlay — white at 5% opacity for button/row hover states.
        'surface-hover': 'var(--color-surface-hover)',
      },
    },
  },
  plugins: [],
}