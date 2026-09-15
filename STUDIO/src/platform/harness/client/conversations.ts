import {
  parseBackgroundJob,
  parseBackgroundJobs,
  parseConversationRecord,
  parseConversationRecords,
  parseMeasuredContextUsage,
  parseOrphanSweepOutcome,
  parseOrphanTrees,
  parsePurgeOutcome,
  type BackgroundJob,
  type ConversationCreateDraft,
  type ConversationPatch,
  type ConversationRecord,
  type MeasuredContextUsage,
  type OrphanSweepOutcome,
  type OrphanTrees,
  type PurgeOutcome,
} from '../contracts'
import { MCP_PATH } from './mcp'
import type { HarnessResult, Requester } from './request'

/**
 * `/api/conversations`: the index rows, their destruction, and the three
 * things a conversation reports about itself - its measured context, its
 * background commands, and its own decision about an MCP server.
 */

const CONVERSATIONS_PATH = '/api/conversations'

export interface ConversationIndexClient {
  listConversations(): Promise<HarnessResult<readonly ConversationRecord[]>>
  createConversation(draft: ConversationCreateDraft): Promise<HarnessResult<ConversationRecord>>
  updateConversation(
    id: string,
    patch: ConversationPatch,
  ): Promise<HarnessResult<ConversationRecord>>
  /** Permanent destruction of one conversation: journal, scoped rows, index row, tree. */
  deleteConversation(id: string): Promise<HarnessResult<PurgeOutcome>>
  purgeConversations(ids: readonly string[]): Promise<HarnessResult<PurgeOutcome>>
  /**
   * Trees no index row addresses, from earlier partial deletes. Read-only;
   * nothing here deletes on its own.
   */
  listOrphanTrees(): Promise<HarnessResult<OrphanTrees>>
  /** Removes the orphaned trees, at a person's request. */
  sweepOrphanTrees(): Promise<HarnessResult<OrphanSweepOutcome>>
  /**
   * The provider's own figure for what one conversation's last request sent.
   *
   * A route of its own rather than a field on the record: it changes on every
   * model request while the row changes on none of them. A conversation
   * nothing has measured answers null, which is an ordinary state and not a
   * failure - the caller estimates instead.
   */
  conversationContext(id: string): Promise<HarnessResult<MeasuredContextUsage | null>>
  /**
   * Records a decision for one conversation, where the conversation lives.
   *
   * The narrowest scope of the three, so it sits with the conversation's own
   * reads rather than with the administration surface - the same argument
   * that keeps a project's decision off the global screen. The body is the
   * project write's, exactly: `null` clears, so the project (or the default)
   * answers again. Nothing here reaches past this conversation, because a
   * conversation change reachable from somewhere wider is a change someone
   * did not know they were making.
   */
  setConversationMcpServerEnabled(
    conversationId: string,
    serverId: string,
    enabled: boolean | null,
  ): Promise<HarnessResult<void>>
  /**
   * The background commands one conversation started.
   *
   * With their output, in the one call: the tail is already bounded, the panel
   * shows it, and a second request per job would make rendering a list of five
   * six round trips.
   */
  conversationJobs(id: string): Promise<HarnessResult<readonly BackgroundJob[]>>
  /**
   * Ends one of them, at the person's request.
   *
   * The same operation the model's own tool performs, deliberately not a
   * different one - a stop that took a gentler path than the model's would
   * leave "the port is still held after I pressed stop".
   */
  stopConversationJob(id: string, jobId: string): Promise<HarnessResult<BackgroundJob | null>>
  /**
   * Ends the conversation's browser, at the person's request (ADR 0049 §4).
   *
   * Answers whether a browser was actually running: the difference between
   * "there was nothing to stop" and "I pressed stop and nothing happened".
   */
  stopConversationBrowser(id: string): Promise<HarnessResult<boolean>>
}

function conversationPath(id: string, suffix = ''): string {
  return `${CONVERSATIONS_PATH}/${encodeURIComponent(id)}${suffix}`
}

export function conversationIndexClient({ json, empty }: Requester): ConversationIndexClient {
  return {
    listConversations() {
      return json('GET', CONVERSATIONS_PATH, undefined, parseConversationRecords)
    },

    createConversation(draft) {
      // Sent on the admission receipt, never before it. An id the harness
      // refused to admit never becomes a row here. The settings ride along
      // when the turn carried them; the admission path has usually written
      // them already, and a repeat receipt is the same write.
      return json(
        'POST',
        CONVERSATIONS_PATH,
        {
          id: draft.id,
          firstMessage: draft.firstMessage,
          ...(draft.projectId === undefined ? {} : { projectId: draft.projectId }),
          ...(draft.modelId === undefined ? {} : { modelId: draft.modelId }),
          ...(draft.reasoningLevel === undefined ? {} : { reasoningLevel: draft.reasoningLevel }),
          ...(draft.permissionMode === undefined ? {} : { permissionMode: draft.permissionMode }),
          ...(draft.createdAt === undefined ? {} : { createdAt: draft.createdAt }),
        },
        parseConversationRecord,
      )
    },

    updateConversation(id, patch) {
      const body: Record<string, unknown> = {}
      if (patch.title !== undefined) body.title = patch.title
      if (patch.pinned !== undefined) body.pinned = patch.pinned
      if (patch.archived !== undefined) body.archived = patch.archived
      if (patch.projectId !== undefined) body.projectId = patch.projectId
      if (patch.modelId !== undefined) body.modelId = patch.modelId
      if (patch.reasoningLevel !== undefined) body.reasoningLevel = patch.reasoningLevel
      if (patch.permissionMode !== undefined) body.permissionMode = patch.permissionMode
      if (patch.lastTurnAt !== undefined) body.lastTurnAt = patch.lastTurnAt
      return json('PATCH', conversationPath(id), body, parseConversationRecord)
    },

    deleteConversation(id) {
      return json('DELETE', conversationPath(id), undefined, parsePurgeOutcome)
    },

    purgeConversations(ids) {
      return json('POST', `${CONVERSATIONS_PATH}/purge`, { ids: [...ids] }, parsePurgeOutcome)
    },

    listOrphanTrees() {
      return json('GET', `${CONVERSATIONS_PATH}/orphan-trees`, undefined, parseOrphanTrees)
    },

    sweepOrphanTrees() {
      return json(
        'POST',
        `${CONVERSATIONS_PATH}/orphan-trees/sweep`,
        undefined,
        parseOrphanSweepOutcome,
      )
    },

    conversationContext(id) {
      return json('GET', conversationPath(id, '/context'), undefined, parseMeasuredContextUsage)
    },

    setConversationMcpServerEnabled(conversationId, serverId, enabled) {
      // The conversation's own route, which lives under the MCP mount rather
      // than under /conversations, because every extension write - whichever
      // scope it answers for - is administered at /api/mcp. What makes this a
      // conversation's door is the path it writes, not a different resource:
      // the scope is the decision, so the URL names both.
      return empty(
        'PUT',
        `${MCP_PATH}/conversations/${encodeURIComponent(conversationId)}/extensions/mcp/${encodeURIComponent(serverId)}`,
        { enabled },
      )
    },

    conversationJobs(id) {
      return json('GET', conversationPath(id, '/jobs'), undefined, parseBackgroundJobs)
    },

    stopConversationBrowser(id) {
      return json(
        'POST',
        conversationPath(id, '/browser/stop'),
        undefined,
        (value) =>
          typeof value === 'object' && value !== null
            ? (value as Record<string, unknown>)['stopped'] === true
            : false,
      )
    },

    stopConversationJob(id, jobId) {
      return json(
        'POST',
        conversationPath(id, `/jobs/${encodeURIComponent(jobId)}/stop`),
        undefined,
        (value) =>
          parseBackgroundJob(
            typeof value === 'object' && value !== null
              ? (value as Record<string, unknown>)['job']
              : null,
          ),
      )
    },
  }
}
