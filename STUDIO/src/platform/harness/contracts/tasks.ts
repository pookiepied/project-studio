/**
 * The background agent tasks a harness dispatched.
 */

import { oneOf } from './guards'

/**
 * The settlement vocabulary the harness's task index speaks. One row per
 * dispatched background task, projected from the task's own stream - the
 * harness never invents a status here, and a row whose stored status this
 * build cannot parse reads as `unknown`, which is the honest answer for a
 * state the stream cannot prove.
 */
export const TASK_STATUSES = [
  'queued',
  'running',
  'waiting_for_user',
  'completed',
  'failed',
  'cancelled',
  'unknown',
] as const

export type AgentTaskStatus = (typeof TASK_STATUSES)[number]

/**
 * One row of the task index.
 *
 * Deliberately an index and not a transcript: the row says what was
 * dispatched, for whom, and how it settled. `resultSummary` is a
 * pointer-shape sentence - the first line of the task's final message,
 * bounded by the harness - never the answer itself.
 */
export interface AgentTask {
  readonly id: string
  readonly agentName: string
  /** The conversation the task's news belongs to, when one was named. */
  readonly parentConversationId: string | null
  readonly title: string
  readonly status: AgentTaskStatus
  readonly createdAt: number
  readonly settledAt: number | null
  readonly resultSummary: string | null
}

export function parseAgentTasks(value: unknown): readonly AgentTask[] {
  // The listing is the array itself; a body that is not one is not rows.
  if (!Array.isArray(value)) return []
  return value.flatMap((row) => {
    const task = parseAgentTask(row)
    return task === null ? [] : [task]
  })
}

export function parseAgentTask(value: unknown): AgentTask | null {
  if (typeof value !== 'object' || value === null) return null
  const row = value as Record<string, unknown>
  const id = row['id']
  const agentName = row['agentName']
  const title = row['title']
  const status = oneOf(TASK_STATUSES, row['status'])
  if (typeof id !== 'string' || id === '') return null
  if (typeof agentName !== 'string' || agentName === '') return null
  if (typeof title !== 'string') return null
  if (status === null) return null
  const number = (key: string): number | null => {
    const found = row[key]
    return typeof found === 'number' && Number.isFinite(found) ? found : null
  }
  const text = (key: string): string | null => {
    const found = row[key]
    return typeof found === 'string' ? found : null
  }
  return {
    id,
    agentName,
    parentConversationId: text('parentConversationId'),
    title,
    status,
    createdAt: number('createdAt') ?? 0,
    settledAt: number('settledAt'),
    resultSummary: text('resultSummary'),
  }
}
