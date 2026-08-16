import { forwardRef } from 'react'
import { cn } from '@/lib/cn'

/**
 * The field treatment used everywhere except the composer.
 *
 * Focus is a border and a 2px ring at 14% alpha. The previous shell used a 3px
 * ring at 26%, which on a white surface read as a thick grey halo -- the thing
 * that made clicking a field look like an error state. A monochrome ring has to
 * stay quiet, because unlike a blue one it cannot rely on hue to say "this is
 * focus rather than a warning".
 */

const BASE = [
  'w-full rounded-md border bg-surface px-2.5 py-1.5 text-ui text-foreground',
  'placeholder:text-muted-foreground/70',
  'transition-[border-color,box-shadow] duration-150 outline-none',
  'focus:border-foreground/20 focus:shadow-[0_0_0_2px_var(--ring)]',
].join(' ')

export const TextField = forwardRef<
  HTMLInputElement,
  {
    value: string
    onChange: (value: string) => void
    placeholder?: string
    autoFocus?: boolean
    onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void
    className?: string
  }
>(function TextField({ value, onChange, placeholder, autoFocus, onKeyDown, className }, ref) {
  return (
    <input
      ref={ref}
      value={value}
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
