import { useCallback, useEffect, useRef, useState } from 'react'
import {
  useHarnessClient,
  type HarnessClient,
  type HarnessFailure,
  type SkillListing,
} from '@/platform/harness'

/**
 * The Skills pane's data.
 *
 * `useMcpServers` with everything but the decision removed. There is no save
 * and no remove: a skill is installed by putting a folder in place and
 * uninstalled by taking it out, and this hook only reads what the folder
 * holds and writes what the person decided about it.
 */

export type SkillsView =
  | { readonly status: 'no-harness' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly listing: SkillListing }
  | { readonly status: 'failed'; readonly error: HarnessFailure }

export interface Skills {
  readonly view: SkillsView
  refresh: () => Promise<void>
  readonly refreshing: boolean
  /**
   * Records a decision. `null` clears it. Without a scope this writes the
   * user's default; with one, that scope's own door, exactly as the MCP hook.
   */
  setEnabled: (id: string, enabled: boolean | null) => Promise<HarnessFailure | null>
}

export interface SkillScopeTarget {
  readonly projectId?: string
  readonly conversationId?: string
}

function readScope(
  projectId: string | undefined,
  conversationId: string | undefined,
): SkillScopeTarget | undefined {
  if (projectId === undefined && conversationId === undefined) return undefined
  return {
    ...(projectId === undefined ? {} : { projectId }),
    ...(conversationId === undefined ? {} : { conversationId }),
  }
}

export function useSkills(scope: SkillScopeTarget = {}): Skills {
  const [view, setView] = useState<SkillsView>({ status: 'loading' })
  const [refreshing, setRefreshing] = useState(false)
  const connect = useHarnessClient()
  const live = useRef(true)

  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])

  // Held apart from the object for the reason `useMcpServers` gives: the
  // caller builds the scope inline, and keying on the object would re-read
  // forever.
  const projectId = scope.projectId
  const conversationId = scope.conversationId

  const read = useCallback(
    async (quiet: boolean) => {
      const harness = await connect()
      if (!live.current) return
      if (harness === null) {
        setView({ status: 'no-harness' })
        return
      }
      if (quiet) setRefreshing(true)
      const result = await harness.listSkills(readScope(projectId, conversationId))
      if (!live.current) return
      setRefreshing(false)
      if (!result.ok) {
        if (!quiet) setView({ status: 'failed', error: result.error })
        return
      }
      setView({ status: 'ready', listing: result.value })
    },
    [connect, projectId, conversationId],
  )

  useEffect(() => {
    void read(false)
  }, [read])

  const refresh = useCallback(async () => {
    await read(true)
  }, [read])

  const write = useCallback(
    async (
      run: (harness: HarnessClient) => Promise<{ ok: true } | { ok: false; error: HarnessFailure }>,
    ): Promise<HarnessFailure | null> => {
      const harness = await connect()
      if (harness === null) {
        return { kind: 'not-reachable', message: 'The harness is not running.', timedOut: false }
      }
      const result = await run(harness)
      if (!result.ok) return result.error
      await read(true)
      return null
    },
    [connect, read],
  )

  return {
    view,
    refreshing,
    refresh,
    setEnabled: useCallback(
      (id, enabled) =>
        write((harness) =>
          conversationId === undefined
            ? harness.setSkillEnabled(id, enabled, projectId === undefined ? undefined : { projectId })
            : harness.setConversationSkillEnabled(conversationId, id, enabled),
        ),
      [write, projectId, conversationId],
    ),
  }
}
