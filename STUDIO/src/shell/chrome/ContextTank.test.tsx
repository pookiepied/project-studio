/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { contextBreakdown } from '@/domain/turn/context'
import { ContextDetails, ContextTank } from '@/shell/chrome/ContextTank'

/**
 * The context account says only what something measured.
 *
 * The pressure on a panel like this is to look complete: a row for the system
 * prompt, one for tool definitions, one for MCP, one for skills, one for
 * memory. None of that is reported by any provider and none of it is counted
 * by the harness, so each row would be a number invented to fill a table.
 * What is pinned here is the opposite: the divisions that exist, the estimate
 * marked as an estimate, and no row for a figure nobody produced.
 */

afterEach(cleanup)

function tank(
  measured: { fresh: number; cached: number; reply: number; estimated?: boolean } | null,
  pending: number,
  window: number | 'unknown' | null = 200_000,
) {
  const breakdown = contextBreakdown(
    { measured: measured === null ? null : { estimated: false, ...measured }, pending },
    window,
  )
  render(
    <>
      <ContextTank breakdown={breakdown} running={false} />
      <ContextDetails breakdown={breakdown} />
    </>,
  )
}

describe('the context tank', () => {
  it('states the fill against the window, in units a person reads', () => {
    tank({ fresh: 10_000, cached: 30_000, reply: 2_000 }, 0)

    expect(screen.getByText('42k')).toBeTruthy()
    expect(screen.getByText(/200k · 21%/)).toBeTruthy()
  })

  it('draws the bands in the window own proportions', () => {
    tank({ fresh: 50_000, cached: 0, reply: 0 }, 0)

    const meter = screen.getByRole('meter', { name: 'Context used' })
    expect(meter.getAttribute('aria-valuenow')).toBe('25')
    expect((meter.firstElementChild as HTMLElement | null)?.style.width).toBe('25%')
  })
})

describe('the breakdown behind it', () => {
  it('divides the window into what was sent, what came back, and what is free', () => {
    tank({ fresh: 10_000, cached: 30_000, reply: 2_000 }, 0)

    // The prompt is one figure to a reader, however the provider split it for
    // billing: 10,000 fresh plus 30,000 from cache is 40k sent.
    expect(screen.getByText('40k')).toBeTruthy()
    expect(screen.getByText('2k')).toBeTruthy()
    expect(screen.getByText('158k')).toBeTruthy()
  })

  it('marks the unmeasured tail as an estimate rather than letting it pass', () => {
    tank({ fresh: 1_000, cached: 0, reply: 100 }, 250)

    expect(screen.getByText('Since that turn')).toBeTruthy()
    expect(screen.getByText('~250')).toBeTruthy()
  })

  it('draws no row for a division that measured nothing', () => {
    // A conversation whose first reply has not landed has no measured turn at
    // all, and a "Reply: 0" row would be a statement about a turn that never
    // happened.
    tank(null, 400)

    expect(screen.queryByText('Sent to the model')).toBeNull()
    expect(screen.queryByText('Reply')).toBeNull()
    expect(screen.getByText('This conversation')).toBeTruthy()
  })

  it('drops a row whose division measured zero', () => {
    // The settled case, and the common one: a turn has reported and nothing
    // has been typed since. A "Since that turn: ~0" row is a row about
    // nothing, and a "Reply: 0" on a turn that failed before producing
    // anything is worse - it reads as a reply that was empty.
    tank({ fresh: 1_000, cached: 0, reply: 0 }, 0)

    expect(screen.getByText('Sent to the model')).toBeTruthy()
    expect(screen.queryByText('Reply')).toBeNull()
    expect(screen.queryByText('Since that turn')).toBeNull()
  })

  it('says when the window it divided by is a stand-in', () => {
    tank({ fresh: 1_000, cached: 0, reply: 0 }, 0, 'unknown')

    expect(screen.getByText(/declares no window/)).toBeTruthy()
  })

  it('says how much of the prompt the cache carried, and that it still occupies the window', () => {
    tank({ fresh: 5_000, cached: 35_000, reply: 100 }, 0)

    expect(screen.getByText(/35k of the 40k sent came from the cache/)).toBeTruthy()
  })
})
