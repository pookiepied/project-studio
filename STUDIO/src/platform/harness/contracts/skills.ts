/**
 * A skill as the harness records it: a folder of instructions, whose it is,
 * and what each scope has decided about it.
 *
 * The scope reading is the MCP one, on purpose. A row about a skill answers
 * the same three questions a row about a server does, and the control that
 * renders them is shared.
 */

import { isRecord } from '@/lib/guards'
import { flag, listOf, oneOf, text } from './guards'
import { MCP_PROVENANCES, type McpProvenance, type McpScopeReading, parseMcpScopeReading } from './mcp'

export interface SkillRecord {
  /** The spec name, which is also the folder name. */
  readonly id: string
  readonly title: string
  /** The catalog line the model reads before deciding to load the skill. */
  readonly description: string
  /** `system` ships with Studio; `user` is a folder the person put in place. */
  readonly provenance: McpProvenance
  /** The folder, absolute, for the row to point at. */
  readonly directory: string
  /** Whether the user's default has this skill on. Not per project. */
  readonly enabledByDefault: boolean
  readonly project?: McpScopeReading
  readonly conversation?: McpScopeReading
}

/** A folder that looked like a skill and was not, with the parser's own reason. */
export interface SkillProblem {
  readonly directory: string
  readonly reason: string
}

export interface SkillListing {
  readonly skills: readonly SkillRecord[]
  readonly problems: readonly SkillProblem[]
}

export function parseSkill(value: unknown): SkillRecord | null {
  if (!isRecord(value)) return null
  const id = text(value['id'])
  const title = text(value['title'])
  const description = text(value['description'])
  const directory = text(value['directory'])
  // A value nobody understood must not show a skill as shipping with Studio.
  const provenance = oneOf(MCP_PROVENANCES, value['provenance']) ?? 'user'
  const enabledByDefault =
    value['enabledByDefault'] === undefined ? false : flag(value['enabledByDefault'])
  const project = value['project'] === undefined ? undefined : parseMcpScopeReading(value['project'])
  const conversation =
    value['conversation'] === undefined ? undefined : parseMcpScopeReading(value['conversation'])

  if (
    id === null ||
    title === null ||
    description === null ||
    directory === null ||
    enabledByDefault === null ||
    project === null ||
    conversation === null
  ) {
    return null
  }

  return {
    id,
    title,
    description,
    provenance,
    directory,
    enabledByDefault,
    ...(project === undefined ? {} : { project }),
    ...(conversation === undefined ? {} : { conversation }),
  }
}

export function parseSkillProblem(value: unknown): SkillProblem | null {
  if (!isRecord(value)) return null
  const directory = text(value['directory'])
  const reason = text(value['reason'])
  if (directory === null || reason === null) return null
  return { directory, reason }
}

export function parseSkillListing(value: unknown): SkillListing | null {
  if (!isRecord(value)) return null
  const skills = listOf(parseSkill, value['skills'])
  const problems = listOf(parseSkillProblem, value['problems'])
  if (skills === null || problems === null) return null
  return { skills, problems }
}
