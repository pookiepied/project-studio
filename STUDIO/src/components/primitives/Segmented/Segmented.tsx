import { motion } from 'framer-motion'
import { SPRING_SNAPPY } from '@/design/tokens'
import { cn } from '@/lib/cn'
import type { ReactNode } from 'react'

interface SegmentedOption<T extends string | number> {
  readonly id: T
  readonly label: ReactNode
}

/**
 * A segmented control.
 *
 * The selected thumb is a shared layout animation rather than a background
 * class, so moving between options slides one object instead of one fading out
 * while another fades in. That is the difference between a control that feels
 * like a switch and one that feels like two buttons.
 */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  ariaLabel,
  /** Distinguishes this control's thumb from any other on screen. */
  layoutId,
}: {
  options: readonly SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  ariaLabel: string
  layoutId: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      // `md` rows inside an `lg` track with 2px of padding: near enough the
      // concentric rule at this size that the corners stay parallel.
      className="flex gap-0.5 rounded-lg bg-muted p-0.5"
    >
      {options.map((option) => {
        const selected = option.id === value
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.id)}
            className={cn(
              'relative flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5',
              'text-ui transition-colors duration-fast',
              selected ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {selected ? (
              <motion.span
                layoutId={layoutId}
                transition={SPRING_SNAPPY}
                className="absolute inset-0 rounded-md bg-surface-raised shadow-chip"
              />
            ) : null}
            <span className="relative z-10 flex items-center gap-1.5">{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}
