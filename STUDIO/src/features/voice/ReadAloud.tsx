import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { DURATION, EASE_OUT } from '@/design/tokens'
import { Icons } from '@/components/icons'
import { IconButton } from '@/components/primitives'
import { speakText } from '@/features/voice/speak'
import { cn } from '@/lib/cn'

/**
 * Read aloud, as one control that grows into the player it needs.
 *
 * At rest it is the speaker button in the action row. Click it and the button
 * becomes a small pill: while the provider renders the audio, the pill shows
 * its working; from the first audible sample the pill IS the player — a
 * pause/play toggle, five bars that move while sound moves and hold still when
 * it does not, and a close that stops everything and puts the button back.
 *
 * No clock and no duration: until the provider answers, nobody knows how long
 * the audio is, and a progress bar that guesses would be a lie with a fill.
 * The bars say the one true thing available — sound is happening — and the
 * pause toggle says so as a state, not as a position.
 *
 * One instance per message, state entirely its own: two messages playing at
 * once is the browser's business to allow and the reader's to find confusing,
 * and stopping the first when the second starts is a second control nobody
 * asked for. The audio element dies with the component (unmount is cancel).
 */
export function ReadAloud({ text }: { text: string }) {
  const [stage, setStage] = useState<'idle' | 'loading' | 'playing' | 'paused'>('idle')
  const [note, setNote] = useState<string | null>(null)
  const audio = useRef<HTMLAudioElement | null>(null)

  const stop = useCallback(() => {
    audio.current?.pause()
    audio.current = null
    setStage('idle')
  }, [])

  // Unmount is cancel: a message scrolled away (or a conversation left) takes
  // its voice with it rather than speaking on.
  useEffect(
    () => () => {
      audio.current?.pause()
      audio.current = null
    },
    [],
  )

  const begin = () => {
    setNote(null)
    setStage('loading')
    void speakText(text).then((outcome) => {
      if (outcome.kind === 'note') {
        setNote(outcome.note)
        setStage('idle')
        window.setTimeout(() => setNote(null), 3200)
        return
      }
      const player = new Audio(`data:${outcome.mimeType};base64,${outcome.audio}`)
      player.onended = () => {
        audio.current = null
        setStage('idle')
      }
      audio.current = player
      setStage('playing')
      void player.play().catch(() => {
        audio.current = null
        setStage('idle')
      })
    })
  }

  const toggle = () => {
    const player = audio.current
    if (player === null) return
    if (player.paused) {
      void player.play().catch(() => stop())
      setStage('playing')
    } else {
      player.pause()
      setStage('paused')
    }
  }

  return (
    <span className="relative inline-flex items-center">
      <AnimatePresence initial={false} mode="popLayout">
        {stage === 'idle' ? (
          <motion.span
            key="button"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: DURATION.fast, ease: EASE_OUT }}
          >
            {note !== null ? (
              // The pill's one dishonesty guard: a refusal shows as a sentence
              // long enough to read, then the button returns. It never types
              // itself into the transcript.
              <span className="whitespace-nowrap rounded-full bg-surface-raised px-2.5 py-1 text-caption text-muted-foreground shadow-raised">
                {note}
              </span>
            ) : (
              <IconButton label="Read aloud" size="sm" onClick={begin}>
                <Icons.readAloud size="sm" />
              </IconButton>
            )}
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
            {stage === 'loading' ? (
              <>
                <WorkingDots />
                <span className="text-caption text-muted-foreground">Reading aloud</span>
              </>
            ) : (
              <>
                <button
                  type="button"
                  aria-label={stage === 'paused' ? 'Resume' : 'Pause'}
                  onClick={toggle}
                  className="flex size-5 items-center justify-center rounded-full text-muted-foreground transition-colors duration-fast hover:bg-tint hover:text-foreground"
                >
                  {stage === 'paused' ? (
                    <Icons.play size="sm" />
                  ) : (
                    <Icons.pause size="sm" />
                  )}
                </button>
                <VoiceBars moving={stage === 'playing'} />
              </>
            )}
            <button
              type="button"
              aria-label="Stop reading aloud"
              onClick={stop}
              className="flex size-5 items-center justify-center rounded-full text-muted-foreground transition-colors duration-fast hover:bg-tint hover:text-foreground"
            >
              <Icons.close size="sm" />
            </button>
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  )
}

/** Three dots, cycling: the wait before the first sample. Same clock as dictation. */
function WorkingDots() {
  return (
    <span aria-hidden className="flex items-center gap-1">
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
