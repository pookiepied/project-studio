/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type {
  HarnessClient,
  HarnessFailure,
  HarnessResult,
  LibraryProvider,
  ProbeResult,
  ProviderConnection,
  ProviderModel,
} from '@/platform/harness'
import { KNOWN_VENDOR, modelFor } from './harness.fixtures'
import { useProviders, type HarnessConnect } from './useProviders'

/**
 * The pane's data, against a stubbed client.
 *
 * This suite stubs the client seam (not `fetch`) because the hook's contract
 * is about the shape of its states and the order of its calls - the wire
 * behaviour those calls have is the pane suite's job, which exercises the real
 * client end to end.
 */

const PROBE: ProbeResult = { ok: true, reachedAt: 1, modelCount: 271, latencyMs: 90 }

function failure(kind: HarnessFailure['kind'] = 'harness-error'): HarnessFailure {
  return { kind, timedOut: false, message: 'stubbed refusal', status: 400 }
}

function ok<T>(value: T): HarnessResult<T> {
  return { ok: true as const, value }
}

function stubClient(overrides: {
  connections?: readonly ProviderConnection[]
  models?: readonly ProviderModel[]
  library?: readonly LibraryProvider[]
  /** What `probeConnection` resolves with; a refused probe is still a ProbeResult. */
  probe?: ProbeResult
  fail?: HarnessFailure
} = {}): HarnessClient {
  const refuse = <T,>(): Promise<HarnessResult<T>> => Promise.resolve({ ok: false, error: failure() })
  const error = overrides.fail
  return {
    getDiagnostics: () => refuse(),
    viewConversationBrowser: () => refuse(),
    interactConversationBrowser: () => refuse(),
    configureDiagnostics: () => refuse(),
    readDiagnostics: () => refuse(),
    clearDiagnostics: () => refuse(),
    queuedMessages: () => refuse(),
    changeQueuedMessage: () => refuse(),
    editQueuedMessage: () => refuse(),
    listConnections: () =>
      error ? Promise.resolve({ ok: false as const, error }) : Promise.resolve(ok(overrides.connections ?? [KNOWN_VENDOR])),
    listLibrary: () => Promise.resolve(ok(overrides.library ?? [])),
    tasks: () => refuse(),
    cancelTask: () => refuse(),
    agents: () => refuse(),
    providerIcon: () => refuse(),
    listModels: () =>
      error ? Promise.resolve({ ok: false as const, error }) : Promise.resolve(ok(overrides.models ?? [modelFor(KNOWN_VENDOR.id, 'claude-opus-5')])),
    getDefaults: () => Promise.resolve(ok({})),
    conversationContext: () => Promise.resolve(ok(null)),
    conversationCompaction: () => Promise.resolve(ok(null)),
    listCommands: () => refuse(),
    readCommand: () => refuse(),
    saveCommand: () => refuse(),
    removeCommand: () => refuse(),
    listGrants: () => refuse(),
    revokeGrant: () => refuse(),
    conversationSnapshots: () => refuse(),
    restoreConversationSnapshot: () => refuse(),
    listLibraryItems: () => refuse(),
    addLibraryItem: () => refuse(),
    updateLibraryItem: () => refuse(),
    removeLibraryItem: () => refuse(),
    uploadDocument: () => refuse(),
    removeDocument: () => refuse(),
    describeImage: () => refuse(),
    expandCommand: () => refuse(),
    compactConversation: () => Promise.resolve(ok(undefined)),
    conversationJobs: () => Promise.resolve(ok([])),
    stopConversationJob: () => Promise.resolve(ok(null)),
    stopConversationBrowser: () => Promise.resolve(ok(false)),
    stopConversationComputer: () => Promise.resolve(ok(false)),
    controlConversationComputer: () => Promise.resolve(ok(undefined)),
    shareConversationScreen: () => Promise.resolve(ok(false)),
    glanceConversationScreen: () => Promise.resolve(ok(undefined)),
    drewOnConversationScreen: () => Promise.resolve(ok(undefined)),
    conversationMediaJobs: () => Promise.resolve(ok([])),
    conversationMediaArtifacts: () => Promise.resolve(ok([])),
    stopConversationMediaJob: () => Promise.resolve(ok(undefined)),
    createConnection: () => Promise.resolve(ok(KNOWN_VENDOR)),
    updateConnection: () => Promise.resolve(ok(KNOWN_VENDOR)),
    deleteConnection: () => Promise.resolve(ok(undefined)),
    probeConnection: () => Promise.resolve(ok(overrides.probe ?? PROBE)),
    setDefault: () => Promise.resolve(ok(undefined)),
    lookupModelFacts: () => Promise.resolve(ok({ found: false as const })),
    addManualModel: () => refuse(),
    setModelOverride: () => refuse(),
    removeModel: () => refuse(),
    setModelSelection: () => Promise.resolve(ok(undefined)),
    transcribe: () => refuse(),
    improveText: () => refuse(),
    speak: () => refuse(),
    listConversations: () => refuse(),
    createConversation: () => refuse(),
    updateConversation: () => refuse(),
    forkConversation: () => refuse(),
    deleteConversation: () => refuse(),
    purgeConversations: () => refuse(),
    listOrphanTrees: () => refuse(),
    sweepOrphanTrees: () => refuse(),
    listPendingApprovals: () => refuse(),
    answerApproval: () => refuse(),
    cancelApproval: () => refuse(),
    listPendingQuestions: () => refuse(),
    answerQuestion: () => refuse(),
    cancelQuestion: () => refuse(),
    stopQuestions: () => refuse(),
    listProjects: () => refuse(),
    createProject: () => refuse(),
    updateProject: () => refuse(),
    deleteProject: () => refuse(),
    addProjectFolder: () => refuse(),
    updateProjectFolder: () => refuse(),
    removeProjectFolder: () => refuse(),
    // The MCP half of the client. This stub is the providers pane's, and it
    // refuses everything it does not model rather than returning an empty
    // success, so a provider test that started calling one of these would
    // fail loudly instead of quietly reading nothing.
    listMcpServers: () => refuse(),
    saveMcpServer: () => refuse(),
    removeMcpServer: () => refuse(),
    setMcpServerEnabled: () => refuse(),
    setConversationMcpServerEnabled: () => refuse(),
    listSkills: () => refuse(),
    setSkillEnabled: () => refuse(),
    setConversationSkillEnabled: () => refuse(),
    setMcpCredential: () => refuse(),
    deleteMcpCredential: () => refuse(),
    // The environments half of the client. This stub is the providers pane's,
    // and it refuses everything it does not model rather than returning an
    // empty success, for the same reason as the MCP half above.
    getScope: () => refuse(),
    grantScope: () => refuse(),
    revokeScope: () => refuse(),
    revokeConversationScope: () => refuse(),
    browseFolders: () => refuse(),
    setSandboxLevel: () => refuse(),
    getShell: () => refuse(),
    getIsolation: () => refuse(),
    setIsolation: () => refuse(),
    setShell: () => refuse(),
    setFolderTrust: () => refuse(),
    getPlan: () => refuse(),
    tickPlanItem: () => refuse(),
    clearPlan: () => refuse(),
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the four states', () => {
  it('reports no-harness when no address is configured', async () => {
    const connect: HarnessConnect = async () => null
    const { result } = renderHook(() => useProviders(connect))

    await waitFor(() => expect(result.current.view.status).toBe('no-harness'))
  })

  it('starts in loading', () => {
    const connect: HarnessConnect = () => new Promise(() => undefined)
    const { result } = renderHook(() => useProviders(connect))

    expect(result.current.view.status).toBe('loading')
  })

  it('reaches ready with connections, models, library, and defaults', async () => {
    const client = stubClient({ library: [] })
    const { result } = renderHook(() => useProviders(async () => client))

    await waitFor(() => expect(result.current.view.status).toBe('ready'))
    if (result.current.view.status !== 'ready') return
    expect(result.current.view.connections).toEqual([KNOWN_VENDOR])
    expect(result.current.view.models).toHaveLength(1)
    expect(result.current.view.defaults).toEqual({})
  })

  it('fails the whole view when any read fails', async () => {
    const client = stubClient({ fail: failure() })
    const { result } = renderHook(() => useProviders(async () => client))

    await waitFor(() => expect(result.current.view.status).toBe('failed'))
    if (result.current.view.status !== 'failed') return
    expect(result.current.view.error.message).toBe('stubbed refusal')
  })
})

describe('mutations', () => {
  it('creates and then re-reads', async () => {
    const client = stubClient()
    const createSpy = vi.spyOn(client, 'createConnection')
    const { result } = renderHook(() => useProviders(async () => client))
    await waitFor(() => expect(result.current.view.status).toBe('ready'))

    const outcome = await result.current.create({
      id: 'new',
      displayName: 'New',
      serves: { language: 'openai-completions' },
      source: 'local',
      enabled: true,
    })

    expect(outcome.ok).toBe(true)
    expect(createSpy).toHaveBeenCalledTimes(1)
  })

  it('sets and clears a default through the client', async () => {
    const client = stubClient()
    const setDefault = vi.spyOn(client, 'setDefault')
    const { result } = renderHook(() => useProviders(async () => client))
    await waitFor(() => expect(result.current.view.status).toBe('ready'))

    await result.current.setDefault('webSearch', { connectionId: 'tavily', modelId: 'tavily-search' })
    expect(setDefault).toHaveBeenLastCalledWith('webSearch', {
      connectionId: 'tavily',
      modelId: 'tavily-search',
    })

    await result.current.setDefault('webSearch', undefined)
    expect(setDefault).toHaveBeenLastCalledWith('webSearch', undefined)
  })

  it('applies a whole-shelf selection', async () => {
    const client = stubClient()
    const selection = vi.spyOn(client, 'setModelSelection')
    const { result } = renderHook(() => useProviders(async () => client))
    await waitFor(() => expect(result.current.view.status).toBe('ready'))

    await result.current.setModelSelection(KNOWN_VENDOR.id, ['claude-opus-5'])
    expect(selection).toHaveBeenCalledWith(KNOWN_VENDOR.id, ['claude-opus-5'])
  })
})

describe('probing', () => {
  it('tracks the per-connection probe state', async () => {
    const client = stubClient({ probe: PROBE })
    const { result } = renderHook(() => useProviders(async () => client))
    await waitFor(() => expect(result.current.view.status).toBe('ready'))

    const outcome = await result.current.probe(KNOWN_VENDOR.id)

    expect(outcome).toEqual(PROBE)
    await waitFor(() => {
      expect(result.current.probes.get(KNOWN_VENDOR.id)?.status).toBe('done')
    })
  })

  it('hands back a refused probe as the provider own sentence', async () => {
    const refused: ProbeResult = {
      ok: false,
      reachedAt: 1,
      failure: 'The endpoint rejected the credential.',
      status: 401,
    }
    const client = stubClient({ probe: refused })
    const { result } = renderHook(() => useProviders(async () => client))
    await waitFor(() => expect(result.current.view.status).toBe('ready'))

    const outcome = await result.current.probe(KNOWN_VENDOR.id)
    expect(outcome).toEqual(refused)
  })
})
