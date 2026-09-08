import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createHarnessClient,
  resolveHarnessAddress,
  type HarnessClient,
  type HarnessFailure,
  type McpServerDraft,
  type McpServerRecord,
} from '@/platform/harness'

/**
 * The MCP pane's data.
 *
 * Modelled on `useProviders`, deliberately: a handful of `useState` calls and
 * no query library. A settings pane talking to a process on the same machine
 * has none of the problems a cache keyed by URL solves.
 *
 * ---- What this hook will not hold ----------------------------------------
 *
 * A server's secret. It never enters this file. `setCredential` takes the
 * value, hands it to the client, and keeps no reference; it lives in the
 * dialog's own state and dies when the dialog unmounts. Nothing here is
 * persisted anywhere, and there is nothing to persist: the harness stores it
 * in the OS credential store and no read path returns it.
 */

export type McpView =
  /** `resolveHarnessAddress()` returned null. */
  | { readonly status: 'no-harness' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly servers: readonly McpServerRecord[] }
  | { readonly status: 'failed'; readonly error: HarnessFailure }

export interface McpServers {
  readonly view: McpView
  /** Re-reads the list, leaving what is on screen in place while it runs. */
  refresh: () => Promise<void>
  /** True while a refresh is in flight over an already-rendered list. */
  readonly refreshing: boolean
  save: (draft: McpServerDraft) => Promise<HarnessFailure | null>
  remove: (id: string) => Promise<HarnessFailure | null>
  /**
   * Records the user's default for a server.
   *
   * `null` clears the decision. Without a scope this pane only ever writes
   * the global one - a project's decision belongs to that project's screen,
   * and a global change reachable from somewhere local is a change someone
   * did not know they were making. With a scope, the same hook serves that
   * scope's screen: the read, the write and the refresh are one machinery,
   * and what changes per scope is only which door they knock on.
   */
  setEnabled: (id: string, enabled: boolean | null) => Promise<HarnessFailure | null>
  setCredential: (id: string, secret: string) => Promise<HarnessFailure | null>
  clearCredential: (id: string) => Promise<HarnessFailure | null>
}

/** Which narrower context this hook's reads and writes answer for, if any. */
export interface McpScopeTarget {
  readonly projectId?: string
  readonly conversationId?: string
}

/**
 * The scope as the harness read wants it, or nothing for the global question.
 *
 * Both fields absent and no scope at all are the same question - what is
 * installed - so they deliberately produce the same call: one argument shape,
 * where the difference between "the global read" and "no scope" is a
 * distinction without a difference.
 */
function readScope(
  projectId: string | undefined,
  conversationId: string | undefined,
): McpScopeTarget | undefined {
  if (projectId === undefined && conversationId === undefined) return undefined
  return {
    ...(projectId === undefined ? {} : { projectId }),
    ...(conversationId === undefined ? {} : { conversationId }),
  }
}

export function useMcpServers(scope: McpScopeTarget = {}): McpServers {
  const [view, setView] = useState<McpView>({ status: 'loading' })
  const [refreshing, setRefreshing] = useState(false)
  const client = useRef<HarnessClient | null>(null)
  /**
   * Guards every `setState` after an await.
   *
   * The pane unmounts the moment someone clicks another section, and a reply
   * that lands afterwards must not resurrect it.
   */
  const live = useRef(true)

  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])

  const connect = useCallback(async (): Promise<HarnessClient | null> => {
    if (client.current) return client.current
    const address = await resolveHarnessAddress()
    if (address === null) return null
    client.current = createHarnessClient(address)
    return client.current
  }, [])

  // The scope's fields, held apart from the object: the caller builds the
  // scope inline, so the object is a new identity every render, while these
  // two values are what the reads, the writes and the effect dependencies
  // actually key on. Depending on the object itself would re-read the list
  // forever, which is the one way this hook could turn into a spin.
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
      // The scope travels on the read: a project's rows carry that project's
      // readings, a conversation's carry the conversation's, and the global
      // read carries neither, because it edits the default and nothing else
      // answers to it.
      const result = await harness.listMcpServers(readScope(projectId, conversationId))
      if (!live.current) return
      setRefreshing(false)
      // A failed refresh leaves the previous list on screen rather than
      // replacing it with an error: the servers did not stop existing because
      // one read failed, and blanking the pane loses the user's place.
      if (!result.ok) {
        if (!quiet) setView({ status: 'failed', error: result.error })
        return
      }
      setView({ status: 'ready', servers: result.value })
    },
    [connect, projectId, conversationId],
  )

  useEffect(() => {
    void read(false)
  }, [read])

  const refresh = useCallback(async () => {
    await read(true)
  }, [read])

  /**
   * Runs a write and re-reads on success.
   *
   * The harness is the only thing that knows what a write actually produced -
   * a saved server gets a status, an enabled one starts connecting - so the
   * list is re-read rather than patched locally. Guessing here is how a pane
   * ends up showing a state the harness never reached.
   */
  const write = useCallback(
    async (
      run: (harness: HarnessClient) => Promise<{ ok: true } | { ok: false; error: HarnessFailure }>,
    ): Promise<HarnessFailure | null> => {
      const harness = await connect()
      if (harness === null) {
        // The same shape a dead socket produces, because that is what this
        // is from the caller's side: the harness could not be reached. It did
        // not time out, though - there was no address to try.
        return {
          kind: 'not-reachable',
          message: 'The harness is not running.',
          timedOut: false,
        }
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
    save: useCallback((draft) => write((harness) => harness.saveMcpServer(draft)), [write]),
    remove: useCallback((id) => write((harness) => harness.removeMcpServer(id)), [write]),
    setEnabled: useCallback(
      (id, enabled) =>
        write((harness) =>
          // The write follows the read's scope: a conversation's decision goes
          // to the conversation's own route, where the conversation lives, and
          // everything else goes to the scope the harness call itself names.
          conversationId === undefined
            ? harness.setMcpServerEnabled(
                id,
                enabled,
                projectId === undefined ? undefined : { projectId },
              )
            : harness.setConversationMcpServerEnabled(conversationId, id, enabled),
        ),
      [write, projectId, conversationId],
    ),
    setCredential: useCallback(
      (id, secret) => write((harness) => harness.setMcpCredential(id, secret)),
      [write],
    ),
    clearCredential: useCallback(
      (id) => write((harness) => harness.deleteMcpCredential(id)),
      [write],
    ),
  }
}
