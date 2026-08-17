import { useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { DURATION, EASE_OUT } from '@/design/tokens'
import { formatClock } from '@/features/voice/waveform'
import type { MicFrameListener } from '@/features/voice/useMicInput'
import type { DictationStage } from '@/features/voice/useDictation'
import { cn } from '@/lib/cn'

/**
 * The composer while it is being spoken to.
 *
 * Takes the field's place inside the capsule and holds the same line height,
 * so the composer neither grows nor reshapes -- the surface stays put and only
 * its contents change, which is the same contract the field itself follows on
 * focus.
 *
 * Three faces, one slot:
 *
 *   recording   real level as scrolling bars plus the clock. The bars are the
 *               last two seconds of measured level, newest on the right --
 *               each bar one frame of what the microphone actually heard, so
 *               a silent room shows a still row and only speaking moves it.
 *   processing  transcribing, with an ellipsis that cycles. Motion here is a
 *               state being reported, not decoration -- the same licence the
 *               thinking sparkle runs on.
 *   blocked     what went wrong, in one line, in the caption voice. It clears
 *               itself (see `useDictation`) rather than demanding a dismissal.
 *
 * ---- Why the bars write to the DOM directly -------------------------------
 *
 * The frame loop runs at display rate; React state does not. Re-rendering the
 * composer 60 times a second would put the whole conversation surface through
 * the reconciler for the sake of twenty numbers, so the loop subscribes once
 * and writes `transform` on the bars it already holds. React never sees a
 * frame.
 */

const BAR_COUNT = 22
/** The sliver that stays visible in silence: a resting row, not an empty one. */
const BAR_MIN = 0.1

function LevelBars({ onFrame }: { onFrame: (listener: MicFrameListener) => () => void }) {
  const bars = useRef<(HTMLSpanElement | null)[]>([])

  useEffect(() => {
    // One slot of look-back, so the row scrolls as history rather than
    // twitching as a whole.
    const history = new Float64Array(BAR_COUNT)
    return onFrame((level) => {
      history.copyWithin(0, 1)
      history[BAR_COUNT - 1] = level
      for (let i = 0; i < BAR_COUNT; i++) {
        const bar = bars.current[i]
        if (!bar) continue
        bar.style.transform = `scaleY(${(BAR_MIN + (1 - BAR_MIN) * history[i]!).toFixed(3)})`
      }
    })
  }, [onFrame])

  return (
    <span aria-hidden className="flex h-5 items-center gap-[3px]">
      {Array.from({ length: BAR_COUNT }, (_, i) => (
        <span
          key={i}
          ref={(element) => {
            bars.current[i] = element
          }}
          className="h-full w-[2px] origin-center rounded-full bg-foreground/65"
          style={{ transform: `scaleY(${BAR_MIN})`, willChange: 'transform' }}
        />
      ))}
    </span>
  )
}

/** Three dots, cycling. Pace is deliberately unhurried: this is a wait. */
function WorkingDots() {
  return (
    <span aria-hidden className="flex items-center gap-1 pl-0.5">
      {[0, 1, 2].map((index) => (
        <motion.span
          key={index}
          className="size-[3px] rounded-full bg-muted-foreground"
          animate={{ opacity: [0.25, 1, 0.25] }}
          transition={{ duration: 1.1, repeat: Infinity, delay: index * 0.18, ease: 'easeInOut' }}
        />
      ))}
    </span>
  )
}

export function DictationBar({
  stage,
  elapsedMs,
  denied,
  onFrame,
}: {
  stage: DictationStage
  elapsedMs: number
  denied: boolean
  onFrame: (listener: MicFrameListener) => () => void
}) {
  return (
    <div className="flex min-h-8 items-center gap-3 px-1 text-caption text-muted-foreground">
      <AnimatePresence initial={false} mode="wait">
        {stage === 'recording' ? (
          <motion.div
            key="recording"
            initial={{ opacity: 0, x: 6 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -6 }}
            transition={{ duration: DURATION.fast, ease: EASE_OUT }}
            className="flex min-w-0 items-center gap-3"
          >
            <LevelBars onFrame={onFrame} />
            {/* The clock is the one number here that is not audio, and it
                earns its place: it is how the user knows the mic has not
                silently died. Tabular figures so the seconds tick without
                the row shifting. */}
            <span className="shrink-0 tabular-nums text-foreground/80">{formatClock(elapsedMs)}</span>
            <span className={cn('truncate', 'opacity-70')}>Esc cancels</span>
          </motion.div>
        ) : stage === 'processing' ? (
          <motion.div
            key="processing"
            initial={{ opacity: 0, x: 6 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -6 }}
            transition={{ duration: DURATION.fast, ease: EASE_OUT }}
            className="flex items-center gap-2.5"
          >
            <WorkingDots />
            <span>Transcribing</span>
          </motion.div>
        ) : (
          <motion.p
            key="blocked"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: DURATION.fast, ease: EASE_OUT }}
            className="truncate"
          >
            {denied
              ? 'Microphone blocked — allow it in Windows privacy settings, then try again'
              : 'No microphone available right now'}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  )
}
