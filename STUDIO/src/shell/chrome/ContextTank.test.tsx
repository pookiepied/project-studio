/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { contextBreakdown } from '@/domain/turn/context'
import { ContextTank } from '@/shell/chrome/ContextTank'

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
  render(<ContextTank breakdown={breakdown} running={false} />)
}

describe('the context tank', () => {
  it('waits for measured usage after compaction rather than displaying the provisional figure', () => {
    tank({ fresh: 22_000, cached: 0, reply: 0, estimated: true }, 0)
    expect(screen.getByText('Awaiting next turn')).toBeTruthy()
    expect(screen.getByText(/Usage will be measured on the next turn/)).toBeTruthy()
    expect(screen.queryByText(/22k/)).toBeNull()
    expect(screen.queryByRole('meter')).toBeNull()
  })

  it('returns to measured figures once the next turn reports usage', () => {
    tank({ fresh: 16_000, cached: 0, reply: 0 }, 0)
    expect(screen.queryByText('Awaiting next turn')).toBeNull()
    expect(screen.getByText('16k')).toBeTruthy()
    expect(screen.getByRole('meter').getAttribute('aria-valuenow')).toBe('8')
  })

  it('states the fill against the window, in units a person reads', () => {
    tank({ fresh: 10_000, cached: 30_000, reply: 2_000 }, 0)
    expect(screen.getByText('42k')).toBeTruthy()
    expect(screen.getByText(/200k · 21%/)).toBeTruthy()
  })

  it('draws the bands in the window own proportions', () => {
    tank({ fresh: 50_000, cached: 0, reply: 0 }, 0)
    const meter = screen.getByRole('meter', { name: 'Context used' })
    expect(meter.getAttribute('aria-valuenow')).toBe('25')
    expect(meter.children).toHaveLength(100)
    expect(meter.querySelectorAll('[data-filled]')).toHaveLength(25)
  })

  it('preserves distinct meter bands for sent, reply and pending tokens', () => {
    tank({ fresh: 10_000, cached: 30_000, reply: 6_000 }, 4_000)
    expect(screen.getByText('~50k')).toBeTruthy()
    const cells = Array.from(screen.getByRole('meter').children)
    expect(cells.filter((cell) => cell.classList.contains('bg-foreground/55'))).toHaveLength(20)
    expect(cells.filter((cell) => cell.classList.contains('bg-foreground/30'))).toHaveLength(3)
    expect(cells.filter((cell) => cell.classList.contains('bg-foreground/15'))).toHaveLength(2)
  })

  it('fills only the estimated band before a turn measures the window', () => {
    tank(null, 10_000)
    expect(screen.getByText('~10k')).toBeTruthy()
    const filled = Array.from(screen.getByRole('meter').querySelectorAll('[data-filled]'))
    expect(filled).toHaveLength(5)
    expect(filled.every((cell) => cell.classList.contains('bg-foreground/15'))).toBe(true)
  })
})
