/**
 * The agent roster a harness serves: every agent it has, as data.
 */

import { oneOf, text } from './guards'

/**
 * The three kinds a definition can be (mirrored from
 * `STUDIO HARNESS/src/contracts/agents.ts`). A row's kind decides which
 * policy fields it carries — only a delegate's policy is static data; a
 * conversation agent composes its surface per conversation and a
 * background agent holds none.
 */
export const AGENT_KINDS = ['conversation', 'delegate', 'background'] as const

export type AgentKind = (typeof AGENT_KINDS)[number]

export const AGENT_MODES = ['ask', 'auto'] as const

export type AgentMode = (typeof AGENT_MODES)[number]

/** The model policy, in the definition's own two arms. */
export type AgentModelPolicyRecord =
  | { readonly inherit: true }
  | { readonly specifier: string; readonly thinkingLevel: 'off' }

/** The effects ceiling's vocabulary, for validation at the boundary. */
export const AGENT_EFFECTS = ['read', 'write', 'execute', 'network'] as const

export interface AgentRosterRecord {
  readonly agentName: string
  readonly title: string
  readonly description: string
  readonly kind: AgentKind
  readonly model: AgentModelPolicyRecord
  /** Only on a delegate: the static allowlist its model sees. */
  readonly tools?: { readonly natives: readonly string[]; readonly mcpNamespaces: readonly string[] }
  /** Only on a delegate: the bundled skills its definition names. */
  readonly skills?: { readonly ids: readonly string[] }
  /** Only on a delegate: the effects ceiling and the consent default. */
  readonly permissions?: { readonly maxEffects: readonly string[]; readonly mode: AgentMode }
  readonly durability: { readonly maxAttempts: number; readonly timeoutMs: number }
}

export function parseAgentRoster(value: unknown): readonly AgentRosterRecord[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((row) => {
    const agent = parseAgentRecord(row)
    return agent === null ? [] : [agent]
  })
}

export function parseAgentRecord(value: unknown): AgentRosterRecord | null {
  if (typeof value !== 'object' || value === null) return null
  const row = value as Record<string, unknown>
  const agentName = text(row['agentName'])
  const title = text(row['title'])
  const description = text(row['description'])
  const kind = oneOf(AGENT_KINDS, row['kind'])
  const durability = parseDurability(row['durability'])
  const model = parseModelPolicy(row['model'])
  if (
    agentName === null ||
    title === null ||
    description === null ||
    kind === null ||
    durability === null ||
    model === null
  ) {
    return null
  }

  // The delegate-only block, parsed only when the row claims the kind it
  // belongs to. A conversation row that carried tools would be the second
  // source of a live answer; dropping the row is louder than trimming it.
  if (kind === 'delegate') {
    const tools = parseToolPolicy(row['tools'])
    const skills = parseSkillPolicy(row['skills'])
    const permissions = parsePermissionPolicy(row['permissions'])
    if (tools === null || skills === null || permissions === null) return null
    return { agentName, title, description, kind, model, tools, skills, permissions, durability }
  }

  // The honest absence: a conversation or background row carries none of
  // the static policy, and a row that does is not served.
  if (row['tools'] !== undefined || row['skills'] !== undefined || row['permissions'] !== undefined) {
    return null
  }
  return { agentName, title, description, kind, model, durability }
}

function parseDurability(value: unknown): AgentRosterRecord['durability'] | null {
  if (typeof value !== 'object' || value === null) return null
  const row = value as Record<string, unknown>
  const maxAttempts = typeof row['maxAttempts'] === 'number' && Number.isFinite(row['maxAttempts']) ? row['maxAttempts'] : null
  const timeoutMs = typeof row['timeoutMs'] === 'number' && Number.isFinite(row['timeoutMs']) ? row['timeoutMs'] : null
  if (maxAttempts === null || timeoutMs === null) return null
  return { maxAttempts, timeoutMs }
}

function parseModelPolicy(value: unknown): AgentModelPolicyRecord | null {
  if (typeof value !== 'object' || value === null) return null
  const row = value as Record<string, unknown>
  if (row['inherit'] === true) return { inherit: true }
  const specifier = text(row['specifier'])
  const thinkingLevel = oneOf(['off'] as const, row['thinkingLevel'])
  if (specifier === null || thinkingLevel === null) return null
  return { specifier, thinkingLevel }
}

function parseToolPolicy(value: unknown): AgentRosterRecord['tools'] | null {
  if (typeof value !== 'object' || value === null) return null
  const row = value as Record<string, unknown>
  const natives = listOfStrings(row['natives'])
  const mcpNamespaces = listOfStrings(row['mcpNamespaces'])
  if (natives === null || mcpNamespaces === null) return null
  return { natives, mcpNamespaces }
}

function parseSkillPolicy(value: unknown): AgentRosterRecord['skills'] | null {
  if (typeof value !== 'object' || value === null) return null
  const row = value as Record<string, unknown>
  const ids = listOfStrings(row['ids'])
  return ids === null ? null : { ids }
}

function parsePermissionPolicy(value: unknown): AgentRosterRecord['permissions'] | null {
  if (typeof value !== 'object' || value === null) return null
  const row = value as Record<string, unknown>
  const maxEffects = listOfStrings(row['maxEffects'])
  const mode = oneOf(AGENT_MODES, row['mode'])
  if (maxEffects === null || mode === null) return null
  return { maxEffects, mode }
}

function listOfStrings(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') return null
    out.push(item)
  }
  return out
}
