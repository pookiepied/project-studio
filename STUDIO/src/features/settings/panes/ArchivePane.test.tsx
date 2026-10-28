/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ArchivePane } from './ArchivePane'
import type { StorePhase } from '@/stores/workspace'

/**
 * The archive answers to the store's phase, not to its own length.
 *
 * This pane used to read "Nothing archived." the moment it mounted, because
 * the conversation index had not arrived yet -- an empty list and a loading
 * one were the same sentence. The tests pin the difference: while the read is
 * in flight the pane holds the rows' shape under a loading announcement, an
 * empty archive may claim to be empty only once the store says `ready`, and a
 * failed read names the failure with the remedy beside it.
 */

const workspace = vi.hoisted(() => {
  return {
    conversations: [] as {
      readonly id: string
      readonly title: string | null
      readonly archived: boolean
      readonly updatedAt: number
    }[],
    // Widened to the whole phase union, so the failed shape the tests assign
    // later is assignable. The rule reads the expression alone; removing this
    // fails the typecheck.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    storePhase: { status: 'loading', error: null } as StorePhase,
    ensureStore: vi.fn(async () => true),
    setArchived: (_conversationId: string, _archived: boolean) => {},
    removeMany: vi.fn(async (_conversationIds: readonly string[]) => ({})),
    orphanTrees: [] as readonly string[],
    refreshOrphanTrees: vi.fn(async () => {}),
    sweepOrphanTrees: vi.fn(async () => ({ ok: true as const, value: {} })),
  }
})

vi.mock('@/stores/workspace', () => ({
  useWorkspace: () => workspace,
}))

afterEach(cleanup)

function ready() {
  workspace.storePhase = { status: 'ready', error: null }
  workspace.conversations = []
}

function archivedConversation(id: string, title: string) {
  return { id, title, archived: true, updatedAt: 1_000 }
}

describe('ArchivePane', () => {
  it('holds the shape of the rows while the index is in flight', () => {
    workspace.storePhase = { status: 'loading', error: null }
    workspace.conversations = []
    render(<ArchivePane />)
    expect(screen.getByRole('status', { name: 'Loading the archive' })).not.toBeNull()
    expect(screen.queryByText('Nothing archived.')).toBeNull()
  })

  it('claims emptiness only once the store says ready', () => {
    ready()
    render(<ArchivePane />)
    expect(screen.getByText('Nothing archived.')).not.toBeNull()
  })

  it('lists the archive when it arrives', () => {
    ready()
    workspace.conversations = [archivedConversation('cnv_1', 'An archived read')]
    render(<ArchivePane />)
    expect(screen.getByText('An archived read')).not.toBeNull()
  })

  it('says what broke and offers the remedy', async () => {
    workspace.storePhase = {
      status: 'failed',
      error: { kind: 'harness-error', status: 503, message: 'read failed' },
    }
    workspace.conversations = []
    workspace.ensureStore = vi.fn(async () => true)
    render(<ArchivePane />)

    expect(screen.getByText('Could not read the archive.')).not.toBeNull()
    expect(screen.getByText('read failed')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(workspace.ensureStore).toHaveBeenCalledTimes(1))
  })

  it('states what deleting destroys before anything is selected', () => {
    ready()
    workspace.conversations = [archivedConversation('cnv_1', 'An archived read')]
    render(<ArchivePane />)
    expect(
      screen.getByText(/Deleting removes the conversation, its files and its transcript/),
    ).not.toBeNull()
  })

  it('purges the whole archive when asked', async () => {
    ready()
    workspace.conversations = [
      archivedConversation('cnv_1', 'First'),
      archivedConversation('cnv_2', 'Second'),
    ]
    workspace.removeMany = vi.fn(async () => ({}))
    render(<ArchivePane />)

    fireEvent.click(screen.getByRole('button', { name: 'Clear archive' }))
    await waitFor(() =>
      expect(workspace.removeMany).toHaveBeenCalledWith(['cnv_1', 'cnv_2']),
    )
  })

  it('keeps a refused conversation listed and says why, verbatim', async () => {
    ready()
    workspace.conversations = [archivedConversation('cnv_live', 'Still working')]
    workspace.removeMany = vi.fn(async () => ({
      cnv_live: 'Conversation "cnv_live" has a turn in flight.',
    }))
    render(<ArchivePane />)

    fireEvent.click(screen.getByRole('button', { name: 'Clear archive' }))
    await waitFor(() =>
      expect(screen.getByRole('alert')).not.toBeNull(),
    )
    expect(screen.getByRole('alert').textContent).toContain('has a turn in flight')
  })

  it('has no separate button for leftover folders', () => {
    ready()
    workspace.conversations = [archivedConversation('cnv_a', 'Old chat')]
    workspace.orphanTrees = ['cnv_1j04nco6']
    render(<ArchivePane />)
    expect(screen.queryByRole('button', { name: 'Remove leftover folders' })).toBeNull()
    expect(screen.getByText(/any folders an earlier delete left behind/)).not.toBeNull()
  })

  it('clears the archive and then sweeps what any delete left behind, in one click', async () => {
    ready()
    workspace.conversations = [archivedConversation('cnv_a', 'Old chat')]
    workspace.orphanTrees = ['cnv_1j04nco6']
    const order: string[] = []
    workspace.removeMany = vi.fn(async (ids: readonly string[]) => { order.push(`purge ${ids.join(',')}`); return {} })
    workspace.sweepOrphanTrees = vi.fn(async (): Promise<{ ok: true; value: Record<string, never> }> => { order.push('sweep'); return { ok: true, value: {} } })
    render(<ArchivePane />)

    fireEvent.click(screen.getByRole('button', { name: 'Clear archive' }))
    await waitFor(() => expect(order).toEqual(['purge cnv_a', 'sweep']))
  })

  it('offers Clear archive when only leftover folders remain, and only sweeps', async () => {
    ready()
    workspace.conversations = []
    workspace.orphanTrees = ['cnv_1j04nco6']
    workspace.removeMany = vi.fn(async () => ({}))
    workspace.sweepOrphanTrees = vi.fn(async (): Promise<{ ok: true; value: Record<string, never> }> => ({ ok: true, value: {} }))
    render(<ArchivePane />)

    expect(screen.getByText(/one folder from a deleted chat is still on disk/)).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Clear archive' }))
    await waitFor(() => expect(workspace.sweepOrphanTrees).toHaveBeenCalledTimes(1))
    expect(workspace.removeMany).not.toHaveBeenCalled()
  })
})
