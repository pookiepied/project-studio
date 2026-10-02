import { useCallback, useEffect, useRef, useState } from 'react'
import {
  useHarnessClient,
  type GrantRecord,
  type HarnessFailure,
} from '@/platform/harness'

/**
 * The Permissions pane's data: the standing approvals, and the one write the
 * page offers — taking one back. Smaller than its siblings because the page
 * is a ledger: nothing here is created or edited, only read and revoked, and
 * a revoke that fails leaves the row exactly where it was.
 */

export type GrantsView =
  | { readonly status: 'no-harness' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly grants: readonly GrantRecord[] }
  | { readonly status: 'failed'; readonly error: HarnessFailure }

export interface Grants {
  readonly view: GrantsView
  readonly refreshing: boolean
  refresh: () => Promise<void>
  /** Resolves to the failure to show, or null when the grant was revoked. */
  revoke: (id: string) => Promise<HarnessFailure | null>
}

const NO_HARNESS: HarnessFailure = {
  kind: 'not-reachable',
  message: 'The harness is not running.',
  timedOut: false,
}

export function useGrants(): Grants {
  const [view, setView] = useState<GrantsView>({ status: 'loading' })
  const [refreshing, setRefreshing] = useState(false)
  const connect = useHarnessClient()
  const live = useRef(true)

  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])

  const readAll = useCallback(
    async (quiet: boolean) => {
      const harness = await connect()
      if (!live.current) return
      if (harness === null) {
        setView({ status: 'no-harness' })
        return
      }
      if (quiet) setRefreshing(true)
      const result = await harness.listGrants()
      if (!live.current) return
      setRefreshing(false)
      if (!result.ok) {
        if (!quiet) setView({ status: 'failed', error: result.error })
        return
      }
      setView({ status: 'ready', grants: result.value })
    },
    [connect],
  )

  useEffect(() => {
    void readAll(false)
  }, [readAll])

  const revoke = useCallback(
    async (id: string): Promise<HarnessFailure | null> => {
      const harness = await connect()
      if (harness === null) return NO_HARNESS
      const result = await harness.revokeGrant(id)
      if (!result.ok) return result.error
      await readAll(true)
      return null
    },
    [connect, readAll],
  )

  return {
    view,
    refreshing,
    refresh: useCallback(() => readAll(true), [readAll]),
    revoke,
  }
}
