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

/** How long a scroll event may still be the echo of our own instant write. */
const ECHO_MS = 80

export function useAutoScroll(dependency: unknown) {
  const viewport = useRef<HTMLDivElement>(null)
  const [pinned, setPinned] = useState(true)
  const lastTop = useRef(0)

  /**
   * Two different things used to share one `programmatic` boolean, and that is
   * what broke the interrupt.
   *
   * The follow sets it on *every* streamed chunk. So while a reply was
   * arriving the flag was permanently true, `onScroll` took its early return
   * every time, and -- because a follow leaves us at the bottom -- it called
   * `setPinned(true)` again immediately after the wheel had set it false. The
   * reader scrolled up and was dragged straight back down by the app's own
   * bookkeeping. Interrupting was impossible, not unreliable.
   *
   * They are separate concerns and are now separate values:
   *
   *   `wroteAt`    a single instant write we should ignore the echo of
   *   `smoothing`  a journey in flight, lasting many frames, ended by scrollend
   *
   * And a user gesture outranks both. A wheel or a press is intent, stated
   * directly, and nothing the app is doing to the scroll position is allowed
   * to overrule it.
   */
  const wroteAt = useRef(0)
  const smoothing = useRef(false)

  const atBottom = useCallback(() => {
    const element = viewport.current
    if (!element) return true
    return element.scrollHeight - element.scrollTop - element.clientHeight <= THRESHOLD
  }, [])

  const onScroll = useCallback(() => {
    const element = viewport.current
    if (!element) return

    // Our own smooth journey: record where we are and decide nothing. The
    // scrollend listener owns the outcome.
    if (smoothing.current) {
      lastTop.current = element.scrollTop
      return
    }

    // The echo of an instant write we just made. A scroll event is dispatched
    // asynchronously after `scrollTop =`, so it arrives looking exactly like a
    // very fast reader. The window is short because it only has to cover that
    // one dispatch, not a period of time during which the user might act.
    if (performance.now() - wroteAt.current < ECHO_MS) {
      lastTop.current = element.scrollTop
      return
    }

    const upward = element.scrollTop < lastTop.current
    lastTop.current = element.scrollTop
    setPinned(!upward && atBottom())
  }, [atBottom])

  /**
   * A gesture wins outright.
   *
   * The wheel reports intent one event before the position does, and it also
   * cancels a jump already in flight -- reaching for the wheel during the
   * animation means you have changed your mind, and continuing to fly to the
   * bottom over the top of that is the app arguing with the person using it.
   */
  const release = useCallback(() => {
    smoothing.current = false
    wroteAt.current = 0
    setPinned(false)
  }, [])

  const onWheel = useCallback(
    (event: { deltaY: number }) => {
      if (event.deltaY < 0) release()
    },
    [release],
  )

  /** A press in the transcript is the reader taking the wheel. */
  const onPointerDown = useCallback(() => release(), [release])

  /**
   * The button's scroll, which is smooth -- unlike the follow, which is not.
   *
   * Following a stream has to be instant: a smooth scroll restarts on every
   * chunk and never arrives, so the view lags permanently behind the text.
   * Pressing jump-to-latest is one deliberate journey with a beginning and an
   * end, and teleporting there loses the reader -- they arrive with no idea
   * whether they moved a screen or twenty.
   *
   * `pinned` is set on arrival rather than on departure. Setting it here would
   * re-run the follow effect below, whose whole job is to jump to the bottom
   * instantly -- so the animation would be started and cancelled on the same
   * frame by our own code, which is what made this button teleport whatever
   * `behavior` said.
   */
  const scrollToBottom = useCallback(() => {
    const element = viewport.current
    if (!element) return

    smoothing.current = true
    lastTop.current = element.scrollTop

    const settle = () => {
      element.removeEventListener('scrollend', settle)
      // A gesture during the flight already released us; do not re-pin over
      // the top of the reader's decision.
      if (!smoothing.current) return
      smoothing.current = false
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
    wroteAt.current = performance.now()
    lastTop.current = element.scrollHeight
    element.scrollTop = element.scrollHeight
  }, [dependency, pinned])

  return { viewport, pinned, onScroll, onWheel, onPointerDown, scrollToBottom }
}
