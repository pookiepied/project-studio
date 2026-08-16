import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Follow streaming output, and stop the moment the reader takes over.
 *
 * Sticking to the bottom unconditionally is the behaviour everyone complains
 * about: you scroll up to re-read something, the next chunk arrives, and you
 * are yanked back down. So the hook holds a `pinned` flag that is true while
 * the viewport is at the bottom and goes false as soon as the user scrolls away
 * from it. Only when pinned does new content scroll into view.
 *
 * `THRESHOLD` exists because "at the bottom" is never exact -- fractional
 * device pixels and a growing last line put the number a few pixels off even
 * when nothing has moved. Anything within it counts as still at the end.
 *
 * ---- Telling our scroll from theirs ---------------------------------------
 *
 * The hard part is that writing `scrollTop` fires a real `scroll` event, so a
 * naive handler cannot tell the follow from the user. Three signals resolve it:
 *
 *   1. A `programmatic` flag is raised before every write the hook makes, and
 *      the first event to arrive under it is swallowed. That kills the race
 *      where the follow's own scroll re-pinned the viewport and the
 *      jump-to-latest button flickered.
 *   2. Direction beats distance. Any *upward* movement unpins, even inside the
 *      threshold: on a trackpad a slow scroll up moves a few pixels at a time,
 *      and if only distance counted, the next chunk would win before the user
 *      had left the slack zone. They cannot escape the pull -- which is exactly
 *      the bug this version exists to fix.
 *   3. The wheel and the pointer are intent. `onWheel` upward and
 *      `onPointerDown` anywhere in the viewport unpin directly, so a click or a
 *      nudge during streaming takes the view away from the follow immediately.
 *
 * Scrolling back to the bottom re-pins, and so does the jump-to-latest button
 * via `scrollToBottom`.
 *
 * Scrolling is instant, not smooth: a smooth scroll restarts on every chunk and
 * never arrives, so the view lags permanently behind the text it follows.
 */

const THRESHOLD = 48

export function useAutoScroll(dependency: unknown) {
  const viewport = useRef<HTMLDivElement>(null)
  const [pinned, setPinned] = useState(true)
  const programmatic = useRef(false)
  const lastTop = useRef(0)

  const atBottom = useCallback(() => {
    const element = viewport.current
    if (!element) return true
    return element.scrollHeight - element.scrollTop - element.clientHeight <= THRESHOLD
  }, [])

  const onScroll = useCallback(() => {
    const element = viewport.current
    if (!element) return
    // A smooth scroll fires this on every frame of the journey, so the flag
    // stays set until the trip ends rather than clearing on the first event --
    // clearing early made the second frame look like the reader scrolling.
    if (programmatic.current) {
      lastTop.current = element.scrollTop
      if (atBottom()) {
        programmatic.current = false
        setPinned(true)
      }
      return
    }
    const upward = element.scrollTop < lastTop.current
    lastTop.current = element.scrollTop
    setPinned(!upward && atBottom())
  }, [atBottom])

  /** The wheel says so before the position does -- unpinned on the first notch. */
  const onWheel = useCallback((event: { deltaY: number }) => {
    if (event.deltaY < 0) setPinned(false)
  }, [])

  /** A press in the transcript is the reader taking the wheel. */
  const onPointerDown = useCallback(() => setPinned(false), [])

  /**
   * The button's scroll, which is smooth -- unlike the follow, which is not.
   *
   * The distinction is the whole reason this is a separate function. Following
   * a stream has to be instant: a smooth scroll restarts on every chunk and
   * never arrives, so the view lags permanently behind the text. Pressing
   * jump-to-latest is one deliberate journey with a beginning and an end, and
   * teleporting there loses the reader -- they arrive with no idea whether they
   * moved a screen or twenty.
   */
  const scrollToBottom = useCallback(() => {
    const element = viewport.current
    if (!element) return

    // `pinned` is deliberately NOT set here, and that is the whole fix.
    //
    // Setting it started the smooth scroll and then immediately re-ran the
    // follow effect below, whose entire job is to jump to the bottom
    // instantly. So the animation was begun and cancelled in the same tick by
    // the app's own code -- which is why the button teleported no matter what
    // `behavior` said. The scroll was never the problem; the state change
    // racing it was.
    //
    // Arrival sets it instead: `scrollend` when the browser offers it,
    // otherwise the normal scroll handler notices we finished at the bottom.
    // Either way `pinned` becomes true after the journey rather than before
    // it, so nothing interrupts the trip.
    programmatic.current = true
    lastTop.current = element.scrollTop

    const settle = () => {
      element.removeEventListener('scrollend', settle)
      programmatic.current = false
      lastTop.current = element.scrollTop
      setPinned(true)
    }
    element.addEventListener('scrollend', settle)

    element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' })
  }, [])

  useEffect(() => {
    if (!pinned) return
    const element = viewport.current
    if (!element) return
    programmatic.current = true
    lastTop.current = element.scrollHeight
    element.scrollTop = element.scrollHeight
  }, [dependency, pinned])

  return { viewport, pinned, onScroll, onWheel, onPointerDown, scrollToBottom }
}
