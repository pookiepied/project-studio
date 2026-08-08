/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        // CSS variables defined in src/design/typography.css — change there.
        sans:    ['var(--font-sans)'],
        display: ['var(--font-display)'],
        serif:   ['var(--font-display)'],
        mono:    ['var(--font-mono)'],
      },
      fontWeight: {
        thin: '100',
        extralight: '200',
        light: '300',
        normal: '400',
        medium: '500',
        semibold: '600',
        bold: '700',
      },
      fontSize: {
        // Unified type scale — bridged from CSS variables (src/design/typography.css).
        // Changing a var there is the single place that reflows the whole UI +
        // the .prose-chat cascade + inline styles. Each step is visually distinct.
        '3xs':  ['var(--text-3xs)',  { lineHeight: 'var(--text-3xs--lh)' }],
        '2xs':  ['var(--text-2xs)',  { lineHeight: 'var(--text-2xs--lh)' }],
        'xs':   ['var(--text-xs)',   { lineHeight: 'var(--text-xs--lh)' }],
        'sm':   ['var(--text-sm)',   { lineHeight: 'var(--text-sm--lh)' }],
        'base': ['var(--text-base)', { lineHeight: 'var(--text-base--lh)' }],
        'body': ['var(--text-body)', { lineHeight: 'var(--text-body--lh)' }],
        'lg':   ['var(--text-lg)',   { lineHeight: 'var(--text-lg--lh)' }],
        'xl':   ['var(--text-xl)',   { lineHeight: 'var(--text-xl--lh)' }],
        '2xl':  ['var(--text-2xl)',  { lineHeight: 'var(--text-2xl--lh)' }],
        '3xl':  ['var(--text-3xl)',  { lineHeight: 'var(--text-3xl--lh)' }],
      },
      colors: {
        gray: {
          50:  '#FAFAFA',
          100: '#F5F5F5',
          150: '#EBEBEB',
          200: '#E5E5E5',
          300: '#D4D4D4',
          400: '#A3A3A3',
          500: '#737373',
          600: '#525252',
          700: '#404040',
          800: '#262626',
          900: '#171717',
        },
        // T6.4c (2026-07-06): the @deprecated `luxury.*` green palette has been
        // DELETED — all 3 live consumers in `features/chat/components/ConversationsDropdown.tsx`
        // migrated to `bg-primary` / `border-primary` / `text-secondary` (D-401 status
        // model — icon + weight + neutral surface, no hue). Status indicators are now
        // strictly neutral per §11.3.
        // T6.4b (2026-07-06): the @deprecated `dark.*` explicit dark palette has been
        // DELETED — all 57 live consumers migrated to `bg-surface-page` / `bg-surface-base`
        // / `text-*` / `border-surface-border` (auto-switching tokens; no `dark:` prefix
        // needed for the migrated call-sites per the §11.2 auto-switch design).
        // Semantic surface tokens — auto-switch via CSS custom properties
        // (defined in src/design/tokens.css). Use as bg-surface-base,
        // border-surface-border, etc. No dark: prefix needed.
        surface: {
          page:     'var(--surface-page)',     // page/root background
          deep:     'var(--surface-deep)',     // sunken panels (terminal, browser)
          base:     'var(--surface-base)',     // standard card/dropdown bg
          raised:   'var(--surface-raised)',   // elevated container
          hover:    'var(--surface-hover)',    // hover — quietest fill (§11.1)
          selected: 'var(--surface-selected)', // selected/active fill (pair w/ text-primary)
          active:   'var(--surface-active)',   // pressed
          border:   'var(--surface-border)',   // hairline border / light-mode elevation
          divider:  'var(--surface-divider)',  // thin inner dividers
          // T6.4a (2026-07-06): `lift` alias DELETED — was a 1:1 alias of `selected`;
          // all 68 consumers migrated to `bg-surface-selected` (or `dark:bg-surface-selected`
          // etc.) via mechanical 1:1 replace. Single surface-ramp key per role now.
        },
        // Ink / text tokens — yields text-primary, text-secondary, text-muted, etc.
        // (also bg-*/border-* if ever needed). Auto-switch via CSS vars.
        primary:        'var(--text-primary)',     // primary text — pure black / soft white
        secondary:      'var(--text-secondary)',   // secondary text
        muted:          'var(--text-muted)',       // muted / placeholder
        disabled:       'var(--text-disabled)',    // disabled text
        'on-emphasis':  'var(--text-on-emphasis)', // text on filled near-black/graphite
        scrim:          'var(--scrim)',            // modal/backdrop scrim
        // State channels that are NOT fills.
        focus:  'var(--focus-ring)', // ring-focus / outline-focus — neutral focus ring
        marker: 'var(--marker)',     // structural selected marker (2px edge bar / inset)
        // T6.1 (2026-07-06): the @deprecated `success`/`error`/`warning`/`info`
        // SCALAR functional colors have been DELETED — 0 live consumers (verified via
        // grep `(bg|text|border|ring|fill|from|to|via)-(success|error|warning|info)(-[0-9])?`).
        // Status in the neutral system is icon + weight + neutral surface (§11.3), never hue.
      },
      spacing: {
        '18': 'var(--space-18)',
        '22': 'var(--space-22)',
      },
      borderRadius: {
        'sm':  'var(--radius-sm)',
        'md':  'var(--radius-md)',
        'lg':  'var(--radius-lg)',
        'xl':  'var(--radius-xl)',
        '2xl': 'var(--radius-2xl)',
      },
      boxShadow: {
        // Auto-switching soft elevation — values come from --shadow-* tokens
        // (soft in light, minimal in dark). No dark: variant needed.
        'sm': 'var(--shadow-sm)',
        'md': 'var(--shadow-md)',
        'lg': 'var(--shadow-lg)',
        'xl': 'var(--shadow-xl)',
        // T6.1 (2026-07-06): the @deprecated `dark-sm`/`dark-md`/`dark-lg`/`dark-xl`
        // explicit dark shadows have been DELETED — 0 live consumers (verified via grep
        // `shadow-(dark-sm|dark-md|dark-lg|dark-xl)`). The base sizes auto-switch via
        // the --shadow-* CSS vars; no `dark:` shadow variant is needed.
      },
      zIndex: {
        // Single layering scale — bridged from CSS vars (tokens.css).
        'overlay': 'var(--z-overlay)',
        'modal':   'var(--z-modal)',
        'popover': 'var(--z-popover)',
        'toast':   'var(--z-toast)',
        'context': 'var(--z-context)',
      },
      transitionDuration: {
        'fast':   'var(--duration-fast)',
        'normal': 'var(--duration-normal)',
        'slow':   'var(--duration-slow)',
        'slower': 'var(--duration-slower)',
      },
      transitionTimingFunction: {
        'standard':  'var(--ease-standard)',
        'decelerate': 'var(--ease-decelerate)',
        'accelerate': 'var(--ease-accelerate)',
        'spring':     'var(--ease-spring)',
      },
      // CSS-keyframe animations. Most motion goes through framer-motion via
      // src/constants/animations.ts; these are the few pure-CSS ones still in use.
      animation: {
        'scale-in': 'scaleIn var(--duration-normal) var(--ease-decelerate)',
        'shimmer': 'shimmer 1.8s ease-in-out infinite',
      },
      keyframes: {
        scaleIn: {
          '0%': { transform: 'scale(0.95)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% center' },
          '100%': { backgroundPosition: '200% center' },
        },
      },
      letterSpacing: {
        // Bridged from CSS vars in typography.css.
        'ultra-wide':  'var(--tracking-ui-label)',
        'extra-wide':  'var(--tracking-extra-wide)',
      },
      maxHeight: {
        '37.5': '150px',
      },
      minHeight: {
        '10': '40px',
      },
    },
  },
  plugins: [],
}
