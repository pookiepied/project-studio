import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useWorkspace } from '@/stores/workspace'
import type { PlanSnapshot } from '@/platform/harness'

/**
 * How often the plan is read while a run is live: the model writes the plan
 * mid-run, and a write should reach the pill within a beat, not after it.
 */
const ACTIVE_POLL_MS = 1_000

/**
 * How often the plan is read while the conversation merely sits open. Slow,
 * because nothing here is urgent - but not zero, because the plan outlives the
 * run that wrote it, and a tick from another window should still arrive.
 */
const IDLE_POLL_MS = 10_000

/**
 * One conversation's plan, read from the store on a poll.
 *
 * The same shape the pending-questions hook runs, and deliberately not the
 * same hook: questions are a queue a person answers, the plan is standing
 * state a person edits, and the two carry different facts - a plan read
 * answers with rows or a damaged flag, never with "nothing is asked".
 *
 * A failed read keeps what was last known, for the same reason the questions
 * hook keeps theirs: the plan is durable state, and "the harness is down" is
 * not the same fact as "there is no plan".
 */
export function usePlan(
  conversationId: string,
  options: {
    /** False on surfaces with no harness conversation behind them (the gallery). */
    readonly enabled?: boolean
    /** Whether a run is under way - the fast cadence's trigger. */
    readonly active?: boolean
  } = {},
): {
  /** The last known plan, or null before the first read succeeds. */
  readonly snapshot: PlanSnapshot | null
  /** True when the conversation has a plan to show - rows, or a damaged read. */
  readonly hasPlan: boolean
  /** The plan's items in position order; empty while unreadable or absent. */
  readonly items: PlanSnapshot['items']
  /** While a tick is in flight; the row's control is disabled. */
  readonly tickingId: string | null
  tick: (itemId: string, status: 'done' | 'pending') => Promise<void>
  clear: () => Promise<void>
} {
  const { enabled = true, active = false } = options
  const { plans } = useWorkspace()

  const [snapshot, setSnapshot] = useState<PlanSnapshot | null>(null)
  const [tickingId, setTickingId] = useState<string | null>(null)
  const liveRef = useRef(true)
  useEffect(() => {
    liveRef.current = true
    return () => {
      liveRef.current = false
    }
  }, [])

  const hasPlan = snapshot !== null && (snapshot.damaged || snapshot.items.length > 0)

  const read = useCallback(async (current: () => boolean) => {
    const result = await plans.get(conversationId)
    if (!result.ok || !liveRef.current || !current()) return
    setSnapshot(result.value)
  }, [plans, conversationId])

  // A per-conversation read must not show the previous conversation's plan
  // across a switch, so the snapshot drops with the id. The questions hook
  // needs no such reset - it holds every conversation's rows and filters.
  useEffect(() => {
    setSnapshot(null)
  }, [conversationId])

  useEffect(() => {
    if (!enabled) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const tickPoll = () => {
      void read(() => !disposed).then(() => {
        if (liveRef.current && !disposed) timer = setTimeout(tickPoll, active ? ACTIVE_POLL_MS : IDLE_POLL_MS)
      })
    }
    tickPoll()
    return () => {
      disposed = true
      if (timer !== null) clearTimeout(timer)
    }
  }, [enabled, active, read])

  const tick = useCallback(
    async (itemId: string, status: 'done' | 'pending') => {
      setTickingId(itemId)
      try {
        const result = await plans.tick(conversationId, itemId, status)
        // Only an accepted tick writes the row locally; a refusal stays for
        // the next poll to reconcile, which also catches another window
        // having settled the same item first.
        if (result.ok && liveRef.current) {
          setSnapshot((current) =>
            current === null
              ? current
              : {
                  ...current,
                  items: current.items.map((item) =>
                    item.id === itemId
                      ? { ...item, status, updatedBy: 'person', updatedAt: Date.now() }
                      : item,
                  ),
                },
          )
        }
      } finally {
        if (liveRef.current) setTickingId(null)
      }
    },
    [plans, conversationId],
  )

  const clear = useCallback(async () => {
    const result = await plans.clear(conversationId)
    // Clearing is removing rows, not settling them: an accepted clear empties
    // the view now rather than waiting a poll to confirm what was asked for.
    if (result.ok && liveRef.current) setSnapshot(null)
  }, [plans, conversationId])

  // The panel renders in position order, which is the order the harness
  // returns. Sorted here rather than trusted, so a wire that omits the sort
  // cannot make the list jump under the reader.
  const items = useMemo(() => {
    if (snapshot === null || snapshot.damaged) return []
    return [...snapshot.items].sort((a, b) => a.position - b.position)
  }, [snapshot])

  return { snapshot, hasPlan, items, tickingId, tick, clear }
}
