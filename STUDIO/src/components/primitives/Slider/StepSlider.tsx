import { useId } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { DURATION, EASE_OUT, SPRING_SNAPPY } from '@/design/tokens'
import { cn } from '@/lib/cn'

/**
 * A slider over named steps.
 *
 * ---- Why a slider and not a list of rows ----------------------------------
 *
 * Reasoning effort is the one setting in the app that is genuinely a *dial*.
 * The steps are ordered, adjacent ones are near-equivalent, and the thing being
 * chosen is a position on a scale rather than a named option — nobody wants
 * "high" specifically, they want "more than medium". A column of radio rows
 * says these are five unrelated choices and hides the ordering that is the
 * whole point.
 *
 * It also survives the real problem: the steps differ per model. Some offer
 * four, some six, some name the top one differently. A slider absorbs that —
 * the track is the same control at any length — where a list of rows changes
 * shape and position every time the model changes, and the user has to re-find
 * the setting they were adjusting.
 *
 * ---- Why it is a native range input ---------------------------------------
 *
 * Because a hand-built one has to reimplement keyboard stepping, focus, drag
 * capture, touch, and the accessibility tree, and would get some of it wrong.
 * The native input is invisible and stretched over the track, so the styling is
 * entirely ours and the behaviour is entirely the platform's.
 *
 * The ends are labelled with what the choice *does* — faster against smarter
 * — rather than with the step names. The names are for the value readout; the
 * ends are there so someone who has never seen the setting knows which way to
 * drag before they know what "medium" means here.
 *
 * ---- Why the movement is a spring and not a duration ----------------------
 *
 * A dial you drag should arrive the way a physical one does. The thumb and
 * the fill used to be CSS transitions on `left` and `width` with a fixed
 * duration, which travels at the same speed for one step as for five and
 * stops dead on arrival — correct, and lifeless, and noticeably so on the one
 * control in the app you adjust by feel. A spring covers a long throw faster
 * than a short one and settles instead of stopping, which is the whole
 * difference between a control that responds and one that updates.
 *
 * The readout crossfades rather than cutting, because the name and its note
 * change length as they change: swapped in one frame the line jumps, and the
 * eye reads the jump instead of the word.
 */
export function StepSlider<T extends string>({
  steps,
  value,
  onChange,
  minLabel = 'Faster',
  maxLabel = 'Smarter',
}: {
  steps: readonly { id: T; name: string; note?: string }[]
  value: T
  onChange: (id: T) => void
  minLabel?: string
  maxLabel?: string
}) {
  const id = useId()
  const index = Math.max(0, steps.findIndex((step) => step.id === value))
  const current = steps[index]
  // Guard the single-step case: it would divide by zero and put the thumb at
  // NaN%, which renders as the thumb vanishing rather than as an error.
  const progress = steps.length > 1 ? index / (steps.length - 1) : 1

  return (
    <div className="px-2 pt-1 pb-2">
      <div className="flex min-h-5 items-baseline justify-between gap-2 pb-2">
        <label htmlFor={id} className="text-ui text-foreground">
          {current?.name ?? 'Default'}
        </label>
        <AnimatePresence mode="wait" initial={false}>
          {current?.note ? (
            <motion.span
              key={current.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: DURATION.fast, ease: EASE_OUT }}
              className="truncate text-micro text-muted-foreground"
            >
              {current.note}
            </motion.span>
          ) : null}
        </AnimatePresence>
      </div>

      <div className="relative flex h-5 items-center">
        {/* The track. The filled part is the distance travelled, which is what
            makes the position readable at a glance without counting stops. */}
        <div className="absolute inset-x-0 h-1.5 rounded-full bg-muted">
          <motion.div
            className="h-full rounded-full bg-primary"
            animate={{ width: `${progress * 100}%` }}
            transition={SPRING_SNAPPY}
          />
        </div>

        {/* Stop marks, so the scale reads as discrete rather than continuous --
            a smooth-looking track that snaps is a control that feels broken. */}
        <div className="pointer-events-none absolute inset-x-0 flex justify-between px-px">
          {steps.map((step, at) => (
            <span
              key={step.id}
              className={cn(
                'size-1 rounded-full transition-colors duration-fast',
                at <= index ? 'bg-primary-foreground/45' : 'bg-foreground/20',
              )}
            />
          ))}
        </div>

        <motion.div
          aria-hidden
          className="pointer-events-none absolute size-3.5 rounded-full border border-hairline bg-surface-raised shadow-chip"
          // `calc` with the thumb's own width backed out, so it stays inside
          // the track at both ends instead of hanging half off.
          animate={{ left: `calc(${progress * 100}% - ${progress * 14}px)` }}
          transition={SPRING_SNAPPY}
        />

        <input
          id={id}
          type="range"
          min={0}
          max={steps.length - 1}
          step={1}
          value={index}
          onChange={(event) => {
            const next = steps[Number(event.target.value)]
            if (next) onChange(next.id)
          }}
          aria-label="Reasoning effort"
          aria-valuetext={current?.name}
          className="absolute inset-x-0 h-5 w-full cursor-pointer opacity-0"
        />
      </div>

      <div className="flex justify-between pt-1.5 text-micro text-muted-foreground">
        <span>{minLabel}</span>
        <span>{maxLabel}</span>
      </div>
    </div>
  )
}
