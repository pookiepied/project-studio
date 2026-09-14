import { useCallback, useEffect, useRef, useState } from 'react'
import { DURATION } from '@/design/tokens'
import { OPEN_STIFFNESS, createFollower } from '@/features/chat/transcript/scroll/followEngine'

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
 *      navigation key releases the pin directly — before the position they
 *      will cause has even been applied. That is what makes interrupting
 *      reliable rather than a race against the follow.
 */

/** How close to the bottom still counts as at the bottom. */
const THRESHOLD = 48

/**
 * How long a jump-to-latest flight may own the scroll events before the belt
 * ends it without permission. `scrollend` usually arrives far sooner; this
 * exists for the flights that never report.
 */
export const FLIGHT_BELT_MS = 1_600

/**
 * How long the open holds at the top once there is content, before the
 * journey down begins: the reveal's own duration, then a moment to have
 * seen it. Counted from the first frame with something to scroll, not from
 * mount - the replay's first delivery may be a while coming.
 */
export const OPEN_HOLD_MS = DURATION.slow * 1000 + 200

/**
 * ---- The open ------------------------------------------------------------
 *
 * Arriving in a conversation is not the same act as following one. The page
 * mounts at scrollTop 0 with an empty transcript, the replay fills it a
 * delivery at a time, and the whole machinery above assumes the only thing
 * that ever moves the viewport is the chase or the reader. Neither is true
 * while the transcript is still arriving: the paging window mounts its
 * sentinel at the top — where the fresh viewport is, so the observer's first
 * callback loads an older batch on the spot — and the correction that holds
 * the reader still writes `scrollTop` from outside the engine, unguarded. One
 * scroll event later `pinned` is false, and every delivery after that reads
 * `if (pinned) drive()` and does nothing. That is the whole mechanism of
 * "opening a long conversation lands you at the top".
 *
 * So the open has a state of its own: `boarding`. While it lasts, scroll
 * events are the layout's, not the reader's, and none of them may unpin; the
 * chase keeps running on every delivery and every resize until it arrives at
 * real content, which is the only self-held way out. The reader's own
 * gestures — wheel, press, key — end it immediately, because the one thing
 * this file will not do is yank someone who has already said where they want
 * to be.
 *
 * The open is also paced. The transcript arrives at the top of the viewport
 * and reveals itself there (`ChatPage`); the journey to the bottom waits
 * for that reveal and a beat more (`OPEN_HOLD_MS`) before it starts, and
 * then runs at the open's own, gentler rate (`OPEN_STIFFNESS`). Without the
 * hold the first frame of content and the first frame of travel were the
 * same frame, and the reader saw a page that appeared already leaving.

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

export function useAutoScroll(dependency: unknown, navigation?: unknown) {
  const viewport = useRef<HTMLDivElement>(null)
  const [pinned, setPinned] = useState(true)
  /** True from mount (or a change of conversation) until the open lands. */
  const boarding = useRef(true)
  /** When the open first saw content, from which the hold is counted. */
  const openSeen = useRef<number | null>(null)

  const follower = useRef(createFollower())
  const frame = useRef(0)
  /** The engine is writing `scrollTop`, so scroll events are its own. */
  const driving = useRef(false)
  /** A smooth jump-to-latest is in flight, which `scrollend` owns. */
  const smoothing = useRef(false)
  /** The belt's timer: a flight that never reports still has to end. */
  const flightBelt = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** The flight's `scrollend` listener, kept so a gesture can revoke it. */
  const settleRef = useRef<((event: Event) => void) | null>(null)
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

      // The open waits at the top. The first frame with content starts the
      // clock; until it runs out the loop keeps its turn - the flag stays
      // up, so the layout's scrolls are still nobody's - and moves nothing.
      if (boarding.current && element.scrollHeight - element.clientHeight > 0) {
        openSeen.current ??= now
        if (now - openSeen.current < OPEN_HOLD_MS) {
          lastTop.current = element.scrollTop
          frame.current = requestAnimationFrame(step)
          return
        }
      }

      // The open glides: its whole distance is a journey the reader watches,
      // and the teleport that spares a mid-stream reader a flight through
      // several screens would also spare them the arrival. It runs at its
      // own rate, too. Past the open, the streaming follow keeps its own
      // judgement on both.
      const moved = follower.current.step(
        element,
        delta,
        boarding.current ? { teleport: false, stiffness: OPEN_STIFFNESS } : undefined,
      )

      if (moved === null) {
        // Arrived. The flag drops so the next scroll event is read as the
        // reader's, and `lastTop` is resynced so it is not read as a jump.
        driving.current = false
        // An arrival at a document with nothing to scroll is the mount frame,
        // not the open landing — the transcript has not come yet, and the
        // boarding must outlive it. The first arrival at real content is the
        // open's own end; from there the ordinary contract takes over.
        if (element.scrollHeight - element.clientHeight > 0) boarding.current = false
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
      // A flight's arrival is its last echoes reaching the bottom, and
      // `scrollend` does not have a monopoly on saying so: an engine without
      // the event, or a browser that cancelled the scroll, would leave the
      // flight owning every later scroll event forever -- the pin frozen,
      // the arrow gone however far from the bottom the reader sits. The
      // echo that lands at the bottom is the same fact; read it there.
      if (smoothing.current && atBottom()) {
        smoothing.current = false
        if (flightBelt.current !== null) {
          clearTimeout(flightBelt.current)
          flightBelt.current = null
        }
        setPinned(true)
      }
      lastTop.current = element.scrollTop
      return
    }

    // The open's scrolls are the layout's — the paging correction, a clamp
    // after a content swap — and not one of them is the reader. Held here,
    // none can unpin the chase that is trying to deliver the open to the
    // bottom; see "The open" at the top of this file.
    if (boarding.current) {
      lastTop.current = element.scrollTop
      return
    }

    // Direction beats distance. On a trackpad a slow scroll up moves a few
    // pixels at a time, and if only distance counted the next chunk would
    // re-pin before the reader had left the slack zone — they could not
    // escape the pull, which is the bug this whole file exists to prevent.
    const upward = element.scrollTop < lastTop.current
    lastTop.current = element.scrollTop
    setPinned(!upward && atBottom())
  }, [atBottom])

  /** A gesture wins outright, including over a jump already in flight —
   *  and over the open: the reader who moves first decides where they are. */
  const release = useCallback(() => {
    // A press does not cancel a programmatic smooth scroll in Chromium, so
    // the flight would keep moving after this -- and its echoes, no longer
    // owned, would classify as the reader's and re-pin them at the bottom
    // over the decision they just made. Interrupted at the position they
    // pressed at, it stops being anybody's flight.
    const flying = smoothing.current
    const element = viewport.current
    boarding.current = false
    smoothing.current = false
    if (flightBelt.current !== null) {
      clearTimeout(flightBelt.current)
      flightBelt.current = null
    }
    if (settleRef.current !== null) {
      element?.removeEventListener('scrollend', settleRef.current)
      settleRef.current = null
    }
    if (flying && element) element.scrollTo({ top: element.scrollTop })
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

    // A zero-distance flight is a scroll some engines never report, with no
    // `scrollend` to settle it; and there is nothing to fly to anyway.
    if (atBottom()) {
      setPinned(true)
      return
    }

    smoothing.current = true
    lastTop.current = element.scrollTop

    // A second click while a flight is running revokes the first flight's
    // settle, or two listeners would race to end the same journey.
    if (settleRef.current !== null) element.removeEventListener('scrollend', settleRef.current)

    const settle = () => {
      element.removeEventListener('scrollend', settle)
      settleRef.current = null
      if (flightBelt.current !== null) {
        clearTimeout(flightBelt.current)
        flightBelt.current = null
      }
      // A gesture during the flight already released us; do not re-pin over
      // the top of the reader's decision.
      if (!smoothing.current) return
      smoothing.current = false
      lastTop.current = element.scrollTop
      // Pin on arrival, and only on arrival. `scrollend` also fires for a
      // flight the browser abandoned far from the bottom -- content grew
      // under it, or a programmatic write aborted it -- and pinning there
      // would hide the arrow while the reader is nowhere near the end, then
      // let the follow yank them the rest of the way as if they had asked.
      setPinned(atBottom())
    }
    settleRef.current = settle
    element.addEventListener('scrollend', settle)

    // The belt. A cancelled flight fires neither `scrollend` nor anything
    // else, and a flight that owns the scroll events owns them forever --
    // every later scroll read as its echo, the pin frozen wherever the
    // flight left it. If the flight is still claimed this long after
    // departure, the claim is released; the echoes after that classify like
    // anyone else's, and the reader is where the flight actually stopped.
    if (flightBelt.current !== null) clearTimeout(flightBelt.current)
    flightBelt.current = setTimeout(() => {
      flightBelt.current = null
      if (!smoothing.current) return
      smoothing.current = false
      lastTop.current = element.scrollTop
    }, FLIGHT_BELT_MS)

    element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' })
  }, [atBottom])

  /**
   * Follow the content, not the messages.
   *
   * Message arrivals used to be the same instant the text appeared. They are
   * not any more — the reveal runs on a frame clock, so between two arrivals
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

  /**
   * A change of conversation is the open again, even if a shell reuses this
   * page instead of remounting it. Everything the previous conversation left
   * behind — a chase mid-flight, a reader's pin, the position in a document
   * that is about to be replaced — is dropped, and the boarding starts over:
   * the new transcript opens at its bottom, or wherever the reader takes it.
   */
  useEffect(() => {
    boarding.current = true
    openSeen.current = null
    if (frame.current) {
      cancelAnimationFrame(frame.current)
      frame.current = 0
    }
    driving.current = false
    smoothing.current = false
    if (flightBelt.current !== null) {
      clearTimeout(flightBelt.current)
      flightBelt.current = null
    }
    if (settleRef.current !== null) {
      viewport.current?.removeEventListener('scrollend', settleRef.current)
      settleRef.current = null
    }
    follower.current.stop()
    lastTop.current = 0
    setPinned(true)
  }, [navigation])

  useEffect(() => {
    if (pinned) drive()
  }, [dependency, pinned, drive])

  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current)
      if (flightBelt.current !== null) clearTimeout(flightBelt.current)
    },
    [],
  )

  return { viewport, pinned, onScroll, onWheel, onPointerDown, onKeyDown, scrollToBottom }
}
