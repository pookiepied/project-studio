/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The read that closes the gap between mounting and subscribing.
 *
 * The supervisor starts the harness eagerly at launch and announces
 * `harness-started` when it is ready. The store does two async things at
 * mount: it resolves the harness address, and it subscribes to those
 * lifecycle events. On a cold start the harness can become ready in between -
 * after the resolve has already answered "not running", and before the
 * subscription exists to hear about it. A Tauri event is not replayed, so
 * without a catch-up read the window sits on `no-harness` while the harness
 * is up and serving, which is the bug this file holds shut.
 *
 * The race is reproduced rather than described: `resolveHarnessAddress`
 * returns null the first time and an address afterwards, and the subscription
 * never delivers an event at all. Only a read taken after subscribing can
 * turn that into a ready store.
 */

const resolveHarnessAddress = vi.fn()
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
    createHarnessClient: () => client,
    startHarness: vi.fn(async () => false),
  }
})

vi.mock('@/features/chat/useConversation', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '@/features/chat/useConversation',
  )
  return {
    ...actual,
    // Subscribes successfully and then stays silent, which is exactly the
    // case a missed event leaves behind.
    defaultListen: (handler: (signal: { name: string; payload: unknown }) => void) => {
      listeners.push(handler)
      return Promise.resolve(() => undefined)
    },
  }
})

const { WorkspaceProvider, useWorkspace } = await import('@/stores/workspace')

function Probe() {
  const { storePhase } = useWorkspace()
  return <span data-testid="phase">{storePhase.status}</span>
}

describe('the store when the harness comes up during mount', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listeners.length = 0
  })

  afterEach(() => {
    cleanup()
  })

  it('reads again after subscribing, so a missed harness-started still lands', async () => {
    // First read: the supervisor is still starting, so there is no address.
    // Every read after it: the harness is up. No event is ever delivered.
    resolveHarnessAddress
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ baseUrl: 'http://127.0.0.1:1/', credential: 'host-attached' })

    render(
      <WorkspaceProvider>
        <Probe />
      </WorkspaceProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('phase').textContent).toBe('ready')
    })
    expect(listeners.length).toBeGreaterThan(0)
  })

  it('does not read twice when the first resolve already found the harness', async () => {
    // The common case. A store that has a client has nothing to catch up on,
    // and a second pass would refetch the whole index for nothing.
    resolveHarnessAddress.mockResolvedValue({
      baseUrl: 'http://127.0.0.1:1/',
      credential: 'host-attached',
    })

    render(
      <WorkspaceProvider>
        <Probe />
      </WorkspaceProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('phase').textContent).toBe('ready')
    })
    expect(resolveHarnessAddress).toHaveBeenCalledTimes(1)
  })
})
