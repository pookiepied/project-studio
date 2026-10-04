import type { HarnessResult, Requester } from './request'
import { parseAgentTasks, type AgentTask } from '../contracts'

/**
 * The background agent tasks the harness dispatched.
 *
 * The rows are the harness's index of its own background work - the titling
 * pass, and everything after it that dispatches an agent the way the titler
 * does. The panel reads them the way it reads the background commands: a
 * poll, because the news of an ending also arrives on its own through the
 * conversation, and the poll is what makes the list appear without one.
 */
export interface TaskClient {
  /**
   * Every task the harness has dispatched, newest first. Optionally narrowed
   * by the agent that ran it.
   */
  tasks(filters?: { agentName?: string }): Promise<HarnessResult<readonly AgentTask[]>>
  /**
   * Stops one task. Answers whether there was something to stop: the
   * difference between "I stopped it" and "it had already settled", which
   * the row cannot promise between polls.
   */
  cancelTask(taskId: string): Promise<HarnessResult<boolean>>
}

export function taskClient(request: Requester): TaskClient {
  const json = request.json
  return {
    tasks(filters) {
      const query = filters?.agentName === undefined ? '' : `?agentName=${encodeURIComponent(filters.agentName)}`
      return json('GET', `/api/tasks${query}`, undefined, parseAgentTasks)
    },
    cancelTask(taskId) {
      return json(
        'POST',
        `/api/tasks/${encodeURIComponent(taskId)}/cancel`,
        undefined,
        (value) =>
          typeof value === 'object' && value !== null
            ? (value as Record<string, unknown>)['cancelled'] === true
            : false,
      )
    },
  }
}
