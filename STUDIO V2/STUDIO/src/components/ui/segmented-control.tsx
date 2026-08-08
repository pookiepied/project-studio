import { useId, type ComponentType } from 'react'
import { motion } from 'framer-motion'
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
}

/**
 * The STUDIO segmented switch — one mechanism for choosing among a few
 * options, with the selection gliding between segments. This is the design
 * system's identity control for mode switching.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: SegmentedControlProps<T>) {
  const thumbId = useId()

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="flex items-center gap-0.5 rounded-full border border-border bg-muted/60 p-0.5"
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
              'relative flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium outline-none transition-colors',
              selected ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {selected && (
              <motion.span
                layoutId={thumbId}
                className="absolute inset-0 rounded-full bg-background shadow-sm ring-1 ring-border"
                transition={{ type: 'spring', stiffness: 400, damping: 32 }}
              />
            )}
            {option.icon && <option.icon size="sm" className="relative z-10" />}
            <span className="relative z-10">{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}
