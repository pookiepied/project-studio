import { describe, expect, it } from 'vitest'

import { narrate, type AudioSink, type Clip, type NarrationState } from './narration'
import { PASSAGE_CHARS } from './passages'
import type { SpeechOutcome } from './speak'

/**
 * The narration loop, over a scripted provider and a recording sink.
 *
 * What is pinned: the first passage plays before the second is rendered;
 * at most one request is in flight beyond the passage being played; a stop
 * ends the requests as well as the sound; a refusal ends the run in
 * `failed` with the provider's sentence; and the sink's last clip, not the
 * provider's last answer, is what ends the run in `done`.
 */

/** A provider whose answers are settled by the test, one per call, in order. */
function scriptedSpeak(): {
  speak: (text: string) => Promise<SpeechOutcome>
  calls: string[]
  answer: (outcome: SpeechOutcome) => void
} {
  const calls: string[] = []
  const pending: Array<(outcome: SpeechOutcome) => void> = []
  return {
    calls,
    speak: (text) => {
      calls.push(text)
      return new Promise<SpeechOutcome>((resolve) => {
        pending.push(resolve)
      })
    },
    answer: (outcome) => {
      const resolve = pending.shift()
      if (resolve === undefined) throw new Error('nothing is waiting for an answer')
      resolve(outcome)
    },
  }
}

function recordingSink(options: { decodes?: boolean } = {}): {
  open: (onEnded: () => void) => AudioSink
  clips: Clip[]
  calls: string[]
  end: () => void
} {
  const clips: Clip[] = []
  const calls: string[] = []
  let onEnded: () => void = () => {}
  return {
    clips,
    calls,
    end: () => onEnded(),
    open: (ended) => {
      onEnded = ended
      return {
        enqueue: (clip) => {
          if (options.decodes === false) return Promise.reject(new Error('not audio'))
          clips.push(clip)
          calls.push('enqueue')
          return Promise.resolve()
        },
        finish: () => calls.push('finish'),
        pause: () => calls.push('pause'),
        resume: () => calls.push('resume'),
        close: () => calls.push('close'),
      }
    },
  }
}

const clip = (n: number): SpeechOutcome => ({ kind: 'ok', audio: `clip-${String(n)}`, mimeType: 'audio/mpeg' })

/** Lets every settled promise in the loop run its continuation. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/** Three sentences long enough to become three passages. */
const THREE_PASSAGES = [
  `${'a'.repeat(200)}.`,
  `${'b'.repeat(PASSAGE_CHARS - 10)}.`,
  `${'c'.repeat(PASSAGE_CHARS - 10)}.`,
].join(' ')

describe('narrate', () => {
  it('plays the first passage before the second is rendered, one request ahead', async () => {
    const provider = scriptedSpeak()
    const sink = recordingSink()
    const states: NarrationState[] = []
    narrate({ text: THREE_PASSAGES, speak: provider.speak, openSink: sink.open, onChange: (s) => states.push(s) })

    expect(states).toEqual([{ stage: 'loading' }])
    expect(provider.calls).toHaveLength(1)

    provider.answer(clip(1))
    await settle()
    expect(sink.clips).toEqual([{ kind: 'ok', audio: 'clip-1', mimeType: 'audio/mpeg' }])
    expect(states.at(-1)).toEqual({ stage: 'playing' })
    // The second request went out the moment the first answered; the third waits.
    expect(provider.calls).toHaveLength(2)

    provider.answer(clip(2))
    await settle()
    expect(provider.calls).toHaveLength(3)
    expect(sink.clips).toHaveLength(2)

    provider.answer(clip(3))
    await settle()
    expect(sink.clips).toHaveLength(3)
    expect(sink.calls.at(-1)).toBe('finish')
    expect(states.at(-1)).toEqual({ stage: 'playing' })

    sink.end()
    expect(states.at(-1)).toEqual({ stage: 'done' })
    expect(sink.calls.at(-1)).toBe('close')
  })

  it('ends in failed with the provider sentence, and asks for nothing more', async () => {
    const provider = scriptedSpeak()
    const sink = recordingSink()
    const states: NarrationState[] = []
    narrate({ text: THREE_PASSAGES, speak: provider.speak, openSink: sink.open, onChange: (s) => states.push(s) })

    provider.answer({ kind: 'note', note: 'No read-aloud model is connected' })
    await settle()
    expect(states.at(-1)).toEqual({ stage: 'failed', note: 'No read-aloud model is connected' })
    expect(sink.calls).toEqual(['close'])
    // The lookahead for the second passage had already gone out; nothing after it does.
    expect(provider.calls).toHaveLength(2)
    provider.answer(clip(2))
    await settle()
    expect(provider.calls).toHaveLength(2)
    expect(sink.clips).toEqual([])
  })

  it('ends in failed when the bytes are not audio the sink can decode', async () => {
    const provider = scriptedSpeak()
    const sink = recordingSink({ decodes: false })
    const states: NarrationState[] = []
    narrate({ text: 'Hello there.', speak: provider.speak, openSink: sink.open, onChange: (s) => states.push(s) })

    provider.answer(clip(1))
    await settle()
    expect(states.at(-1)?.stage).toBe('failed')
    expect(states.at(-1)?.note).toMatch(/cannot play/)
  })

  it('stops the requests with the sound, and says nothing after', async () => {
    const provider = scriptedSpeak()
    const sink = recordingSink()
    const states: NarrationState[] = []
    const narration = narrate({
      text: THREE_PASSAGES,
      speak: provider.speak,
      openSink: sink.open,
      onChange: (s) => states.push(s),
    })

    provider.answer(clip(1))
    await settle()
    expect(provider.calls).toHaveLength(2)

    narration.stop()
    expect(sink.calls.at(-1)).toBe('close')
    const before = states.length

    provider.answer(clip(2))
    await settle()
    expect(provider.calls).toHaveLength(2)
    expect(sink.clips).toHaveLength(1)
    expect(states).toHaveLength(before)
    narration.pause()
    expect(states).toHaveLength(before)
  })

  it('pauses and resumes the sink, and a pause before the first sound holds', async () => {
    const provider = scriptedSpeak()
    const sink = recordingSink()
    const states: NarrationState[] = []
    const narration = narrate({
      text: 'Hello there.',
      speak: provider.speak,
      openSink: sink.open,
      onChange: (s) => states.push(s),
    })

    narration.pause()
    expect(states.at(-1)).toEqual({ stage: 'paused' })
    provider.answer(clip(1))
    await settle()
    expect(states.at(-1)).toEqual({ stage: 'paused' })

    narration.resume()
    expect(states.at(-1)).toEqual({ stage: 'playing' })
    expect(sink.calls).toEqual(['pause', 'enqueue', 'finish', 'resume'])
  })

  it('is done at once for a message with nothing to say', () => {
    const provider = scriptedSpeak()
    const sink = recordingSink()
    const states: NarrationState[] = []
    narrate({ text: '   ', speak: provider.speak, openSink: sink.open, onChange: (s) => states.push(s) })
    expect(provider.calls).toEqual([])
    expect(states.at(-1)).toEqual({ stage: 'done' })
  })
})

