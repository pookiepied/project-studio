import { useEffect, useState } from 'react'

import { useWorkspace } from '@/stores/workspace'
import { Pane, Row } from '@/features/settings/panes/Pane'
import type { AgentRosterRecord } from '@/platform/harness'

/**
 * The agent roster (S5.3), read-only.
 *
 * Every agent the harness has, straight from its registry — the same list
 * the delegate mount, the gate's per-agent filter, and the scope
 * substitution resolve through — so this pane cannot drift from what runs.
 * The honest-list rule is why there are no controls: definitions are code
 * on the harness side, reviewed there, and a form here would edit a second
 * copy of the truth. What the pane does add is the readable one-line story
 * of each agent's policy — what its model may see, what its calls may earn,
 * what it asks for — which the definitions state in code and a person
 * reasonably wants in words.
 *
 * A conversation or background row shows no policy list, because it has
 * none to show: `studio` composes its tools from the conversation's own
 * state, and the background agents hold none. Showing an empty list there
 * would imply a decision was made; the pane says the composing instead.
 */

const KIND_LABEL: Record<AgentRosterRecord['kind'], string> = {
  conversation: 'Conversation agent',
  delegate: 'Delegate',
  background: 'Background agent',
  worker: 'Background worker',
}

const EFFECT_LABEL: Record<string, string> = {
  read: 'read',
  write: 'write',
  execute: 'run',
  network: 'network',
}

export function AgentsPane() {
  const { agents } = useWorkspace()
  const list = agents.list
  const [roster, setRoster] = useState<readonly AgentRosterRecord[] | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void list().then((result) => {
      if (!live) return
      if (result.ok) setRoster(result.value)
      else setFailed(result.error.message)
    })
    return () => {
      live = false
    }
    // Read once when the pane opens. The roster is the harness's build, not
    // live state; a poll here would be a clock on something that cannot move.
  }, [list])

  if (failed !== null) {
    return (
      <Pane title="Agents" description="What Studio's agents are and what each one may do.">
        <Row label="The harness is not running" hint={failed} />
      </Pane>
    )
  }
  if (roster === null) {
    return (
      <Pane title="Agents" description="What Studio's agents are and what each one may do.">
        <Row label="Reading the roster…" />
      </Pane>
    )
  }

  return (
    <Pane title="Agents" description="What Studio's agents are and what each one may do.">
      {roster.map((agent) => (
        <div key={agent.agentName} className="py-3.5">
          <p className="text-ui text-foreground">
            {agent.title} <span className="text-caption text-muted-foreground">({agent.agentName})</span>
          </p>
          <p className="mt-0.5 text-caption text-muted-foreground">
            {KIND_LABEL[agent.kind]} — {agent.description}
          </p>
          {agent.permissions !== undefined ? (
            <p className="mt-1 text-caption text-muted-foreground">
              {describePolicy(agent)}
            </p>
          ) : agent.kind === 'conversation' || agent.kind === 'worker' ? (
            <p className="mt-1 text-caption text-muted-foreground">
              Composes its tools, skills and permissions from each conversation's own state.
            </p>
          ) : null}
        </div>
      ))}
    </Pane>
  )
}

/** The delegate's policy, as the sentence a person would check it against. */
function describePolicy(agent: AgentRosterRecord): string {
  const { tools, skills, permissions } = agent
  if (tools === undefined || skills === undefined || permissions === undefined) return ''
  const parts: string[] = []
  const natives = tools.natives.join(', ')
  const mcp = tools.mcpNamespaces
  parts.push(
    `Tools: ${natives === '' ? 'none' : natives}` +
      (mcp.length === 0
        ? ''
        : mcp[0] === '*'
          ? ", plus the conversation's adopted MCP tools"
          : `, plus MCP: ${mcp.join(', ')}`),
  )
  parts.push(`Skills: ${skills.ids.length > 0 ? skills.ids.join(', ') : 'none'}`)
  const effects = permissions.maxEffects.map((effect) => EFFECT_LABEL[effect] ?? effect)
  parts.push(
    `Its calls may ${effects.length > 0 ? effects.join(', ') : 'do nothing'} — ${permissions.mode === 'inherit'
      ? "it follows the chat's permission mode, and anything that still needs approval asks under this agent's name"
      : `anything unapproved stops and asks under this agent's name first (mode: ${permissions.mode})`}.`,
  )
  return parts.join('. ')
}
