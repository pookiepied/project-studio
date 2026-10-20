/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AgentsPane } from './AgentsPane'
import type { AgentRosterRecord } from '@/platform/harness'

/**
 * The agent roster pane (S5.3), read-only. What the tests pin is the
 * honest-list rule at the surface: a delegate's policy is stated where a
 * person can read it, the conversation agent's row says its surface is
 * composed rather than pretending a static list exists, and a harness that
 * is not running is a fact on the pane rather than an empty frame.
 */

const workspace = vi.hoisted(() => ({
  agents: {
    list: vi.fn<() => Promise<{ ok: true; value: readonly AgentRosterRecord[] } | { ok: false; error: { message: string } }>>(),
  },
}))

vi.mock('@/stores/workspace', () => ({
  useWorkspace: () => workspace,
}))

const DELEGATE: AgentRosterRecord = {
  agentName: 'general',
  title: 'General',
  description: 'Hands-on work: writes and edits files, runs commands.',
  kind: 'delegate',
  model: { inherit: true },
  tools: { natives: ['read', 'write', 'shell'], mcpNamespaces: ['*'] },
  skills: { ids: [] },
  permissions: { maxEffects: ['read', 'write', 'execute', 'network'], mode: 'inherit' },
  durability: { maxAttempts: 3, timeoutMs: 3600000 },
}

const CONVERSATION: AgentRosterRecord = {
  agentName: 'studio',
  title: 'Studio',
  description: 'The continuing agent.',
  kind: 'conversation',
  model: { inherit: true },
  durability: { maxAttempts: 3, timeoutMs: 3600000 },
}

afterEach(() => {
  cleanup()
  workspace.agents.list.mockReset()
})

describe('AgentsPane', () => {
  it('names every agent and states a delegate policy where one exists', async () => {
    workspace.agents.list.mockResolvedValue({ ok: true, value: [DELEGATE, CONVERSATION] })
    render(<AgentsPane />)

    // Both rows render, by title and by id.
    expect(await screen.findByText((_, element) => element?.textContent === 'General (general)')).not.toBeNull()
    expect(screen.getByText((_, element) => element?.textContent === 'Studio (studio)')).not.toBeNull()
    // The delegate's policy sentence names the wildcard as the conversation's
    // adopted MCP, and a consent default that follows the chat's mode.
    expect(screen.getByText(/Tools: read, write, shell, plus the conversation's adopted MCP tools/i)).not.toBeNull()
    expect(screen.getByText(/follows the chat's permission mode, and anything that still needs approval asks under this agent's name/i)).not.toBeNull()
    // The conversation agent composes live state; the pane says so instead
    // of inventing a static list.
    expect(screen.getByText(/Composes its tools, skills and permissions from each conversation's own state/i)).not.toBeNull()
    // The honest-list rule means no controls to edit any of it.
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('shows a harness that is not running as a fact, not an empty pane', async () => {
    workspace.agents.list.mockResolvedValue({ ok: false as const, error: { message: 'connection refused' } })
    render(<AgentsPane />)

    expect(await screen.findByText('The harness is not running')).not.toBeNull()
    expect(screen.getByText('connection refused')).not.toBeNull()
  })
})
