import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createHarnessClient,
  resolveHarnessAddress,
  type DetectedPreset,
  type HarnessClient,
  type HarnessFailure,
  type ProjectRecord,
  type SandboxLevel,
  type SandboxScopeInfo,
} from '@/platform/harness'

export type EnvironmentsView =
  | { readonly status: 'no-harness' }
  | { readonly status: 'loading' }
  | {
      readonly status: 'ready'
      readonly projects: readonly ProjectRecord[]
      readonly projectId: string | null
      readonly scope: SandboxScopeInfo
      readonly presets: readonly DetectedPreset[]
    }
  | { readonly status: 'failed'; readonly error: HarnessFailure }

export interface Environments {
  readonly view: EnvironmentsView
  readonly refreshing: boolean
  /** The harness's own sentence for the last refused write, if any. */
  readonly lastError: string | null
  refresh: () => Promise<void>
  selectProject: (projectId: string | null) => Promise<void>
  setLevel: (projectId: string, level: SandboxLevel) => Promise<HarnessFailure | null>
  /**
   * The person's answer about one folder, by path. Not by project: the
   * harness decides trust per folder, so two projects attaching the same
   * repository share the one answer and this reload shows it in both.
   */
  setTrust: (root: string, trusted: boolean) => Promise<HarnessFailure | null>
  grantPreset: (
    projectId: string,
    presetId: string,
    path: string,
    mode: 'read' | 'write',
  ) => Promise<HarnessFailure | null>
  grantCustom: (
    projectId: string,
    path: string,
    mode: 'read' | 'write',
  ) => Promise<HarnessFailure | null>
  revoke: (projectId: string, path: string) => Promise<HarnessFailure | null>
}

export function useEnvironments(): Environments {
  const [view, setView] = useState<EnvironmentsView>({ status: 'loading' })
  const [refreshing, setRefreshing] = useState(false)
  const [lastError, setLastError] = useState<string | null>(null)
  const client = useRef<HarnessClient | null>(null)
  const live = useRef(true)
  const projectId = useRef<string | null>(null)

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

  const load = useCallback(async (selected: string | null, background: boolean) => {
    const handle = await connect()
    if (!live.current) return
    if (handle === null) {
      setView({ status: 'no-harness' })
      return
    }
    if (!background) setView({ status: 'loading' })
    else setRefreshing(true)

    const [projectsResult, scopeResult, presetsResult] = await Promise.all([
      handle.listProjects(),
      handle.getScope(selected ?? undefined),
      handle.listPresets(),
    ])
    if (!live.current) return
    setRefreshing(false)

    if (!projectsResult.ok) {
      setView({ status: 'failed', error: projectsResult.error })
      return
    }
    if (!scopeResult.ok) {
      setView({ status: 'failed', error: scopeResult.error })
      return
    }
    if (!presetsResult.ok) {
      setView({ status: 'failed', error: presetsResult.error })
      return
    }
    const projects = projectsResult.value
    const next = selected ?? projects[0]?.id ?? null
    projectId.current = next
    if (next !== selected && next !== null) {
      const rescoped = await handle.getScope(next)
      if (!live.current) return
      if (!rescoped.ok) {
        setView({ status: 'failed', error: rescoped.error })
        return
      }
      setView({ status: 'ready', projects, projectId: next, scope: rescoped.value, presets: presetsResult.value })
      return
    }
    setView({ status: 'ready', projects, projectId: next, scope: scopeResult.value, presets: presetsResult.value })
  }, [connect])

  useEffect(() => {
    void load(null, false)
  }, [load])

  const refresh = useCallback(async () => {
    await load(projectId.current, true)
  }, [load])

  const selectProject = useCallback(async (next: string | null) => {
    projectId.current = next
    await load(next, true)
  }, [load])

  const mutate = useCallback(async (work: (handle: HarnessClient) => Promise<{ ok: true } | { ok: false; error: HarnessFailure }>): Promise<HarnessFailure | null> => {
    const handle = await connect()
    if (handle === null) {
      const failure = { kind: 'not-reachable', timedOut: false, message: 'The harness is not running.' } as const
      if (live.current) setLastError(failure.message)
      return failure
    }
    const result = await work(handle)
    if (!live.current) return result.ok ? null : result.error
    // The harness's own sentence, verbatim: a refused system path names
    // trusted, and paraphrasing it here would lose the remedy.
    if (!result.ok) setLastError(result.error.message)
    else setLastError(null)
    if (!result.ok) return result.error
    await load(projectId.current, true)
    return null
  }, [connect, load])

  return {
    view,
    refreshing,
    lastError,
    refresh,
    selectProject,
    setLevel: (id, level) => mutate((handle) => handle.setSandboxLevel(id, level)),
    setTrust: (root, trusted) => mutate((handle) => handle.setFolderTrust(root, trusted)),
    grantPreset: (id, presetId, path, mode) =>
      mutate((handle) => handle.grantScope({ projectId: id, path, mode, source: 'preset', presetId })),
    grantCustom: (id, path, mode) =>
      mutate((handle) => handle.grantScope({ projectId: id, path, mode, source: 'custom' })),
    revoke: (id, path) => mutate((handle) => handle.revokeScope(id, path)),
  }
}
