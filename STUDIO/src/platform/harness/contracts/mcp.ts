/**
 * An MCP server as the harness records it: transport, auth, scope, and the
 * status of its last contact.
 */

import { isRecord } from '@/lib/guards'
import { flag, listOf, oneOf, optionalText, text } from './guards'

/**
 * How a server is reached.
 *
 * Two, and there will not be a third. `sse` is the deprecated two-endpoint
 * HTTP+SSE transport; the harness does not implement it and says so by name
 * (`C-16`). `http` here means Streamable HTTP, one endpoint.
 */
export const MCP_TRANSPORTS = ['stdio', 'http'] as const
export type McpTransport = (typeof MCP_TRANSPORTS)[number]

/** How a remote endpoint proves who we are. */
export const MCP_AUTH_KINDS = ['none', 'bearer', 'header'] as const
export type McpAuthKind = (typeof MCP_AUTH_KINDS)[number]

/**
 * The lifecycle a running server is in.
 *
 * `given-up` is distinct from `failed`: failed will be retried, given-up will
 * not, and a screen that showed them the same way would leave someone waiting
 * for a retry that is never coming.
 */
export const MCP_STATES = [
  'idle',
  'starting',
  'ready',
  'stopping',
  'failed',
  'given-up',
] as const
export type McpState = (typeof MCP_STATES)[number]

/**
 * Which protocol revision a server turned out to speak.
 *
 * Detected, never configured. The harness probes `server/discover` first and
 * falls back to `initialize`, so this is a fact to display rather than a
 * choice to offer - and offering it would only give someone a way to be wrong
 * about their own server.
 */
export const MCP_ERAS = ['modern', 'legacy'] as const
export type McpEra = (typeof MCP_ERAS)[number]

/**
 * Which scope produced the answer for a row.
 *
 * The reason a settings screen can say "on, from your defaults" rather than
 * just "on". Absent means nothing anywhere had an opinion, which resolves to
 * off.
 */
export const SCOPE_KINDS = ['global', 'project', 'conversation'] as const
export type ScopeKind = (typeof SCOPE_KINDS)[number]

/**
 * What one scope has decided, and what the whole chain answers.
 *
 * Three facts, because a row has to be honest about the effect, not only the
 * setting. `decision` is what is stored at this scope: on, off, or `null`
 * when it inherits - a real third answer, not a spelling of off, because
 * inherit hands the question to a wider scope while off ends it. `resolved`
 * and `decidedAt` are what the chain answers for the context the read named:
 * this scope's own answer when it decided, the wider scope's when it did not.
 * A control that showed only the decision would render "inherits" and "off"
 * as the same silence, and the model's reach differs under the two.
 */
export interface McpScopeReading {
  /** What this scope has stored: on, off, or `null` when it inherits. */
  readonly decision: boolean | null
  /** What selection resolves for the context this read was made in. */
  readonly resolved: boolean
  /** Which scope produced `resolved`. Absent when nothing anywhere decided; that resolves to off. */
  readonly decidedAt?: ScopeKind
}

export interface McpServerStatus {
  readonly state: McpState
  /** Failed starts so far. Zero unless the state is failed or given-up. */
  readonly attempts: number
  readonly era?: McpEra
  readonly protocolVersion?: string
  /** Why the last attempt failed, in the words the failure used. */
  readonly lastError?: string
  /** The last of what the server wrote to stderr, when one is connected. */
  readonly diagnostics: readonly string[]
}

/**
 * A server as this app sees it.
 *
 * **No secret is here, and none can arrive.** A bearer token, or the value of
 * the variable a local server reads its key from, lives in the OS credential
 * store. The record carries the variable's NAME, which is configuration. The
 * parse below rebuilds field by field for exactly this reason: a harness that
 * one day returned a secret could not smuggle it through a spread.
 */
/** Whose server this is, and therefore whether its tools load eagerly. */
export type McpProvenance = 'system' | 'user'

export const MCP_PROVENANCES = ['system', 'user'] as const

export interface McpServerRecord {
  readonly id: string
  readonly title: string
  /**
   * One sentence saying what the server is for, and not the title.
   *
   * The title is the label on the row - usually a product name. This is the
   * sentence the harness puts in the model's capability inventory, so it is
   * what decides whether a run reaches for this server at all. Empty when
   * nobody has written one.
   */
  readonly description: string
  /**
   * Whether the server ships with Studio or somebody attached it.
   *
   * Read-only here. The dialog does not offer it, because it is a shipping
   * decision rather than a preference, and a switch that makes a third-party
   * server load on every turn is not one to put in front of someone without
   * the paragraph that explains what it costs.
   */
  readonly provenance: McpProvenance
  readonly transport: McpTransport
  /** Absolute path to a real executable. `stdio` only. */
  readonly command?: string
  /** A real vector, never a string: nothing downstream may re-split it. */
  readonly args: readonly string[]
  /** Non-secret environment for the child. */
  readonly env: Readonly<Record<string, string>>
  /** `http` only. */
  readonly url?: string
  readonly auth: McpAuthKind
  /** Header name when `auth` is `header`. Not a secret. */
  readonly authHeader?: string
  /** The variable a local server reads its secret from. Not the secret. */
  readonly authEnvVar?: string
  /** Whether a contained local server is given a network. `stdio` only. */
  readonly needsNetwork: boolean
  /**
   * The user's default for this server, read at the global scope.
   *
   * Not "is it running", and not one project's answer. A server can be on by
   * default and not yet started, or running because a project overrode the
   * default - so this is stored state, never inferred from `status`.
   */
  readonly enabledByDefault: boolean
  /**
   * What the narrower scopes decided, when the read asked about one.
   *
   * `project` is present when the read named a project, `conversation` when it
   * named a conversation, and neither is present from the global read, whose
   * rows are about the default itself. Absent also means a harness older than
   * the readings: such a read still works, it just cannot say what inherit
   * resolves to, which is the one thing these fields are for.
   */
  readonly project?: McpScopeReading
  readonly conversation?: McpScopeReading
  readonly status?: McpServerStatus
}

export function stringMap(value: unknown): Readonly<Record<string, string>> | null {
  if (value === undefined) return {}
  if (!isRecord(value)) return null
  const out: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'string') return null
    out[key] = entry
  }
  return out
}

export function parseMcpStatus(value: unknown): McpServerStatus | null {
  if (!isRecord(value)) return null
  const state = oneOf(MCP_STATES, value['state'])
  if (state === null) return null
  const attempts = typeof value['attempts'] === 'number' ? value['attempts'] : 0
  const era = oneOf(MCP_ERAS, value['era'])
  const protocolVersion = optionalText(value['protocolVersion'])
  const lastError = optionalText(value['lastError'])
  const diagnostics = Array.isArray(value['diagnostics'])
    ? value['diagnostics'].filter((entry): entry is string => typeof entry === 'string')
    : []

  if (!protocolVersion.ok || !lastError.ok) return null

  return {
    state,
    attempts,
    diagnostics,
    ...(era === null ? {} : { era }),
    ...(protocolVersion.value === undefined ? {} : { protocolVersion: protocolVersion.value }),
    ...(lastError.value === undefined ? {} : { lastError: lastError.value }),
  }
}

/**
 * One scope's reading, as the harness wrote it.
 *
 * `decision` must say which of the three answers it is rather than collapsing
 * to a boolean, because the difference between "inherits" (`null`) and "off"
 * (`false`) is the difference between the wider scope deciding and this scope
 * having ended the question - exactly the flattening this parser exists to
 * keep honest. A reading that is present but malformed is refused outright
 * rather than guessed at: the row would otherwise display an inherited state
 * it only half knows.
 */
export function parseMcpScopeReading(value: unknown): McpScopeReading | null {
  if (!isRecord(value)) return null
  const decision = value['decision']
  if (typeof decision !== 'boolean' && decision !== null) return null
  const resolved = flag(value['resolved'])
  if (resolved === null) return null
  const decidedAt = oneOf(SCOPE_KINDS, value['decidedAt'])
  if (value['decidedAt'] !== undefined && decidedAt === null) return null

  return {
    decision,
    resolved,
    ...(decidedAt === null ? {} : { decidedAt }),
  }
}

export function parseMcpServer(value: unknown): McpServerRecord | null {
  if (!isRecord(value)) return null

  const id = text(value['id'])
  const title = text(value['title'])
  // Absent reads as empty rather than as a parse failure: a harness that
  // predates the column is a harness this app still has to talk to, and a
  // missing sentence is exactly "nobody has written one".
  //
  // The empty string is that same answer, and must be read the same way. The
  // harness stores an undescribed server as `""` and sends `""` back, so
  // treating empty as malformed refused every server nobody had written a
  // sentence for - and because one bad row fails the whole list, a single
  // undescribed server made the entire MCP screen unreadable and every save
  // of one look like a failure while it had in fact been written.
  const described = value['description'] === '' ? undefined : value['description']
  const description = optionalText(described)
  // Absent reads as `user`, matching the harness's own default and the column
  // default behind it. Anything unrecognised also reads as `user`, which is
  // the side that withholds - a value nobody understood must not be the thing
  // that shows a server as shipping with Studio.
  const provenance = oneOf(MCP_PROVENANCES, value['provenance']) ?? 'user'
  const transport = oneOf(MCP_TRANSPORTS, value['transport'])
  const auth = oneOf(MCP_AUTH_KINDS, value['auth'])
  const command = optionalText(value['command'])
  const url = optionalText(value['url'])
  const authHeader = optionalText(value['authHeader'])
  const authEnvVar = optionalText(value['authEnvVar'])
  const env = stringMap(value['env'])
  const args = Array.isArray(value['args'])
    ? value['args'].every((entry) => typeof entry === 'string')
      ? (value['args'] as readonly string[])
      : null
    : []

  if (
    id === null ||
    title === null ||
    transport === null ||
    auth === null ||
    args === null ||
    env === null ||
    !description.ok ||
    !command.ok ||
    !url.ok ||
    !authHeader.ok ||
    !authEnvVar.ok
  ) {
    return null
  }

  // `needsNetwork` defaults to true when absent, matching the harness: every
  // already-installed server was granted a network before the field existed,
  // and reading a missing field as `false` here would draw a boundary in the
  // UI that the harness is not applying.
  const needsNetwork = value['needsNetwork'] === undefined ? true : flag(value['needsNetwork'])
  if (needsNetwork === null) return null

  // Off when absent, matching the store: no decision anywhere resolves to off,
  // and a missing field is exactly "nobody has decided".
  const enabledByDefault =
    value['enabledByDefault'] === undefined ? false : flag(value['enabledByDefault'])
  if (enabledByDefault === null) return null

  // Read when present, refused when malformed, absent when the harness
  // predates them - which is the one case where a row legitimately cannot say
  // what inherit resolves to, because nobody told it.
  const project = value['project'] === undefined ? undefined : parseMcpScopeReading(value['project'])
  const conversation =
    value['conversation'] === undefined ? undefined : parseMcpScopeReading(value['conversation'])
  if (project === null || conversation === null) return null

  const status = value['status'] === undefined ? undefined : parseMcpStatus(value['status'])

  // Rebuilt field by field, never spread from the response.
  return {
    id,
    title,
    description: description.value ?? '',
    provenance,
    transport,
    auth,
    args,
    env,
    needsNetwork,
    enabledByDefault,
    ...(project === undefined ? {} : { project }),
    ...(conversation === undefined ? {} : { conversation }),
    ...(command.value === undefined ? {} : { command: command.value }),
    ...(url.value === undefined ? {} : { url: url.value }),
    ...(authHeader.value === undefined ? {} : { authHeader: authHeader.value }),
    ...(authEnvVar.value === undefined ? {} : { authEnvVar: authEnvVar.value }),
    ...(status === undefined || status === null ? {} : { status }),
  }
}

export function parseMcpServers(value: unknown): readonly McpServerRecord[] | null {
  return listOf(parseMcpServer, value)
}

/**
 * What is sent to install or replace a server.
 *
 * The record without the parts the harness owns: `status` is observed, not
 * configured. It deliberately carries no secret field - the credential is a
 * separate call, so a draft can be logged, echoed back in an error, or held
 * in a form's state without ever being a thing that leaks a key.
 */
export type McpServerDraft = Omit<
  McpServerRecord,
  'status' | 'args' | 'env' | 'needsNetwork' | 'enabledByDefault' | 'description' | 'provenance'
> & {
  readonly args?: readonly string[]
  readonly env?: Readonly<Record<string, string>>
  readonly needsNetwork?: boolean
  readonly description?: string
  /**
   * Left out of what this app sends, deliberately.
   *
   * Omitting it means the harness's default applies, and the harness's default
   * is `user`. A server somebody attached here is a user server; there is no
   * screen that should be able to say otherwise.
   */
  readonly provenance?: McpProvenance
}
