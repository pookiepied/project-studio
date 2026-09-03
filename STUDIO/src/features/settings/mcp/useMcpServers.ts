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
   * `null` clears the decision. This pane only ever writes the global scope -
   * a project's decision belongs to that project's screen, and a global change
   * reachable from somewhere local is a change someone did not know they were
   * making.
   */
  setEnabled: (id: string, enabled: boolean | null) => Promise<HarnessFailure | null>
  setCredential: (id: string, secret: string) => Promise<HarnessFailure | null>
  clearCredential: (id: string) => Promise<HarnessFailure | null>
}

export function useMcpServers(): McpServers {
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

  const read = useCallback(
    async (quiet: boolean) => {
      const harness = await connect()
      if (!live.current) return
      if (harness === null) {
        setView({ status: 'no-harness' })
        return
      }
      if (quiet) setRefreshing(true)
      const result = await harness.listMcpServers()
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
    [connect],
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
      (id, enabled) => write((harness) => harness.setMcpServerEnabled(id, enabled)),
      [write],
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
