import type { HarnessResult, Requester } from './request'
import { parseAgentRoster, type AgentRosterRecord } from '../contracts'

/**
 * The agent roster a harness serves.
 *
 * Read-only by design: the agents are definitions in the harness's code,
 * reviewed there, and this surface exists so the Settings pane can show
 * what actually runs — the same registry the delegate mount, the gate's
 * per-agent filter, and the scope substitution resolve through — rather
 * than a form that would edit a second copy of the truth.
 */
export interface AgentClient {
  /** Every agent the harness has, sorted by name, with each one's policy. */
  agents(): Promise<HarnessResult<readonly AgentRosterRecord[]>>
}

export function agentClient(request: Requester): AgentClient {
  const json = request.json
  return {
    agents() {
      return json('GET', '/api/agents', undefined, parseAgentRoster)
    },
  }
}
