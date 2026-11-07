/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { HANDOVER_GRACE_MS, useCompactionHandover } from './useCompactionHandover'

afterEach(() => {
  vi.useRealTimers()
})

/**
 * The wait line and the record are one line: the wait holds its slot until
 * the record is in the log, and goes in the render the record arrives.
 */
describe('the compaction handover', () => {
  it('holds the wait line past the flag until the record arrives', () => {
    // Every render's answer: the handover is the render the record lands in,
    // before the hook's own effect tidies up after it.
    const renders: { waiting: boolean; handedOver: boolean }[] = []
    const { result, rerender } = renderHook(
      ({ compacting, records }) => {
        const answer = useCompactionHandover(compacting, records)
        renders.push(answer)
        return answer
      },
      { initialProps: { compacting: false, records: 1 } },
    )
    expect(result.current.waiting).toBe(false)

    rerender({ compacting: true, records: 1 })
    expect(result.current).toEqual({ waiting: true, handedOver: false })

    // The harness answered; the page is re-reading the log.
    rerender({ compacting: false, records: 1 })
    expect(result.current.waiting).toBe(true)

    // The record lands: the wait goes in this same render, as a handover.
    const before = renders.length
    rerender({ compacting: false, records: 2 })
    expect(renders[before]).toEqual({ waiting: false, handedOver: true })
    expect(result.current.waiting).toBe(false)
  })

  it('hands over even when the record beats the flag', () => {
    const { result, rerender } = renderHook(
      ({ compacting, records }) => useCompactionHandover(compacting, records),
      { initialProps: { compacting: true, records: 0 } },
    )
    rerender({ compacting: true, records: 1 })
    expect(result.current.waiting).toBe(false)
    rerender({ compacting: false, records: 1 })
    expect(result.current.waiting).toBe(false)
  })

  it('lets a refused compaction fold away after the grace', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(
      ({ compacting, records }) => useCompactionHandover(compacting, records),
      { initialProps: { compacting: true, records: 0 } },
    )
    rerender({ compacting: false, records: 0 })
    expect(result.current.waiting).toBe(true)
    act(() => {
      vi.advanceTimersByTime(HANDOVER_GRACE_MS)
    })
    expect(result.current).toEqual({ waiting: false, handedOver: false })
  })
})
