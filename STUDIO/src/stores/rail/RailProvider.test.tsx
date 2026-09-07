/**
 * @vitest-environment jsdom
 */
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ReactNode } from 'react'

import { RailProvider, planEntryId, useRail } from './RailProvider'
import type { Artifact } from '@/domain/artifacts/types'

/**
 * The rail's rules, as the plan entry meets them.
 *
 * Artifacts accumulate and the cap drops the oldest; a conversation has one
 * plan, so the plan entry is keyed by the conversation - opening it twice
 * focuses it - and is exempt from that cap. Evicting the plan to make room
 * for a search result is the bug that only shows up in long sessions, which
 * is exactly why it is pinned here.
 */

afterEach(cleanup)

function artifact(id: string): Artifact {
  return { kind: 'search_results', title: `Artifact ${id}`, status: 'done', id }
}

function wrapper({ children }: { children: ReactNode }) {
  return <RailProvider>{children}</RailProvider>
}

describe('the rail holding a plan', () => {
  it('opens the conversation plan once and focuses it on a second open', () => {
    const { result } = renderHook(() => useRail(), { wrapper })

    act(() => {
      result.current.openPlan('cnv_1', 'First conversation')
    })
    act(() => {
      result.current.openPlan('cnv_1', 'First conversation')
    })

    const plans = result.current.entries.filter((entry) => entry.kind === 'plan')
    expect(plans).toHaveLength(1)
    expect(plans[0]?.id).toBe(planEntryId('cnv_1'))
    expect(result.current.activeId).toBe(planEntryId('cnv_1'))

    // And a second conversation gets its own, not the first one's.
    act(() => {
      result.current.openPlan('cnv_2', 'Second conversation')
    })
    expect(result.current.entries.filter((entry) => entry.kind === 'plan')).toHaveLength(2)
    expect(result.current.activeId).toBe(planEntryId('cnv_2'))
  })

  it('is exempt from the twelve-entry cap: thirteen artifacts do not evict it', () => {
    const { result } = renderHook(() => useRail(), { wrapper })

    act(() => {
      result.current.openPlan('cnv_1', 'Conversation')
    })
    for (let at = 0; at < 13; at += 1) {
      act(() => {
        result.current.openArtifact(artifact(`art_${at}`), 'cnv_1', 'Conversation')
      })
    }

    // The cap governs the whole strip, so artifacts give the plan one of the
    // twelve places - but the plan itself is never the entry dropped.
    expect(result.current.entries.filter((entry) => entry.kind === 'artifact')).toHaveLength(11)
    expect(
      result.current.entries.find((entry) => entry.id === planEntryId('cnv_1')),
    ).toBeDefined()

    // A fourteenth artifact takes the freed place; the oldest artifact goes,
    // the plan stays.
    act(() => {
      result.current.openArtifact(artifact('art_13'), 'cnv_1', 'Conversation')
    })
    expect(
      result.current.entries.find((entry) => entry.id === planEntryId('cnv_1')),
    ).toBeDefined()
    expect(result.current.entries.filter((entry) => entry.kind === 'artifact')).toHaveLength(11)
  })

  it('holds the cap when the plan arrives last, not only when it arrives first', () => {
    // The other filling order. Twelve artifacts first, then the plan: if the
    // cap is applied only where artifacts are opened, the strip quietly sits
    // at thirteen and the rule the exemption is written against stops being
    // true in half the cases.
    const { result } = renderHook(() => useRail(), { wrapper })

    for (let at = 0; at < 12; at += 1) {
      act(() => {
        result.current.openArtifact(artifact(`art_${at}`), 'cnv_1', 'Conversation')
      })
    }
    expect(result.current.entries).toHaveLength(12)

    act(() => {
      result.current.openPlan('cnv_1', 'Conversation')
    })

    expect(result.current.entries).toHaveLength(12)
    expect(result.current.entries.filter((entry) => entry.kind === 'artifact')).toHaveLength(11)
    expect(
      result.current.entries.find((entry) => entry.id === planEntryId('cnv_1')),
    ).toBeDefined()
    // The oldest artifact is the one that made room.
    expect(result.current.entries.find((entry) => entry.id === 'art_0')).toBeUndefined()
  })

  it('closes like any entry: closing the plan empties the rail when it is all there was', () => {
    const { result } = renderHook(() => useRail(), { wrapper })

    act(() => {
      result.current.openPlan('cnv_1', 'Conversation')
    })
    act(() => {
      result.current.close(planEntryId('cnv_1'))
    })

    expect(result.current.entries).toHaveLength(0)
    expect(result.current.activeId).toBeNull()
  })
})

/**
 * The background-commands entry, which is keyed the way the plan is.
 *
 * Jobs arrive and end on their own schedule, so a tab per job would open and
 * close the rail under somebody reading something else in it. One entry per
 * conversation stays put.
 */
describe('the background commands entry', () => {
  it('opens once per conversation however often it is asked for', () => {
    const { result } = renderHook(() => useRail(), { wrapper })

    act(() => result.current.openJobs('cnv_1', 'A conversation'))
    act(() => result.current.openJobs('cnv_1', 'A renamed conversation'))

    const jobs = result.current.entries.filter((entry) => entry.kind === 'jobs')
    expect(jobs).toHaveLength(1)
    // Re-titled in place rather than duplicated - the same rule the plan keeps.
    expect(jobs[0]?.conversationTitle).toBe('A renamed conversation')
  })

  it('gives each conversation its own', () => {
    const { result } = renderHook(() => useRail(), { wrapper })

    act(() => result.current.openJobs('cnv_1', 'One'))
    act(() => result.current.openJobs('cnv_2', 'Two'))

    expect(result.current.entries.filter((entry) => entry.kind === 'jobs')).toHaveLength(2)
  })
})
