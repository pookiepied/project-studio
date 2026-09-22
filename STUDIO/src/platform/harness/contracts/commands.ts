/**
 * A slash command as the harness records it: the name typed after `/`, what
 * it does, whose it is, and whether it expands to a prompt or runs an
 * action in this window.
 */

import { isRecord } from '@/lib/guards'
import { listOf, oneOf, text } from './guards'

export const COMMAND_PROVENANCES = ['builtin', 'system', 'user'] as const
export type CommandProvenance = (typeof COMMAND_PROVENANCES)[number]

export const COMMAND_KINDS = ['prompt', 'action'] as const
export type CommandKind = (typeof COMMAND_KINDS)[number]

export interface CommandRecord {
  readonly id: string
  readonly description: string
  /** What to type after the name; empty when nothing is expected. */
  readonly argumentHint: string
  /** `builtin` is an action in this window; `system` ships as a file; `user` is the person's. */
  readonly provenance: CommandProvenance
  readonly kind: CommandKind
  /** The file, for a prompt command; null for a built-in. */
  readonly path: string | null
}

/** A file that looked like a command and was not, with the reason. */
export interface CommandProblem {
  readonly path: string
  readonly reason: string
}

export interface CommandListing {
  readonly commands: readonly CommandRecord[]
  readonly problems: readonly CommandProblem[]
  /** Where the person's own command files live. */
  readonly userDirectory: string
}

/** A prompt command's file, read apart: the two frontmatter fields and the body. */
export interface CommandSource {
  readonly description: string
  readonly argumentHint: string
  readonly body: string
}

export function parseCommand(value: unknown): CommandRecord | null {
  if (!isRecord(value)) return null
  const id = text(value['id'])
  const description = text(value['description'])
  // The hint is legitimately the empty string - it is what "nothing to type"
  // reads as, and the built-in actions ship it - so it does not go through
  // `text`, whose non-empty rule failed the record, the listing and the
  // picker with it.
  const argumentHint = value['argumentHint'] === '' ? '' : text(value['argumentHint'])
  const provenance = oneOf(COMMAND_PROVENANCES, value['provenance'])
  const kind = oneOf(COMMAND_KINDS, value['kind'])
  const path = value['path'] === null ? null : text(value['path'])
  if (
    id === null ||
    description === null ||
    argumentHint === null ||
    provenance === null ||
    kind === null ||
    (path === null && value['path'] !== null)
  ) {
    return null
  }
  return { id, description, argumentHint, provenance, kind, path }
}

export function parseCommandProblem(value: unknown): CommandProblem | null {
  if (!isRecord(value)) return null
  const path = text(value['path'])
  const reason = text(value['reason'])
  if (path === null || reason === null) return null
  return { path, reason }
}

export function parseCommandListing(value: unknown): CommandListing | null {
  if (!isRecord(value)) return null
  const commands = listOf(parseCommand, value['commands'])
  const problems = listOf(parseCommandProblem, value['problems'])
  const userDirectory = text(value['userDirectory'])
  if (commands === null || problems === null || userDirectory === null) return null
  return { commands, problems, userDirectory }
}

/** `GET /api/commands/:id`: the record, and the file's halves for a prompt command. */
export interface CommandDetail {
  readonly command: CommandRecord
  readonly source: CommandSource | null
}

export function parseCommandDetail(value: unknown): CommandDetail | null {
  if (!isRecord(value)) return null
  const command = parseCommand(value['command'])
  if (command === null) return null
  const raw = value['source']
  if (raw === null || raw === undefined) return { command, source: null }
  if (!isRecord(raw)) return null
  const frontmatter = isRecord(raw['frontmatter']) ? raw['frontmatter'] : {}
  const body = text(raw['body'])
  if (body === null) return null
  return {
    command,
    source: {
      description: text(frontmatter['description']) ?? '',
      argumentHint: text(frontmatter['argumentHint']) ?? '',
      body,
    },
  }
}

export function parseCommandExpansion(value: unknown): string | null {
  if (!isRecord(value)) return null
  // An expansion of nothing is a real answer - a body that is only `$1`,
  // expanded against no arguments - so it does not go through `text`.
  const expanded = value['text']
  return typeof expanded === 'string' ? expanded : null
}
