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
 * speaking order. What lands during `recording` is `transcript` - the strip
 * shows its tail, so the person can see the transcriber keeping up - and
 * nothing else: the field is not written to until the take ends. Then the
 * whole passage goes to `onTake` once, and `processing` is only the last
 * segment's wait before that.
 *
 * The field used to receive each segment as it came back. That made a take
 * land in pieces, a sentence at a time, and each piece was a cut in a
 * textarea the person could not see; the passage then appeared already
 * complete when the field returned, so the pieces had bought nothing. One
 * delivery lets the field show the passage arriving (`TextLanding`).
 *
 * Two exits from recording, and they are different actions on purpose: stop
 * keeps the recording and processes it; Escape discards. A user who fumbles
 * the keyboard must not find a sentence they did not say sitting in the field
 * - and since nothing reaches the field before stop, Escape discards the
 * whole take.
 */

export type DictationStage = 'idle' | 'requesting' | 'recording' | 'processing' | 'blocked'

/** How long the blocked message holds the field before restoring it. */
const BLOCKED_DISMISS_MS = 2800

export function useDictation({ onTake }: { onTake: (text: string) => void }) {
  const [stage, setStage] = useState<DictationStage>('idle')
  const [elapsedMs, setElapsedMs] = useState(0)
  const [denied, setDenied] = useState(false)
  /**
   * A sentence from the transcriber, held for the strip's blocked face: the
   * mic worked, the words did not come back. Same self-clearing rhythm as
   * `denied`, because both are one-line facts, not dialogs.
   */
  const [note, setNote] = useState<string | null>(null)
  /** What this take has transcribed so far, for the strip; the field gets it at the end. */
  const [transcript, setTranscript] = useState('')
  /** The same words, readable from `stop` without waiting on a render. */
  const spoken = useRef('')
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
    spoken.current = ''
    setStage('requesting')
    const line = createSegmentPipeline({
      transcribe: (segment) => transcribeRecording(segment, { segment: true }),
      onText: (text) => {
        spoken.current = spoken.current === '' ? text : `${spoken.current} ${text}`
        setTranscript(spoken.current)
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
  }, [fail, mic, stage])

  /** Stop and keep: the last segment joins the others, and the whole take goes to the field. */
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
    // Delivered before the stage turns, so the composer sees the passage
    // and the end of the take in that order.
    onTake(spoken.current)
    setStage('idle')
  }, [clearTimers, mic, onTake, stage])

  /** Stop and discard the take; nothing of it reached the field. */
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
