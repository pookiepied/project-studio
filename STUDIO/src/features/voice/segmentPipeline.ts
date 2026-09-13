import type { TranscriptionOutcome } from '@/features/voice/transcribe'
import type { VoiceNote } from '@/features/voice/useMicInput'

/**
 * Segments in, sentences out, in the order they were spoken.
 *
 * Each segment is posted the moment it is cut, so several are usually in
 * flight at once, and a transcriber answers them in whatever order it likes.
 * The field must not: what was said first goes in first. So the pipeline
 * transcribes concurrently and delivers sequentially - each segment's text
 * waits for every earlier segment's to be delivered, then goes.
 *
 * Two ways out. `finish` waits for everything in flight and answers whether
 * any words at all were delivered, which is what decides between a quiet
 * close and "nothing intelligible came back". `abandon` drops everything not
 * yet delivered: a segment already in the field stays (it was said), one
 * still in flight never lands. A transcriber that fails - the harness down,
 * no model connected - ends the take through `onFailure`, once, with the
 * sentence the transcriber gave; later segments are abandoned with it.
 */

export interface SegmentPipelineOptions {
  readonly transcribe: (note: VoiceNote) => Promise<TranscriptionOutcome>
  readonly onText: (text: string) => void
  readonly onFailure: (note: string) => void
}

export interface SegmentPipeline {
  /** A cut segment. Returns at once; delivery happens in order, later. */
  push(note: VoiceNote): void
  /** Waits for every pushed segment. True when any text was delivered. */
  finish(): Promise<boolean>
  /** Drops whatever has not been delivered yet. */
  abandon(): void
}

export function createSegmentPipeline(options: SegmentPipelineOptions): SegmentPipeline {
  let tail: Promise<void> = Promise.resolve()
  let delivered = false
  let abandoned = false
  let failed = false

  return {
    push(note) {
      if (abandoned || failed) return
      // Transcription starts now, concurrently with whatever is in flight;
      // only the delivery is chained behind the previous segment's.
      const outcome = options.transcribe(note).catch(
        (): TranscriptionOutcome => ({ kind: 'note', note: 'Dictation failed - try again' }),
      )
      tail = tail.then(async () => {
        const answer = await outcome
        if (abandoned || failed) return
        if (answer.kind === 'ok') {
          if (answer.text !== '') {
            delivered = true
            options.onText(answer.text)
          }
          return
        }
        failed = true
        options.onFailure(answer.note)
      })
    },

    async finish() {
      await tail
      return delivered
    },

    abandon() {
      abandoned = true
    },
  }
}
