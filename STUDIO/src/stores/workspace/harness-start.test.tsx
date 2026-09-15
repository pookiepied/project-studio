/**
 * @vitest-environment jsdom
 */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The store while the harness is starting.
 *
 * The supervisor starts the harness at launch, and for the first second or
 * two of a cold start there is no address because there is not yet a
 * harness. The store read that as an absence: every launch opened on "the
 * harness is not running", and then the app arrived when `harness-started`
 * did - the window arriving twice, the first time wrong. A start is a wait,
 * not an absence, so the store holds `loading` through it and reads again
 * when the start ends, whichever way it ends.
 */

const resolveHarnessAddress = vi.fn()
const harnessIsStarting = vi.fn()
const listeners: ((signal: { name: string; payload: unknown }) => void)[] = []

const client = {
  listConversations: vi.fn(async () => ({ ok: true, value: [] }) as const),
  listProjects: vi.fn(async () => ({ ok: true, value: [] }) as const),
  listConnections: vi.fn(async () => ({ ok: true, value: [] }) as const),
  listModels: vi.fn(async () => ({ ok: true, value: [] }) as const),
  getDefaults: vi.fn(async () => ({ ok: true, value: {} }) as const),
}

vi.mock('@/platform/harness', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/platform/harness')
  return {
    ...actual,
    resolveHarnessAddress: () => resolveHarnessAddress(),
    harnessIsStarting: () => harnessIsStarting(),
    createHarnessClient: () => client,
    startHarness: vi.fn(async () => false),
  }
})

vi.mock('@/platform/harness/lifecycle', () => ({
  defaultListen: (handler: (signal: { name: string; payload: unknown }) => void) => {
    listeners.push(handler)
    return Promise.resolve(() => undefined)
  },
}))

const { WorkspaceProvider, useWorkspace } = await import('@/stores/workspace')

function Probe() {
  const { storePhase } = useWorkspace()
  return <span data-testid="phase">{storePhase.status}</span>
}

const phase = () => screen.getByTestId('phase').textContent
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)))

describe('the store while the harness is starting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listeners.length = 0
  })

  afterEach(() => {
    cleanup()
  })

  it('holds loading through the start, and is ready once it has started', async () => {
    resolveHarnessAddress.mockResolvedValue(null)
    harnessIsStarting.mockResolvedValue(true)

    render(
      <WorkspaceProvider>
        <Probe />
      </WorkspaceProvider>,
    )
    await waitFor(() => expect(listeners.length).toBeGreaterThan(0))
    await settle()
    // Not "no-harness": nothing is absent, something is on its way.
    expect(phase()).toBe('loading')

    // The start ends well.
    resolveHarnessAddress.mockResolvedValue({
      baseUrl: 'http://127.0.0.1:1/',
      credential: 'host-attached',
    })
    harnessIsStarting.mockResolvedValue(false)
    act(() => {
      for (const listener of listeners) listener({ name: 'harness-started', payload: undefined })
    })
    await waitFor(() => expect(phase()).toBe('ready'))
  })

  it('says the harness is not running once a start has failed', async () => {
    resolveHarnessAddress.mockResolvedValue(null)
    harnessIsStarting.mockResolvedValue(true)

    render(
      <WorkspaceProvider>
        <Probe />
      </WorkspaceProvider>,
    )
    await waitFor(() => expect(listeners.length).toBeGreaterThan(0))
    await settle()
    expect(phase()).toBe('loading')

    // The start ends badly: the supervisor says so, and the read that
    // follows finds a harness that is neither running nor starting.
    harnessIsStarting.mockResolvedValue(false)
    act(() => {
      for (const listener of listeners) listener({ name: 'harness-failed', payload: undefined })
    })
    await waitFor(() => expect(phase()).toBe('no-harness'))
  })

  it('stops waiting after the deadline, so a start that never ends is not an endless splash', async () => {
    // The false reassurance to refuse: a harness that reports "starting"
    // forever. Past the deadline the store says the harness is not running,
    // which is the page with the start button on it.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      resolveHarnessAddress.mockResolvedValue(null)
      harnessIsStarting.mockResolvedValue(true)

      render(
        <WorkspaceProvider>
          <Probe />
        </WorkspaceProvider>,
      )
      await waitFor(() => expect(listeners.length).toBeGreaterThan(0))
      await settle()
      expect(phase()).toBe('loading')

      await act(() => vi.advanceTimersByTimeAsync(8_500))
      await waitFor(() => expect(phase()).toBe('no-harness'))
    } finally {
      vi.useRealTimers()
    }
  })

  it('reads an absence as an absence when nothing is starting', async () => {
    resolveHarnessAddress.mockResolvedValue(null)
    harnessIsStarting.mockResolvedValue(false)

    render(
      <WorkspaceProvider>
        <Probe />
      </WorkspaceProvider>,
    )
    await waitFor(() => expect(phase()).toBe('no-harness'))
  })
})
