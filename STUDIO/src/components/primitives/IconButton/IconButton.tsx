import { forwardRef, useState, type ReactNode } from 'react'
import { IconStateProvider, type IconState } from '@/components/icons/Icon'
import { Tooltip } from '@/components/primitives/Tooltip/Tooltip'
import { cn } from '@/lib/cn'

/**
 * The one icon-only control in the app.
 *
 * Square by default because it sits in rows of other square controls and a
 * circle among squares reads as a different family. The composer's send and add
 * buttons pass `round`, and there the circle is the point: they are the only
 * single-purpose verbs inside the field.
 *
 * ---- Where icon motion comes from ----------------------------------------
 *
 * This is the component that drives it. The button tracks pointer state itself
 * and publishes one word -- rest, hover, press, on -- to every mark inside it.
 * The glyph decides what to do about that word: the trash lid tilts, the gear
 * turns, send lifts, the plus becomes a cross.
 *
 * Two consequences are deliberate. The icon reacts to the whole 28px button
 * rather than to the 14px mark, so the control feels alive to its edges instead
 * of having a small live patch in the middle of a dead square. And `active`
 * outranks hover, so a control that is *on* keeps saying so while the pointer
 * crosses it.
 *
 * The button itself does not move. A control that scales under the cursor is a
 * touch affordance; under a desktop pointer it reads as the layout being
 * unstable.
 *
 * Pointer state is tracked with `pointerenter`/`pointerleave` rather than CSS
 * `:hover` because the value has to be readable by React to be passed down, and
 * `pointercancel` is handled so a press interrupted by a scroll or a system
 * gesture cannot leave the glyph stuck mid-press.
 */

type Size = 'sm' | 'md' | 'lg'
type Tone = 'quiet' | 'solid'

/** `lg` is 32px, matching `COMPOSER.controlSize` -- the controls inside the field. */
const SIZE_CLASS: Record<Size, string> = {
  sm: 'size-6',
  md: 'size-7',
  lg: 'size-8',
}

const TONE_CLASS: Record<Tone, string> = {
  quiet: 'text-muted-foreground hover:bg-tint hover:text-foreground',
  solid: 'bg-primary text-primary-foreground hover:opacity-85',
}

export interface IconButtonProps {
  label: string
  onClick?: () => void
  size?: Size
  tone?: Tone
  round?: boolean
  active?: boolean
  disabled?: boolean
  /** Where the tooltip opens. `bottom` for controls near the window's top. */
  tooltipSide?: 'top' | 'bottom' | 'right'
  className?: string
  children: ReactNode
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, onClick, size = 'md', tone = 'quiet', round = false, active = false, disabled = false, tooltipSide = 'top', className, children },
  ref,
) {
  const [pointer, setPointer] = useState<'rest' | 'hover' | 'press'>('rest')

  const iconState: IconState =
    disabled ? 'rest' : pointer === 'press' ? 'press' : active ? 'on' : pointer

  return (
    <Tooltip label={label} side={tooltipSide}>
      <button
        ref={ref}
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        onPointerEnter={() => setPointer('hover')}
        onPointerLeave={() => setPointer('rest')}
        onPointerDown={() => setPointer('press')}
        onPointerUp={() => setPointer('hover')}
        onPointerCancel={() => setPointer('rest')}
        className={cn(
          'inline-flex shrink-0 items-center justify-center',
          // `leading-none` and the flex centring together are what actually keep
          // the glyph on the button's optical centre. Line-height alone leaves an
          // SVG sitting a pixel low, which is the misalignment that showed up
          // across the composer row.
          'leading-none transition-colors duration-150',
          'disabled:pointer-events-none disabled:opacity-40',
          round ? 'rounded-full' : 'rounded-md',
          SIZE_CLASS[size],
          TONE_CLASS[tone],
          active && tone === 'quiet' && 'bg-selected text-foreground',
          className,
        )}
      >
        <IconStateProvider state={iconState}>{children}</IconStateProvider>
      </button>
    </Tooltip>
  )
})
