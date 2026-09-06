/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { type ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FLIGHT_BELT_MS, useAutoScroll } from './useAutoScroll'

/**
 * The scroll contract of the transcript viewport, and specifically of its
 * opening.
 *
 * Following a stream is the old, tested behaviour: pinned at the bottom, the
 * chase on every growth, the reader's first gesture takes over. What this
 * suite holds is the other half — that ARRIVING in a conversation ends at the
 * bottom too, no matter what the arriving layout does on the way: the paging
 * window loads older batches above the fresh viewport and holds the top still
 * with writes the engine does not make, and every one of those writes used to
 * read as a reader's scroll and unpin the follow for good. The open has its
 * own state now; these tests keep it honest from both sides — nothing the
 * layout does may unpin it, and nothing the reader does may be overridden.
 */

// jsdom has no layout, so the tests state the numbers a browser would
// measure. One shared geometry, re-stated per test; the element reads it.
const geometry = { scrollHeight: 0, clientHeight: 0, top: 0 }

function measure(height: number, client: number): void {
  geometry.scrollHeight = height
  geometry.clientHeight = client
}

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)

// The chase runs on the frame clock; the tests own the clock. Frames only
// move when `flushFrames` says so, and each one is worth 16ms.
const rafQueue: FrameRequestCallback[] = []
vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number =>
  rafQueue.push(callback),
)
vi.stubGlobal('cancelAnimationFrame', (id: number): void => {
  rafQueue.splice(id - 1, 1)
})

let ticks = 0
function flushFrames(count = 3): void {
  for (let frame = 0; frame < count; frame += 1) {
    const due = rafQueue.splice(0)
    ticks += 1
    for (const callback of due) callback(performance.now() + ticks * 16)
  }
}

function installGeometry(element: HTMLElement): void {
  Object.defineProperty(element, 'scrollHeight', {
    configurable: true,
    get: () => geometry.scrollHeight,
  })
  Object.defineProperty(element, 'clientHeight', {
    configurable: true,
    get: () => geometry.clientHeight,
  })
  Object.defineProperty(element, 'scrollTop', {
    configurable: true,
    get: () => geometry.top,
    set(value: number) {
      const max = Math.max(geometry.scrollHeight - geometry.clientHeight, 0)
      geometry.top = Math.min(Math.max(value, 0), max)
      // The real element fires this from the scroll steps rather than the
      // write; synchronous is the same contract with the waiting removed.
      element.dispatchEvent(new Event('scroll', { bubbles: true }))
    },
  })
}

type Auto = ReturnType<typeof useAutoScroll>
let latest: Auto | null = null

/** The page wiring, exactly as ChatPage hangs it on the viewport. */
function Probe({ dependency, navigation }: { dependency: number; navigation: string }): ReactElement {
  const auto = useAutoScroll(dependency, navigation)
  latest = auto
  return (
    <div
      ref={auto.viewport}
      onScroll={auto.onScroll}
      onWheel={auto.onWheel}
      onPointerDown={auto.onPointerDown}
      onKeyDown={auto.onKeyDown}
    >
      <div />
    </div>
  )
}

function mountTranscript(
  dependency = 1,
  navigation = 'cnv_a',
): ReturnType<typeof render> {
  const view = render(<Probe dependency={dependency} navigation={navigation} />)
  const viewport = latest?.viewport.current
  if (!viewport) throw new Error('the probe never mounted a viewport')
  installGeometry(viewport)
  return view
}

function viewportElement(): HTMLElement {
  const viewport = latest?.viewport.current
  if (!viewport) throw new Error('no viewport to scroll')
  return viewport
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  latest = null
  geometry.scrollHeight = 0
  geometry.clientHeight = 0
  geometry.top = 0
  rafQueue.length = 0
})

describe('the open', () => {
  it('glides before it lands, a journey instead of a jump', () => {
    mountTranscript()
    measure(4000, 500)
    // One frame in, the open has covered part of the distance and is still
    // travelling: the reader watches the transcript go by, fast at the
    // start, settling as it arrives. A teleport here would be the bug.
    act(() => flushFrames(1))
    expect(geometry.top).toBeGreaterThan(0)
    expect(geometry.top).toBeLessThan(3500)

    act(() => flushFrames(60))
    expect(geometry.top).toBeCloseTo(3500, 0)
    expect(latest?.pinned).toBe(true)
  })

  it('holds the pin through a paging correction made while it was still landing', () => {
    const view = mountTranscript()
    // A first delivery too short to scroll: the chase arrives at nothing,
    // and the boarding holds for the deliveries that follow.
    measure(600, 600)
    act(() => flushFrames(2))

    // The tall delivery lands, and the paging window answers it the way it
    // answers every load: an older batch above, and a correction write that
    // holds the top of the document where it was.
    measure(4000, 500)
    view.rerender(<Probe dependency={2} navigation="cnv_a" />)
    act(() => {
      viewportElement().scrollTop = 800
    })
    // The correction is not a reader. The pin survives it, and the chase
    // that is still owed finishes the journey.
    expect(latest?.pinned).toBe(true)
    act(() => flushFrames(60))
    expect(geometry.top).toBeCloseTo(3500, 0)
  })

  it('does not yank a reader who moved during the open', () => {
    mountTranscript()
    measure(4000, 500)
    fireEvent.wheel(viewportElement(), { deltaY: -40 })
    expect(latest?.pinned).toBe(false)

    act(() => flushFrames(3))
    expect(geometry.top).toBe(0)
  })

  it('reads scrolls by classification again once the open has landed', () => {
    mountTranscript()
    measure(4000, 500)
    act(() => flushFrames(60))
    expect(geometry.top).toBeCloseTo(3500, 0)

    // A clamp from a content swap after arrival: classified as it always
    // was — upward, unpinned. The boarding is over; the ordinary contract
    // owns every scroll from here.
    act(() => {
      viewportElement().scrollTop = 0
    })
    expect(latest?.pinned).toBe(false)
  })

  it('opens the next conversation at its bottom when the page is reused', () => {
    const view = mountTranscript(1, 'cnv_a')
    measure(4000, 500)
    act(() => flushFrames(60))
    expect(geometry.top).toBeCloseTo(3500, 0)

    // The reader scrolled up in conversation A and stayed there.
    fireEvent.wheel(viewportElement(), { deltaY: -40 })
    expect(latest?.pinned).toBe(false)

    // Conversation B arrives on the same mounted page: taller, and worth
    // the bottom all over again.
    measure(6000, 500)
    view.rerender(<Probe dependency={2} navigation="cnv_b" />)
    act(() => flushFrames(60))

    expect(geometry.top).toBeCloseTo(5500, 0)
    expect(latest?.pinned).toBe(true)
  })
})

describe('the jump to latest', () => {
  /** jsdom has no smooth scrolling; the flight's own echoes stand in for it. */
  function stubScrollTo(): void {
    Object.defineProperty(viewportElement(), 'scrollTo', {
      configurable: true,
      value: () => {},
    })
  }

  it('settles on the echo that reaches the bottom, scrollend or not', () => {
    mountTranscript()
    measure(4000, 500)
    act(() => flushFrames(60))
    // The reader is away from the bottom, arrow in view; they click it.
    act(() => {
      viewportElement().scrollTop = 2000
    })
    expect(latest?.pinned).toBe(false)
    stubScrollTo()
    act(() => {
      latest?.scrollToBottom()
    })
    expect(latest?.pinned).toBe(false)

    // The flight runs; its echoes are its own. The one that reaches the
    // bottom is the arrival, whether or not any event confirms it.
    act(() => {
      viewportElement().scrollTop = 3400
    })
    expect(latest?.pinned).toBe(false)
    act(() => {
      viewportElement().scrollTop = 3500
    })
    expect(latest?.pinned).toBe(true)
  })

  it('does not pin on a scrollend that lands short of the bottom', () => {
    mountTranscript()
    measure(4000, 500)
    act(() => flushFrames(60))
    act(() => {
      viewportElement().scrollTop = 2000
    })
    stubScrollTo()
    act(() => {
      latest?.scrollToBottom()
    })
    // The engine reports the flight's end anyway -- content grew under it,
    // or a programmatic write aborted it -- and the report lands far from
    // the bottom. That is not an arrival: the pin waits for the real one,
    // or the arrow vanishes while the reader sits mid-transcript.
    act(() => {
      viewportElement().dispatchEvent(new Event('scrollend'))
    })
    expect(latest?.pinned).toBe(false)
  })

  it('interrupts a flight the reader pressed to stop', () => {
    mountTranscript()
    measure(4000, 500)
    act(() => flushFrames(60))
    act(() => {
      viewportElement().scrollTop = 2000
    })
    const scrollTo = vi.fn()
    Object.defineProperty(viewportElement(), 'scrollTo', {
      configurable: true,
      value: scrollTo,
    })
    act(() => {
      latest?.scrollToBottom()
    })
    expect(scrollTo).toHaveBeenCalledWith({ top: 4000, behavior: 'smooth' })
    // The press ends the flight where it stands: a press alone does not
    // cancel a programmatic smooth scroll, and the echoes it would keep
    // producing would re-pin the reader at the bottom over their decision.
    fireEvent.pointerDown(viewportElement())
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 2000 })
    expect(latest?.pinned).toBe(false)
  })

  it('ends a flight that never reports, and classifies again after it', () => {
    // Only the belt's clock is faked: the frame clock stays in the suite's
    // own hands, and a wholesale fake would capture the frame queue with it.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    mountTranscript()
    measure(4000, 500)
    act(() => flushFrames(60))
    act(() => {
      viewportElement().scrollTop = 2000
    })
    stubScrollTo()
    act(() => {
      latest?.scrollToBottom()
    })
    expect(latest?.pinned).toBe(false)

    // The flight is cancelled the way browsers cancel them: silently. No
    // scrollend, no echoes, nothing. The belt ends its claim, and the next
    // scroll is read as what it is instead of swallowed.
    act(() => {
      vi.advanceTimersByTime(FLIGHT_BELT_MS + 1)
    })
    act(() => {
      viewportElement().scrollTop = 3470
    })
    expect(latest?.pinned).toBe(true)
  })
})
