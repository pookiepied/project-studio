import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { DURATION, EASE_OUT } from '@/design/tokens'
import { Icons } from '@/components/icons'
import { IconButton } from '@/components/primitives'
import { speakText } from '@/features/voice/speak'
import { narrate, type Narration, type NarrationState } from '@/features/voice/narration'
import { openWebAudioSink } from '@/features/voice/webAudioSink'
import { cn } from '@/lib/cn'
import { WorkingDots } from '@/components/state'

/**
 * Read aloud, as one control that grows into the player it needs.
 *
 * At rest it is the speaker button in the action row. Click it and the button
 * becomes a small pill: while the provider renders the opening passage, the
 * pill shows its working; from the first audible sample the pill IS the
 * player — a pause/play toggle, five bars that move while sound moves and
 * hold still when it does not, and a close that stops everything and puts
 * the button back.
 *
 * The message is read as passages, each rendered while the one before it
 * plays (`narration.ts`), so the wait is for one short render rather than
 * for the whole message. A wait that runs long is said as much: the pill
 * changes its word after a few seconds instead of leaving a person to
 * wonder whether the click took.
 *
 * A refusal stays until it is dismissed. The old pill flashed its sentence
 * for three seconds and put the button back, which for anyone who looked
 * away was a button that did nothing; a sentence worth reading is worth
 * leaving up, with a retry beside it for the refusals a retry can answer.
 *
 * No clock and no duration: until the provider answers, nobody knows how long
 * the audio is, and a progress bar that guesses would be a lie with a fill.
 *
 * One instance per message, state entirely its own: two messages playing at
 * once is the browser's business to allow and the reader's to find confusing,
 * and stopping the first when the second starts is a second control nobody
 * asked for. The narration dies with the component (unmount is cancel).
 */

/** How long a render may take before the pill admits it is taking a while. */
const SLOW_AFTER_MS = 6_000

export function ReadAloud({ text }: { text: string }) {
  const [state, setState] = useState<NarrationState | { stage: 'idle' }>({ stage: 'idle' })
  const [slow, setSlow] = useState(false)
  const narration = useRef<Narration | null>(null)

  const stop = useCallback(() => {
    narration.current?.stop()
    narration.current = null
    setState({ stage: 'idle' })
  }, [])

  // Unmount is cancel: a message scrolled away (or a conversation left) takes
  // its voice with it rather than speaking on.
  useEffect(
    () => () => {
      narration.current?.stop()
      narration.current = null
    },
    [],
  )

  useEffect(() => {
    if (state.stage !== 'loading') {
      setSlow(false)
      return
    }
    const timer = window.setTimeout(() => setSlow(true), SLOW_AFTER_MS)
    return () => window.clearTimeout(timer)
  }, [state.stage])

  const begin = () => {
    narration.current?.stop()
    // The narration says `loading` synchronously, before it is the current
    // one and while the guard below still refuses it, so the pill says it
    // here.
    setState({ stage: 'loading' })
    const started = narrate({
      text,
      speak: speakText,
      openSink: openWebAudioSink,
      onChange: (next) => {
        // A narration that was stopped and replaced must not speak for the
        // one that replaced it.
        if (narration.current !== started) return
        if (next.stage === 'done') {
          narration.current = null
          setState({ stage: 'idle' })
          return
        }
        setState(next)
      },
    })
    narration.current = started
  }

  const toggle = () => {
    if (state.stage === 'paused') narration.current?.resume()
    else narration.current?.pause()
  }

  return (
    <span className="relative inline-flex items-center">
      <AnimatePresence initial={false} mode="popLayout">
        {state.stage === 'idle' ? (
          <motion.span
            key="button"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: DURATION.fast, ease: EASE_OUT }}
          >
            <IconButton label="Read aloud" size="sm" onClick={begin}>
              <Icons.readAloud size="sm" />
            </IconButton>
          </motion.span>
        ) : (
          <motion.span
            key="pill"
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.94 }}
            transition={{ duration: DURATION.fast, ease: EASE_OUT }}
            className="flex items-center gap-1.5 rounded-full bg-surface-raised py-0.5 pr-1 pl-2.5 shadow-raised"
          >
            {state.stage === 'loading' ? (
              <>
                <WorkingDots className="text-muted-foreground" />
                <span className="whitespace-nowrap text-caption text-muted-foreground">
                  {slow ? 'Still rendering the voice' : 'Reading aloud'}
                </span>
              </>
            ) : state.stage === 'failed' ? (
              <>
                {/* The refusal never types itself into the transcript: it
                    lives in the pill, with the one remedy a pill can offer. */}
                <span role="status" className="whitespace-nowrap text-caption text-muted-foreground">
                  {state.note}
                </span>
                <PillButton label="Try again" onClick={begin}>
                  <Icons.reload size="sm" />
                </PillButton>
              </>
            ) : (
              <>
                <PillButton label={state.stage === 'paused' ? 'Resume' : 'Pause'} onClick={toggle}>
                  {state.stage === 'paused' ? <Icons.play size="sm" /> : <Icons.pause size="sm" />}
                </PillButton>
                <VoiceBars moving={state.stage === 'playing'} />
              </>
            )}
            <PillButton label="Stop reading aloud" onClick={stop}>
              <Icons.close size="sm" />
            </PillButton>
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  )
}

function PillButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex size-5 items-center justify-center rounded-full text-muted-foreground transition-colors duration-fast hover:bg-tint hover:text-foreground"
    >
      {children}
    </button>
  )
}

/**
 * Five bars, moving while sound moves. There is no audio analysis behind
 * them — a decoded waveform is frames of work nobody asked this pill to do —
 * so the bars share one gentle pulse and, on pause, freeze exactly where they
 * are: `animation-play-state` rather than unmount, so resuming never reads as
 * restarting.
 */
function VoiceBars({ moving }: { moving: boolean }) {
  return (
    <span aria-hidden className="flex h-3.5 items-center gap-[2px]">
      {[0, 1, 2, 3, 4].map((index) => (
        <span
          key={index}
          className={cn('w-[2px] rounded-full bg-foreground/60', moving ? 'animate-pulse' : 'opacity-50')}
          style={{
            height: `${6 + ((index * 5) % 9)}px`,
            ...(moving ? { animationDelay: `${index * 0.12}s` } : {}),
          }}
        />
      ))}
    </span>
  )
}
