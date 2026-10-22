import type { SpeechOutcome } from './speak'
import { splitPassages } from './passages'

/**
 * One message read aloud, passage by passage.
 *
 * The provider renders a whole request before it answers a byte, and the
 * desktop seam hands the answer over whole, so a message sent as one request
 * is silent until every word of it has been rendered - a long answer used to
 * sit behind a working pill for the length of that render and then, when
 * the render outran the budget, drop back to a plain button. This reads the
 * message as the passages `splitPassages` cuts, and keeps exactly one
 * request in flight ahead of the passage being played: the first sound is
 * one short render away, and each next passage is usually rendered before
 * the current one has finished sounding.
 *
 * One request ahead, not all of them at once: the provider is metered per
 * character, and a person who stops after two sentences should not have
 * paid for twenty. The cost of stopping is at most the passage already in
 * flight, whose answer is discarded when it comes.
 *
 * The playback surface is a sink the caller provides. Production hands in
 * the Web Audio one (`webAudioSink.ts`), which is what makes the passages
 * join without a gap; a test hands in a recorder. Nothing here knows how
 * sound is made, which is also why this file has no `window` in it.
 */

export type NarrationStage = 'loading' | 'playing' | 'paused' | 'done' | 'failed'

export interface NarrationState {
  readonly stage: NarrationStage
  /** The sentence a `failed` stage shows; absent on every other stage. */
  readonly note?: string
}

/** One rendered passage, as the harness hands it over. */
export interface Clip {
  readonly audio: string
  readonly mimeType: string
}

/**
 * Where the clips go to become sound. `enqueue` settles once the clip is
 * decoded and scheduled after whatever is already queued, and rejects when
 * the bytes are not audio the platform can decode. `finish` says no more
 * clips are coming, so the sink can tell the end of the last one from a
 * pause between two.
 */
export interface AudioSink {
  enqueue(clip: Clip, onPlayed?: () => void): Promise<void>
  finish(): void
  pause(): void
  resume(): void
  close(): void
  /** Silences or restores playback without stopping it; optional for sinks that cannot. */
  setMuted?(muted: boolean): void
}

export interface NarrationOptions {
  readonly text: string
  /** One passage to the provider; `speakText` in production. */
  readonly speak: (text: string) => Promise<SpeechOutcome>
  /** Opens the sink; `onEnded` fires once the last queued clip has sounded. */
  readonly openSink: (onEnded: () => void) => AudioSink
  readonly onChange: (state: NarrationState) => void
}

export interface Narration {
  pause(): void
  resume(): void
  /** Stops the sound and the requests. Silent: the caller decides what the stop looks like. */
  stop(): void
}

export function narrate(options: NarrationOptions): Narration {
  const { speak, onChange } = options
  const passages = splitPassages(options.text)
  let stopped = false
  let paused = false
  let sink: AudioSink | null = null

  const settle = (state: NarrationState): void => {
    if (stopped) return
    stopped = true
    sink?.close()
    sink = null
    onChange(state)
  }

  sink = options.openSink(() => settle({ stage: 'done' }))
  onChange({ stage: 'loading' })

  const run = async (): Promise<void> => {
    // `ahead` is the request for the passage after the one being handled,
    // started before that one is decoded so the two overlap. The answer to
    // a request in flight when `stop` lands is simply never read.
    let ahead: Promise<SpeechOutcome> | null = passages.length === 0 ? null : speak(passages[0] ?? '')
    for (let at = 0; at < passages.length; at += 1) {
      const outcome = await ahead
      if (stopped || outcome === null) return
      const next = passages[at + 1]
      ahead = next === undefined ? null : speak(next)
      if (outcome.kind === 'note') {
        settle({ stage: 'failed', note: outcome.note })
        return
      }
      try {
        await sink?.enqueue(outcome)
      } catch {
        settle({ stage: 'failed', note: 'The speech provider returned audio this device cannot play' })
        return
      }
      if (stopped) return
      if (at === 0) onChange({ stage: paused ? 'paused' : 'playing' })
    }
    if (passages.length === 0) {
      settle({ stage: 'done' })
      return
    }
    sink?.finish()
  }
  void run()

  return {
    pause() {
      if (stopped || sink === null) return
      paused = true
      sink.pause()
      onChange({ stage: 'paused' })
    },
    resume() {
      if (stopped || sink === null) return
      paused = false
      sink.resume()
      onChange({ stage: 'playing' })
    },
    stop() {
      if (stopped) return
      stopped = true
      sink?.close()
      sink = null
    },
  }
}
