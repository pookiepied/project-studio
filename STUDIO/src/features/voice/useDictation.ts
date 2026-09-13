import { useCallback, useEffect, useRef, useState } from 'react'
import { createSegmentPipeline, type SegmentPipeline } from '@/features/voice/segmentPipeline'
import { useMicInput, type VoiceNote } from '@/features/voice/useMicInput'
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
 * The words arrive while the person is still speaking. The microphone cuts
 * the take into segments at its pauses (`segments.ts`), each is transcribed
 * as it is cut, and the pipeline (`segmentPipeline.ts`) delivers the text in
 * speaking order - so `recording` is also when text lands, and `processing`
 * is only the last segment's wait. `transcript` is what has landed in this
 * take, for the strip to show while the field is out of sight.
 *
 * Two exits from recording, and they are different actions on purpose: stop
 * keeps the recording and processes it; Escape discards. A user who fumbles
 * the keyboard must not find a sentence they did not say sitting in the field.
 * With text arriving live, Escape discards what has not landed yet - a
 * sentence already in the field was said, and stays.
 */

export type DictationStage = 'idle' | 'requesting' | 'recording' | 'processing' | 'blocked'

/** How long the blocked message holds the field before restoring it. */
const BLOCKED_DISMISS_MS = 2800

export function useDictation({ onText }: { onText: (text: string) => void }) {
  const [stage, setStage] = useState<DictationStage>('idle')
  const [elapsedMs, setElapsedMs] = useState(0)
  const [denied, setDenied] = useState(false)
  /**
   * A sentence from the transcriber, held for the strip's blocked face: the
   * mic worked, the words did not come back. Same self-clearing rhythm as
   * `denied`, because both are one-line facts, not dialogs.
   */
  const [note, setNote] = useState<string | null>(null)
  /** What this take has put in the field so far. */
  const [transcript, setTranscript] = useState('')
  const mic = useMicInput()
  const pipeline = useRef<SegmentPipeline | null>(null)

  const clock = useRef<number | null>(null)
  const startedAt = useRef(0)
  const dismissing = useRef<number | null>(null)

  const clearTimers = useCallback(() => {
    if (clock.current !== null) window.clearInterval(clock.current)
    if (dismissing.current !== null) window.clearTimeout(dismissing.current)
    clock.current = null
    dismissing.current = null
  }, [])

  /** Ends the take on the transcriber's word, once; later segments are dropped. */
  const fail = useCallback(
    (sentence: string) => {
      clearTimers()
      pipeline.current?.abandon()
      pipeline.current = null
      mic.stop()
      setNote(sentence)
      setStage('blocked')
      dismissing.current = window.setTimeout(() => setStage('idle'), BLOCKED_DISMISS_MS)
    },
    [clearTimers, mic],
  )

  const start = useCallback(async () => {
    if (stage !== 'idle' && stage !== 'blocked') return
    setNote(null)
    setTranscript('')
    setStage('requesting')
    const line = createSegmentPipeline({
      transcribe: (segment) => transcribeRecording(segment, { segment: true }),
      onText: (text) => {
        onText(text)
        setTranscript((current) => (current === '' ? text : `${current} ${text}`))
      },
      onFailure: (sentence) => fail(sentence),
    })
    pipeline.current = line
    const live = await mic.start({ record: true, onSegment: (segment: VoiceNote) => line.push(segment) })
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
  }, [fail, mic, onText, stage])

  /** Stop and keep: the last segment joins the ones already transcribed. */
  const stop = useCallback(async () => {
    if (stage !== 'recording') return
    clearTimers()
    const line = pipeline.current
    const note = await new Promise<ReturnType<typeof mic.takeNote>>((resolve) => {
      mic.stop()
      // The recorder assembles its blob in `onstop`, one tick after `stop()`
      // returns. The take happens after that turn of the event loop.
      window.setTimeout(() => resolve(mic.takeNote()), 0)
    })

    setStage('processing')
    // The last segment goes through the same door as the others, so it
    // lands after them; then the pipeline is drained, and what it says about
    // the whole take decides the close.
    if (note !== null) line?.push(note)
    const delivered = (await line?.finish()) ?? false
    if (pipeline.current !== line) return // the take was ended by a failure meanwhile
    pipeline.current = null
    if (!delivered) {
      setNote('Nothing intelligible came back - try again, a little closer to the mic')
      setStage('blocked')
      dismissing.current = window.setTimeout(() => setStage('idle'), BLOCKED_DISMISS_MS)
      return
    }
    setStage('idle')
  }, [clearTimers, mic, stage])

  /** Stop and discard what has not landed. */
  const cancel = useCallback(() => {
    if (stage !== 'recording') return
    clearTimers()
    pipeline.current?.abandon()
    pipeline.current = null
    mic.stop()
    setStage('idle')
  }, [clearTimers, mic, stage])

  // Escape means discard, not stop-and-process. It is bound to the document
  // because the field is hidden while recording, so focus is nowhere useful
  // to bind it to — the same reasoning as the Dialog's Escape.
  useEffect(() => {
    if (stage !== 'recording') return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [cancel, stage])

  useEffect(() => clearTimers, [clearTimers])

  return { stage, elapsedMs, denied, note, transcript, start, stop, cancel, mic }
}
