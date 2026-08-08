import { useId } from 'react'
import { Slider } from '@base-ui/react/slider'
import { AnimatePresence, motion } from 'framer-motion'
import { EFFORT_STOPS, PEAK_EFFORT, effortIndex } from '@/features/chat/composer/turnSettings'
import type { Effort } from '@/features/chat/session/types'
import { cn } from '@/lib/utils'

/**
 * Reasoning effort as a discrete slider.
 *
 * The scale comes from `EFFORT_STOPS`, so the number of stops is never
 * hard-coded here. Reaching the top stop is treated as an event rather than
 * just another value: the fill becomes a gradient, a highlight sweeps across it
 * once, and the gradient then stays for as long as the value holds. The sweep
 * is deliberately one-shot — a permanently animating control in a composer is
 * noise, but a single acknowledgement of hitting the ceiling is legible.
 */
export function ReasoningSlider({
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
    <div className="px-1">
      <div className="flex items-baseline justify-between">
        <span id={labelId} className="text-xs font-medium text-foreground">
          Reasoning
        </span>
        <span
          className={cn(
            'text-xs font-medium transition-colors duration-200',
            atPeak
              ? 'bg-linear-to-r from-indigo-500 via-fuchsia-500 to-amber-500 bg-clip-text text-transparent'
              : 'text-muted-foreground',
          )}
        >
          {stop.label}
        </span>
      </div>

      <Slider.Root
        value={index}
        onValueChange={(value) => {
          const next = EFFORT_STOPS[Array.isArray(value) ? value[0] : value]
          if (next) onChange(next.value)
        }}
        min={0}
        max={lastIndex}
        step={1}
        aria-labelledby={labelId}
        className="mt-3"
      >
        <Slider.Control className="flex h-4 w-full items-center">
          <Slider.Track className="relative h-1.5 w-full rounded-full bg-muted select-none">
            {/* Stop ticks sit under the fill so the filled run covers them. */}
            <div aria-hidden className="absolute inset-0 flex items-center justify-between px-[3px]">
              {EFFORT_STOPS.map((tick) => (
                <span key={tick.value} className="size-1 rounded-full bg-border" />
              ))}
            </div>

            <Slider.Indicator
              className={cn(
                'relative overflow-hidden rounded-full transition-colors duration-300',
                atPeak
                  ? 'bg-linear-to-r from-indigo-500 via-fuchsia-500 to-amber-500'
                  : 'bg-foreground',
              )}
            >
              <AnimatePresence>
                {atPeak && (
                  <motion.span
                    // One pass of light across the new gradient, then gone.
                    // The gradient underneath is what persists.
                    key="peak-sweep"
                    initial={{ x: '-120%' }}
                    animate={{ x: '120%' }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.75, ease: 'easeOut' }}
                    className="absolute inset-y-0 w-1/2 bg-linear-to-r from-transparent via-white/70 to-transparent"
                  />
                )}
              </AnimatePresence>
            </Slider.Indicator>

            <Slider.Thumb
              className={cn(
                'size-3.5 rounded-full bg-background ring-2 transition-shadow duration-300 outline-none',
                'focus-visible:ring-offset-1 focus-visible:ring-offset-popover',
                atPeak ? 'ring-fuchsia-500 shadow-[0_0_0_4px_rgba(217,70,239,0.18)]' : 'ring-foreground',
              )}
            />
          </Slider.Track>
        </Slider.Control>
      </Slider.Root>

      {/* Fixed height: the hints differ in length, and letting the panel resize
          under the pointer made the popover jump between stops. */}
      <p className="mt-2 h-8 text-[11px] leading-snug text-muted-foreground">{stop.hint}</p>
    </div>
  )
}
