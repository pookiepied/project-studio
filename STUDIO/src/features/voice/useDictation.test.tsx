/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DictationControls, DictationPrompt } from './DictationBar'
import type { DictationStage } from './useDictation'
import { appendTake, useDictation } from './useDictation'

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
      <DictationPrompt stage="requesting" denied={false} note={null} />,
    )

    expect(screen.getByText('Asking for the microphone')).toBeTruthy()
    // Not the blocked paragraph, which was the borrowed face: that line is
    // about a microphone that refused, and none of that has been learned yet.
    expect(screen.queryByText('No microphone available right now')).toBeNull()
    expect(screen.queryByText(/Microphone blocked/)).toBeNull()
  })
})

function controls(stage: DictationStage, actions: Partial<Parameters<typeof DictationControls>[0]> = {}) {
  return (
    <DictationControls
      stage={stage}
      elapsedMs={4200}
      onFrame={() => () => {}}
      onCancel={vi.fn()}
      onPause={vi.fn()}
      onResume={vi.fn()}
      onFinish={vi.fn()}
      {...actions}
    />
  )
}

describe('the take controls', () => {
  it('shows the clock, and offers cancel, pause and finish while recording', () => {
    const onCancel = vi.fn()
    const onPause = vi.fn()
    const onFinish = vi.fn()
    render(controls('recording', { onCancel, onPause, onFinish }))

    expect(screen.getByText('0:04')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    fireEvent.click(screen.getByRole('button', { name: 'Stop and transcribe' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onPause).toHaveBeenCalledTimes(1)
    expect(onFinish).toHaveBeenCalledTimes(1)
  })

  it('turns Pause into Resume, and stills the dot', () => {
    const onResume = vi.fn()
    const { container } = render(controls('paused', { onResume }))

    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    expect(onResume).toHaveBeenCalledTimes(1)
    expect(container.querySelector('.studio-recording-dot')?.hasAttribute('data-paused')).toBe(true)
  })

  it('keeps the bars and swaps the clock for the word when transcribing', () => {
    const { container, rerender } = render(controls('recording'))
    const bars = container.querySelector('.justify-end[aria-hidden]')
    rerender(controls('processing'))

    // The same element: the row did not empty and refill, one thing in it changed.
    expect(container.querySelector('.justify-end[aria-hidden]')).toBe(bars)
    expect(screen.getByText('Transcribing')).toBeTruthy()
    expect(screen.queryByText('0:04')).toBeNull()
    expect(screen.getByRole('button', { name: 'Cancel' }).hasAttribute('disabled')).toBe(true)
  })
})

describe('the prompt while there are no words', () => {
  it('invites speech, and says when the take is paused', async () => {
    const { rerender } = render(<DictationPrompt stage="recording" denied={false} note={null} />)
    expect(screen.getByText("Go ahead, I'm listening")).toBeTruthy()

    rerender(<DictationPrompt stage="paused" denied={false} note={null} />)
    expect(await screen.findByText('Paused')).toBeTruthy()
  })
})

describe('a take following a draft', () => {
  it('is what the field shows during the take and what it keeps after', () => {
    expect(appendTake('Typed first.  ', 'Then spoken.')).toBe('Typed first. Then spoken.')
    expect(appendTake('   ', 'Only spoken.')).toBe('Only spoken.')
  })
})
