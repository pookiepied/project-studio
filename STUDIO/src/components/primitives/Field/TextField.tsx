import { forwardRef } from 'react'
import { cn } from '@/lib/cn'

/**
 * The field treatment used everywhere except the composer.
 *
 * Focus is a border and a 2px ring at 14% alpha. The previous shell used a 3px
 * ring at 26%, which on a white surface read as a thick grey halo — the thing
 * that made clicking a field look like an error state. A monochrome ring has to
 * stay quiet, because unlike a blue one it cannot rely on hue to say "this is
 * focus rather than a warning".
 */

const BASE = [
  'w-full rounded-md border bg-surface px-2.5 py-1.5 text-ui text-foreground',
  'placeholder:text-muted-foreground/70',
  'transition-[border-color,box-shadow] duration-fast outline-none',
  'focus:border-foreground/20 focus:shadow-[0_0_0_2px_var(--ring)]',
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
