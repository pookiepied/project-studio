import {
  parseGrants,
  parsePendingApprovals,
  parsePendingQuestions,
  parsePlanSnapshot,
  type ApprovalAnswer,
  type GrantRecord,
  type PendingApprovalRecord,
  type PendingQuestionRecord,
  type PlanSnapshot,
} from '../contracts'
import type { HarnessResult, Requester } from './request'

/**
 * What a run asks a person to decide, and what a person has already decided:
 * the permission questions the kernel parks, the questions a run raises for
 * an answer, the plan a person ticks, and the grants those answers have
 * accumulated into. Three routes, one credential - every one sits behind the
 * APPROVAL admission scope, the same credential as everything else in the
 * client.
 */

const PENDING_APPROVALS_PATH = '/api/permissions/pending'
const PENDING_QUESTIONS_PATH = '/api/questions/pending'
const QUESTION_STOP_PATH = '/api/questions/stop'
const PLANS_PATH = '/api/plans'
const GRANTS_PATH = '/api/permissions/grants'

/** Which columns a grants listing is narrowed by; an absent one says nothing. */
export interface GrantFiltersInput {
  readonly agentId?: string
  readonly projectId?: string
  readonly conversationId?: string
}

export interface DecisionClient {
  /**
   * The permission questions the kernel has raised and nobody has answered.
   *
   * Harness-wide rather than per conversation - the list carries every
   * conversation's parked rows, and each row names the conversation it
   * belongs to - so this lives on the administration client beside the index
   * routes, not on the conversation client.
   */
  listPendingApprovals(): Promise<HarnessResult<readonly PendingApprovalRecord[]>>
  /** Settles one question with a verdict and how long the allow lasts. */
  answerApproval(id: string, answer: ApprovalAnswer): Promise<HarnessResult<void>>
  /** Withdraws one question without answering it; 204 or a 404 for a row already gone. */
  cancelApproval(id: string): Promise<HarnessResult<void>>

  /**
   * The approvals already given — the rows an answered "always" or "this
   * conversation" wrote — so the person can see them and take one back.
   * Behind the same credential as the pending list, because giving a
   * permission and withdrawing it are one act seen from its two ends.
   */
  listGrants(filters?: GrantFiltersInput): Promise<HarnessResult<readonly GrantRecord[]>>
  /** Marks one grant revoked; 204, or a 404 for an id already gone. */
  revokeGrant(id: string): Promise<HarnessResult<void>>

  /**
   * The questions the harness's runs are asking for a decision, under the
   * same approval credential but never the same rows: a permission question
   * cannot time out and has no default, and this channel is the one with
   * both. The list is harness-wide and each row names its conversation.
   */
  listPendingQuestions(): Promise<HarnessResult<readonly PendingQuestionRecord[]>>
  /** Settles one question: chosen options, written text, or a deferral. */
  answerQuestion(
    id: string,
    answer: { optionIds?: readonly string[]; text?: string; deferred?: boolean },
  ): Promise<HarnessResult<void>>
  /** Withdraws one question without an outcome; 204 or a 404 for a row already gone. */
  cancelQuestion(id: string): Promise<HarnessResult<void>>
  /** Stops every question one conversation is asking: the person is ending the run. */
  stopQuestions(conversationId: string): Promise<HarnessResult<void>>

  /**
   * One conversation's plan: the rows the model writes and the person ticks.
   * Unlike the question and approval lists this read is per conversation,
   * because the plan belongs to the conversation rather than to a run, and
   * the read is the only place the damaged state can be told from an empty
   * one - the client carries it as data, never as an error.
   */
  getPlan(conversationId: string): Promise<HarnessResult<PlanSnapshot>>
  /** The person's tick. Only done and pending are offered, and only to the person. */
  tickPlanItem(
    conversationId: string,
    itemId: string,
    status: 'done' | 'pending',
  ): Promise<HarnessResult<void>>
  /** Clears the conversation's plan: the panel's remedy for a damaged read. */
  clearPlan(conversationId: string): Promise<HarnessResult<void>>
}

export function decisionClient({ json, empty }: Requester): DecisionClient {
  return {
    listPendingApprovals() {
      return json('GET', PENDING_APPROVALS_PATH, undefined, parsePendingApprovals)
    },

    answerApproval(id, answer) {
      return empty('POST', `${PENDING_APPROVALS_PATH}/${encodeURIComponent(id)}`, answer)
    },

  cancelApproval(id) {
    return empty('DELETE', `${PENDING_APPROVALS_PATH}/${encodeURIComponent(id)}`)
  },

  listGrants(filters) {
    // A filter names a column to conjoin; an absent one says nothing about
    // that column, and an empty query is the whole list.
    const params = new URLSearchParams()
    if (filters?.agentId !== undefined) params.set('agentId', filters.agentId)
    if (filters?.projectId !== undefined) params.set('projectId', filters.projectId)
    if (filters?.conversationId !== undefined) {
      params.set('conversationId', filters.conversationId)
    }
    const query = params.toString()
    return json('GET', query === '' ? GRANTS_PATH : `${GRANTS_PATH}?${query}`, undefined, parseGrants)
  },

  revokeGrant(id) {
    return empty('DELETE', `${GRANTS_PATH}/${encodeURIComponent(id)}`)
  },

    listPendingQuestions() {
      return json('GET', PENDING_QUESTIONS_PATH, undefined, parsePendingQuestions)
    },

    answerQuestion(id, answer) {
      // Only what was chosen travels: a body with nothing in it is refused by
      // the harness, and a false `deferred` field would be a second way to
      // say "answered".
      const body: Record<string, unknown> = {}
      if (answer.optionIds !== undefined) body.optionIds = [...answer.optionIds]
      if (answer.text !== undefined) body.text = answer.text
      if (answer.deferred === true) body.deferred = true
      return empty('POST', `${PENDING_QUESTIONS_PATH}/${encodeURIComponent(id)}`, body)
    },

    cancelQuestion(id) {
      return empty('DELETE', `${PENDING_QUESTIONS_PATH}/${encodeURIComponent(id)}`)
    },

    stopQuestions(conversationId) {
      return empty('POST', QUESTION_STOP_PATH, { conversationId })
    },

    getPlan(conversationId) {
      return json(
        'GET',
        `${PLANS_PATH}/${encodeURIComponent(conversationId)}`,
        undefined,
        parsePlanSnapshot,
      )
    },

    tickPlanItem(conversationId, itemId, status) {
      // The body names the status rather than a bare boolean: the vocabulary
      // is the same five the model writes, narrowed for the person, and a
      // word reads truer at the seam than a flag.
      return empty(
        'POST',
        `${PLANS_PATH}/${encodeURIComponent(conversationId)}/items/${encodeURIComponent(itemId)}`,
        { status },
      )
    },

    clearPlan(conversationId) {
      return empty('DELETE', `${PLANS_PATH}/${encodeURIComponent(conversationId)}`)
    },
  }
}
