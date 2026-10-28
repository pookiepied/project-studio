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
    parentConversationId: 'conversation',
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

const tasksSurface = { list: () => list(), cancel: (taskId: string) => cancelTask(taskId) }
vi.mock('@/stores/workspace', () => ({ useWorkspace: () => ({ tasks: tasksSurface }) }))

beforeEach(() => {
  vi.clearAllMocks()
  server = [task()]
  list.mockImplementation(async () => ({ ok: true as const, value: server }))
})

describe('the agent tasks section', () => {
  it('reports cancellation failure and makes the control available again', async () => {
    cancelTask.mockRejectedValueOnce(new Error('disconnected'))
    render(<TasksSection conversationId="conversation" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }))
    await screen.findByText('The stop request failed. Try again.')
    expect(screen.getByRole('button', { name: 'Stop' }).hasAttribute('disabled')).toBe(false)
    expect(screen.getByText('Running')).toBeTruthy()
  })
  it('excludes unowned tasks and tasks owned by other conversations', async () => {
    server = [task(), task({ id: 'foreign', title: 'Other conversation', parentConversationId: 'other' }), task({ id: 'unowned', title: 'Unowned task', parentConversationId: null })]
    render(<TasksSection conversationId="conversation" />)
    await screen.findByText('Titler')
    expect(screen.queryByText('Other conversation')).toBeNull()
    expect(screen.queryByText('Unowned task')).toBeNull()
  })
  it('does not confuse an accepted cancellation request with termination', async () => {
    cancelTask.mockResolvedValueOnce({ ok: true, value: true })
    render(<TasksSection conversationId="conversation" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }))
    await waitFor(() => expect(cancelTask).toHaveBeenCalled())
    expect(screen.queryByText('Stopped')).toBeNull()
    expect(screen.getByText('Running')).toBeTruthy()
  })
  it('shows the task, its state, and stops a running one', async () => {
    render(<TasksSection conversationId="conversation" />)

    await screen.findByText('Titler')
    expect(screen.getByText('Running')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    await waitFor(() => expect(screen.getByText('Stopped')).toBeTruthy())
    expect(cancelTask).toHaveBeenCalledWith('cnv_x')
  })

  it('names a failure rather than a bare Finished', async () => {
    server = [task({ status: 'failed', settledAt: 5, resultSummary: 'The model had a bad day.' })]
    render(<TasksSection conversationId="conversation" />)

    await screen.findByText('Failed')
    expect(screen.getByTitle('The model had a bad day.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull()
  })

  it('reads a status it cannot parse as Unknown rather than inventing one', async () => {
    server = [task({ status: 'unknown', settledAt: 5 })]
    render(<TasksSection conversationId="conversation" />)

    await screen.findByText('Unknown')
  })

  it('is silent when the harness has dispatched nothing', async () => {
    server = []
    const { container } = render(<TasksSection conversationId="conversation" />)

    await waitFor(() => expect(list).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })
})
