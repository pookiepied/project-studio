import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createHarnessClient,
  resolveHarnessAddress,
  type HarnessClient,
  type HarnessFailure,
  type HarnessResult,
  type LibraryProvider,
  type ProbeResult,
  type ProviderConnection,
  type ProviderConnectionDraft,
  type ProviderModel,
  type DefaultSelection,
  type CapabilitySlot,
  type ModelReferenceSlot,
} from '@/platform/harness'
import type { ManualModelInput } from '@/platform/harness/client'

/**
 * The Providers pane's data.
 *
 * This is the whole of the app's state management for the provider surface,
 * and it is a handful of `useState` calls, because that is what the components
 * need. There is no query library here on purpose: a cache keyed by URL,
 * background refetching and stale-while-revalidate are answers to problems a
 * settings pane talking to a process on the same machine does not have.
 *
 * ---- What this hook will not hold -----------------------------------------
 *
 * An API key. It never enters this file. `create` takes a draft that may carry
 * one, hands it to the client, and keeps no reference; the value lives in the
 * dialog's own state and dies when the dialog unmounts. Nothing here is
 * persisted anywhere - not the Tauri store, not localStorage. There is nothing
 * to persist: the harness is the store, and it never returns a key.
 */

/** Absent from the map means "never probed", which is different from "failed". */
export type ProbeState =
  | { readonly status: 'probing' }
  | { readonly status: 'done'; readonly result: ProbeResult }
  | { readonly status: 'failed'; readonly error: HarnessFailure }

type ProvidersView =
  /** `resolveHarnessAddress()` returned null. */
  | { readonly status: 'no-harness' }
  | { readonly status: 'loading' }
  | {
      readonly status: 'ready'
      readonly connections: readonly ProviderConnection[]
      readonly models: readonly ProviderModel[]
      readonly library: readonly LibraryProvider[]
      readonly defaults: DefaultSelection
    }
  | { readonly status: 'failed'; readonly error: HarnessFailure }

export interface Providers {
  readonly view: ProvidersView
  readonly probes: ReadonlyMap<string, ProbeState>
  /** Re-reads everything, leaving the current list on screen while it runs. */
  refresh: () => Promise<void>
  create: (draft: ProviderConnectionDraft) => Promise<HarnessResult<ProviderConnection>>
  setEnabled: (id: string, enabled: boolean) => Promise<HarnessResult<ProviderConnection>>
  remove: (id: string) => Promise<HarnessResult<void>>
  /**
   * Probes one connection. Resolves to the provider-side result, to the
   * transport failure, or to null when there is no harness to ask; the
   * per-connection probe state is updated either way.
   */
  probe: (id: string) => Promise<ProbeResult | HarnessFailure | null>
  setDefault: (
    slot: CapabilitySlot,
    ref: ModelReferenceSlot | undefined,
  ) => Promise<HarnessResult<void>>
  addManualModel: (
    connectionId: string,
    model: ManualModelInput,
  ) => Promise<HarnessResult<ProviderModel>>
  setModelOverride: (
    connectionId: string,
    modelId: string,
    patch: { readonly displayName?: string; readonly hidden?: boolean },
  ) => Promise<HarnessResult<ProviderModel>>
  removeModel: (connectionId: string, modelId: string) => Promise<HarnessResult<void>>
  setModelSelection: (
    connectionId: string,
    modelIds: readonly string[],
  ) => Promise<HarnessResult<void>>
}

/**
 * How the hook gets a client, injectable so a test can supply one.
 *
 * A function rather than a client, because deciding there is no harness is
 * itself one of the four states and has to be reachable from the same seam.
 * Whatever is passed must be stable across renders - it is an effect
 * dependency.
 */
export type HarnessConnect = () => Promise<HarnessClient | null>

async function connectToHarness(): Promise<HarnessClient | null> {
  const address = await resolveHarnessAddress()
  return address === null ? null : createHarnessClient(address)
}

/**
 * What a mutation answers with when there is no client at all.
 *
 * It should be unreachable - every control that mutates is only rendered in
 * the `ready` state - but a mutation has to return something, and returning a
 * failure the UI already knows how to draw beats inventing a fifth case or
 * throwing into a component that has no boundary.
 */
const NO_HARNESS: HarnessFailure = {
  kind: 'not-reachable',
  timedOut: false,
  message: 'No harness is configured, so there is nothing to change.',
}

export function useProviders(connect: HarnessConnect = connectToHarness): Providers {
  const [view, setView] = useState<ProvidersView>({ status: 'loading' })
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

    // All four reads in flight together: they are independent, and the pane
    // cannot draw a row without any of them.
    const [connections, models, library, defaults] = await Promise.all([
      existing.listConnections(),
      existing.listModels(),
      existing.listLibrary(),
      existing.getDefaults(),
    ])
    if (!live.current) return

    // Any failure is the whole page's failure. A list of connections with no
    // model counts would render rows claiming zero models, which is a number,
    // and a wrong number is worse than a stated failure.
    for (const result of [connections, models, library, defaults]) {
      if (!result.ok) {
        setView({ status: 'failed', error: result.error })
        return
      }
    }

    if (
      connections.ok &&
      models.ok &&
      library.ok &&
      defaults.ok
    ) {
      setView({
        status: 'ready',
        connections: connections.value,
        models: models.value,
        library: library.value,
        defaults: defaults.value,
      })
    }
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
   * derived facts this side cannot compute - the credential status after a
   * key is stored, the availability marks a probe just learned - so patching
   * the local arrays would show a state that disagrees with the one on disk.
   */
  const mutate = useCallback(
    async <T,>(run: (target: HarnessClient) => Promise<HarnessResult<T>>) => {
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

  const setDefault = useCallback(
    (slot: CapabilitySlot, ref: ModelReferenceSlot | undefined) =>
      mutate((target) => target.setDefault(slot, ref)),
    [mutate],
  )

  const addManualModel = useCallback(
    (connectionId: string, model: ManualModelInput) =>
      mutate((target) => target.addManualModel(connectionId, model)),
    [mutate],
  )

  const setModelOverride = useCallback(
    (connectionId: string, modelId: string, patch: { readonly displayName?: string; readonly hidden?: boolean }) =>
      mutate((target) => target.setModelOverride(connectionId, modelId, patch)),
    [mutate],
  )

  const removeModel = useCallback(
    (connectionId: string, modelId: string) =>
      mutate((target) => target.removeModel(connectionId, modelId)),
    [mutate],
  )

  const setModelSelection = useCallback(
    (connectionId: string, modelIds: readonly string[]) =>
      mutate((target) => target.setModelSelection(connectionId, modelIds)),
    [mutate],
  )

  const probe = useCallback(async (id: string): Promise<ProbeResult | HarnessFailure | null> => {
    const target = client.current
    if (target === null) return null

    // Recorded before the request so the row can say it is working. The probe
    // reaches out to the provider's own endpoint with an eight second budget,
    // which is far longer than anything else in this app and long enough to
    // read as hung if the row does not change.
    setProbes((current) => new Map(current).set(id, { status: 'probing' }))

    const result = await target.probeConnection(id)
    if (!live.current) return null

    if (result.ok) {
      setProbes((current) => new Map(current).set(id, { status: 'done', result: result.value }))
      // A successful probe may have taught the harness what the provider no
      // longer offers; the rows on screen should say so.
      await load()
      return result.value
    }
    setProbes((current) => new Map(current).set(id, { status: 'failed', error: result.error }))
    return result.error
  }, [load])

  return {
    view,
    probes,
    refresh: load,
    create,
    setEnabled,
    remove,
    probe,
    setDefault,
    addManualModel,
    setModelOverride,
    removeModel,
    setModelSelection,
  }
}
