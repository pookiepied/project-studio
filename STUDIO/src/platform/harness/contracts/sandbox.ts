/**
 * The sandbox's scope: levels, rows, folder trust, and the
 * folder listing the picker browses.
 */

import { isRecord } from '@/lib/guards'
import { finiteNumber, listOf, oneOf, text } from './guards'

/*
 * Mirrored from `GET /api/sandbox/scope`: the doors the person opened in the
 * wall. Scope is which paths a project may reach beyond its own folder;
 * level is whether the project is contained at all. The two are kept apart
 * here the same way they are kept apart in the pane.
 */

export const SANDBOX_LEVELS = ['contained', 'trusted'] as const
export type SandboxLevel = (typeof SANDBOX_LEVELS)[number]

export const SANDBOX_SCOPE_MODES = ['read', 'write'] as const
export type SandboxScopeMode = (typeof SANDBOX_SCOPE_MODES)[number]

export const SANDBOX_SCOPE_SOURCES = ['preset', 'custom', 'question'] as const
export type SandboxScopeSource = (typeof SANDBOX_SCOPE_SOURCES)[number]

export interface SandboxScopeRow {
  readonly projectId: string
  readonly path: string
  readonly mode: SandboxScopeMode
  readonly source: SandboxScopeSource
  readonly presetId: string | null
  readonly grantedAt: number
}

/*
 * Folder trust: whether the person vouches for a directory at all.
 *
 * A different question from the two above, and a precondition rather than a
 * wall - an undecided folder refuses every write and every command whatever
 * the permission mode says. The vocabulary collides with `SandboxLevel`, whose
 * `trusted` means uncontained: these two never derive from each other, and a
 * folder can be vouched for while its project stays contained, which is the
 * ordinary case.
 */

export const TRUST_DECISIONS = ['trusted', 'untrusted', 'undecided'] as const
export type TrustDecision = (typeof TRUST_DECISIONS)[number]

export interface FolderTrust {
  readonly root: string
  readonly name: string
  readonly decision: TrustDecision
}

export interface SandboxScopeInfo {
  readonly project: readonly SandboxScopeRow[]
  readonly machineWide: readonly SandboxScopeRow[]
  readonly level: SandboxLevel
  /** One row per folder of the project asked about; empty when none was. */
  readonly trust: readonly FolderTrust[]
}

export function nullablePresetId(value: unknown): { ok: true; value: string | null } | { ok: false } {
  if (value === null) return { ok: true, value: null }
  const parsed = text(value)
  return parsed === null ? { ok: false } : { ok: true, value: parsed }
}

export function parseSandboxScopeRow(value: unknown): SandboxScopeRow | null {
  if (!isRecord(value)) return null
  const projectId = typeof value['projectId'] === 'string' ? value['projectId'] : null
  const path = text(value['path'])
  const mode = oneOf(SANDBOX_SCOPE_MODES, value['mode'])
  const source = oneOf(SANDBOX_SCOPE_SOURCES, value['source'])
  const presetId = nullablePresetId(value['presetId'])
  const grantedAt = finiteNumber(value['grantedAt'])
  if (projectId === null || path === null || mode === null || source === null || !presetId.ok || grantedAt === null) {
    return null
  }
  return { projectId, path, mode, source, presetId: presetId.value, grantedAt }
}

export function parseFolderTrust(value: unknown): FolderTrust | null {
  if (!isRecord(value)) return null
  const root = text(value['root'])
  const name = typeof value['name'] === 'string' ? value['name'] : null
  const decision = oneOf(TRUST_DECISIONS, value['decision'])
  if (root === null || name === null || decision === null) return null
  return { root, name, decision }
}

export function parseSandboxScopeInfo(value: unknown): SandboxScopeInfo | null {
  if (!isRecord(value)) return null
  const project = listOf(parseSandboxScopeRow, value['project'])
  const machineWide = listOf(parseSandboxScopeRow, value['machineWide'])
  const level = oneOf(SANDBOX_LEVELS, value['level'])
  const trust = listOf(parseFolderTrust, value['trust'])
  if (project === null || machineWide === null || level === null || trust === null) return null
  return { project, machineWide, level, trust }
}

/*
 * The harness-side folder browser (ADR 0050, step 6).
 *
 * A folder is chosen on the machine it lives on, and a paired tab has no
 * native dialog to reach for - the file system being chosen is the PC's, not
 * the phone's. So the harness lists directories and the picker walks the
 * answer. The listing is wider than a choice on purpose: it reaches volume
 * roots and system directories, which are positions a person walks through,
 * while the wall stays at the folder write, whose refusal arrives as a
 * harness-error carrying `validateFolderPath`'s sentence.
 */

export interface BrowsedDirectory {
  readonly name: string
  readonly path: string
}

export interface FolderListing {
  /** The directory listed, normalized absolute. */
  readonly path: string
  /** The way back out, or null where there is no wider directory. */
  readonly parent: string | null
  /** The child directories, names first; files are not positions. */
  readonly directories: readonly BrowsedDirectory[]
}

export function parseBrowsedDirectory(value: unknown): BrowsedDirectory | null {
  if (!isRecord(value)) return null
  const name = text(value['name'])
  const path = text(value['path'])
  if (name === null || path === null) return null
  return { name, path }
}

export function parseFolderListing(value: unknown): FolderListing | null {
  if (!isRecord(value)) return null
  const path = text(value['path'])
  const parent = value['parent'] === null ? '' : text(value['parent'])
  const directories = listOf(parseBrowsedDirectory, value['directories'])
  if (path === null || parent === null || directories === null) return null
  return { path, parent: parent === '' ? null : parent, directories }
}
