/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PlanPanel } from './PlanPanel'
import type { PlanItemRecord, PlanSnapshot } from '@/platform/harness'

/**
 * The pill says two numbers and, when one is running, which; the panel is the
 * list itself with a tick on each row. The pill is a disclosure control and
 * nothing else - no menu, no hover card - and the panel is not a dashboard:
 * the assertions below fail if either grows a control the brief refused.
 *
 * The panel reads through `usePlan`, so the workspace stub is the same tiny
 * in-memory server the hook's tests run against.
 */

afterEach(() => {
  // The config does not set `globals: true`, so testing-library's automatic
  // cleanup never registers.
  cleanup()
})

function item(overrides: Partial<PlanItemRecord> = {}): PlanItemRecord {
  return {
    id: 'one',
    text: 'Read the existing schema',
    status: 'pending',
    position: 1,
    updatedBy: 'model',
    updatedAt: 1,
    ...overrides,
  }
}

function snapshot(items: readonly PlanItemRecord[], overrides: Partial<PlanSnapshot> = {}): PlanSnapshot {
  return { conversationId: 'cnv_x', damaged: false, items, ...overrides }
}

let server: PlanSnapshot
const get = vi.fn<() => Promise<{ ok: true; value: PlanSnapshot }>>()
const tickPlan = vi.fn(
  async (_conversationId: string, itemId: string, status: 'done' | 'pending') => {
    server = {
      ...server,
      items: server.items.map((entry) =>
        entry.id === itemId ? { ...entry, status, updatedBy: 'person', updatedAt: 3 } : entry,
      ),
    }
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
  server = snapshot([item()])
  get.mockImplementation(async () => ({ ok: true as const, value: server }))
})

describe('the plan panel', () => {
  it('renders the items in position order with their status and text', async () => {
    server = snapshot([
      item({ id: 'three', status: 'pending', position: 3, text: 'Third' }),
      item({ id: 'one', status: 'done', position: 1, text: 'First' }),
      item({ id: 'two', status: 'running', position: 2, text: 'Second' }),
    ])
    render(<PlanPanel conversationId="cnv_x" />)

    await waitFor(() => expect(screen.getByText('1 of 3 done')).toBeTruthy())
    const rows = screen.getAllByRole('checkbox')
    // The wire's order is not trusted: first-seen order, always.
    expect(rows.map((row) => row.textContent)).toEqual(['First', 'Second', 'Third'])
    expect(rows[0]?.getAttribute('aria-checked')).toBe('true')
    expect(rows[1]?.getAttribute('aria-checked')).toBe('false')
  })

  it('ticks an item done, and the store answers as the person', async () => {
    render(<PlanPanel conversationId="cnv_x" />)

    await waitFor(() => expect(screen.getByRole('checkbox')).toBeTruthy())
    fireEvent.click(screen.getByRole('checkbox'))

    await waitFor(() =>
      expect(screen.getByRole('checkbox').getAttribute('aria-checked')).toBe('true'),
    )
    expect(tickPlan).toHaveBeenCalledWith('cnv_x', 'one', 'done')
  })

  it('unticks a done item back to pending', async () => {
    server = snapshot([item({ status: 'done' })])
    render(<PlanPanel conversationId="cnv_x" />)

    await waitFor(() =>
      expect(screen.getByRole('checkbox').getAttribute('aria-checked')).toBe('true'),
    )
    fireEvent.click(screen.getByRole('checkbox'))

    await waitFor(() =>
      expect(screen.getByRole('checkbox').getAttribute('aria-checked')).toBe('false'),
    )
    expect(tickPlan).toHaveBeenCalledWith('cnv_x', 'one', 'pending')
  })

  it('offers the clear only where it is owed: on a plan nobody can read', async () => {
    server = snapshot([], { damaged: true })
    render(<PlanPanel conversationId="cnv_x" />)

    await waitFor(() => expect(screen.getByText(/could not be read/)).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Clear the plan' }))
    expect(clearPlan).toHaveBeenCalledOnce()
  })

  it('does not offer a clear while the plan is readable', async () => {
    render(<PlanPanel conversationId="cnv_x" />)

    await waitFor(() => expect(screen.getByRole('checkbox')).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Clear the plan' })).toBeNull()
  })
})
