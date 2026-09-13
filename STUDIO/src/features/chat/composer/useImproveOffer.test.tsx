/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { ImproveOutcome } from '@/features/voice/improve'
import { useImproveOffer } from './useImproveOffer'

/**
 * The offer, driven the way the composer drives it: a take lands and opens
 * it, the field's text is what the hook watches. What is pinned: the offer
 * works on the whole field; Undo is there only while the field is still
 * the model's text; a send or an emptied field withdraws it; a refusal
 * keeps it with a sentence; a take starting withdraws it until it lands.
 */

function harness(improve: (text: string) => Promise<ImproveOutcome>, initial = '') {
  const onImproved = vi.fn()
  const hook = renderHook(() => {
    const [text, setText] = useState(initial)
    const offer = useImproveOffer({ text, setText, improve, onImproved })
    return { text, setText, ...offer }
  })
  return { ...hook, onImproved }
}

/** One take landing: the composer appends the words, then opens the offer. */
function dictate(result: ReturnType<typeof harness>['result'], spoken: string) {
  act(() => {
    result.current.setText(result.current.text === '' ? spoken : `${result.current.text} ${spoken}`)
    result.current.open()
  })
}

describe('the improve offer', () => {
  it('opens when a take lands, and improves the whole field', async () => {
    const improve = vi.fn(() => Promise.resolve<ImproveOutcome>({ kind: 'ok', text: 'Typed first. The thing is broken.' }))
    const { result, onImproved } = harness(improve, 'Typed first.')
    expect(result.current.offer).toBeNull()

    dictate(result, 'um so the thing is broken')
    expect(result.current.offer).toEqual({ state: 'ready', note: null })

    await act(async () => {
      await result.current.improve()
    })
    // The whole field, not the dictated tail: the message is what reads.
    expect(improve).toHaveBeenCalledWith('Typed first. um so the thing is broken')
    expect(result.current.text).toBe('Typed first. The thing is broken.')
    expect(result.current.offer).toEqual({ state: 'improved', note: null })
    expect(onImproved).toHaveBeenCalledWith('Typed first. The thing is broken.')
  })

  it('undoes to the field as it was, and stays offered', async () => {
    const { result } = harness(() => Promise.resolve({ kind: 'ok', text: 'Better.' }), 'Typed.')
    dictate(result, 'worse')
    await act(async () => {
      await result.current.improve()
    })
    act(() => result.current.undo())
    expect(result.current.text).toBe('Typed. worse')
    expect(result.current.offer).toEqual({ state: 'ready', note: null })
  })

  it('makes an edited improvement the person\'s own: no Undo, Improve again', async () => {
    const { result } = harness(() => Promise.resolve({ kind: 'ok', text: 'Better.' }))
    dictate(result, 'worse')
    await act(async () => {
      await result.current.improve()
    })
    act(() => result.current.setText('Better. And more.'))
    expect(result.current.offer).toEqual({ state: 'ready', note: null })
    // Undo has nothing to put back now; the field stays as typed.
    act(() => result.current.undo())
    expect(result.current.text).toBe('Better. And more.')
  })

  it('is withdrawn by a send or an emptied field, and by a take starting', () => {
    const { result } = harness(() => Promise.resolve({ kind: 'ok', text: 'x' }))
    dictate(result, 'hello')
    expect(result.current.offer).not.toBeNull()
    act(() => result.current.setText(''))
    expect(result.current.offer).toBeNull()

    dictate(result, 'again')
    expect(result.current.offer).not.toBeNull()
    act(() => result.current.close())
    expect(result.current.offer).toBeNull()
    // The field keeps its words; only the offer went.
    expect(result.current.text).toBe('again')
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
    expect(result.current.offer?.state).toBe('improved')
  })

  it('keeps the offer with the sentence when the model refuses', async () => {
    const { result, onImproved } = harness(() =>
      Promise.resolve({ kind: 'note', note: 'No text model is connected - pick one in Settings - Providers' }),
    )
    dictate(result, 'words')
    await act(async () => {
      await result.current.improve()
    })
    expect(result.current.text).toBe('words')
    expect(result.current.offer).toEqual({
      state: 'ready',
      note: 'No text model is connected - pick one in Settings - Providers',
    })
    expect(onImproved).not.toHaveBeenCalled()
  })
})
