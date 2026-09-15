/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { TranscriptionOutcome } from './transcribe'
import type { VoiceNote } from './useMicInput'

/**
 * A take, from the microphone's word to the field.
 *
 * The microphone and the transcriber are stand-ins here; `useDictation.test`
 * runs the real microphone against a stubbed `getUserMedia`. What is pinned
 * is the handling in between: the last segment is whatever the microphone
 * resolves `stop()` with, and a segment that fails after words have already
 * come back ends the take without losing those words. Both were true bugs
 * in a long take: a timer racing the recorder's flush dropped the last
 * sentence now and then, and one refused segment threw the minute before
 * it away.
 */

let onSegment: ((note: VoiceNote) => void) | null = null
let lastNote: VoiceNote | null = null
const micStop = vi.fn(() => Promise.resolve(lastNote))

vi.mock('@/features/voice/useMicInput', () => ({
  useMicInput: () => ({
    status: 'live',
    start: (options?: { onSegment?: (note: VoiceNote) => void }) => {
      onSegment = options?.onSegment ?? null
      return Promise.resolve(true)
    },
    stop: micStop,
    onFrame: () => () => {},
  }),
}))

const answers = new Map<string, TranscriptionOutcome>()
vi.mock('@/features/voice/transcribe', () => ({
  transcribeRecording: async (note: VoiceNote) => {
    const label = (await note.blob?.text()) ?? ''
    return answers.get(label) ?? { kind: 'ok', text: '' }
  },
}))

const { useDictation } = await import('./useDictation')

const note = (label: string): VoiceNote => ({ blob: new Blob([label]), durationMs: 1_500 })
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)))

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  vi.useRealTimers()
  answers.clear()
  onSegment = null
  lastNote = null
  micStop.mockClear()
})

describe('the last segment', () => {
  it('is what the microphone resolves stop with, and lands after the others', async () => {
    answers.set('first', { kind: 'ok', text: 'First sentence.' })
    answers.set('last', { kind: 'ok', text: 'Last sentence.' })
    const onTake = vi.fn()
    const { result } = renderHook(() => useDictation({ onTake }))

    await act(() => result.current.start())
    act(() => onSegment?.(note('first')))
    lastNote = note('last')
    await act(() => result.current.stop())
    await settle()

    expect(micStop).toHaveBeenCalledTimes(1)
    expect(onTake).toHaveBeenCalledWith('First sentence. Last sentence.')
    expect(result.current.stage).toBe('idle')
  })
})

describe('a segment that fails after words have come back', () => {
  it('ends the take with the note, then puts the words that came back in the field', async () => {
    answers.set('first', { kind: 'ok', text: 'What was said.' })
    answers.set('second', { kind: 'note', note: 'Dictation failed: the provider refused' })
    const onTake = vi.fn()
    const { result } = renderHook(() => useDictation({ onTake }))

    await act(() => result.current.start())
    act(() => onSegment?.(note('first')))
    await settle()
    act(() => onSegment?.(note('second')))
    await settle()

    // The take ended on the transcriber's word, and the field has not
    // changed yet: the note is what the strip shows.
    expect(result.current.stage).toBe('blocked')
    expect(result.current.note).toBe('Dictation failed: the provider refused')
    expect(micStop).toHaveBeenCalledTimes(1)
    expect(onTake).not.toHaveBeenCalled()

    // The hold ends: the words that were said go to the field with it.
    await act(() => vi.advanceTimersByTimeAsync(9_000))
    expect(onTake).toHaveBeenCalledWith('What was said.')
    expect(result.current.stage).toBe('idle')
  })

  it('hands the words over at once when a new take starts during the hold', async () => {
    answers.set('first', { kind: 'ok', text: 'Kept.' })
    answers.set('second', { kind: 'note', note: 'Dictation failed: the provider refused' })
    const onTake = vi.fn()
    const { result } = renderHook(() => useDictation({ onTake }))

    await act(() => result.current.start())
    act(() => onSegment?.(note('first')))
    await settle()
    act(() => onSegment?.(note('second')))
    await settle()
    expect(result.current.stage).toBe('blocked')

    await act(() => result.current.start())
    expect(onTake).toHaveBeenCalledTimes(1)
    expect(onTake).toHaveBeenCalledWith('Kept.')
    expect(result.current.stage).toBe('recording')

    // The old hold is over; it does not fire into the new take.
    await act(() => vi.advanceTimersByTimeAsync(9_000))
    expect(onTake).toHaveBeenCalledTimes(1)
    expect(result.current.stage).toBe('recording')
  })
})
