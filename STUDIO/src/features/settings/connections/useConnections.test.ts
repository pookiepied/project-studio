/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import type {
  HarnessClient,
  HarnessFailure,
  ProbeResult,
  ProviderConnection,
  ProviderModel,
} from '@/platform/harness'
import { useConnections, type HarnessConnect } from './useConnections'
import { KNOWN_VENDOR, UNKNOWN_VENDOR, modelFor } from './harness.fixtures'

/**
 * The four states, and what a mutation does to them.
 *
 * The hook's `connect` argument is the seam: a test supplies a client rather
 * than an address, which is the same seam the sidecar task will use to supply
 * a real one. No module is mocked here.
 */

afterEach(cleanup)

const UNAUTHORIZED: HarnessFailure = {
  kind: 'unauthorized',
  status: 401,
  message: 'Harness admission is required.',
}

const UNREACHABLE: HarnessFailure = {
  kind: 'not-reachable',
  timedOut: false,
  message: 'The harness could not be reached.',
}

interface Stub {
  readonly client: HarnessClient
  readonly listConnections: ReturnType<typeof vi.fn>
  readonly listModels: ReturnType<typeof vi.fn>
  readonly createConnection: ReturnType<typeof vi.fn>
  readonly updateConnection: ReturnType<typeof vi.fn>
  readonly deleteConnection: ReturnType<typeof vi.fn>
  readonly probeConnection: ReturnType<typeof vi.fn>
  readonly connect: HarnessConnect
}

/** The refusal every unused conversation/project method answers with. */
const NOT_USED_HERE: HarnessFailure = {
  kind: 'not-reachable',
  timedOut: false,
  message: 'The Connections pane does not use the conversation index.',
}

function refuse(): Promise<{ ok: false; error: HarnessFailure }> {
  return Promise.resolve({ ok: false as const, error: NOT_USED_HERE })
}

/**
 * Every conversation/project method of `HarnessClient`, stubbed to fail. This
 * pane does not touch the index surface; if one ever fires here the suite is
 * testing more than it says.
 */
function unreachableIndexStubs() {
  return {
    listConversations: () => refuse(),
    createConversation: () => refuse(),
    updateConversation: () => refuse(),
    deleteConversation: () => refuse(),
    purgeConversations: () => refuse(),
    listProjects: () => refuse(),
    createProject: () => refuse(),
    updateProject: () => refuse(),
    deleteProject: () => Promise.resolve({ ok: true as const, value: undefined }),
    addProjectFolder: () => refuse(),
    updateProjectFolder: () => refuse(),
    removeProjectFolder: () => refuse(),
  }
}

function stubClient(
  overrides: {
    connections?: readonly ProviderConnection[]
    models?: readonly ProviderModel[]
  } = {},
): Stub {
  const listConnections = vi.fn(async () => ({
    ok: true as const,
    value: overrides.connections ?? [KNOWN_VENDOR],
  }))
  const listModels = vi.fn(async () => ({
    ok: true as const,
    value: overrides.models ?? [modelFor(KNOWN_VENDOR.id, 'claude-opus-5')],
  }))
  const createConnection = vi.fn(async () => ({ ok: true as const, value: KNOWN_VENDOR }))
  const updateConnection = vi.fn(async () => ({ ok: true as const, value: KNOWN_VENDOR }))
  const deleteConnection = vi.fn(async () => ({ ok: true as const, value: undefined }))
  const probeConnection = vi.fn(async () => ({ ok: true as const, value: PROBE }))

  const client: HarnessClient = {
    listConnections,
    listModels,
    createConnection,
    updateConnection,
    deleteConnection,
    probeConnection,
    // The provider pane never calls the index surface; the stubs only
    // satisfy the interface. If one of these ever fires here, this suite is
    // testing more than it says.
    ...unreachableIndexStubs(),
  }

  return {
    client,
    listConnections,
    listModels,
    createConnection,
    updateConnection,
    deleteConnection,
    probeConnection,
    // Stable across renders, which the hook requires of it.
    connect: async () => client,
  }
}

const PROBE: ProbeResult = { ok: true, reachedAt: 1, modelCount: 4, latencyMs: 137 }

describe('the four states', () => {
  it('reports no-harness when no address is configured', async () => {
    const connect: HarnessConnect = async () => null
    const { result } = renderHook(() => useConnections(connect))

    await waitFor(() => expect(result.current.view.status).toBe('no-harness'))
  })

  it('starts in loading', () => {
    const stub = stubClient()
    const { result } = renderHook(() => useConnections(stub.connect))

    expect(result.current.view.status).toBe('loading')
  })

  it('reaches ready with connections and models together', async () => {
    const stub = stubClient({
      connections: [KNOWN_VENDOR, UNKNOWN_VENDOR],
      models: [modelFor(KNOWN_VENDOR.id, 'claude-opus-5'), modelFor(KNOWN_VENDOR.id, 'claude-haiku-4-5')],
    })
    const { result } = renderHook(() => useConnections(stub.connect))

    await waitFor(() => expect(result.current.view.status).toBe('ready'))
    const view = result.current.view
    if (view.status !== 'ready') throw new Error('expected ready')
    expect(view.connections).toHaveLength(2)
    expect(view.models).toHaveLength(2)
  })

  it('fails the whole page when the connection list fails', async () => {
    const stub = stubClient()
    stub.listConnections.mockResolvedValue({ ok: false, error: UNAUTHORIZED })

    const { result } = renderHook(() => useConnections(stub.connect))

    await waitFor(() => expect(result.current.view.status).toBe('failed'))
    const view = result.current.view
    if (view.status !== 'failed') throw new Error('expected failed')
    expect(view.error).toEqual(UNAUTHORIZED)
  })

  it('fails the whole page when only the model list fails', async () => {
    // Rather than showing rows whose model counts would all read zero.
    const stub = stubClient()
    stub.listModels.mockResolvedValue({ ok: false, error: UNREACHABLE })

    const { result } = renderHook(() => useConnections(stub.connect))

    await waitFor(() => expect(result.current.view.status).toBe('failed'))
    const view = result.current.view
    if (view.status !== 'failed') throw new Error('expected failed')
    expect(view.error.kind).toBe('not-reachable')
  })
})

describe('mutations', () => {
  it('re-reads after a successful change', async () => {
    const stub = stubClient()
    const { result } = renderHook(() => useConnections(stub.connect))
    await waitFor(() => expect(result.current.view.status).toBe('ready'))
    expect(stub.listConnections).toHaveBeenCalledTimes(1)

    await result.current.setEnabled(KNOWN_VENDOR.id, false)

    expect(stub.updateConnection).toHaveBeenCalledWith(KNOWN_VENDOR.id, { enabled: false })
    expect(stub.listConnections).toHaveBeenCalledTimes(2)
  })

  it('does not re-read after a failed change, and hands the error back', async () => {
    const stub = stubClient()
    stub.createConnection.mockResolvedValue({ ok: false, error: UNAUTHORIZED })
    const { result } = renderHook(() => useConnections(stub.connect))
    await waitFor(() => expect(result.current.view.status).toBe('ready'))

    const outcome = await result.current.create({
      id: 'new-one',
      displayName: 'New one',
      kind: 'language',
      source: 'local',
      enabled: true,
      protocol: 'openai-completions',
    })

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.error).toEqual(UNAUTHORIZED)
    expect(stub.listConnections).toHaveBeenCalledTimes(1)
  })

  it('removes by id', async () => {
    const stub = stubClient()
    const { result } = renderHook(() => useConnections(stub.connect))
    await waitFor(() => expect(result.current.view.status).toBe('ready'))

    await result.current.remove(KNOWN_VENDOR.id)

    expect(stub.deleteConnection).toHaveBeenCalledWith(KNOWN_VENDOR.id)
  })
})

describe('probing', () => {
  it('records probing before the result and the result after', async () => {
    const stub = stubClient()
    let release = (_: { ok: true; value: ProbeResult }) => {}
    stub.probeConnection.mockReturnValue(
      new Promise<{ ok: true; value: ProbeResult }>((resolve) => {
        release = resolve
      }),
    )

    const { result } = renderHook(() => useConnections(stub.connect))
    await waitFor(() => expect(result.current.view.status).toBe('ready'))

    const pending = result.current.probe(KNOWN_VENDOR.id)
    await waitFor(() =>
      expect(result.current.probes.get(KNOWN_VENDOR.id)?.status).toBe('probing'),
    )

    release({ ok: true, value: PROBE })
    await pending

    await waitFor(() => expect(result.current.probes.get(KNOWN_VENDOR.id)?.status).toBe('done'))
    const state = result.current.probes.get(KNOWN_VENDOR.id)
    if (state?.status !== 'done') throw new Error('expected done')
    expect(state.result.latencyMs).toBe(137)
  })

  it('records a transport failure as a failed probe, not a failed page', async () => {
    const stub = stubClient()
    stub.probeConnection.mockResolvedValue({ ok: false, error: UNREACHABLE })

    const { result } = renderHook(() => useConnections(stub.connect))
    await waitFor(() => expect(result.current.view.status).toBe('ready'))

    await result.current.probe(KNOWN_VENDOR.id)

    await waitFor(() => expect(result.current.probes.get(KNOWN_VENDOR.id)?.status).toBe('failed'))
    // The page is still perfectly usable; only that one row learned something.
    expect(result.current.view.status).toBe('ready')
  })
})
