/**
 * @vitest-environment jsdom
 */
import { AnimatePresence } from 'framer-motion'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TranscriptWait } from './TranscriptWait'

/**
 * The conversation's wait, while its history is read.
 *
 * What this holds is the bug the shipped wait had: rendered where ChatPage
 * renders it - the child an `AnimatePresence` is born with - the dots stood
 * at their rest pose for the whole wait. An `AnimatePresence initial=
 * {false}` tells a first-render child that its entrance is already over,
 * which blocks the initial animation of the whole subtree; and because the
 * wait's later renders hand Framer the very keyframes it mounted with,
 * nothing ever looks changed, so nothing ever starts. The posture below is
 * therefore exactly the shipped one: `AnimatePresence` with no
 * `initial={false}`, the wait present on the very first render.
 *
 * The two postures of this bug (without, and with, the prop) play their
 * animations in ONE test, sequentially, because a jsdom + fake-clock + test
 * pairing keeps exactly one sure-footed animation per file: a second
 * animating test in the same file was sampled standing still no matter what
 * it rendered. The first test here is the one that animates, and the one
 * after it reads the settled markup and needs no clocks.
 */

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

/** The three dots, and only them: the wrapper they hang from is `aria-hidden`. */
function dots(): HTMLElement[] {
  return Array.from(document.querySelectorAll('span[aria-hidden] > span'))
}

function dotTransforms(): string[] {
  return dots().map((el) => el.style.transform)
}

function waitOpacity(): string {
  const wait = document.querySelector('[role="status"]')
  return wait instanceof HTMLElement ? wait.style.opacity : 'MISSING'
}

/** Pixels, not the `none` an at-rest dot is written with. */
function risen(transform: string): number {
  const match = /translateY\(([\d.]+)px\)/.exec(transform)
  return match === null ? 0 : Number(match[1])
}

describe('TranscriptWait', () => {
  it('arrives late, and its dots bob - in the posture ChatPage ships', async () => {
    vi.useFakeTimers()

    // The shipped posture: the wait is the first-render child, and the
    // presence carries no initial={false} (see the note above). Fifty
    // forgiven the SHOW_AFTER delay; a second and a fifth covers the rest
    // of the entrance and the first full bob.
    const { unmount } = render(
      <AnimatePresence>
        <TranscriptWait key="loading" />
      </AnimatePresence>,
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })
    // Fifty milliseconds in, the wait has not begun to arrive: SHOW_AFTER
    // holds it unseen. This is the half of the bug that was silent - the
    // prop's block also swallowed this delay, and the dots snapped in.
    expect(waitOpacity()).not.toBe('1')

    for (let i = 0; i < 6; i += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200)
      })
    }
    // The entrance has finished, and the wait stands.
    expect(waitOpacity()).toBe('1')

    // And the bob: all three dots have travelled, the last of them (a
    // fifth-second stagger) having risen and come back.
    const transforms = dotTransforms()
    expect(transforms).toHaveLength(3)
    expect(Math.max(...transforms.map(risen))).toBeGreaterThan(1)

    unmount()
    cleanup()

    // The bug, kept as documentation: the same posture with
    // `initial={false}` - what ChatPage shipped - is the dead one. The
    // presence blocks the entering animation of the whole subtree, and the
    // keyframes that never look changed never start it again.
    vi.useFakeTimers()
    const { unmount: unmountBlocked } = render(
      <AnimatePresence initial={false}>
        <TranscriptWait key="loading" />
      </AnimatePresence>,
    )
    // Blocked, the entrance is skipped: full opacity at once.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })
    expect(waitOpacity()).toBe('1')

    for (let i = 0; i < 6; i += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200)
      })
    }
    expect(dotTransforms().map(risen)).toEqual([0, 0, 0])

    unmountBlocked()
  })

  it('announces itself once, quietly', () => {
    render(
      <AnimatePresence>
        <TranscriptWait key="loading" />
      </AnimatePresence>,
    )
    const wait = document.querySelector('[role="status"]')
    expect(wait).not.toBeNull()
    expect(wait?.getAttribute('aria-label')).toBe('Loading the conversation')
  })
})
