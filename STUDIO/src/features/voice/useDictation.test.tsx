/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from '@testing-library/react'
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DictationBar } from './DictationBar'
import { useDictation } from './useDictation'

/**
 * The dictation hook, against the microphone.

 * The one failure this pins is the quiet one: a `getUserMedia` that never
 * settles. That is exactly what an unanswered WebView2 permission request
 * looks like from here - no resolution, no rejection, the promise just
 * pending - and it used to leave the strip showing the blocked paragraph, so
 * the stall and "no microphone available" were the same picture. It now has
 * its own word, and this is the test that keeps it.
 */

/** Installs one getUserMedia in jsdom's navigator; jsdom has none of its own. */
function stubMicrophone(getUserMedia: () => Promise<MediaStream>): void {
  Object.defineProperty(window.navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  })
}

/** A stream that answers nothing, as an unanswered permission dialog does. */
function pendingStream(): Promise<MediaStream> {
  return new Promise(() => {})
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('a permission question that is never answered', () => {
  it('holds the hook in requesting, not blocked', async () => {
    stubMicrophone(pendingStream)
    const onTake = vi.fn()
    const { result } = renderHook(() => useDictation({ onTake }))

    // `start` awaits the microphone, so its promise stays pending here; the
    // stage is what the synchronous half of the call decides, which is the
    // point: the person sees this state, not a settled one.
    act(() => {
      void result.current.start()
    })

    expect(result.current.stage).toBe('requesting')
    expect(result.current.denied).toBe(false)
    expect(result.current.note).toBeNull()
    expect(onTake).not.toHaveBeenCalled()
  })

  it('gives the waiting its own face, so a stall does not read as no microphone', () => {
    render(
      <DictationBar
        stage="requesting"
        elapsedMs={0}
        denied={false}
        note={null}
        onFrame={() => () => {}}
      />,
    )

    expect(screen.getByText('Asking for the microphone')).toBeTruthy()
    // Not the blocked paragraph, which was the borrowed face: that line is
    // about a microphone that refused, and none of that has been learned yet.
    expect(screen.queryByText('No microphone available right now')).toBeNull()
    expect(screen.queryByText(/Microphone blocked/)).toBeNull()
  })
})

describe('the live strip', () => {
  it('shows the clock and the escape hint while recording, and no words', () => {
    render(
      <DictationBar stage="recording" elapsedMs={4200} denied={false} note={null} onFrame={() => () => {}} />,
    )
    expect(screen.getByText('Esc cancels')).toBeTruthy()
    expect(screen.getByText('0:04')).toBeTruthy()
  })

  it('keeps the bars and swaps the clock for the word when transcribing', () => {
    const { container, rerender } = render(
      <DictationBar stage="recording" elapsedMs={4200} denied={false} note={null} onFrame={() => () => {}} />,
    )
    const bars = container.querySelector('[aria-hidden]')
    rerender(
      <DictationBar stage="processing" elapsedMs={4200} denied={false} note={null} onFrame={() => () => {}} />,
    )
    // The same element: the strip did not empty and refill, one thing in it changed.
    expect(container.querySelector('[aria-hidden]')).toBe(bars)
    expect(screen.getByText('Transcribing')).toBeTruthy()
    expect(screen.queryByText('Esc cancels')).toBeNull()
  })
})
