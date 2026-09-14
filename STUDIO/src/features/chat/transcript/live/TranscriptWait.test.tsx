/**
 * @vitest-environment jsdom
 */
import { AnimatePresence } from 'framer-motion'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

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
 * ---- One clock for the whole file, never taken away ----------------------
 *
 * Framer's frame pump is not the test's clock: the batcher captures
 * `requestAnimationFrame` once, at module evaluation, and jsdom's
 * pretendToBeVisual pump schedules its 16ms tick through whatever
 * `setInterval` is global at the FIRST wake - which is inside the first
 * test, under the one faked clock. Restore that clock (`useRealTimers`)
 * and its queue dies with the pump's outstanding tick still owed: the
 * pump's own "scheduled" flag stays set, and no later test - under fakes
 * OR under real clocks, whichever comes after - ever pumps another frame.
 * Every试验 after the first then reads three dots standing still, whatever
 * they were built from. So the clock is installed once, above, and is
 * NEVER taken away: the pump's timers survive into every later test of
 * this file, each of which waits out its own intervals against the shared,
 * cumulative, fake now. (Vitest gives each file a fresh environment, so
 * the promised restoration at the end of the file is the runner's, not
 * ours.) Everything here is therefore phase-independent on purpose: every
 * test samples RELATIVE to its own mount, never against an absolute now.
 *
 * The second test carries its own witness - a shipped-posture mount that
 * must rise - precisely because a wedged pump and a correctly-still wait
 * look the same. A stillness that also survives the witness is evidence;
 * a stillness with nothing living beside it is not.
 */

beforeAll(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
})

function waitOpacity(): string {
  const wait = document.querySelector('[role="status"]')
  return wait instanceof HTMLElement ? wait.style.opacity : 'MISSING'
}

/** Pixels, not the `none` an at-rest dot is written with. */
function risen(transform: string): number {
  const match = /translateY\(([\d.]+)px\)/.exec(transform)
  return match === null ? 0 : Number(match[1])
}

/** Advances the shared clock in 200ms steps. */
async function passMs(total: number): Promise<void> {
  for (let passed = 0; passed < total; passed += 200) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })
  }
}

describe('TranscriptWait', () => {
  it('arrives late, and its dots bob - in the posture ChatPage ships', async () => {
    render(
      <AnimatePresence>
        <TranscriptWait key="loading" />
      </AnimatePresence>,
    )

    // Fifty milliseconds in, the wait has not begun to arrive: SHOW_AFTER
    // holds it unseen. This is the half of the bug that was silent - the
    // prop's block also swallowed this delay, and the dots snapped in.
    await passMs(50)
    expect(waitOpacity()).not.toBe('1')

    // A second and a fifth: past the SHOW_AFTER delay, past the entrance
    // itself, and into the second bob. The wait stands, and the dots have
    // travelled - the third of them (a fifth-second stagger) having risen
    // and come back.
    await passMs(1200)
    expect(waitOpacity()).toBe('1')
    const transforms = Array.from(document.querySelectorAll('span[aria-hidden] > span'))
    expect(transforms).toHaveLength(3)
    expect(Math.max(...transforms.map((el) => risen((el as HTMLElement).style.transform)))).toBeGreaterThan(1)
  })

  it('the dead posture: blocked at mount, still for the whole wait', async () => {
    // The witness, first: the shipped posture, alive on the shared clock a
    // second time. If the pump wedged anywhere along the way, this fails
    // rather than the stillness below passing unnoticed.
    const living = render(
      <AnimatePresence>
        <TranscriptWait key="loading" />
      </AnimatePresence>,
    )
    await passMs(1200)
    expect(
      Math.max(...Array.from(document.querySelectorAll('span[aria-hidden] > span')).map((el) => risen((el as HTMLElement).style.transform))),
    ).toBeGreaterThan(1)
    living.unmount()

    // And the blocked posture - what ChatPage shipped - in the same living
    // clock. The presence says the entrance is over, so the wait is at full
    // opacity at once, and no keyframes that never look changed ever start:
    // stillness with a witness standing beside it.
    render(
      <AnimatePresence initial={false}>
        <TranscriptWait key="loading" />
      </AnimatePresence>,
    )
    await passMs(50)
    expect(waitOpacity()).toBe('1')

    await passMs(1200)
    const transforms = Array.from(document.querySelectorAll('span[aria-hidden] > span')).map(
      (el) => risen((el as HTMLElement).style.transform),
    )
    expect(transforms).toHaveLength(3)
    expect(Math.max(...transforms)).toBe(0)
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
