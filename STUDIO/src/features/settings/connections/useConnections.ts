import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createHarnessClient,
  resolveHarnessAddress,
  type HarnessClient,
  type HarnessFailure,
  type HarnessResult,
  type ProbeResult,
  type ProviderConnection,
  type ProviderConnectionDraft,
  type ProviderModel,
} from '@/platform/harness'

/**
 * The Connections pane's data.
 *
 * This is the whole of the app's state management for the harness, and it is
 * three `useState` calls, because that is what three components need. There is
 * no query library here on purpose: a cache keyed by URL, background
 * refetching and stale-while-revalidate are answers to problems a settings
 * pane talking to a process on the same machine does not have. When a second
 * pane needs the same data, the honest next step is to lift this hook into a
 * provider, not to install a library.
 *
 * ---- The four states -------------------------------------------------------
 *
 * They are a tagged union rather than three booleans because each one renders
 * as a different page, and the combinations booleans allow -- loading *and*
 * failed, ready *and* no harness -- are not states this feature has.
 *
 * `no-harness` is the one to be careful with. It is not an error and must not
 * be drawn as one: no harness configured is the app's shipped behaviour today
 * and a perfectly good way to use it. The pane falls back to the built-in
 * catalog and says so quietly.
 *
 * ---- What this hook will not hold -----------------------------------------
 *
 * An API key. It never enters this file. `create` takes a draft that may carry
 * one, hands it to the client, and keeps no reference; the value lives in the
 * dialog's own state and dies when the dialog unmounts. Nothing here is
 * persisted anywhere -- not the Tauri store, not localStorage. There is
 * nothing to persist: the harness is the store, and it never returns a key.
 */

/** Absent from the map means "never probed", which is different from "failed". */
export type ProbeState =
  | { readonly status: 'probing' }
  | { readonly status: 'done'; readonly result: ProbeResult }
  | { readonly status: 'failed'; readonly error: HarnessFailure }

export type ConnectionsView =
  /** `resolveHarnessAddress()` returned null. Show the built-in catalog. */
  | { readonly status: 'no-harness' }
  | { readonly status: 'loading' }
  | {
      readonly status: 'ready'
      readonly connections: readonly ProviderConnection[]
      readonly models: readonly ProviderModel[]
    }
  | { readonly status: 'failed'; readonly error: HarnessFailure }

export interface Connections {
  readonly view: ConnectionsView
  readonly probes: ReadonlyMap<string, ProbeState>
  /** Re-reads connections and models, leaving the current list on screen while it runs. */
  refresh: () => Promise<void>
  create: (draft: ProviderConnectionDraft) => Promise<HarnessResult<ProviderConnection>>
  setEnabled: (id: string, enabled: boolean) => Promise<HarnessResult<ProviderConnection>>
  remove: (id: string) => Promise<HarnessResult<void>>
  probe: (id: string) => Promise<void>
}

/**
 * How the hook gets a client, injectable so a test can supply one.
 *
 * A function rather than a client, because deciding there is no harness is
 * itself one of the four states and has to be reachable from the same seam.
 * Whatever is passed must be stable across renders -- it is an effect
 * dependency.
 */
export type HarnessConnect = () => Promise<HarnessClient | null>

export async function connectToHarness(): Promise<HarnessClient | null> {
  const address = await resolveHarnessAddress()
  return address === null ? null : createHarnessClient(address)
}

/**
 * What a mutation answers with when there is no client at all.
 *
 * It should be unreachable -- every control that mutates is only rendered in
 * the `ready` state -- but a mutation has to return something, and returning a
 * failure the UI already knows how to draw beats inventing a fifth case or
 * throwing into a component that has no boundary.
 */
const NO_HARNESS: HarnessFailure = {
  kind: 'not-reachable',
  timedOut: false,
  message: 'No harness is configured, so there is nothing to change.',
}

export function useConnections(connect: HarnessConnect = connectToHarness): Connections {
  const [view, setView] = useState<ConnectionsView>({ status: 'loading' })
  const [probes, setProbes] = useState<ReadonlyMap<string, ProbeState>>(() => new Map())

  // The client outlives a render but is not render state: nothing displays it
  // and changing it must not paint. It is resolved once and reused, which also
  // means the address is decided once per mount rather than per request.
  const client = useRef<HarnessClient | null>(null)
  // Every write below is guarded by this. Two of these requests can be in
  // flight for eight seconds (a probe), which is long enough for someone to
  // leave the pane, and a setState after unmount is a warning that hides real
  // ones.
  const live = useRef(true)

  const load = useCallback(async () => {
    const existing = client.current ?? (await connect())
    if (!live.current) return

    if (existing === null) {
      setView({ status: 'no-harness' })
      return
    }
    client.current = existing

    // Both in flight together: they are independent reads and the pane cannot
    // draw a row without either of them, so serialising would only make the
    // first paint later.
    const [connections, models] = await Promise.all([
      existing.listConnections(),
      existing.listModels(),
    ])
    if (!live.current) return

    // Either failure is the whole page's failure. A list of connections with
    // no model counts would render rows claiming zero models, which is a
    // number, and a wrong number is worse than a stated failure.
    if (!connections.ok) {
      setView({ status: 'failed', error: connections.error })
      return
    }
    if (!models.ok) {
      setView({ status: 'failed', error: models.error })
      return
    }

    setView({ status: 'ready', connections: connections.value, models: models.value })
  }, [connect])

  useEffect(() => {
    live.current = true
    void load()
    return () => {
      live.current = false
    }
  }, [load])

  /**
   * Runs a mutation and re-reads on success.
   *
   * The re-read is not an optimisation to remove later. The harness owns
   * derived facts this side cannot compute -- the credential status after a
   * key is stored, the model list a new connection resolves to -- so patching
   * the local array would show a record that disagrees with the one on disk.
   */
  const mutate = useCallback(
    async <T>(run: (target: HarnessClient) => Promise<HarnessResult<T>>) => {
      const target = client.current
      if (target === null) return { ok: false, error: NO_HARNESS } as const
      const result = await run(target)
      if (result.ok) await load()
      return result
    },
    [load],
  )

  const create = useCallback(
    (draft: ProviderConnectionDraft) => mutate((target) => target.createConnection(draft)),
    [mutate],
  )

  const setEnabled = useCallback(
    (id: string, enabled: boolean) =>
      mutate((target) => target.updateConnection(id, { enabled })),
    [mutate],
  )

  const remove = useCallback(
    (id: string) => mutate((target) => target.deleteConnection(id)),
    [mutate],
  )

  const probe = useCallback(async (id: string) => {
    const target = client.current
    if (target === null) return

    // Recorded before the request so the row can say it is working. The probe
    // reaches out to the provider's own endpoint with an eight second budget,
    // which is far longer than anything else in this app and long enough to
    // read as hung if the row does not change.
    setProbes((current) => new Map(current).set(id, { status: 'probing' }))

    const result = await target.probeConnection(id)
    if (!live.current) return

    setProbes((current) =>
      new Map(current).set(
        id,
        result.ok
          ? { status: 'done', result: result.value }
          : { status: 'failed', error: result.error },
      ),
    )
  }, [])

  return { view, probes, refresh: load, create, setEnabled, remove, probe }
}
