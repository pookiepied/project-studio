import { useCallback, useEffect, useRef, useState } from 'react'
import { createFollower } from '@/features/chat/transcript/scroll/followEngine'

/**
 * Follow streaming output, and stop the moment the reader takes over.
 *
 * Sticking to the bottom unconditionally is the behaviour everyone complains
 * about: you scroll up to re-read something, the next chunk arrives, and you
 * are yanked back down. So a `pinned` flag is true while the viewport is at the
 * bottom and goes false as soon as the reader leaves it, and only while pinned
 * does the view chase new content.
 *
 * The chase itself is in `followEngine.ts`, and this hook decides when it runs.
 * That split is deliberate: whether to follow is a question about the user's
 * intent, and how to follow is a question about layout and frame timing. They
 * were one function and it was hard to change either without breaking the
 * other.
 *
 * ---- Telling our scroll from theirs ---------------------------------------
 *
 * Every write the engine makes fires a real `scroll` event, so the handler
 * cannot use position alone to detect the reader. Two signals resolve it:
 *
 *   1. While the engine is driving, scroll events are its own echo and are
 *      ignored. This is a flag rather than a time window because the engine now
 *      writes on *every* frame for the length of a stream, so there is no quiet
 *      moment in which an echo could be distinguished by timing.
 *   2. Gestures are intent, and they outrank everything. A wheel, a press, or a
 *      navigation key releases the pin directly -- before the position they
 *      will cause has even been applied. That is what makes interrupting
 *      reliable rather than a race against the follow.
 */

/** How close to the bottom still counts as at the bottom. */
const THRESHOLD = 48

/** Keys that scroll. Without these, paging up during a stream fights the follow. */
const SCROLL_KEYS = new Set([
  'ArrowUp',
  'PageUp',
  'Home',
  'ArrowDown',
  'PageDown',
  'End',
  ' ',
])

export function useAutoScroll(dependency: unknown) {
  const viewport = useRef<HTMLDivElement>(null)
  const [pinned, setPinned] = useState(true)

  const follower = useRef(createFollower())
  const frame = useRef(0)
  /** The engine is writing `scrollTop`, so scroll events are its own. */
  const driving = useRef(false)
  /** A smooth jump-to-latest is in flight, which `scrollend` owns. */
  const smoothing = useRef(false)
  const lastTop = useRef(0)

  /**
   * `pinned` for callbacks installed once and read later.
   *
   * The observer and the frame loop below must see the current value, not the
   * one captured when they were created. Re-installing them on every change
   * would tear down and rebuild an observer during exactly the frames the
   * transcript is growing.
   */
  const pinnedRef = useRef(pinned)
  pinnedRef.current = pinned

  const atBottom = useCallback(() => {
    const element = viewport.current
    if (!element) return true
    return element.scrollHeight - element.scrollTop - element.clientHeight <= THRESHOLD
  }, [])

  /**
   * Run the chase until it arrives.
   *
   * The loop stops when the engine reports it has nothing left to do, and the
   * resize observer starts it again when the document grows. Running
   * unconditionally for the length of a stream would keep a frame callback
   * alive through every pause the model takes.
   */
  const drive = useCallback(() => {
    if (frame.current) return

    let last = performance.now()

    const step = (now: number) => {
      frame.current = 0

      const element = viewport.current
      if (!element || !pinnedRef.current) {
        driving.current = false
        follower.current.stop()
        return
      }

      const delta = (now - last) / 1000
      last = now

      driving.current = true
      const moved = follower.current.step(element, delta)

      if (moved === null) {
        // Arrived. The flag drops so the next scroll event is read as the
        // reader's, and `lastTop` is resynced so it is not read as a jump.
        driving.current = false
        lastTop.current = element.scrollTop
        return
      }

      lastTop.current = moved
      frame.current = requestAnimationFrame(step)
    }

    frame.current = requestAnimationFrame(step)
  }, [])

  const onScroll = useCallback(() => {
    const element = viewport.current
    if (!element) return

    // Ours, either way. The engine's own writes, or a smooth jump whose
    // outcome the `scrollend` listener owns.
    if (driving.current || smoothing.current) {
      lastTop.current = element.scrollTop
      return
    }

    // Direction beats distance. On a trackpad a slow scroll up moves a few
    // pixels at a time, and if only distance counted the next chunk would
    // re-pin before the reader had left the slack zone -- they could not
    // escape the pull, which is the bug this whole file exists to prevent.
    const upward = element.scrollTop < lastTop.current
    lastTop.current = element.scrollTop
    setPinned(!upward && atBottom())
  }, [atBottom])

  /** A gesture wins outright, including over a jump already in flight. */
  const release = useCallback(() => {
    smoothing.current = false
    driving.current = false
    follower.current.stop()
    if (frame.current) {
      cancelAnimationFrame(frame.current)
      frame.current = 0
    }
    setPinned(false)
  }, [])

  const onWheel = useCallback(
    (event: { deltaY: number }) => {
      if (event.deltaY < 0) release()
    },
    [release],
  )

  const onPointerDown = useCallback(() => release(), [release])

  const onKeyDown = useCallback(
    (event: { key: string }) => {
      if (SCROLL_KEYS.has(event.key)) release()
    },
    [release],
  )

  /**
   * Jump to latest.
   *
   * Native smooth scrolling rather than the follow engine, because this is one
   * deliberate journey with a beginning and an end rather than a chase, and
   * `scrollend` gives an exact arrival to pin on. `pinned` is set on arrival:
   * setting it on departure would start the follow loop, which would drive the
   * same element from the same frame and fight the browser's animation.
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

  /**
   * Follow the content, not the messages.
   *
   * Message arrivals used to be the same instant the text appeared. They are
   * not any more -- the reveal runs on a frame clock, so between two arrivals
   * the transcript goes on growing for dozens of frames with no state change
   * here at all. A `ResizeObserver` fires on the thing actually being asked
   * about, and covers every other cause of growth for free: an image loading, a
   * code block expanding, the window reflowing a paragraph.
   */
  useEffect(() => {
    const element = viewport.current
    const content = element?.firstElementChild
    if (!content) return

    const observer = new ResizeObserver(() => {
      if (pinnedRef.current) drive()
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [drive])

  useEffect(() => {
    if (pinned) drive()
  }, [dependency, pinned, drive])

  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  return { viewport, pinned, onScroll, onWheel, onPointerDown, onKeyDown, scrollToBottom }
}
