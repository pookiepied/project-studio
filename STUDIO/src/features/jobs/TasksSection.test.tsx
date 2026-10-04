/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TasksSection } from './TasksSection'
import type { AgentTask } from '@/platform/harness'

/**
 * The agent tasks section, as a person sees it.
 *
 * The assertions hold the section to the same discipline the commands'
 * panel is held to: what was dispatched, how it went, and the way to stop
 * one - and nothing more. The section is silent when there is nothing: a
 * heading with no rows under it is the panel pretending there is a kind of
 * work the conversation has never seen.
 */

afterEach(() => {
  cleanup()
})

function task(overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    id: 'cnv_x',
    agentName: 'title',
    parentConversationId: null,
    title: 'Titler',
    status: 'running',
    createdAt: 1,
    settledAt: null,
    resultSummary: null,
    ...overrides,
  }
}

let server: readonly AgentTask[]
const list = vi.fn<() => Promise<{ ok: true; value: readonly AgentTask[] }>>()
const cancelTask = vi.fn(async (_taskId: string) => {
  // The harness records the intent and the projector settles the row; by the
  // next poll the index reads cancelled. The fake answers the same way.
  server = server.map((entry) =>
    entry.id === _taskId
      ? { ...entry, status: 'cancelled' as const, settledAt: 5 }
      : entry,
  )
  return { ok: true as const, value: true }
})

vi.mock('@/stores/workspace', () => ({
  useWorkspace: () => ({
    tasks: {
      list: () => list(),
      cancel: (taskId: string) => cancelTask(taskId),
    },
  }),
}))

beforeEach(() => {
  server = [task()]
  list.mockImplementation(async () => ({ ok: true as const, value: server }))
})

describe('the agent tasks section', () => {
  it('shows the task, its state, and stops a running one', async () => {
    render(<TasksSection />)

    await screen.findByText('Titler')
    expect(screen.getByText('Running')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    await waitFor(() => expect(screen.getByText('Stopped')).toBeTruthy())
    expect(cancelTask).toHaveBeenCalledWith('cnv_x')
  })

  it('names a failure rather than a bare Finished', async () => {
    server = [task({ status: 'failed', settledAt: 5, resultSummary: 'The model had a bad day.' })]
    render(<TasksSection />)

    await screen.findByText('The model had a bad day.')
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull()
  })

  it('reads a status it cannot parse as Unknown rather than inventing one', async () => {
    server = [task({ status: 'unknown', settledAt: 5 })]
    render(<TasksSection />)

    await screen.findByText('Unknown')
  })

  it('is silent when the harness has dispatched nothing', async () => {
    server = []
    const { container } = render(<TasksSection />)

    await waitFor(() => expect(list).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })
})
