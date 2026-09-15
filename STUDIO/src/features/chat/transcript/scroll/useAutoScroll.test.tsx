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

/** Frames enough for any chase to settle. */
const OPEN_FRAMES = 160

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
function Probe({
  dependency,
  navigation,
  ready = true,
}: {
  dependency: number
  navigation: string
  ready?: boolean
}): ReactElement {
  const auto = useAutoScroll(dependency, navigation, ready)
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
  it('lands at the bottom at once while the words are unseen, and says so', () => {
    const view = render(<Probe dependency={1} navigation="cnv_a" ready={false} />)
    const viewport = latest?.viewport.current
    if (!viewport) throw new Error('the probe never mounted a viewport')
    installGeometry(viewport)
    measure(4000, 500)
    expect(latest?.landed).toBe(false)

    // One frame: the whole distance, no journey - nobody is watching one.
    act(() => flushFrames(2))
    expect(geometry.top).toBeCloseTo(3500, 0)
    expect(latest?.landed).toBe(true)
    expect(latest?.pinned).toBe(true)

    // Shown, the follow is the ordinary chase again.
    view.rerender(<Probe dependency={1} navigation="cnv_a" ready />)
    act(() => flushFrames(2))
    expect(geometry.top).toBeCloseTo(3500, 0)
  })

  it('lands on words that fit the viewport without scrolling', () => {
    const view = mountTranscript()
    const content = viewportElement().firstElementChild
    if (content) {
      Object.defineProperty(content, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ height: 300 }),
      })
    }
    // The delivery lands: content shorter than the viewport, nowhere to go.
    measure(300, 500)
    view.rerender(<Probe dependency={2} navigation="cnv_a" />)
    expect(latest?.landed).toBe(true)
  })

  it('follows shown words as a chase, a journey instead of a jump', () => {
    mountTranscript()
    measure(4000, 500)
    // One frame in, the chase has covered part of the distance and is still
    // travelling - the streaming follow's own glide.
    act(() => flushFrames(1))
    expect(geometry.top).toBeGreaterThan(0)

    act(() => flushFrames(OPEN_FRAMES))
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
    act(() => flushFrames(OPEN_FRAMES))
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
    act(() => flushFrames(OPEN_FRAMES))
    expect(geometry.top).toBeCloseTo(3500, 0)

    // A clamp from a content swap after arrival: classified as it always
    // was — upward, unpinned. The boarding is over; the ordinary contract
    // owns every scroll from here.
    act(() => {
      viewportElement().scrollTop = 0
    })
    expect(latest?.pinned).toBe(false)
  })

  it('holds the pin through a clamp that lands at the bottom of a shorter document', () => {
    const view = mountTranscript()
    measure(4000, 500)
    act(() => flushFrames(OPEN_FRAMES))
    expect(geometry.top).toBeCloseTo(3500, 0)

    // The document loses height under a viewport at its end - rows stepped
    // out of layout for the sidebar's move - and the position is clamped to
    // the new end. Upward by position, but nobody scrolled.
    measure(2000, 500)
    act(() => {
      viewportElement().scrollTop = 3500
    })
    expect(geometry.top).toBe(1500)
    expect(latest?.pinned).toBe(true)

    // The height comes back when the move lands (a delivery stands in for
    // the resize observer here), and the follow is still alive to chase it.
    measure(4000, 500)
    view.rerender(<Probe dependency={2} navigation="cnv_a" />)
    act(() => flushFrames(OPEN_FRAMES))
    expect(geometry.top).toBeCloseTo(3500, 0)
    expect(latest?.pinned).toBe(true)
  })

  it('opens the next conversation at its bottom when the page is reused', () => {
    const view = mountTranscript(1, 'cnv_a')
    measure(4000, 500)
    act(() => flushFrames(OPEN_FRAMES))
    expect(geometry.top).toBeCloseTo(3500, 0)

    // The reader scrolled up in conversation A and stayed there.
    fireEvent.wheel(viewportElement(), { deltaY: -40 })
    expect(latest?.pinned).toBe(false)

    // Conversation B arrives on the same mounted page: taller, and worth
    // the bottom all over again.
    measure(6000, 500)
    view.rerender(<Probe dependency={2} navigation="cnv_b" />)
    act(() => flushFrames(OPEN_FRAMES))

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
    act(() => flushFrames(OPEN_FRAMES))
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
    act(() => flushFrames(OPEN_FRAMES))
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
    act(() => flushFrames(OPEN_FRAMES))
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
    act(() => flushFrames(OPEN_FRAMES))
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
