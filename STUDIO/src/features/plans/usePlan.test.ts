/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

import { usePlan } from './usePlan'
import type { PlanItemRecord, PlanSnapshot } from '@/platform/harness'

/**
 * The plan hook's three facts: the plan outlives the run that wrote it, a
 * failed read is not an empty plan, and a conversation switch must not show
 * the previous conversation's plan for a beat. Each is a way the pill could
 * quietly lie.
 *
 * The stub is a tiny in-memory server, not a static answer: the hook's poll
 * re-reads while it is mounted, so a stub that never reflects an accepted
 * tick would have the next read "undo" it - which is the reconciliation
 * working, against a mock that lies.
 */

let server: PlanSnapshot;

function seedSnapshot(conversationId: string, overrides: Partial<PlanSnapshot> = {}): PlanSnapshot {
  return {
    conversationId,
    damaged: false,
    items: [
      { id: 'one', text: 'Do one', status: 'done', position: 1, updatedBy: 'model', updatedAt: 1 },
      { id: 'two', text: 'Do two', status: 'running', position: 2, updatedBy: 'model', updatedAt: 2 },
    ],
    ...overrides,
  }
}

const refused = {
  ok: false as const,
  error: { kind: 'not-reachable' as const, timedOut: false, message: 'down' },
}

const get = vi.fn<() => Promise<{ ok: true; value: PlanSnapshot } | typeof refused>>()
const tickPlan = vi.fn(
  async (_conversationId: string, itemId: string, status: 'done' | 'pending') => {
    const items = server.items.map((item): PlanItemRecord =>
      item.id === itemId ? { ...item, status, updatedBy: 'person', updatedAt: 3 } : item,
    )
    server = { ...server, items }
    return { ok: true as const, value: undefined }
  },
)
const clearPlan = vi.fn(async () => {
  server = { ...server, items: [] }
  return { ok: true as const, value: undefined }
})

vi.mock('@/stores/workspace', () => ({
  useWorkspace: () => ({
    plans: {
      get: () => get(),
      tick: (conversationId: string, itemId: string, status: 'done' | 'pending') =>
        tickPlan(conversationId, itemId, status),
      clear: () => clearPlan(),
    },
  }),
}))

beforeEach(() => {
  server = seedSnapshot('cnv_x')
  get.mockImplementation(async () => ({ ok: true as const, value: server }))
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('the plan this conversation holds', () => {
  it('reads the conversation plan on mount', async () => {
    const { result } = renderHook(() => usePlan('cnv_x'))

    await waitFor(() => expect(result.current.hasPlan).toBe(true))
    expect(result.current.items.map((item) => item.id)).toEqual(['one', 'two'])
  })

  it('keeps the last known plan when a read fails, because down is not empty', async () => {
    const { result, rerender } = renderHook(({ active }) => usePlan('cnv_x', { active }), {
      initialProps: { active: false },
    })
    await waitFor(() => expect(result.current.hasPlan).toBe(true))

    get.mockResolvedValue(refused)
    // Flipping the cadence's trigger re-runs the poll, which is the hook's
    // own read path failing - not a manual call the hook never saw.
    rerender({ active: true })
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThanOrEqual(2))

    expect(result.current.hasPlan).toBe(true)
    expect(result.current.items).toHaveLength(2)
  })

  it('drops the previous conversation plan the moment the id changes', async () => {
    const { result, rerender } = renderHook(({ conversationId }) => usePlan(conversationId), {
      initialProps: { conversationId: 'cnv_x' },
    })
    await waitFor(() => expect(result.current.hasPlan).toBe(true))

    server = seedSnapshot('cnv_y')
    rerender({ conversationId: 'cnv_y' })

    // No beat of the other conversation's plan over this one's composer.
    expect(result.current.hasPlan).toBe(false)
    await waitFor(() => expect(result.current.items.map((item) => item.id)).toEqual(['one', 'two']))
  })

  it('writes an accepted tick into the snapshot, attributed to the person', async () => {
    const { result } = renderHook(() => usePlan('cnv_x'))
    await waitFor(() => expect(result.current.hasPlan).toBe(true))

    await act(async () => {
      await result.current.tick('two', 'done')
    })

    const two = result.current.items.find((item) => item.id === 'two')
    expect(two?.status).toBe('done')
    expect(two?.updatedBy).toBe('person')
  })

  it('empties the view when the clear is accepted', async () => {
    const { result } = renderHook(() => usePlan('cnv_x'))
    await waitFor(() => expect(result.current.hasPlan).toBe(true))

    await act(async () => {
      await result.current.clear()
    })

    expect(result.current.hasPlan).toBe(false)
  })
})
