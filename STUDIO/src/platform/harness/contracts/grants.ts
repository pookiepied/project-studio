/**
 * A permission already given, as the harness keeps it.
 */

import { isRecord } from '@/lib/guards'
import { finiteNumber, listOf, nullableTextOrAbsent, text } from './guards'

/*
 * Mirrored from `GET /api/permissions/grants`: one element of what
 * `PermissionGrantStore.list()` answers
 * (`STUDIO HARNESS/src/permissions/grant-store.ts`). A grant is the record of
 * an allow the person gave that was meant to outlast the call - an `always`
 * or a `conversation` answer; `once` approves one call and stores nothing -
 * and the list is what the Permissions pane shows and revokes from.
 *
 * The optional columns arrive the way the harness writes them: a
 * conversation-scoped grant carries `conversationId`, a standing one carries
 * no such key at all (`JSON.stringify` never carries an `undefined`), so
 * "absent" and "null" are the same fact here.
 */
export interface GrantRecord {
  readonly id: string
  /** The capability as the kernel keys it, e.g. `native/write_file` or `mcp:blender/render`. */
  readonly capabilityKey: string
  /** The agent identity the approval was given to. */
  readonly agentId: string
  /** Set for a conversation-scoped grant; null for one that persists. */
  readonly conversationId: string | null
  /** The project the approval was given in; null means it applies anywhere. */
  readonly projectId: string | null
  /** What the approval was narrowed to - `src/**`, `git:log`. Null means the whole capability. */
  readonly resourcePattern: string | null
  /** The definition the person saw when this approval was given. */
  readonly definitionHash: string | null
  readonly grantedAt: number
}

export function parseGrant(value: unknown): GrantRecord | null {
  if (!isRecord(value)) return null

  const id = text(value['id'])
  const capabilityKey = text(value['capabilityKey'])
  const agentId = text(value['agentId'])
  const grantedAt = finiteNumber(value['grantedAt'])
  if (id === null || capabilityKey === null || agentId === null || grantedAt === null) {
    return null
  }

  const conversationId = nullableTextOrAbsent(value['conversationId'])
  const projectId = nullableTextOrAbsent(value['projectId'])
  const resourcePattern = nullableTextOrAbsent(value['resourcePattern'])
  const definitionHash = nullableTextOrAbsent(value['definitionHash'])
  if (!conversationId.ok || !projectId.ok || !resourcePattern.ok || !definitionHash.ok) {
    return null
  }

  return {
    id,
    capabilityKey,
    agentId,
    conversationId: conversationId.value,
    projectId: projectId.value,
    resourcePattern: resourcePattern.value,
    definitionHash: definitionHash.value,
    grantedAt,
  }
}

export function parseGrants(value: unknown): readonly GrantRecord[] | null {
  return listOf(parseGrant, value)
}
