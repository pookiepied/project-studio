import { useId } from 'react'
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
      <div className="flex items-baseline justify-between gap-2 pb-2">
        <label htmlFor={id} className="text-ui text-foreground">
          {current?.name ?? 'Default'}
        </label>
        {current?.note ? (
          <span className="truncate text-micro text-muted-foreground">{current.note}</span>
        ) : null}
      </div>

      <div className="relative flex h-5 items-center">
        {/* The track. The filled part is the distance travelled, which is what
            makes the position readable at a glance without counting stops. */}
        <div className="absolute inset-x-0 h-1.5 rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-fast ease-out"
            style={{ width: `${progress * 100}%` }}
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

        <div
          aria-hidden
          className="pointer-events-none absolute size-3.5 rounded-full border border-hairline bg-surface-raised shadow-chip transition-[left] duration-fast ease-out"
          // `calc` with the thumb's own width backed out, so it stays inside
          // the track at both ends instead of hanging half off.
          style={{ left: `calc(${progress * 100}% - ${progress * 14}px)` }}
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
