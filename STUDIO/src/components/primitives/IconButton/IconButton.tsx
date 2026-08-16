import { forwardRef, useState, type ReactNode } from 'react'
import { IconStateProvider, type IconState } from '@/components/icons/Icon'
import { Tooltip } from '@/components/primitives/Tooltip/Tooltip'
import { cn } from '@/lib/cn'

/**
 * The one icon-only control in the app.
 *
 * Always circular. The chip carries the state now (see `TONE_CLASS`), and a
 * circle is the shape that reads as a resting place for a mark rather than a
 * button drawn around one -- four corners at 28px are four things asking to be
 * noticed. There is no `round` prop because there is no second answer.
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

/**
 * The background carries the state; the glyph does not.
 *
 * `hover:text-foreground` used to ride along with the chip, so a hovered mark
 * went from `--muted-foreground` to `--foreground` -- a jump of 0.41 in
 * lightness, in one step, at the same moment a background appeared underneath
 * it. Two things escalating at once made a hovered icon the highest-contrast
 * pixel on screen: darker than the body text beside it, for a control the
 * pointer was merely passing over. That is the whole of the "harsh", "inky",
 * lit-up quality, and it is what separates this from the platform look.
 *
 * macOS moves the chip and leaves the glyph alone, so the answer to "where am
 * I" is a soft shape appearing, not the icon shouting.
 *
 * That holds for `active` too, and the exception it used to make was the
 * inconsistency worth naming: with `active` also darkening the mark, a control
 * that was merely on looked *heavier* than everything around it, and whether an
 * icon thickened depended on whether the surface happened to track an active
 * state. Same gesture, different result, one screen apart. The capsule says on;
 * the glyph is the same glyph in every state it can be in.
 *
 * What replaces the contrast is motion -- see `drawn.tsx`. A mark that shows its
 * state by moving a part of itself says more than one that shows it by getting
 * darker, and it says it without becoming the loudest thing in the window.
 */
const TONE_CLASS: Record<Tone, string> = {
  quiet: 'text-muted-foreground hover:bg-tint',
  // Opting out of the global muted icon colour on purpose: this mark sits on
  // a filled chip, where muted grey on near-black is unreadable rather than
  // quiet. The arbitrary variant lands in the utilities layer, which is what
  // lets it beat the `.studio-icon` default in `index.css`.
  solid: 'bg-primary text-primary-foreground hover:opacity-85 [&_.studio-icon]:text-primary-foreground',
}

export interface IconButtonProps {
  label: string
  onClick?: () => void
  size?: Size
  tone?: Tone
  active?: boolean
  disabled?: boolean
  /** Where the tooltip opens. `bottom` for controls near the window's top. */
  tooltipSide?: 'top' | 'bottom' | 'right'
  className?: string
  children: ReactNode
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, onClick, size = 'md', tone = 'quiet', active = false, disabled = false, tooltipSide = 'top', className, children },
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
          // Circular, because the chip is the whole state signal now and a
          // circle is the shape that reads as a resting place for a mark rather
          // than a button drawn around it. A squircle at 28px is four corners
          // asking to be noticed; the circle is quieter at the same contrast,
          // which is the entire trade this component is making.
          'rounded-full',
          SIZE_CLASS[size],
          TONE_CLASS[tone],
          active && tone === 'quiet' && 'bg-selected',
          className,
        )}
      >
        <IconStateProvider state={iconState}>{children}</IconStateProvider>
      </button>
    </Tooltip>
  )
})
