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
        // References CSS variables defined in src/styles/typography.css.
        // Changing a font requires only updating that file + src/styles/fonts.ts.
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
        // Micro sizes for intentional dense UI (timestamps, badges, captions).
        '3xs': ['9px', { lineHeight: '12px' }],
        '2xs': ['10px', { lineHeight: '14px' }],
        'xs': ['11px', { lineHeight: '16px' }],
        'sm': ['12px', { lineHeight: '18px' }],
        'base': ['14px', { lineHeight: '20px' }],
        'lg': ['16px', { lineHeight: '24px' }],
        'xl': ['18px', { lineHeight: '26px' }],
        '2xl': ['22px', { lineHeight: '30px' }],
        '3xl': ['28px', { lineHeight: '36px' }],
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
        // (defined in src/tokens/tokens.css). Use as bg-surface-base,
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
        // State channels that are NOT fills.
        focus:  'var(--focus-ring)', // ring-focus / outline-focus — neutral focus ring
        marker: 'var(--marker)',     // structural selected marker (2px edge bar / inset)
        // T6.1 (2026-07-06): the @deprecated `success`/`error`/`warning`/`info`
        // SCALAR functional colors have been DELETED — 0 live consumers (verified via
        // grep `(bg|text|border|ring|fill|from|to|via)-(success|error|warning|info)(-[0-9])?`).
        // Status in the neutral system is icon + weight + neutral surface (§11.3), never hue.
      },
      spacing: {
        '18': '72px',
        '22': '88px',
      },
      borderRadius: {
        'sm': '4px',
        'md': '8px',
        'lg': '12px',
        'xl': '16px',
        '2xl': '24px',
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
        // Single layering scale — retire the ad-hoc z-[9999] zoo (DOC §12).
        'overlay': '40',
        'modal':   '50',
        'popover': '60',
        'toast':   '70',
        'context': '80',
      },
      transitionDuration: {
        'fast': '150ms',
        'normal': '250ms',
        'slow': '350ms',
        'slower': '500ms',
      },
      transitionTimingFunction: {
        'standard': 'cubic-bezier(0.4, 0.0, 0.2, 1)',
        'decelerate': 'cubic-bezier(0.0, 0.0, 0.2, 1)',
        'accelerate': 'cubic-bezier(0.4, 0.0, 1, 1)',
        'spring': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
      // CSS-keyframe animations. Most motion goes through framer-motion via
      // src/constants/animations.ts; these are the few pure-CSS ones still in use.
      animation: {
        'scale-in': 'scaleIn 250ms cubic-bezier(0.0, 0.0, 0.2, 1)', // Select.tsx open
        'shimmer': 'shimmer 1.8s ease-in-out infinite',             // skeleton shimmer
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
        // Single source for these tokens. Values match what the app actually rendered
        // before Phase 1 (the hand-written .tracking-*-wide rules in index.css used to
        // win the cascade); those duplicate CSS rules were removed to end the collision.
        'ultra-wide': '0.08em',
        'extra-wide': '0.06em',
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
