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
    storePhase: { status: 'loading', error: null } as StorePhase,
    ensureStore: vi.fn(async () => true),
    setArchived: (_conversationId: string, _archived: boolean) => {},
    removeMany: (_conversationIds: readonly string[]) => {},
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
})
