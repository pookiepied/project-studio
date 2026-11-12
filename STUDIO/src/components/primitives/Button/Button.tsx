import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { LOOP } from '@/design/tokens'
import { cn } from '@/lib/cn'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-confirm'
type Size = 'xs' | 'sm' | 'md' | 'lg'

/** A solid destructive fill belongs to the final confirmation. */
const VARIANT: Record<Variant, string> = {
  primary:
    'bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary [&_.studio-icon]:text-primary-foreground',
  secondary:
    'bg-muted text-foreground hover:bg-soft active:bg-foreground/15',
  ghost: 'text-muted-foreground hover:bg-tint hover:text-foreground active:bg-soft',
  danger: 'bg-danger/10 text-danger hover:bg-danger/15 active:bg-danger/20',
  'danger-confirm': 'bg-danger-confirm text-white hover:bg-danger-confirm/90 active:bg-danger-confirm [&_.studio-icon]:text-white',
}

/** Keep short labels compact while giving the capsule more height. */
const SIZE: Record<Size, string> = {
  xs: '[--control-size:var(--button-xs)] px-2 text-caption',
  sm: '[--control-size:var(--button-sm)] px-2.5 text-caption',
  md: '[--control-size:var(--button-md)] px-3 text-ui',
  lg: '[--control-size:var(--button-lg)] px-6 text-ui',
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
  role,
  label,
  expanded,
  pressed,
  hasPopup,
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
  /** `menuitem` when the button is an action inside a popover menu. */
  role?: 'menuitem'
  /** Accessible name, when the visible text alone does not say enough. */
  label?: string
  expanded?: boolean
  pressed?: boolean
  hasPopup?: 'menu'
  children: ReactNode
}) {
  return (
    <button
      type={type}
      role={role}
      aria-label={label}
      aria-expanded={expanded}
      aria-pressed={pressed}
      aria-haspopup={hasPopup}
      onClick={onClick}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cn(
        'studio-control-flat relative inline-flex shrink-0 items-center justify-center rounded-full font-medium whitespace-nowrap select-none',
        'transition-[color,background-color,box-shadow] duration-fast',
        'disabled:pointer-events-none disabled:opacity-45',
        SIZE[size],
        VARIANT[variant],
        fullWidth && 'w-full',
        className,
      )}
    >
      {/* Keep the label's width and accessible name while the action is busy. */}
      <span className={cn('inline-flex items-center gap-1.5', busy && 'opacity-0')}>
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

/** Rotation communicates ongoing work without implying measurable progress. */
function Spinner() {
  return (
    <motion.span
      aria-hidden
      className="size-[1.1em] rounded-full border-[1.5px] border-current border-t-transparent opacity-70"
      animate={{ rotate: 360 }}
      transition={LOOP.spin}
    />
  )
}
