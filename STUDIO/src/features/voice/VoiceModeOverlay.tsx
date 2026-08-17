import { useEffect, useMemo, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { DURATION, EASE_OUT, SHELL } from '@/design/tokens'
import { Icons } from '@/components/icons'
import { Button } from '@/components/primitives'
import { IconButton } from '@/components/primitives'
import {
  LevelHistory,
  formatClock,
  prefersReducedMotion,
  ridgePath,
  speakingEnvelope,
  thinkingPulse,
} from '@/features/voice/waveform'
import { useVoiceSession } from '@/features/voice/useVoiceMode'

/**
 * The voice stage.
 *
 * A different stage in the plain sense: the whole window is given over to one
 * conversation held out loud, and everything else -- sidebar, transcript,
 * composer -- waits underneath, untouched, for the mode to end.
 *
 * ---- The layout ------------------------------------------------------------
 *
 * A strip's worth of headroom, one line of state, the ridge, the words, and
 * one transport. No panels, no cards: the surface is the window itself, which
 * is what makes this read as a room rather than a dialog about a room.
 *
 * ---- Motion ----------------------------------------------------------------
 *
 * Entrance and exit are a whole surface changing, so they take `DURATION.slow`
 * -- the palette's clock, not the composer's. Everything inside is
 * crossfades on the state of the session; the one continuous animation is the
 * ridge, which is measurement, not choreography (see `VoiceRidge`).
 *
 * ---- Controls --------------------------------------------------------------
 *
 * One transport, one meaning: the floor. Tapped while listening, it takes the
 * turn by hand; tapped while the stage speaks or thinks, it interrupts and
 * gives the floor back. Escape leaves the mode entirely. The close control is
 * a quiet round button in the corner -- never the primary, because leaving is
 * not the thing this screen is for.
 */

/** The line of state at the top of the stage. */
const STAGE_LABEL = {
  connecting: 'Opening',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking',
  blocked: 'Microphone',
} as const

const TRANSPORT_LABEL = {
  listening: 'Take the turn',
  thinking: 'Interrupt',
  speaking: 'Interrupt',
} as const

const RIDGE_WIDTH = 320
const RIDGE_HEIGHT = 120
const RIDGE_SAMPLES = 64

export function VoiceModeOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const session = useVoiceSession(open)

  // Escape leaves the mode from anywhere, including while the transport is
  // disabled -- a mode you could not keyboard out of would be a trap with a
  // waveform in it. Bound to the document for the same reason the Dialog's
  // is: focus may be nowhere useful inside the stage.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  const transport =
    session.stage === 'listening' ? session.stopListening : session.interrupt
  const transportReady = session.stage in TRANSPORT_LABEL

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          role="dialog"
          aria-modal
          aria-label="Voice mode"
          initial={{ opacity: 0, scale: 0.985 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.99, transition: { duration: DURATION.base, ease: EASE_OUT } }}
          transition={{ duration: DURATION.slow, ease: EASE_OUT }}
          className="absolute inset-0 z-50 flex flex-col bg-surface"
        >
          {/* The strip's height again, so the close control sits where the
              window's other chrome sits and the stage has a headband of
              quiet above its first line. */}
          <header
            className="flex shrink-0 items-center justify-end"
            style={{ height: SHELL.topStrip.height, paddingInline: SHELL.topStrip.paddingInline }}
          >
            <IconButton label="Leave voice mode" size="md" onClick={onClose}>
              <Icons.close size="md" />
            </IconButton>
          </header>

          {/* Blocked is the one state with no ridge to watch and no transport
              to press, so it replaces the stage rather than decorating it. */}
          {session.stage === 'blocked' ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
              <p className="max-w-sm text-ui text-muted-foreground">
                {session.denied
                  ? 'The microphone is blocked. Allow it for Studio in Windows privacy settings, then try again.'
                  : 'No microphone is available right now.'}
              </p>
              <Button variant="secondary" size="sm" onClick={() => void session.retry()}>
                Try again
              </Button>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-7 px-6">
              {/* One line of state. The label swaps on a fast crossfade; the
                  dot under "Listening" pulses for exactly as long as the
                  microphone is actually open -- the same licence the thinking
                  sparkle runs on. */}
              <div className="flex h-4 items-center">
                <AnimatePresence initial={false} mode="popLayout">
                  <motion.span
                    key={session.stage}
                    initial={{ opacity: 0, y: 3 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -3 }}
                    transition={{ duration: DURATION.fast, ease: EASE_OUT }}
                    className="flex items-center gap-2 text-micro text-muted-foreground"
                  >
                    {session.stage === 'listening' ? (
                      <motion.span
                        aria-hidden
                        className="size-1.5 rounded-full bg-foreground"
                        animate={{ opacity: [1, 0.3, 1] }}
                        transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
                      />
                    ) : null}
                    {STAGE_LABEL[session.stage]}
                  </motion.span>
                </AnimatePresence>
              </div>

              <VoiceRidge session={session} />

              {/* The words. Reserved height so the ridge does not shift as
                  lines come and go; the display voice because a spoken reply
                  is the one statement this screen makes. */}
              <div className="flex min-h-28 w-full max-w-[34rem] items-start justify-center">
                <AnimatePresence initial={false} mode="wait">
                  {session.stage === 'listening' ? (
                    session.spoken.length === 0 ? (
                      <motion.p
                        key="hint"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: DURATION.base, ease: EASE_OUT }}
                        className="text-center text-caption text-muted-foreground"
                      >
                        Talk, then pause — the silence ends the turn.
                      </motion.p>
                    ) : null
                  ) : session.stage === 'speaking' ? (
                    <motion.p
                      key={`reply-${session.turn}`}
                      aria-live="polite"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: DURATION.base, ease: EASE_OUT }}
                      className="studio-display text-balance text-center text-foreground"
                    >
                      {session.spoken.map((word, index) => (
                        <motion.span
                          key={index}
                          className="inline-block"
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: DURATION.base, ease: EASE_OUT }}
                        >
                          {word}
                        </motion.span>
                      ))}
                    </motion.p>
                  ) : null}
                </AnimatePresence>
              </div>

              {/* The clock is the turn, not the session: it resets when the
                  floor changes hands, which is the interval a speaker
                  actually cares about. */}
              <div className="flex h-4 items-center">
                <AnimatePresence initial={false}>
                  {session.stage === 'listening' ? (
                    <motion.span
                      key="clock"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: DURATION.fast, ease: EASE_OUT }}
                      className="tabular-nums text-caption text-muted-foreground"
                    >
                      {formatClock(session.elapsedMs)}
                    </motion.span>
                  ) : null}
                </AnimatePresence>
              </div>
            </div>
          )}

          <footer className="flex shrink-0 flex-col items-center gap-2.5 pb-8">
            {session.stage !== 'blocked' ? (
              <>
                {/* Bigger than a composer control and solid, because it is
                    the one control on the stage; a circle, like every
                    icon-only control in the app. */}
                <IconButton
                  label={TRANSPORT_LABEL[session.stage as keyof typeof TRANSPORT_LABEL] ?? 'Interrupt'}
                  size="lg"
                  tone="solid"
                  className="size-11"
                  disabled={!transportReady}
                  onClick={transport}
                >
                  <Icons.stop size="md" />
                </IconButton>
                <span className="text-micro text-muted-foreground/70">Esc to leave</span>
              </>
            ) : null}
          </footer>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

/**
 * The ridge: the stage's continuous line, drawn from the level history.
 *
 * One frame loop, one buffer, one path -- and the source of the signal
 * changes with the session while all three persist:
 *
 *   listening   the microphone's measured level. Real, always; silence draws
 *               a hairline, because that is what silence is.
 *   thinking    the pulse from `waveform.ts`. Barely above the hairline: the
 *               one state with nothing to measure gets the quietest shape.
 *   speaking    the envelope. Synthesised, and contained -- see its note in
 *               `waveform.ts`; a real voice swaps the source and nothing else.
 *
 * Because the buffer survives the transitions, the line morphs from one
 * source into the next instead of being redrawn -- the collapse from speech
 * to thought reads as settling, not switching.
 *
 * Like the composer's bars, this writes the path directly from the frame
 * loop; the session's React state changes four or five times a minute, and
 * none of those renders should be carrying a waveform.
 */
function VoiceRidge({ session }: { session: ReturnType<typeof useVoiceSession> }) {
  const path = useRef<SVGPathElement>(null)
  const history = useRef(new LevelHistory(RIDGE_SAMPLES))
  const level = useRef(0)
  const reduced = useMemo(() => prefersReducedMotion(), [])

  useEffect(() => session.mic.onFrame((value) => {
    level.current = value
  }), [session.mic])

  useEffect(() => {
    let frame = 0
    const startedAt = performance.now()

    const step = (now: number) => {
      const seconds = (now - startedAt) / 1000
      switch (session.stage) {
        case 'listening':
          history.current.push(level.current)
          break
        case 'speaking':
          history.current.push(reduced ? 0.32 : speakingEnvelope(seconds, session.turn))
          break
        case 'thinking':
          history.current.push(reduced ? 0.05 : thinkingPulse(seconds))
          break
        default:
          history.current.push(0.02)
      }
      path.current?.setAttribute('d', ridgePath(history.current, RIDGE_WIDTH, RIDGE_HEIGHT))
      frame = requestAnimationFrame(step)
    }

    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
    // The stage and turn are read per frame on purpose: restarting the loop
    // on every word would reset the clock the envelopes are driven by.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced])

  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${RIDGE_WIDTH} ${RIDGE_HEIGHT}`}
      preserveAspectRatio="none"
      className="h-[120px] w-full max-w-[34rem]"
    >
      <path
        ref={path}
        fill="var(--foreground)"
        fillOpacity={0.09}
        stroke="var(--foreground)"
        strokeOpacity={0.35}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
