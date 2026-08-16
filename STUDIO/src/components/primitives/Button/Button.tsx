import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

type Variant = 'primary' | 'quiet' | 'outline'

const VARIANT: Record<Variant, string> = {
  primary: 'bg-primary text-primary-foreground hover:opacity-85',
  quiet: 'text-muted-foreground hover:bg-tint hover:text-foreground',
  outline: 'border bg-surface text-foreground hover:bg-tint',
}

/** The labelled button. Icon-only controls use `IconButton` instead. */
export function Button({
  onClick,
  variant = 'quiet',
  disabled = false,
  type = 'button',
  className,
  children,
}: {
  onClick?: () => void
  variant?: Variant
  disabled?: boolean
  type?: 'button' | 'submit'
  className?: string
  children: ReactNode
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-md px-2.5',
        'text-ui leading-none whitespace-nowrap transition-colors duration-fast',
        'disabled:pointer-events-none disabled:opacity-40',
        VARIANT[variant],
        className,
      )}
    >
      {children}
    </button>
  )
}
