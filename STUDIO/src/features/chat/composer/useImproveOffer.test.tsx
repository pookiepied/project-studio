/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { ImproveOutcome } from '@/features/voice/improve'
import { useImproveOffer } from './useImproveOffer'

/**
 * The offer, driven the way the composer drives it: a take begins, its
 * segments are recorded, it finishes, and the field's text is what the
 * hook watches. What is pinned: the offer exists only for the dictated
 * tail and only while it is unedited; Improve replaces that tail and
 * nothing before it; Undo puts it back; a refusal keeps the offer with a
 * sentence; a new take withdraws the last offer.
 */

function harness(improve: (text: string) => Promise<ImproveOutcome>, initial = '') {
  return renderHook(() => {
    const [text, setTextState] = useState(initial)
    const setText = (update: (current: string) => string) => setTextState(update)
    const offer = useImproveOffer({ text, setText, improve })
    return { text, setText, ...offer }
  })
}

/** One take: begin, the segments, finish - the composer's sequence. */
function dictate(result: ReturnType<typeof harness>['result'], ...segments: string[]) {
  act(() => result.current.begin())
  for (const segment of segments) {
    act(() => {
      result.current.record(segment)
      result.current.setText((current) => (current === '' ? segment : `${current} ${segment}`))
    })
  }
  act(() => result.current.finish())
}

describe('the improve offer', () => {
  it('appears for what a take dictated, and only while the tail is those words', () => {
    const { result } = harness(() => Promise.resolve({ kind: 'ok', text: 'x' }), 'Typed first.')
    expect(result.current.offer).toBeNull()

    dictate(result, 'um so the thing', 'is broken')
    expect(result.current.offer).toEqual({
      state: 'ready',
      span: 'um so the thing is broken',
      note: null,
    })

    // A keystroke after the dictated words withdraws the offer: it was
    // about those words, and these are no longer exactly those.
    act(() => result.current.setText((current) => `${current} now`))
    expect(result.current.offer).toBeNull()
  })

  it('is withdrawn by a send, and never made for a take that delivered nothing', () => {
    const { result } = harness(() => Promise.resolve({ kind: 'ok', text: 'x' }))
    dictate(result, 'hello')
    expect(result.current.offer?.span).toBe('hello')
    act(() => result.current.setText(() => ''))
    expect(result.current.offer).toBeNull()

    dictate(result)
    expect(result.current.offer).toBeNull()
  })

  it('improves the dictated tail only, then undoes it', async () => {
    const improve = vi.fn(() => Promise.resolve<ImproveOutcome>({ kind: 'ok', text: 'The thing is broken.' }))
    const { result } = harness(improve, 'Typed first.')
    dictate(result, 'um so the thing is broken')

    await act(async () => {
      await result.current.improve()
    })
    expect(improve).toHaveBeenCalledWith('um so the thing is broken')
    expect(result.current.text).toBe('Typed first. The thing is broken.')
    expect(result.current.offer).toEqual({ state: 'improved', span: 'The thing is broken.', note: null })

    act(() => result.current.undo())
    expect(result.current.text).toBe('Typed first. um so the thing is broken')
    expect(result.current.offer).toEqual({ state: 'ready', span: 'um so the thing is broken', note: null })
  })

  it('shows working while the model answers, and does not improve twice', async () => {
    let release: (outcome: ImproveOutcome) => void = () => {}
    const improve = vi.fn(() => new Promise<ImproveOutcome>((resolve) => (release = resolve)))
    const { result } = harness(improve)
    dictate(result, 'words')

    let first: Promise<void> = Promise.resolve()
    act(() => {
      first = result.current.improve()
    })
    expect(result.current.offer?.state).toBe('working')
    await act(async () => {
      await result.current.improve()
    })
    expect(improve).toHaveBeenCalledTimes(1)

    await act(async () => {
      release({ kind: 'ok', text: 'Words.' })
      await first
    })
    expect(result.current.text).toBe('Words.')
  })

  it('keeps the offer with the sentence when the model refuses', async () => {
    const { result } = harness(() =>
      Promise.resolve({ kind: 'note', note: 'No text model is connected - pick one in Settings - Providers' }),
    )
    dictate(result, 'words')
    await act(async () => {
      await result.current.improve()
    })
    expect(result.current.text).toBe('words')
    expect(result.current.offer).toEqual({
      state: 'ready',
      span: 'words',
      note: 'No text model is connected - pick one in Settings - Providers',
    })
  })

  it('withdraws the last offer when a new take begins, and offers the new take', () => {
    const { result } = harness(() => Promise.resolve({ kind: 'ok', text: 'x' }))
    dictate(result, 'first take')
    expect(result.current.offer?.span).toBe('first take')
    act(() => result.current.begin())
    expect(result.current.offer).toBeNull()
    act(() => {
      result.current.record('second take')
      result.current.setText((current) => `${current} second take`)
    })
    act(() => result.current.finish())
    expect(result.current.offer?.span).toBe('second take')
    expect(result.current.text).toBe('first take second take')
  })
})
