import { useEffect, useRef, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Icons } from '@/components/icons'
import { Button, IconButton } from '@/components/primitives'
import { DURATION, EASE_OUT } from '@/design/tokens'
import { formatClock } from '@/features/voice/waveform'
import type { MicFrameListener } from '@/features/voice/useMicInput'
import type { DictationStage } from '@/features/voice/useDictation'
import { WorkingDots } from '@/components/state'
import { VoiceFailure } from '@/features/voice/VoiceFailure'

/**
 * The composer while it is being spoken to.
 *
 * The composer keeps its two rows, and only their contents change. It grows only
 * as words arrive, the way it does for typing.
 *
 * The words themselves are the field's job: the composer shows the take in the
 * real field, read-only, so they wrap, grow the box and scroll as typed text does.
 * `DictationPrompt` only has the slot when there are no words to show:
 *
 *   recording     an invitation, in the placeholder's voice.
 *   paused        says so.
 *   requesting    the working dots and their own word. This stage once borrowed
 *                 the blocked paragraph, so WebView2 never answering the
 *                 permission request looked like "no microphone available".
 *   blocked       what went wrong, in one line. It clears itself (`useDictation`).
 *                 A take that simply had nothing in it says so plainly
 *                 ("No speech heard"), with no failure label: silence is news,
 *                 not an error.
 *
 * `DictationControls` has the tools row: Cancel, then the clock with the live
 * level, then Pause and the accent button that ends the take. On stop the bars
 * rest and "Transcribing" takes the clock's place; they stay mounted so the
 * shape holds and only one thing changes.
 *
 * ---- Why the bars write to the DOM directly -------------------------------
 *
 * The frame loop runs at display rate; React state does not. Re-rendering the
 * composer 60 times a second would put the whole conversation surface through
 * the reconciler for the sake of twenty numbers, so the loop subscribes once
 * and writes `transform` on the bars it already holds. React never sees a
 * frame.
 */

/** A ceiling, not a fit: the row is anchored right and clips on the left. */
const BAR_COUNT = 24
/** The sliver that stays visible in silence: a resting row, not an empty one. */
const BAR_MIN = 0.1

const FADE = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: DURATION.fast, ease: EASE_OUT },
} as const

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
        // Silence for a slot that is not there; `i` is bounded by the
        // array's own length, so this is the compiler's doubt, not a real one.
        const level = history[i] ?? 0
        bar.style.transform = `scaleY(${(BAR_MIN + (1 - BAR_MIN) * level).toFixed(3)})`
      }
    })
  }, [onFrame])

  return (
    // The newest sample is pinned to the right edge and the rest falls off the
    // left, which is also the correct reading of the data: a scrolling history.
    <span
      aria-hidden
      className="flex w-16 min-w-0 items-center justify-end gap-[3px] overflow-hidden"
      style={{ height: 'calc(var(--text-ui) * var(--leading-ui))' }}
    >
      {Array.from({ length: BAR_COUNT }, (_, i) => (
        <span
          key={i}
          ref={(element) => {
            bars.current[i] = element
          }}
          className="h-full w-[2px] shrink-0 origin-center rounded-full bg-foreground/55"
          style={{ transform: `scaleY(${BAR_MIN})`, willChange: 'transform' }}
        />
      ))}
    </span>
  )
}

function prompt(stage: DictationStage): string | null {
  if (stage === 'recording') return "Go ahead, I'm listening"
  return stage === 'paused' ? 'Paused' : null
}

export function DictationPrompt({
  stage,
  denied,
  note,
  quiet = null,
}: {
  stage: DictationStage
  denied: boolean
  /** A sentence from the transcriber, when the words did not come back. */
  note: string | null
  /** The plain line for a take with nothing in it, which is not a failure. */
  quiet?: string | null
}) {
  let content: ReactNode

  if (stage === 'requesting') {
    content = (
      <span className="flex items-center gap-2.5">
        <WorkingDots className="pl-0.5" />
        <span>Asking for the microphone</span>
      </span>
    )
  } else if (stage === 'blocked') {
    content = (
      <span className="block min-w-0 truncate">
        {quiet !== null
          ? quiet
          : note !== null
          ? <VoiceFailure label="Dictation failed" note={note} />
          : denied
            ? 'Microphone blocked — allow it in Windows privacy settings, then try again'
            : 'No microphone available right now'}
      </span>
    )
  } else {
    content = prompt(stage)
  }

  return (
    <AnimatePresence initial={false} mode="wait">
      <motion.div
        key={stage}
        {...FADE}
        className="shrink-0 text-ui text-muted-foreground"
        style={{ minHeight: 'calc(var(--text-ui) * var(--leading-ui))' }}
      >
        {content}
      </motion.div>
    </AnimatePresence>
  )
}

export function DictationControls({
  stage,
  elapsedMs,
  onFrame,
  onCancel,
  onPause,
  onResume,
  onFinish,
}: {
  stage: DictationStage
  elapsedMs: number
  onFrame: (listener: MicFrameListener) => () => void
  onCancel: () => void
  onPause: () => void
  onResume: () => void
  onFinish: () => void
}) {
  const paused = stage === 'paused'
  const processing = stage === 'processing'

  return (
    // Thirds, so the clock stays centred whatever the two ends hold.
    <div className="grid h-full grid-cols-[1fr_auto_1fr] items-center gap-2">
      <div className="flex min-w-0 items-center">
        <Button variant="ghost" size="sm" disabled={processing} onClick={onCancel}>
          Cancel
        </Button>
      </div>

      <div className="flex min-w-0 items-center gap-2.5 text-ui text-foreground">
        {processing ? (
          <span className="flex items-center gap-2 text-muted-foreground">
            Transcribing
            <WorkingDots />
          </span>
        ) : (
          <>
            <span aria-hidden className="studio-recording-dot" data-paused={paused || undefined} />
            {/* The one number here that is not audio, and how a person knows the
                mic has not silently died. Tabular, so the row holds still. */}
            <span className="tabular-nums">{formatClock(elapsedMs)}</span>
          </>
        )}
        <LevelBars onFrame={onFrame} />
      </div>

      <div className="flex min-w-0 items-center justify-end gap-1">
        <IconButton
          label={paused ? 'Resume' : 'Pause'}
          size="xs"
          disabled={processing}
          onClick={paused ? onResume : onPause}
        >
          {paused ? <Icons.play size="md" /> : <Icons.pause size="md" />}
        </IconButton>
        <IconButton label="Stop and transcribe" size="xs" tone="accent" disabled={processing} onClick={onFinish}>
          <Icons.check size="md" />
        </IconButton>
      </div>
    </div>
  )
}
