import { describe, expect, it, vi } from 'vitest'

import { createSegmentPipeline } from './segmentPipeline'
import type { TranscriptionOutcome } from './transcribe'
import type { VoiceNote } from './useMicInput'

/**
 * The pipeline, against a stand-in transcriber whose answers can be held
 * and released in any order. What is pinned: the field receives text in
 * speaking order however the vendor answers; an empty segment is nothing,
 * not a failure; a failing segment ends the take once and drops the rest;
 * abandoning drops what has not landed and keeps what has.
 */

function note(label: string): VoiceNote {
  return { blob: new Blob([label]), durationMs: 1_000 }
}

/** A transcriber whose every answer waits until the test releases it by label. */
function heldTranscriber() {
  const pending = new Map<string, (outcome: TranscriptionOutcome) => void>()
  const transcribe = async (segment: VoiceNote): Promise<TranscriptionOutcome> => {
    const label = await segment.blob?.text()
    return new Promise((resolve) => pending.set(label ?? '', resolve))
  }
  const release = (label: string, outcome: TranscriptionOutcome) => {
    const resolve = pending.get(label)
    if (resolve === undefined) throw new Error(`nothing pending for ${label}`)
    pending.delete(label)
    resolve(outcome)
  }
  return { transcribe, release }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('the segment pipeline', () => {
  it('delivers in speaking order when the transcriber answers out of it', async () => {
    const { transcribe, release } = heldTranscriber()
    const onText = vi.fn()
    const line = createSegmentPipeline({ transcribe, onText, onFailure: vi.fn() })

    line.push(note('one'))
    line.push(note('two'))
    line.push(note('three'))
    await settle()

    release('three', { kind: 'ok', text: 'Third.' })
    release('two', { kind: 'ok', text: 'Second.' })
    await settle()
    // Nothing lands while the first is still out: order is the contract.
    expect(onText).not.toHaveBeenCalled()

    release('one', { kind: 'ok', text: 'First.' })
    const delivered = await line.finish()
    expect(onText.mock.calls.map(([text]) => text)).toEqual(['First.', 'Second.', 'Third.'])
    expect(delivered).toBe(true)
  })

  it('treats an empty segment as nothing, and says so only when the whole take was nothing', async () => {
    const { transcribe, release } = heldTranscriber()
    const onText = vi.fn()
    const onFailure = vi.fn()
    const line = createSegmentPipeline({ transcribe, onText, onFailure })

    line.push(note('cough'))
    await settle()
    release('cough', { kind: 'ok', text: '' })
    expect(await line.finish()).toBe(false)
    expect(onText).not.toHaveBeenCalled()
    expect(onFailure).not.toHaveBeenCalled()
  })

  it('ends the take once on a failing segment and drops the ones behind it', async () => {
    const { transcribe, release } = heldTranscriber()
    const onText = vi.fn()
    const onFailure = vi.fn()
    const line = createSegmentPipeline({ transcribe, onText, onFailure })

    line.push(note('a'))
    line.push(note('b'))
    line.push(note('c'))
    await settle()
    release('a', { kind: 'ok', text: 'Fine.' })
    release('b', { kind: 'note', note: 'No transcription model is connected' })
    release('c', { kind: 'note', note: 'No transcription model is connected' })
    await line.finish()

    expect(onText.mock.calls.map(([text]) => text)).toEqual(['Fine.'])
    expect(onFailure).toHaveBeenCalledTimes(1)
    expect(onFailure).toHaveBeenCalledWith('No transcription model is connected')
    // Nothing more is taken after a failure.
    line.push(note('d'))
    await settle()
    expect(() => release('d', { kind: 'ok', text: 'x' })).toThrow(/nothing pending/)
  })

  it('abandons what has not landed and keeps what has', async () => {
    const { transcribe, release } = heldTranscriber()
    const onText = vi.fn()
    const line = createSegmentPipeline({ transcribe, onText, onFailure: vi.fn() })

    line.push(note('said'))
    line.push(note('unsaid'))
    await settle()
    release('said', { kind: 'ok', text: 'Said.' })
    await settle()
    line.abandon()
    release('unsaid', { kind: 'ok', text: 'Never.' })
    await line.finish()

    expect(onText.mock.calls.map(([text]) => text)).toEqual(['Said.'])
  })

  it('reads a transcriber that throws as a failed take, not an unhandled rejection', async () => {
    const onFailure = vi.fn()
    const line = createSegmentPipeline({
      transcribe: () => Promise.reject(new Error('socket closed')),
      onText: vi.fn(),
      onFailure,
    })
    line.push(note('x'))
    await line.finish()
    expect(onFailure).toHaveBeenCalledWith('Dictation failed - try again')
  })
})
