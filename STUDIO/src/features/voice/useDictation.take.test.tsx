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
/** The microphone's frame listener, so a test can say a voice was heard. */
let frame: ((level: number, dtMs: number, voiced: boolean) => void) | null = null
let lastNote: VoiceNote | null = null
const micStop = vi.fn(() => Promise.resolve(lastNote))
const setPaused = vi.fn()

vi.mock('@/features/voice/useMicInput', () => ({
  useMicInput: () => ({
    status: 'live',
    start: (options?: { onSegment?: (note: VoiceNote) => void }) => {
      onSegment = options?.onSegment ?? null
      return Promise.resolve(true)
    },
    stop: micStop,
    setPaused,
    onFrame: (listener: (level: number, dtMs: number, voiced: boolean) => void) => {
      frame = listener
      return () => {
        frame = null
      }
    },
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
  frame = null
  lastNote = null
  micStop.mockClear()
  setPaused.mockClear()
})

describe('a pause', () => {
  it('holds the clock and the microphone, and carries on from the same second', async () => {
    const { result } = renderHook(() => useDictation({ onTake: vi.fn() }))

    await act(() => result.current.start())
    await act(() => vi.advanceTimersByTimeAsync(3_000))
    act(() => result.current.pause())
    expect(result.current.stage).toBe('paused')
    expect(setPaused).toHaveBeenLastCalledWith(true)
    const held = result.current.elapsedMs

    await act(() => vi.advanceTimersByTimeAsync(5_000))
    expect(result.current.elapsedMs).toBe(held)

    act(() => result.current.resume())
    expect(result.current.stage).toBe('recording')
    expect(setPaused).toHaveBeenLastCalledWith(false)
    await act(() => vi.advanceTimersByTimeAsync(1_000))
    expect(result.current.elapsedMs).toBeGreaterThanOrEqual(held + 800)
    expect(result.current.elapsedMs).toBeLessThan(held + 2_000)
  })

  it('can be finished from, and keeps the take', async () => {
    answers.set('last', { kind: 'ok', text: 'Said before the pause.' })
    const onTake = vi.fn()
    const { result } = renderHook(() => useDictation({ onTake }))

    await act(() => result.current.start())
    act(() => result.current.pause())
    lastNote = note('last')
    await act(() => result.current.stop())
    await settle()

    expect(onTake).toHaveBeenCalledWith('Said before the pause.')
    expect(result.current.stage).toBe('idle')
  })

  it('can be cancelled from, by Escape, and nothing reaches the field', async () => {
    const onTake = vi.fn()
    const { result } = renderHook(() => useDictation({ onTake }))

    await act(() => result.current.start())
    act(() => result.current.pause())
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })

    expect(result.current.stage).toBe('idle')
    expect(onTake).not.toHaveBeenCalled()
  })
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

/**
 * A take with nothing in it is not a failure. The person did not speak, or
 * nothing they said came back as words; the strip says so plainly and the
 * field returns, with no "Dictation failed" anywhere.
 */
describe('a take with nothing in it', () => {
  it('says no speech was heard when the microphone never heard a voice', async () => {
    const onTake = vi.fn()
    const { result } = renderHook(() => useDictation({ onTake }))

    await act(() => result.current.start())
    lastNote = note('silence')
    await act(() => result.current.stop())
    await settle()

    expect(result.current.stage).toBe('blocked')
    expect(result.current.quiet).toBe('No speech heard')
    expect(result.current.note).toBeNull()
    await act(() => vi.advanceTimersByTimeAsync(2_000))
    expect(result.current.stage).toBe('idle')
    expect(onTake).not.toHaveBeenCalled()
  })

  it('reads a provider refusing a silent clip as silence, not a failure', async () => {
    answers.set('silence', { kind: 'note', note: 'Dictation failed: audio too short' })
    const { result } = renderHook(() => useDictation({ onTake: vi.fn() }))

    await act(() => result.current.start())
    act(() => onSegment?.(note('silence')))
    await settle()

    expect(result.current.stage).toBe('blocked')
    expect(result.current.quiet).toBe('No speech heard')
    expect(result.current.note).toBeNull()
  })

  it("says it did not catch the words when a voice was heard but nothing came back", async () => {
    const { result } = renderHook(() => useDictation({ onTake: vi.fn() }))

    await act(() => result.current.start())
    act(() => frame?.(0.4, 16, true))
    lastNote = note('mumble')
    await act(() => result.current.stop())
    await settle()

    expect(result.current.quiet).toBe("Didn't catch that - try again")
    expect(result.current.note).toBeNull()
  })

  it('still reports a real failure once a voice was heard', async () => {
    answers.set('spoken', { kind: 'note', note: 'Dictation failed: the provider refused' })
    const { result } = renderHook(() => useDictation({ onTake: vi.fn() }))

    await act(() => result.current.start())
    act(() => frame?.(0.4, 16, true))
    act(() => onSegment?.(note('spoken')))
    await settle()

    expect(result.current.note).toBe('Dictation failed: the provider refused')
    expect(result.current.quiet).toBeNull()
  })
})
