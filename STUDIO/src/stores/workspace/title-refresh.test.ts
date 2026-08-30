import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createTitleRefresh } from './title-refresh'

/**
 * One nudge per conversation, once, after a bounded wait - and nothing for a
 * conversation this window did not begin. The delay is the honest part: the
 * harness's titling starts as the first exchange settles, so an immediate
 * re-read would prove nothing.
 */

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('createTitleRefresh', () => {
  it('refreshes once, after the delay, when a tracked conversation settles', () => {
    const refresh = vi.fn()
    const refresher = createTitleRefresh({ refresh, delayMs: 6000 })

    refresher.track('cnv_1')
    refresher.settled('cnv_1')

    vi.advanceTimersByTime(5999)
    expect(refresh).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('does nothing for a conversation this window did not begin', () => {
    const refresh = vi.fn()
    const refresher = createTitleRefresh({ refresh, delayMs: 6000 })

    refresher.settled('cnv_untracked')
    vi.advanceTimersByTime(60_000)

    expect(refresh).not.toHaveBeenCalled()
  })

  it('nudges at most once per conversation', () => {
    const refresh = vi.fn()
    const refresher = createTitleRefresh({ refresh, delayMs: 6000 })

    refresher.track('cnv_1')
    refresher.settled('cnv_1')
    refresher.settled('cnv_1')
    vi.advanceTimersByTime(6000)

    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('coalesces several conversations settling into one re-read', () => {
    const refresh = vi.fn()
    const refresher = createTitleRefresh({ refresh, delayMs: 6000 })

    refresher.track('cnv_1')
    refresher.track('cnv_2')
    refresher.settled('cnv_1')
    refresher.settled('cnv_2')
    vi.advanceTimersByTime(6000)

    // One index read answers for both rows.
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('cancels a pending refresh when the window goes away', () => {
    const refresh = vi.fn()
    const refresher = createTitleRefresh({ refresh, delayMs: 6000 })

    refresher.track('cnv_1')
    refresher.settled('cnv_1')
    refresher.dispose()
    vi.advanceTimersByTime(60_000)

    expect(refresh).not.toHaveBeenCalled()
  })
})
