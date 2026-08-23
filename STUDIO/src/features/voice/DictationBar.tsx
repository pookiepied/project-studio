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

/**
 * Enough bars to fill the field at its widest, not enough to be counted.
 *
 * It was 22, which drew a ~107px strip and left the rest of the composer
 * empty -- the dictation state used a third of the field and the remaining
 * two thirds were blank, which is what made it read as unfinished rather than
 * as the field doing something. The row is anchored right and clips on the
 * left, so this is a ceiling rather than an exact fit: the history always
 * reaches both edges whatever width the composer happens to be, with the
 * sidebar open or shut.
 */
const BAR_COUNT = 64
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
    // `justify-end` plus `overflow-hidden` is what makes one fixed bar count
    // fit every field width: the newest sample is pinned to the right edge and
    // anything that does not fit falls off the left, which is also the correct
    // reading of the data -- this is the last two seconds, scrolling.
    <span
      aria-hidden
      className="flex min-w-0 flex-1 items-center justify-end gap-[3px] overflow-hidden"
      style={{ height: 'calc(var(--text-ui) * var(--leading-ui))' }}
    >
      {Array.from({ length: BAR_COUNT }, (_, i) => (
        <span
          key={i}
          ref={(element) => {
            bars.current[i] = element
          }}
          className="h-full w-[2px] shrink-0 origin-center rounded-full bg-foreground/65"
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
    // Exactly one line of composer text tall -- the same box `ComposerField`'s
    // textarea occupies, so swapping one for the other cannot change the
    // capsule's height.
    //
    // This was `min-h-8`: 32px against the field's 18.6px line, so starting
    // dictation grew the composer by 13px and ended it by shrinking back. The
    // component's own docstring promised the opposite ("holds the same line
    // height, so the composer neither grows nor reshapes") -- the contract was
    // right and the number was never derived from it. Stated against the `ui`
    // role rather than this row's `caption`, because the height has to match
    // the *field*, and `1lh` here would measure the caption text inside it.
    <div
      className="flex w-full items-center gap-3 px-1 text-caption text-muted-foreground"
      style={{ minHeight: 'calc(var(--text-ui) * var(--leading-ui))' }}
    >
      <AnimatePresence initial={false} mode="wait">
        {stage === 'recording' ? (
          <motion.div
            key="recording"
            initial={{ opacity: 0, x: 6 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -6 }}
            transition={{ duration: DURATION.fast, ease: EASE_OUT }}
            className="flex w-full min-w-0 items-center gap-3"
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
