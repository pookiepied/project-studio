import { forwardRef } from 'react'
import { cn } from '@/lib/cn'

/**
 * The field treatment used everywhere except the composer.
 *
 * Focus is the border, deepened — nothing else. The treatment this replaces
 * was a border shift plus a 2px bloom of grey, first at 26% and then at 14%,
 * and the person using the forms described both the same way: a thick,
 * old-fashioned, light-grey outline that reads like an error state. The
 * lesson was not a smaller alpha. A monochrome halo cannot do this job at
 * any weight — a blue ring says "focus, not warning" with hue, and grey has
 * nothing but spread to say it with, so the answer read as smudge whatever
 * its opacity. The edge says it instead: the same one-pixel border the field
 * always had, deepened to 45%, the weight `--ring` already established as
 * assertive-but-polite in this app.
 *
 * The keyboard outline is a separate register and stays `--ring`: Tab-only,
 * drawn outside the control where it cannot crowd anything. The fields never
 * consume it directly — see the token note in `index.css` for the history of
 * the regression that proved why.
 */

const BASE = [
  // `min-w-0` is load-bearing: a field is `w-full`, and inside a flex ROW a
  // `w-full` item still refuses to shrink below its intrinsic width unless
  // the minimum is released — so in any narrow row the field overflows its
  // container and gets clipped at the edges rather than shrinking. Every
  // field lives in a column or a row of some layout; none of them wants the
  // default minimum.
  'w-full min-w-0 rounded-md border bg-surface px-2.5 py-1.5 text-ui text-foreground',
  'placeholder:text-muted-foreground/70',
  'transition-[border-color] duration-fast outline-none',
  'focus:border-foreground/45',
  // The app's global `:focus-visible` outline would stack on top of this
  // field's own border — two answers, and the outer one floats 4px off the
  // field, where its ends bulge past the field's own shape on a short control
  // and it is the first thing an `overflow` ancestor clips at the left and
  // right edges. The field's border is the focus indicator, for mouse and
  // keyboard alike, and it is drawn inside the field's own box so no
  // container can cut it off. The bang is load-bearing: this sheet's own
  // rules are unlayered, and unlayered styles beat every utility layer
  // without it.
  'focus-visible:outline-none!',
].join(' ')

export const TextField = forwardRef<
  HTMLInputElement,
  {
    value: string
    onChange: (value: string) => void
    placeholder?: string
    autoFocus?: boolean
    /**
     * `password` masks the value and is the only other type this field takes.
     *
     * There is no `email`, `number` or `url` here on purpose: those types
     * bring browser validation bubbles and spinner affordances that this
     * design system has no drawing for, and a field that renders a native
     * error balloon over a modal is a UI nobody designed. Masking is
     * different — it is a security property of the input, not a validation
     * behaviour, and the app now has one place that needs it (an API key on
     * its way to the harness credential store).
     */
    type?: 'text' | 'password'
    /**
     * Defaults to `off`. A password manager offering to save a harness API key
     * into a browser vault is the exact opposite of what that key's handling
     * is for — it is submitted once and forgotten, never read back.
     */
    autoComplete?: string
    ariaLabel?: string
    onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void
    className?: string
  }
>(function TextField(
  {
    value,
    onChange,
    placeholder,
    autoFocus,
    type = 'text',
    autoComplete = 'off',
    ariaLabel,
    onKeyDown,
    className,
  },
  ref,
) {
  return (
    <input
      ref={ref}
      value={value}
      type={type}
      autoComplete={autoComplete}
      aria-label={ariaLabel}
      autoFocus={autoFocus}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={onKeyDown}
      className={cn(BASE, className)}
    />
  )
})

export function TextArea({
  value,
  onChange,
  placeholder,
  rows = 3,
  className,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  rows?: number
  className?: string
}) {
  return (
    <textarea
      value={value}
      rows={rows}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className={cn(BASE, 'resize-none', className)}
    />
  )
}
