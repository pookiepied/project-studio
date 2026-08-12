import { useId, type ComponentType } from 'react'
import { motion } from 'framer-motion'
import { SPRING_SNAPPY } from '@/app/motion'
import type { IconSize } from '@/components/icons'
import { cn } from '@/lib/utils'

/** Any concept from the icon barrel. Typed structurally so this primitive does
 *  not depend on the icon library directly. */
type OptionIcon = ComponentType<{ size?: IconSize; className?: string }>

export interface SegmentedControlOption<T extends string> {
  value: T
  label: string
  icon?: OptionIcon
}

interface SegmentedControlProps<T extends string> {
  options: ReadonlyArray<SegmentedControlOption<T>>
  value: T
  onChange: (value: T) => void
  ariaLabel: string
  className?: string
}

/**
 * The Studio segmented switch — the one mechanism for choosing among a few
 * peer options, with the selection gliding between segments.
 *
 * The glide is the entire point and it is done with `layoutId`, not with a
 * transform this component computes. That means the thumb travels correctly
 * when the options change width, when the control is resized, and when the
 * font loads late — three cases a hand-measured indicator gets wrong and only
 * reveals under real content.
 *
 * The thumb is drawn *behind* the label (`z-10` on the content) rather than
 * the label being redrawn on top of a moving box. Otherwise text crossfades
 * as the thumb passes under it, which reads as a flicker.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: SegmentedControlProps<T>) {
  const thumbId = useId()

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        'flex shrink-0 items-center gap-0.5 rounded-full border border-border bg-muted/50 p-0.5',
        className,
      )}
    >
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              'relative flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-colors duration-150',
              'outline-none focus-visible:ring-2 focus-visible:ring-ring',
              selected ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {selected && (
              <motion.span
                layoutId={thumbId}
                className="absolute inset-0 rounded-full bg-surface-raised shadow-sm ring-1 ring-border"
                transition={SPRING_SNAPPY}
              />
            )}
            {option.icon && <option.icon size="xs" className="relative z-10" />}
            <span className="relative z-10">{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}
