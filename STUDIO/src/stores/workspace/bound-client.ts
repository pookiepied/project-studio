import type { RefObject } from 'react'
import type { HarnessClient, HarnessFailure, HarnessResult } from '@/platform/harness'
import type { BoundClient } from '@/stores/workspace/types'

/**
 * The harness surfaces the store hands out, bound to whichever client the
 * store holds at the moment of the call.
 *
 * Bound to the ref rather than to a client, so a harness restart - which
 * replaces the client - is survived by the next call. A panel holds this
 * object across the restart, and a captured client would keep pointing at
 * the address that went away. With no client there is nothing to ask, and
 * each call answers with the same `not-reachable` failure every other read
 * of the harness answers with, in its own words.
 */
export function bindClient(clientRef: RefObject<HarnessClient | null>): BoundClient {
  const call = <T>(
    message: string,
    request: (client: HarnessClient) => Promise<HarnessResult<T>>,
  ): Promise<HarnessResult<T>> => {
    const client = clientRef.current
    if (client === null) return Promise.resolve(unreachable(message))
    return request(client)
  }

  return {
    approvals: {
      list: () =>
        call('The harness is not running, so there is nothing to ask it.', (client) =>
          client.listPendingApprovals(),
        ),
      answer: (id, answer) =>
        call('The harness is not running, so the answer went nowhere.', (client) =>
          client.answerApproval(id, answer),
        ),
      cancel: (id) =>
        call('The harness is not running, so the question could not be withdrawn.', (client) =>
          client.cancelApproval(id),
        ),
    },
    questions: {
      list: () =>
        call('The harness is not running, so there is nothing to ask it.', (client) =>
          client.listPendingQuestions(),
        ),
      answer: (id, answer) =>
        call('The harness is not running, so the answer went nowhere.', (client) =>
          client.answerQuestion(id, answer),
        ),
      cancel: (id) =>
        call('The harness is not running, so the question could not be withdrawn.', (client) =>
          client.cancelQuestion(id),
        ),
      stop: (conversationId) =>
        call('The harness is not running, so the questions could not be stopped.', (client) =>
          client.stopQuestions(conversationId),
        ),
    },
    plans: {
      get: (conversationId) =>
        call('The harness is not running, so there is no plan to read.', (client) =>
          client.getPlan(conversationId),
        ),
      tick: (conversationId, itemId, status) =>
        call('The harness is not running, so the tick went nowhere.', (client) =>
          client.tickPlanItem(conversationId, itemId, status),
        ),
      clear: (conversationId) =>
        call('The harness is not running, so the plan could not be cleared.', (client) =>
          client.clearPlan(conversationId),
        ),
    },
    backgroundJobs: {
      list: (conversationId) =>
        call('The harness is not running, so there are no commands to list.', (client) =>
          client.conversationJobs(conversationId),
        ),
      stop: (conversationId, jobId) =>
        call('The harness is not running, so nothing was stopped.', (client) =>
          client.stopConversationJob(conversationId, jobId),
        ),
    },
    tasks: {
      list: () =>
        call('The harness is not running, so there are no tasks to list.', (client) =>
          client.tasks(),
        ),
      cancel: (taskId) =>
        call('The harness is not running, so nothing was stopped.', (client) =>
          client.cancelTask(taskId),
        ),
    },
    agents: {
      list: () =>
        call('The harness is not running, so there is no agent roster to read.', (client) =>
          client.agents(),
        ),
    },
    browser: {
      stop: (conversationId) =>
        call('The harness is not running, so there is no browser to stop.', (client) =>
          client.stopConversationBrowser(conversationId),
        ),
    },
    computer: {
      stop: (conversationId) =>
        call('The harness is not running, so nothing is driving the computer.', (client) =>
          client.stopConversationComputer(conversationId),
        ),
    },
    mediaJobs: {
      list: (conversationId) =>
        call('The harness is not running, so there are no generations to list.', (client) =>
          client.conversationMediaJobs(conversationId),
        ),
      stop: (conversationId, jobId) =>
        call('The harness is not running, so nothing was stopped.', (client) =>
          client.stopConversationMediaJob(conversationId, jobId),
        ),
      artifacts: (conversationId) =>
        call('The harness is not running, so there are no artifacts to list.', (client) =>
          client.conversationMediaArtifacts(conversationId),
        ),
    },
    browseFolders: (path) =>
      call(
        'The harness is not running, so the folders on this PC cannot be listed.',
        (client) => client.browseFolders(path),
      ),
  }
}

/** The failure every call answers with when there is no harness to ask. */
export function unreachable(message: string): {
  readonly ok: false
  readonly error: HarnessFailure
} {
  return { ok: false, error: { kind: 'not-reachable', timedOut: false, message } }
}
