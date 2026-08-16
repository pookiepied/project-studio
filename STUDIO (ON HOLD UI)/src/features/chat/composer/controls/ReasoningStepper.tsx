import { useId } from 'react'
import { motion } from 'framer-motion'
import { SPRING_SNAPPY } from '@/app/motion'
import { EFFORT_STOPS, PEAK_EFFORT, effortIndex } from '@/features/chat/composer/turnSettings'
import type { Effort } from '@/features/chat/session/types'
import { cn } from '@/lib/utils'

/**
 * Reasoning effort, as four discrete steps.
 *
 * This replaces a slider, and the replacement is the point. A slider promises a
 * continuum — it invites you to drag, to find a value between two others — and
 * this setting has exactly four states. Every drag ended in a snap to a stop,
 * which is a control arguing with its own affordance. Four steps are a
 * segmented control; that is what this is now.
 *
 * The gradient is gone too. The old peak state painted the fill, the thumb ring
 * and the label in indigo→fuchsia→amber and swept a highlight across it once.
 * In a monochrome app that was the loudest thing on screen, and it was
 * announcing *a settings default*. Peak now reads the way everything else does:
 * a filled track behind it, and the label in the foreground weight.
 *
 * The track behind the steps is not decoration — it is what makes "max" read as
 * further along a scale rather than just a different option, which a plain
 * segmented control loses.
 *
 * Everything here is a pill, not a rounded rectangle. A four-square row inside
 * a popover reads as a form field; a capsule with a sliding thumb reads as a
 * macOS control. Same information, and the difference is the whole feel.
 */
export function ReasoningStepper({
  effort,
  onChange,
}: {
  effort: Effort
  onChange: (effort: Effort) => void
}) {
  const labelId = useId()
  const index = effortIndex(effort)
  const stop = EFFORT_STOPS[index]
  const atPeak = effort === PEAK_EFFORT
  const lastIndex = EFFORT_STOPS.length - 1

  return (
    <div>
      <div className="flex items-baseline justify-between px-0.5">
        <span id={labelId} className="text-xs font-medium text-foreground">
          Reasoning
        </span>
        <span
          className={cn(
            'text-xs transition-colors duration-150',
            atPeak ? 'font-semibold text-foreground' : 'text-muted-foreground',
          )}
        >
          {stop.label}
        </span>
      </div>

      <div
        role="radiogroup"
        aria-labelledby={labelId}
        className="relative mt-2 flex items-center rounded-full border border-border bg-muted/50 p-0.5"
        onKeyDown={(event) => {
          // Arrow keys walk the scale. A radiogroup that only responds to
          // clicks is a segmented control that keyboard users cannot change.
          const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
          if (delta === 0) return
          event.preventDefault()
          const next = EFFORT_STOPS[Math.min(Math.max(index + delta, 0), lastIndex)]
          if (next) onChange(next.value)
        }}
      >
        {/* Filled track: everything up to and including the current step. It
            sits under the thumb, so the two read as one object. */}
        <motion.span
          aria-hidden
          className="absolute inset-y-0.5 left-0.5 rounded-full bg-foreground/[0.07]"
          initial={false}
          animate={{ width: `calc(${((index + 1) / EFFORT_STOPS.length) * 100}% - 4px)` }}
          transition={SPRING_SNAPPY}
        />

        {EFFORT_STOPS.map((option, optionIndex) => {
          const selected = optionIndex === index
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(option.value)}
              className={cn(
                'relative flex h-6 flex-1 items-center justify-center rounded-full text-[11px] font-medium transition-colors duration-150',
                'outline-none focus-visible:ring-2 focus-visible:ring-ring',
                selected ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {selected && (
                <motion.span
                  layoutId="reasoning-thumb"
                  transition={SPRING_SNAPPY}
                  className="absolute inset-0 rounded-full bg-surface-raised shadow-sm ring-1 ring-border"
                />
              )}
              <span className="relative z-10">{option.label}</span>
            </button>
          )
        })}
      </div>

      {/* Fixed height: the hints differ in length, and letting the panel resize
          under the pointer made the popover jump between steps. */}
      <p className="mt-2 h-8 px-0.5 text-[11px] leading-snug text-muted-foreground">{stop.hint}</p>
    </div>
  )
}
