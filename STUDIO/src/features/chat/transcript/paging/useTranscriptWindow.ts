import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

/**
 * How much of a long conversation is actually in the document.
 *
 * A transcript is append-only and unbounded. A year of daily use is tens of
 * thousands of turns, and every one of them is markdown that has to be parsed,
 * highlighted, measured and laid out. Put all of it in the DOM and opening the
 * conversation stalls for seconds, scrolling drops frames for the rest of the
 * session, and memory climbs until the window is killed.
 *
 * So the tail is rendered and the rest is not, and older turns arrive in
 * batches as you scroll back toward them.
 *
 * ---- Why batches rather than a virtual list ------------------------------
 *
 * Windowing libraries need to know how tall a row is, and a transcript row can
 * be a line of text or a forty-line code block that changes height when you
 * expand it. Estimating gets the scrollbar wrong, measuring every row costs the
 * work we came here to avoid, and both fight the auto-scroll follow, which
 * writes `scrollTop` on its own schedule.
 *
 * Batching sidesteps the whole category. Rows keep their natural height,
 * nothing is measured, and the only thing that has to be right is not moving
 * the reader when older content appears above them — which is the point of the
 * layout effect below and the one genuinely hard part of this file.
 */

/** Turns added per batch. Roughly a screen and a half. */
const BATCH = 24

/** How much is on screen when a conversation opens. */
const INITIAL = 40

/**
 * Distance from the top at which the next batch is fetched.
 *
 * Generous on purpose: loading at zero means the reader arrives at a hard stop
 * and waits. A screen of runway means the content is usually there before they
 * reach it, which is the difference between paging and simply scrolling.
 */
const TRIGGER_MARGIN = 600

/**
 * The one thing windowing needs of an item: a stable identity for the
 * anchor. Demo messages and live transcript items both qualify; this module
 * is content-blind by design.
 */
interface WindowedItem {
  readonly id: string
}

export interface TranscriptWindow<T extends WindowedItem> {
  /** The items to render, oldest first. */
  readonly visible: readonly T[]
  /** Older turns exist behind the top of the list. */
  readonly hasOlder: boolean
  /** A batch is being brought in. Drives the mark at the top of the list. */
  readonly loading: boolean
  /** Attach to a sentinel element above the first rendered message. */
  readonly sentinel: (node: HTMLElement | null) => void
}

export function useTranscriptWindow<T extends WindowedItem>(
  items: readonly T[],
  viewport: React.RefObject<HTMLElement | null>,
): TranscriptWindow<T> {
  const [count, setCount] = useState(INITIAL)
  const [loading, setLoading] = useState(false)

  const total = items.length
  const shown = Math.min(count, total)
  const hasOlder = shown < total

  /**
   * Reset when the conversation changes, not when it grows.
   *
   * Keyed on the first message's id rather than on length: length changes on
   * every streamed reply, and resetting there would throw away everything the
   * reader had paged in each time the model spoke.
   */
  const anchorId = items[0]?.id
  useEffect(() => {
    setCount(INITIAL)
  }, [anchorId])

  /**
   * Hold the reader still while older turns are inserted above them.
   *
   * This is the whole difficulty. Content added above the viewport pushes
   * everything down by its own height, so without compensation the reader is
   * thrown backwards by a screen and a half at the exact moment they were
   * reading — and the auto-scroll follow, seeing an upward jump, would then
   * unpin as though they had done it deliberately.
   *
   * `useLayoutEffect` runs after the DOM is updated and before the browser
   * paints, so the correction lands in the same frame as the insertion and
   * nothing is ever drawn in the wrong place.
   *
   * ---- Why the container turns CSS scroll anchoring off --------------------
   *
   * Browsers already do a version of this. Chromium's scroll anchoring watches
   * for content inserted above the viewport and shifts `scrollTop` to keep the
   * visible content still — and measured, it moves it by *exactly* the height
   * that was added.
   *
   * Which means leaving it on and also correcting here is a double correction,
   * and that is not a theoretical worry: `scrollTop += delta` on top of the
   * browser's own adjustment threw the reader several hundred pixels the wrong
   * way. The two fixes fought and the sum was the bug.
   *
   * So anchoring is switched off on the viewport (`overflow-anchor: none` in
   * `index.css`) and this owns the correction outright. Deferring to the
   * browser instead would work today and is the more fragile choice: anchoring
   * is a heuristic that suppresses itself in cases it considers ambiguous —
   * including around programmatic scrolls, which the follow performs on every
   * frame of every stream. A correction that silently stops applying under load
   * is worse than one that always runs.
   *
   * The correction is absolute rather than relative for the same reason. `+=`
   * assumes nothing else touched the position between the measurement and the
   * effect; setting it from the recorded values cannot compound.
   */
  const pending = useRef<{ height: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const element = viewport.current
    if (!element || pending.current === null) return

    const { height, top } = pending.current
    pending.current = null

    const delta = element.scrollHeight - height
    if (delta > 0) element.scrollTop = top + delta

    setLoading(false)
  }, [shown, viewport])

  const loadOlder = useCallback(() => {
    const element = viewport.current
    if (!element) return

    setLoading(true)
    // Both, recorded before the state change: the height tells the effect how
    // much taller the document became, and the position is what the correction
    // is measured from.
    pending.current = { height: element.scrollHeight, top: element.scrollTop }
    setCount((current) => current + BATCH)
  }, [viewport])

  /**
   * Watch a sentinel rather than the scroll position.
   *
   * A scroll handler would run on every frame of every scroll and recompute a
   * threshold that only matters near the top. An observer fires when the
   * boundary is genuinely approached and costs nothing the rest of the time —
   * and it also handles the case a scroll handler misses entirely, where a
   * batch arrives shorter than the viewport and the boundary is *still* on
   * screen, so the next batch is requested immediately.
   */
  const observer = useRef<IntersectionObserver | null>(null)

  const sentinel = useCallback(
    (node: HTMLElement | null) => {
      observer.current?.disconnect()
      if (!node || !hasOlder) return

      observer.current = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) loadOlder()
        },
        { root: viewport.current, rootMargin: `${TRIGGER_MARGIN}px 0px 0px 0px` },
      )
      observer.current.observe(node)
    },
    [hasOlder, loadOlder, viewport],
  )

  useEffect(() => () => observer.current?.disconnect(), [])

  return {
    // Sliced from the end: the newest turns are the ones always present, and
    // paging extends backwards into the history.
    visible: shown >= total ? items : items.slice(total - shown),
    hasOlder,
    loading,
    sentinel,
  }
}
