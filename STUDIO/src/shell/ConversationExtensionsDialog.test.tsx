/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConversationExtensionsDialog } from './ConversationExtensionsDialog'
import type { McpServers, McpView } from '@/features/settings/mcp/useMcpServers'
import type { McpServerRecord } from '@/platform/harness'

/**
 * The conversation scope's surface, which has one fact to prove that the
 * other scopes' screens do not: that it reads THIS conversation and names the
 * thing its Inherit hands the question to. Everything else - the tri-state's
 * meaning, the honesty of the note - is the shared control's question, proven
 * once in ScopeToggle's own file and the project section's.
 */

const useMcpServers = vi.hoisted(() => vi.fn())

vi.mock('@/features/settings/mcp/useMcpServers', () => ({ useMcpServers }))

afterEach(cleanup)

beforeEach(() => {
  vi.clearAllMocks()
})

function record(overrides: Partial<McpServerRecord> = {}): McpServerRecord {
  return {
    id: 'echo-server',
    title: 'Echo server',
    description: 'Echoes the supplied text',
    provenance: 'user',
    transport: 'stdio',
    command: 'C:\\tools\\node.exe',
    args: ['server.js'],
    env: {},
    needsNetwork: false,
    auth: 'none',
    enabledByDefault: false,
    ...overrides,
  }
}

function hooked(view: McpView): void {
  useMcpServers.mockReturnValue({
    view,
    refreshing: false,
    refresh: vi.fn(async () => {}),
    save: vi.fn(async () => null),
    remove: vi.fn(async () => null),
    setEnabled: vi.fn(async () => null),
    setCredential: vi.fn(async () => null),
    clearCredential: vi.fn(async () => null),
  } satisfies McpServers)
}

const ready = (servers: readonly McpServerRecord[]): McpView => ({ status: 'ready', servers })

function open(overrides: {
  conversationId?: string
  projectName?: string | null
  view?: McpView
} = {}): void {
  if (overrides.view !== undefined) hooked(overrides.view)
  render(
    <ConversationExtensionsDialog
      conversation={
        overrides.conversationId === undefined ? null : { id: overrides.conversationId }
      }
      projectName={overrides.projectName ?? null}
      onClose={vi.fn()}
    />,
  )
}

describe('the conversation extensions dialog', () => {
  it('reads the conversation it is open for, and not the wider answers', () => {
    hooked(ready([]))
    open({ conversationId: 'conv_1' })

    expect(useMcpServers).toHaveBeenCalledWith({ conversationId: 'conv_1' })
  })

  it('idles on the global read while it is closed', () => {
    // Nobody sees this list; the hook still holds a scope, because its
    // contract has no scopeless shape, and the global read is the harmless
    // answer while the dialog is closed.
    open({})

    expect(useMcpServers).toHaveBeenCalledWith({})
  })

  it('names the project that the conversation inherits from', () => {
    // The note is the point of the row: this conversation has said nothing,
    // so what its Inherit resolves to is its project's answer - and "its
    // project" beside a conversation's own title is a pronoun looking for its
    // noun, so the project is named.
    hooked(
      ready([
        record({ conversation: { decision: null, resolved: true, decidedAt: 'project' } }),
      ]),
    )
    open({ conversationId: 'conv_1', projectName: 'Ada' })

    expect(screen.getByText('Inherits Ada, which has it on.')).toBeTruthy()
  })

  it('says when a change reaches the conversation, and when the note does not', () => {
    hooked(ready([record()]))
    open({ conversationId: 'conv_1' })

    expect(screen.getByText(/applies the change the next time it sends/)).toBeTruthy()
    expect(screen.getByText(/settled at its first message and does not change/)).toBeTruthy()
  })

  it('renders nothing while it is closed', () => {
    // The flag-prop doubles as the open state; a closed dialog's rows would
    // be a second, invisible conversation list answering nobody's question.
    open({})

    expect(screen.queryByText('Extensions')).toBeNull()
    expect(screen.queryByText(/What this conversation can reach/)).toBeNull()
  })
})
