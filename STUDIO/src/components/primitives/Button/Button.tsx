import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { LOOP } from '@/design/tokens'
import { cn } from '@/lib/cn'

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
 * ---- The shape ------------------------------------------------------------
 *
 * One pill at every size. The scale used to mix radii — `rounded-md` at sm,
 * `rounded-lg` at md and lg, a pill only at xs — so stepping a button up or
 * down read as changing controls rather than changing sizes, and the md/lg
 * corner was the difference between these buttons and the polished pills the
 * person held them against. A pill is also the honest shape for a press
 * target: the corner radius and the height agree, so the eye reads one object
 * instead of a rectangle with softened accidents. The horizontal padding is
 * half the height at every step, which is what makes a pill read as a pill
 * rather than as a lozenge with room to spare.
 *
 * Icon-only controls are not this component — they are round, they are
 * tooltip-labelled, and they are `IconButton`.
 */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'xs' | 'sm' | 'md' | 'lg'

/**
 * Every variant states its own border, so none of them inherits one.
 *
 * `border-transparent` on the filled ranks rather than `border-0` keeps all
 * four the same height to the pixel: a 1px border is 2px of box, and a row
 * mixing a bordered button with an unbordered one is 2px out of alignment for
 * a reason nobody ever finds.
 *
 * The states follow RULES §1 with one channel each. Hover raises the tint
 * (`/90` on the filled ink is its tint — white showing through); press
 * deepens the chip and settles the resting shadow, so the control sinks into
 * the page exactly where it was aimed. Nothing scales, translates, or
 * brightens under the pointer.
 */
const VARIANT: Record<Variant, string> = {
  primary:
    'border border-transparent bg-primary text-primary-foreground shadow-chip hover:bg-primary/90 active:bg-primary active:shadow-none',
  secondary:
    'border bg-surface text-foreground shadow-chip hover:bg-tint active:bg-selected active:shadow-none',
  ghost:
    'border border-transparent text-muted-foreground hover:bg-tint hover:text-foreground active:bg-selected',
  danger: 'border border-danger/35 text-danger hover:bg-danger/10 active:bg-danger/15',
}

/**
 * Heights are the same scale the rest of the app measures controls on, so a
 * button sits level with a text field or a segmented control beside it.
 *
 * `xs` is the card step: the compact pill a stopped-run card offers its
 * verdicts in. At the `sm` height a card carrying four of them spends more
 * pixels on its buttons than on the question they answer, which is the
 * specific complaint that put this step on the scale. Its padding stays a
 * half-step under the height's half, because a card pill is allowed to be
 * denser than a page pill.
 */
const SIZE: Record<Size, string> = {
  xs: 'h-6 gap-1 rounded-full px-2.5 text-caption',
  sm: 'h-7 gap-1.5 rounded-full px-3.5 text-caption',
  md: 'h-8 gap-2 rounded-full px-4 text-ui',
  lg: 'h-10 gap-2 rounded-full px-5 text-ui',
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
    <button
      type={type}
      onClick={onClick}
      disabled={inert}
      aria-busy={busy || undefined}
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center',
        'font-medium leading-none whitespace-nowrap select-none',
        // Color and shadow together: the press deepens the chip and settles
        // the resting shadow in the same 120ms, which is what makes it read
        // as one gesture — the control sinking — rather than two effects.
        'transition-[color,background-color,border-color,box-shadow] duration-fast',
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
      <span className={cn('inline-flex items-center', SIZE[size].includes('gap-1') ? 'gap-1' : 'gap-2', busy && 'opacity-0')}>
        {icon}
        {children}
      </span>

      {busy ? (
        <span className="absolute inset-0 flex items-center justify-center">
          <Spinner />
        </span>
      ) : null}
    </button>
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
      transition={LOOP.spin}
    />
  )
}
