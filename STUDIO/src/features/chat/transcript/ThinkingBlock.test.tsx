/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ThinkingBlock, type ThinkingSpan } from './ThinkingBlock'

/**
 * The one row a collapsed reasoning trace gets.
 *
 * Its whole job at rest is to say what happened and how long it took, in as
 * few marks as possible. What it may claim about time is the part that keeps
 * being got wrong, and the rule it settled on is narrow: the row measures the
 * REASONING RUN, from its first delta to its last, and never the silence in
 * front of it. That silence is partly the provider's latency and partly
 * hidden thinking this window cannot see, and while the row was anchored to
 * the submission receipt it reported the two as one number about the model.
 *
 * The row does not exist before its run does, so there is no state here for
 * "a turn is running and nothing has arrived". That is drawn by nothing at
 * all, and said by the ring on the send control.
 */

/** When the reasoning run opened — this row's zero, and the only one. */
const OPENED = 1_700_000_000_000

function measured(since: number | null, until: number | null): ThinkingSpan {
  return { kind: 'measured', since, until }
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

/**
 * The chevron is the row's only icon-set mark — the brand mark beside it is a
 * StudioMark, not an `Icons.*` — so `studio-icon` identifies it without a test
 * hook. Lucide marks wrap in a span and the class lands there, not on the svg.
 */
function disclosureClasses(container: HTMLElement): string {
  const marks = container.querySelectorAll('button span.studio-icon')
  if (marks.length !== 1) throw new Error(`expected one chevron, saw ${marks.length}`)
  return marks[0].getAttribute('class') ?? ''
}

describe('what the row says about a finished run', () => {
  it('reports the span its own deltas landed over', () => {
    render(
      <ThinkingBlock
        text="working it out"
        span={measured(OPENED, OPENED + 11_000)}
        live={false}
      />,
    )
    expect(screen.getByText('Thought for 11s')).toBeTruthy()
  })

  it('claims no duration for a trace that was seen exactly once', () => {
    // Google delivers thought summaries whole, in a single delta: measured on
    // a real turn, the run opened and closed inside 320ms of a three-second
    // wait. Two identical timestamps are ONE observation, not a span of zero,
    // and "Thought for a moment" over a trace the model spent seconds on is
    // the fabrication this rule exists to refuse.
    render(<ThinkingBlock text="working it out" span={measured(OPENED, OPENED)} live={false} />)
    expect(screen.getByText('Thought')).toBeTruthy()
    expect(screen.queryByText(/Thought for/)).toBeNull()
  })

  it('claims nothing for a run this window did not watch', () => {
    // A reattach hands back a two-minute turn in fifty milliseconds. Neither
    // number is the run, so no number is shown.
    render(<ThinkingBlock text="working it out" span={measured(null, null)} live={false} />)
    expect(screen.getByText('Thought')).toBeTruthy()
    expect(screen.queryByText(/Thought for/)).toBeNull()
  })

  it('repeats a stated duration rather than measuring one', () => {
    // The artifact gallery is a scripted display, not a conversation. Its
    // number was written down, and the clock has nothing to do with it.
    render(
      <ThinkingBlock text="working it out" span={{ kind: 'stated', seconds: 4 }} live={false} />,
    )
    expect(screen.getByText('Thought for 4s')).toBeTruthy()
  })
})

describe('the clock while a run is live', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(OPENED + 3_000)
  })

  it('counts from the run, so a trace still arriving is legible as it happens', () => {
    render(<ThinkingBlock text="half a thought" span={measured(OPENED, null)} live />)
    expect(screen.getByText('Thinking for 3s')).toBeTruthy()
  })

  it('advances on its own between deltas', () => {
    // A provider that streams its reasoning can go seconds between deltas,
    // and a row frozen at "Thinking" through them reads as a stall.
    render(<ThinkingBlock text="half a thought" span={measured(OPENED, null)} live />)
    expect(screen.getByText('Thinking for 3s')).toBeTruthy()

    // Advancing the timers advances the mocked clock with them, which is the
    // point: the row re-reads the clock, it does not count its own ticks.
    act(() => {
      vi.advanceTimersByTime(6_000)
    })
    expect(screen.getByText('Thinking for 9s')).toBeTruthy()
  })

  it('stops when the run does, leaving the total on screen', () => {
    const view = render(<ThinkingBlock text="half a thought" span={measured(OPENED, null)} live />)
    act(() => {
      vi.advanceTimersByTime(4_000)
    })

    view.rerender(
      <ThinkingBlock
        text="working it out"
        span={measured(OPENED, OPENED + 7_400)}
        live={false}
      />,
    )
    // Frozen at what was measured, and unmoved by the clock running on.
    act(() => {
      vi.advanceTimersByTime(23_000)
    })
    expect(screen.getByText('Thought for 7s')).toBeTruthy()
  })

  it('runs no clock for a stated duration, which cannot change', () => {
    render(<ThinkingBlock text="half a thought" span={{ kind: 'stated', seconds: 4 }} live />)
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(screen.getByText('Thinking for 4s')).toBeTruthy()
  })
})

describe('the disclosure control', () => {
  it('is not drawn at rest', () => {
    const { container } = render(
      <ThinkingBlock text="working it out" span={measured(OPENED, OPENED + 4_000)} live={false} />,
    )
    expect(disclosureClasses(container)).toContain('opacity-0')
  })

  it('is drawn while the trace is open, which is when it means something', () => {
    const { container } = render(
      <ThinkingBlock text="working it out" span={measured(OPENED, OPENED + 4_000)} live={false} />,
    )
    fireEvent.click(screen.getByRole('button'))

    expect(disclosureClasses(container)).toContain('opacity-100')
    expect(screen.getByText('working it out')).toBeTruthy()
  })
})

/**
 * The gap between a reasoning run opening and its first delta. The run exists
 * — the wire said so — so the row exists and says the model is thinking. It
 * has nothing to disclose yet, which makes it a statement rather than a
 * control until the words arrive.
 */
describe('a run that has opened but delivered nothing', () => {
  it('carries no disclosure, because there is nothing behind it', () => {
    const { container } = render(<ThinkingBlock text="" span={measured(OPENED, null)} live />)

    expect(container.querySelectorAll('button span.studio-icon')).toHaveLength(0)
  })

  it('is not a control: no tab stop, and nothing opens', () => {
    // A focusable row that does nothing when activated is worse than no row.
    render(<ThinkingBlock text="" span={measured(OPENED, null)} live />)
    const row = screen.getByRole('button')
    expect(row.hasAttribute('disabled')).toBe(true)

    fireEvent.click(row)
    expect(row.getAttribute('aria-expanded')).toBe('false')
  })

  it('says only that the model is thinking when there is no start to count from', () => {
    render(<ThinkingBlock text="" span={measured(null, null)} live />)
    expect(screen.getByText('Thinking')).toBeTruthy()
  })
})
