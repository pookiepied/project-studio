import { parseSkillListing, type SkillListing } from '../contracts'
import type { HarnessResult, Requester } from './request'

/**
 * `/api/skills`: the skills installed, the folders that failed to be one, and
 * the decision at each scope about whether one is on.
 *
 * The MCP client with everything but the decision removed. A skill is
 * installed by putting a folder in place, so there is nothing to save, remove
 * or hold a secret for; what remains is the one question the two kinds
 * share, asked at the same three scopes and spelled the same way.
 */

export const SKILLS_PATH = '/api/skills'

export interface SkillClient {
  /**
   * Every installed skill, and the problems found beside them.
   *
   * With a scope, each row also carries that scope's reading; without one,
   * the rows say nothing narrower, because the global screen edits the
   * default and nothing else answers to it.
   */
  listSkills(scope?: {
    readonly projectId?: string
    readonly conversationId?: string
  }): Promise<HarnessResult<SkillListing>>
  /**
   * Records a decision at one scope. `null` clears it so the wider scope
   * applies again; off overrides an inherited on, cleared returns to it.
   */
  setSkillEnabled(
    id: string,
    enabled: boolean | null,
    scope?: { readonly projectId: string },
  ): Promise<HarnessResult<void>>
}

export function skillClient({ json, empty }: Requester): SkillClient {
  return {
    listSkills(scope) {
      const params = new URLSearchParams()
      if (scope?.projectId !== undefined) params.set('projectId', scope.projectId)
      if (scope?.conversationId !== undefined) params.set('conversationId', scope.conversationId)
      const search = params.toString()
      return json(
        'GET',
        `${SKILLS_PATH}${search === '' ? '' : `?${search}`}`,
        undefined,
        parseSkillListing,
      )
    },

    setSkillEnabled(id, enabled, scope) {
      // Two routes on purpose, as for a server: a global change reachable
      // from a project screen is a change someone did not know they were
      // making.
      const path =
        scope === undefined
          ? `${SKILLS_PATH}/extensions/skill/${encodeURIComponent(id)}`
          : `${SKILLS_PATH}/projects/${encodeURIComponent(scope.projectId)}/extensions/skill/${encodeURIComponent(id)}`
      return empty('PUT', path, { enabled })
    },
  }
}
