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
    const onText = vi.fn()
    const { result } = renderHook(() => useDictation({ onText }))

    // `start` awaits the microphone, so its promise stays pending here; the
    // stage is what the synchronous half of the call decides, which is the
    // point: the person sees this state, not a settled one.
    act(() => {
      void result.current.start()
    })

    expect(result.current.stage).toBe('requesting')
    expect(result.current.denied).toBe(false)
    expect(result.current.note).toBeNull()
    expect(onText).not.toHaveBeenCalled()
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

describe('the recording face', () => {
  it('shows the words as they land, and the escape hint until they do', () => {
    const { rerender } = render(
      <DictationBar stage="recording" elapsedMs={1200} denied={false} note={null} onFrame={() => () => {}} />,
    )
    expect(screen.getByText('Esc cancels')).toBeTruthy()

    rerender(
      <DictationBar
        stage="recording"
        elapsedMs={4200}
        denied={false}
        note={null}
        transcript="The first sentence landed."
        onFrame={() => () => {}}
      />,
    )
    expect(screen.getByText('The first sentence landed.')).toBeTruthy()
    expect(screen.queryByText('Esc cancels')).toBeNull()
  })

  it('shows the tail of a long transcript, not its head', () => {
    const transcript = `${'word '.repeat(40)}the newest words`
    render(
      <DictationBar
        stage="recording"
        elapsedMs={9000}
        denied={false}
        note={null}
        transcript={transcript}
        onFrame={() => () => {}}
      />,
    )
    const shown = screen.getByTitle(transcript)
    expect(shown.textContent?.endsWith('the newest words')).toBe(true)
    expect(shown.textContent?.startsWith('…')).toBe(true)
  })
})
