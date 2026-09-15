import { useCallback, useEffect, useRef, useState } from 'react'
import { useMicInput } from '@/features/voice/useMicInput'

/**
 * The voice session, as a state machine.
 *
 *   connecting   the stage is open, permission is being asked for.
 *   listening    the mic is live; the ridge shows the real level, the clock
 *                runs, and silence-detection watches for the end of a turn.
 *   thinking     the turn has been taken; the ridge settles to its pulse.
 *   speaking     the reply is being delivered, word by word.
 *   blocked      the mic never opened. Stated, retryable, never fatal.
 *
 * ---- How a turn ends -------------------------------------------------------
 *
 * Two ways, and both are real inputs: the listener taps the transport, or the
 * microphone goes quiet. The second is voice-detection over the same measured
 * level the ridge draws — speech must be confirmed (a sustained level above
 * the speech threshold) before silence can end anything, so a stage opened
 * into a quiet room never fires by itself, and only silence *after* speech
 * advances. There is no timer-only fallback, because a timeout that ends a
 * turn nobody started is the fake effect this feature refuses.
 *
 * ---- The loop, and where it is honest --------------------------------------
 *
 * listening and thinking are entirely real. The reply spoken in `speaking`
 * is a stand-in — no model and no voice exist behind this app yet — and the
 * loop turns regardless, because the point of the stage is that the states,
 * the hand-offs and the interruptions all behave today. When a transport
 * arrives, `speaking` starts consuming real tokens and real audio level and
 * everything around it stays as it is.
 */

export type VoiceStage = 'connecting' | 'listening' | 'thinking' | 'speaking' | 'blocked'

/** Speech is confirmed after this much time above the speech threshold. */
const CONFIRM_SPEECH_MS = 320
/** Silence ends a turn only once speech was confirmed. */
const END_SILENCE_MS = 1900
const SPEECH_LEVEL = 0.085
const SILENCE_LEVEL = 0.05

/** The thinking pause: short enough not to patronise, long enough to read. */
const THINK_MIN_MS = 550
const THINK_JITTER_MS = 450

/** Spoken pace. Words at reading speed, punctuation held a little longer. */
const WORD_PACE_MS = 290
const PUNCT_PAUSE_MS = 260

/** What the stage says while the real voice does not exist yet. */
const REPLIES = [
  'Voice mode is listening — the states, the silence and the interruptions are all real; these words are the last piece to arrive.',
  'I hold the floor until you tap. Interrupt me mid-sentence and I will hand it straight back.',
  'That pause was you, ending the turn. The clock you watched was the turn, measured.',
]

export function useVoiceSession(active: boolean) {
  const [stage, setStage] = useState<VoiceStage>('connecting')
  const [elapsedMs, setElapsedMs] = useState(0)
  const [turn, setTurn] = useState(0)
  const [spoken, setSpoken] = useState<string[]>([])
  const [denied, setDenied] = useState(false)
  const mic = useMicInput()

  const timers = useRef<number[]>([])
  const clock = useRef<number | null>(null)
  const stageRef = useRef<VoiceStage>('connecting')
  stageRef.current = stage

  const schedule = useCallback((fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms))
  }, [])

  const clearRun = useCallback(() => {
    for (const id of timers.current) window.clearTimeout(id)
    timers.current = []
    if (clock.current !== null) window.clearInterval(clock.current)
    clock.current = null
  }, [])

  const beginListening = useCallback(() => {
    clearRun()
    setSpoken([])
    setElapsedMs(0)
    setStage('listening')
    const startedAt = performance.now()
    clock.current = window.setInterval(() => {
      setElapsedMs(performance.now() - startedAt)
    }, 250)
  }, [clearRun])

  const beginThinking = useCallback(() => {
    clearRun()
    setStage('thinking')
    // The modulo cannot leave the array, and the first line is a truthful
    // stand-in if it ever somehow did -- neither of which an assertion says.
    const words = (REPLIES[turn % REPLIES.length] ?? REPLIES[0] ?? '').split(' ')
    schedule(() => {
      setStage('speaking')
      // The words arrive on a cadence, not in a batch: this is the pace a
      // spoken reply actually delivers itself at, which is the whole
      // difference between a line being shown and a line being said.
      let at = 120
      for (const word of words) {
        at += WORD_PACE_MS + (/[,.!?—]$/.test(word) ? PUNCT_PAUSE_MS : 0)
        schedule(() => setSpoken((current) => [...current, word]), at)
      }
      schedule(() => {
        setTurn((current) => current + 1)
        beginListening()
      }, at + 800)
    }, THINK_MIN_MS + Math.random() * THINK_JITTER_MS)
  }, [beginListening, clearRun, schedule, turn])

  /** The transport, in listening: take the turn now, by hand. */
  const stopListening = useCallback(() => {
    if (stageRef.current !== 'listening') return
    beginThinking()
  }, [beginThinking])

  /** The transport, in speaking or thinking: the floor returns to the user. */
  const interrupt = useCallback(() => {
    if (stageRef.current !== 'speaking' && stageRef.current !== 'thinking') return
    // An interrupted turn does not advance the reply cycle: the user is
    // about to say the thing that replaces it.
    beginListening()
  }, [beginListening])

  /** From blocked: ask again. Permission may have been granted meanwhile. */
  const retry = useCallback(async () => {
    const live = await mic.start()
    if (live) beginListening()
    else setDenied(mic.status === 'denied')
  }, [beginListening, mic])

  // Open and close with the stage.
  useEffect(() => {
    if (!active) {
      clearRun()
      void mic.stop()
      setStage('connecting')
      setTurn(0)
      setSpoken([])
      setDenied(false)
      return
    }
    let cancelled = false
    void mic.start().then((live) => {
      if (cancelled) return
      if (live) beginListening()
      else {
        setDenied(mic.status === 'denied')
        setStage('blocked')
      }
    })
    return () => {
      cancelled = true
    }
    // `mic` is a fresh object each render but its members are stable; the
    // effect is meant to run on open and close, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  // Silence-detection, over the measured level. Runs only while listening,
  // and reads the stage through a ref so the subscription itself is stable.
  useEffect(() => {
    if (stage !== 'listening') return
    let speechMs = 0
    let silenceMs = 0
    return mic.onFrame((level, dtMs) => {
      if (level >= SPEECH_LEVEL) {
        speechMs += dtMs
        silenceMs = 0
      } else if (level < SILENCE_LEVEL) {
        silenceMs += dtMs
      }
      if (speechMs >= CONFIRM_SPEECH_MS && silenceMs >= END_SILENCE_MS) {
        speechMs = 0
        silenceMs = 0
        beginThinking()
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, mic.onFrame, beginThinking])

  useEffect(() => clearRun, [clearRun])

  return { stage, elapsedMs, turn, spoken, denied, stopListening, interrupt, retry, mic }
}
