import {
  parseMcpServer,
  parseMcpServers,
  type McpServerDraft,
  type McpServerRecord,
} from '../contracts'
import type { HarnessResult, Requester } from './request'

/**
 * `/api/mcp`: the servers installed, their credentials, and the decision at
 * each scope about whether one is on. The conversation-scoped write lives
 * with the conversation client, where the conversation's other reads are.
 */

export const MCP_PATH = '/api/mcp'

export interface McpClient {
  /**
   * Every installed server, each with what it is currently doing.
   *
   * With a scope, each row also carries that scope's reading: what the
   * project or conversation has decided, and what the whole chain resolves
   * to. Without one the rows say nothing narrower, because the global screen
   * edits the default and nothing else answers to it.
   */
  listMcpServers(scope?: {
    readonly projectId?: string
    readonly conversationId?: string
  }): Promise<HarnessResult<readonly McpServerRecord[]>>
  /** Installs a server, or replaces one with the same id. */
  saveMcpServer(draft: McpServerDraft): Promise<HarnessResult<McpServerRecord>>
  removeMcpServer(id: string): Promise<HarnessResult<void>>
  /**
   * Records a decision at one scope.
   *
   * `null` is not a spelling of `false`: it clears the decision so the wider
   * scope applies again. Off overrides an inherited on; cleared returns to it.
   */
  setMcpServerEnabled(
    id: string,
    enabled: boolean | null,
    scope?: { readonly projectId: string },
  ): Promise<HarnessResult<void>>
  /**
   * Stores the server's secret in the OS credential store.
   *
   * The value passes through this call and is never held: nothing in STUDIO
   * keeps it, and no read path can return it. Callers hand it over from the
   * dialog's own state and forget it on unmount.
   */
  setMcpCredential(id: string, secret: string): Promise<HarnessResult<void>>
  deleteMcpCredential(id: string): Promise<HarnessResult<void>>
}

export function mcpClient({ json, empty }: Requester): McpClient {
  return {
    listMcpServers(scope) {
      // The scope rides in the query rather than in three separate methods,
      // because it is one question - what is installed - read for one
      // narrower context or for none. Absent and empty keys are the same
      // answer here: the global read, whose rows carry no readings.
      const params = new URLSearchParams()
      if (scope?.projectId !== undefined) params.set('projectId', scope.projectId)
      if (scope?.conversationId !== undefined) params.set('conversationId', scope.conversationId)
      const search = params.toString()
      return json(
        'GET',
        `${MCP_PATH}/servers${search === '' ? '' : `?${search}`}`,
        undefined,
        parseMcpServers,
      )
    },

    saveMcpServer(draft) {
      return json('POST', `${MCP_PATH}/servers`, draft, parseMcpServer)
    },

    removeMcpServer(id) {
      return empty('DELETE', `${MCP_PATH}/servers/${encodeURIComponent(id)}`)
    },

    setMcpServerEnabled(id, enabled, scope) {
      // The global default and a project's decision are different routes on
      // purpose. A global change reachable from a project screen is a change
      // someone did not know they were making, so the two cannot be one call
      // with an optional field the caller might forget to set.
      const path =
        scope === undefined
          ? `${MCP_PATH}/extensions/mcp/${encodeURIComponent(id)}`
          : `${MCP_PATH}/projects/${encodeURIComponent(scope.projectId)}/extensions/mcp/${encodeURIComponent(id)}`
      return empty('PUT', path, { enabled })
    },

    setMcpCredential(id, secret) {
      return empty('PUT', `${MCP_PATH}/servers/${encodeURIComponent(id)}/credential`, {
        secret,
      })
    },

    deleteMcpCredential(id) {
      return empty('DELETE', `${MCP_PATH}/servers/${encodeURIComponent(id)}/credential`)
    },
  }
}
