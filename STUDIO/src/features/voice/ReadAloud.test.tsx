/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { NarrationOptions, NarrationState } from './narration'

/**
 * The pill over a narration the test drives by hand.
 *
 * Two things this pins, both of which the old pill got wrong. A refusal
 * stays up with a retry until it is dismissed, rather than flashing for
 * three seconds and putting the button back as if nothing had been
 * clicked. And a render that runs long is said as much: the wait changes
 * its word rather than looking identical at one second and at forty.
 */

const stop = vi.fn()
let report: ((state: NarrationState) => void) | null = null
const narrate = vi.fn((options: NarrationOptions) => {
  report = options.onChange
  return { pause: vi.fn(), resume: vi.fn(), stop }
})

vi.mock('@/features/voice/narration', () => ({ narrate: (options: NarrationOptions) => narrate(options) }))
vi.mock('@/features/voice/webAudioSink', () => ({ openWebAudioSink: () => ({}) }))

const { ReadAloud } = await import('./ReadAloud')

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  narrate.mockClear()
  stop.mockClear()
  report = null
})

function begin(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Read aloud' }))
}

describe('the read-aloud pill', () => {
  it('survives a narration that reports loading before it has returned', () => {
    // The real narration says `loading` from inside `narrate`, before the
    // caller holds it. The pill once read its own handle in that callback
    // and threw, which made every click on the button an uncaught error.
    narrate.mockImplementationOnce((options: NarrationOptions) => {
      options.onChange({ stage: 'loading' })
      report = options.onChange
      return { pause: vi.fn(), resume: vi.fn(), stop }
    })
    render(<ReadAloud text="Good morning." />)
    expect(() => begin()).not.toThrow()
    expect(screen.getByText('Reading aloud')).toBeTruthy()

    act(() => report?.({ stage: 'done' }))
    expect(screen.getByRole('button', { name: 'Read aloud' })).toBeTruthy()
  })

  it('shows a refusal until it is dismissed, with a retry beside it', () => {
    render(<ReadAloud text="Good morning." />)
    begin()
    act(() => report?.({ stage: 'failed', note: 'No read-aloud model is connected' }))

    expect(screen.getByRole('status').textContent).toBe('Read-aloud failed')
    expect(screen.queryByText('No read-aloud model is connected')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Read-aloud failed details' }))
    expect(screen.getByText('No read-aloud model is connected')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(narrate).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByText('Reading aloud')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Stop reading aloud' }))
    expect(stop).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Read aloud' })).toBeTruthy()
  })

  it('changes its word when the render runs long', () => {
    vi.useFakeTimers()
    render(<ReadAloud text="Good morning." />)
    begin()
    expect(screen.getByText('Reading aloud')).toBeTruthy()

    act(() => {
      vi.advanceTimersByTime(6_500)
    })
    expect(screen.getByText('Still rendering the voice')).toBeTruthy()

    act(() => report?.({ stage: 'playing' }))
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy()
  })

  it('puts the button back when the narration is done, and stops it on unmount', () => {
    const { unmount } = render(<ReadAloud text="Good morning." />)
    begin()
    act(() => report?.({ stage: 'playing' }))
    act(() => report?.({ stage: 'done' }))
    expect(screen.getByRole('button', { name: 'Read aloud' })).toBeTruthy()

    begin()
    unmount()
    expect(stop).toHaveBeenCalledTimes(1)
  })
})
