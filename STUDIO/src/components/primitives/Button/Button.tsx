import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/cn'
import { DURATION, EASE_OUT } from '@/design/tokens'

/**
 * The labelled button.
 *
 * ---- Why this got rebuilt -------------------------------------------------
 *
 * It used to be a 28px-tall text-coloured span with a hover tint, which is a
 * *link* wearing a button's name. That is fine inside a menu, where everything
 * is a row and the surrounding structure says what is clickable. It is wrong
 * for "Add provider" or "Reset to defaults" standing alone on a settings page,
 * where the control has to announce itself: those read as incidental text, and
 * a destructive action reading as incidental text is a real problem rather than
 * a cosmetic one.
 *
 * So a button now has weight, a size scale, and a variant that states its rank.
 * Three ranks and no more, because a page where several controls all claim to
 * be the important one has no important one:
 *
 *   primary     the one thing this page wants you to do
 *   secondary   a real action, equal in weight to its neighbours
 *   ghost       an action that should not compete — inside rows, beside text
 *   danger      loses data, or cannot be undone
 *
 * `danger` is deliberately outlined rather than filled. A filled red button is
 * the loudest object on any screen, and a settings page that ships one is a
 * settings page daring you to click it. Filled red belongs on the confirmation
 * step, where the choice has already been narrowed to yes or no.
 *
 * Icon-only controls are not this component — they are round, they are
 * tooltip-labelled, and they are `IconButton`.
 */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

/**
 * Every variant states its own border, so none of them inherits one.
 *
 * `border-transparent` on the filled ranks rather than `border-0` keeps all
 * four the same height to the pixel: a 1px border is 2px of box, and a row
 * mixing a bordered button with an unbordered one is 2px out of alignment for
 * a reason nobody ever finds.
 */
const VARIANT: Record<Variant, string> = {
  primary:
    'border border-transparent bg-primary text-primary-foreground shadow-chip hover:bg-primary/90 active:bg-primary/80',
  secondary: 'border bg-surface text-foreground shadow-chip hover:bg-tint active:bg-tint',
  ghost: 'border border-transparent text-muted-foreground hover:bg-tint hover:text-foreground',
  danger: 'border border-danger/35 text-danger hover:bg-danger/10 active:bg-danger/15',
}

/**
 * Heights are the same scale the rest of the app measures controls on, so a
 * button sits level with a text field or a segmented control beside it.
 */
const SIZE: Record<Size, string> = {
  sm: 'h-7 gap-1.5 rounded-md px-2.5 text-caption',
  md: 'h-8 gap-2 rounded-lg px-3 text-ui',
  lg: 'h-10 gap-2 rounded-lg px-4 text-ui',
}

export function Button({
  onClick,
  variant = 'secondary',
  size = 'md',
  disabled = false,
  busy = false,
  type = 'button',
  icon,
  fullWidth = false,
  className,
  children,
}: {
  onClick?: () => void
  variant?: Variant
  size?: Size
  disabled?: boolean
  /** An action is in flight. Shows a spinner and refuses further presses. */
  busy?: boolean
  type?: 'button' | 'submit'
  /** Leading mark. Sized by the icon system, never by this component. */
  icon?: ReactNode
  fullWidth?: boolean
  className?: string
  children: ReactNode
}) {
  const inert = disabled || busy

  return (
    <motion.button
      type={type}
      onClick={onClick}
      disabled={inert}
      aria-busy={busy || undefined}
      // The press is a scale, not a translate. A control that moves down under
      // the pointer moves *out from under it*, so a slip becomes a miss; a
      // control that compresses stays exactly where it was aimed.
      whileTap={inert ? undefined : { scale: 0.97 }}
      transition={{ duration: DURATION.fast, ease: EASE_OUT }}
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center',
        'font-medium leading-none whitespace-nowrap select-none',
        'transition-colors duration-fast',
        // Focus is a ring on the button, offset from it, and only for the
        // keyboard. Drawn inside the border it reads as a second border and
        // shifts the label; shown on click it is the halo everyone complains
        // about.
        'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
        'disabled:pointer-events-none disabled:opacity-45',
        SIZE[size],
        VARIANT[variant],
        fullWidth && 'w-full',
        className,
      )}
    >
      {/* The label holds its place while busy rather than being replaced.
          Swapping the text for a spinner resizes the button mid-action, which
          moves every control beside it at the one moment the user is watching
          to see whether the click registered. */}
      <span className={cn('inline-flex items-center', SIZE[size].includes('gap-1.5') ? 'gap-1.5' : 'gap-2', busy && 'opacity-0')}>
        {icon}
        {children}
      </span>

      {busy ? (
        <span className="absolute inset-0 flex items-center justify-center">
          <Spinner />
        </span>
      ) : null}
    </motion.button>
  )
}

/**
 * The in-flight mark.
 *
 * A rotating arc rather than a pulsing dot: a spinner has to say "still going",
 * and only continuous rotation does that without also implying progress toward
 * a known end.
 */
function Spinner() {
  return (
    <motion.span
      aria-hidden
      className="size-3.5 rounded-full border-[1.5px] border-current border-t-transparent opacity-70"
      animate={{ rotate: 360 }}
      transition={{ duration: 0.7, ease: 'linear', repeat: Infinity }}
    />
  )
}
