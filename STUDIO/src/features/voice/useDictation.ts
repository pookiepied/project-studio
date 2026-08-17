import { useCallback, useEffect, useRef, useState } from 'react'
import { useMicInput } from '@/features/voice/useMicInput'
import { transcribeRecording } from '@/features/voice/transcribe'

/**
 * Dictation, as a lifecycle.
 *
 *   idle        the field is a field.
 *   requesting  permission is being asked for; the button waits.
 *   recording   the mic is live, the strip shows the real level and the clock.
 *   processing  the recording has been handed to the transcriber.
 *   blocked     the mic was refused or is missing; the strip says which, then
 *               lets the field return on its own.
 *
 * Two exits from recording, and they are different actions on purpose: stop
 * keeps the recording and processes it; Escape discards. A user who fumbles
 * the keyboard must not find a sentence they did not say sitting in the field.
 */

export type DictationStage = 'idle' | 'requesting' | 'recording' | 'processing' | 'blocked'

/** How long the blocked message holds the field before restoring it. */
const BLOCKED_DISMISS_MS = 2800

export function useDictation({ onText }: { onText: (text: string) => void }) {
  const [stage, setStage] = useState<DictationStage>('idle')
  const [elapsedMs, setElapsedMs] = useState(0)
  const [denied, setDenied] = useState(false)
  const mic = useMicInput()

  const clock = useRef<number | null>(null)
  const startedAt = useRef(0)
  const dismissing = useRef<number | null>(null)

  const clearTimers = useCallback(() => {
    if (clock.current !== null) window.clearInterval(clock.current)
    if (dismissing.current !== null) window.clearTimeout(dismissing.current)
    clock.current = null
    dismissing.current = null
  }, [])

  const start = useCallback(async () => {
    if (stage !== 'idle' && stage !== 'blocked') return
    setStage('requesting')
    const live = await mic.start({ record: true })
    if (!live) {
      setDenied(mic.status === 'denied')
      setStage('blocked')
      dismissing.current = window.setTimeout(() => setStage('idle'), BLOCKED_DISMISS_MS)
      return
    }
    startedAt.current = performance.now()
    setElapsedMs(0)
    setStage('recording')
    clock.current = window.setInterval(() => {
      setElapsedMs(performance.now() - startedAt.current)
    }, 200)
  }, [mic, stage])

  /** Stop and keep: the recording is transcribed into the field. */
  const stop = useCallback(async () => {
    if (stage !== 'recording') return
    clearTimers()
    const note = await new Promise<ReturnType<typeof mic.takeNote>>((resolve) => {
      mic.stop()
      // The recorder assembles its blob in `onstop`, one tick after `stop()`
      // returns. The take happens after that turn of the event loop.
      window.setTimeout(() => resolve(mic.takeNote()), 0)
    })

    setStage('processing')
    const text = note ? await transcribeRecording(note) : ''
    if (text) onText(text)
    setStage('idle')
  }, [clearTimers, mic, onText, stage])

  /** Stop and discard. Nothing reaches the field. */
  const cancel = useCallback(() => {
    if (stage !== 'recording') return
    clearTimers()
    mic.stop()
    setStage('idle')
  }, [clearTimers, mic, stage])

  // Escape means discard, not stop-and-process. It is bound to the document
  // because the field is hidden while recording, so focus is nowhere useful
  // to bind it to -- the same reasoning as the Dialog's Escape.
  useEffect(() => {
    if (stage !== 'recording') return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [cancel, stage])

  useEffect(() => clearTimers, [clearTimers])

  return { stage, elapsedMs, denied, start, stop, cancel, mic }
}
