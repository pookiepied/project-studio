/**
 * A project as the index stores it: name, icon, folders, and the drafts and
 * patches that change it.
 */

import { isRecord } from '@/lib/guards'
import { finiteNumber, listOf, oneOf, text } from './guards'

/** The marks a project may wear; mirrored from `projectIconSchema`. */
export const PROJECT_ICON_KEYS = [
  'arc',
  'stack',
  'grid',
  'ring',
  'wave',
  'burst',
  'prism',
  'diamond',
] as const

export type ProjectIconKey = (typeof PROJECT_ICON_KEYS)[number]

export interface ProjectFolderRecord {
  readonly id: string
  readonly name: string
  readonly path: string
}

export interface ProjectRecord {
  readonly id: string
  readonly name: string
  /** Membership, not free text: oneOf(PROJECT_ICON_KEYS) proved it below. */
  readonly icon: ProjectIconKey
  readonly description: string
  readonly folders: readonly ProjectFolderRecord[]
  readonly createdAt: number
}

export function parseProjectFolder(value: unknown): ProjectFolderRecord | null {
  if (!isRecord(value)) return null
  const id = text(value['id'])
  const name = text(value['name'])
  const path = text(value['path'])
  if (id === null || name === null || path === null) return null
  return { id, name, path }
}

export function parseProjectRecord(value: unknown): ProjectRecord | null {
  if (!isRecord(value)) return null

  const id = text(value['id'])
  const name = text(value['name'])
  const icon = oneOf(PROJECT_ICON_KEYS, value['icon'])
  const folders = listOf(parseProjectFolder, value['folders'])
  const createdAt = finiteNumber(value['createdAt'])

  // A description differs from every other text field here: empty is a real
  // stored value ("a project with no description yet"), and the column is NOT
  // NULL at the other end, so a plain string is required - null is a drift.
  const rawDescription = value['description']
  if (typeof rawDescription !== 'string') return null

  if (
    id === null ||
    name === null ||
    icon === null ||
    folders === null ||
    createdAt === null
  ) {
    return null
  }

  return {
    id,
    name,
    icon,
    description: rawDescription,
    folders,
    createdAt,
  }
}

export function parseProjectRecords(value: unknown): readonly ProjectRecord[] | null {
  return listOf(parseProjectRecord, value)
}

export interface ProjectFolderSpec {
  readonly name: string
  readonly path: string
}

/** Everything creating a project means; the id is caller-chosen like the rest. */
export interface ProjectCreateDraft {
  readonly id?: string
  readonly name: string
  readonly icon: string
  readonly description?: string
  readonly folders?: readonly ProjectFolderSpec[]
}

export interface ProjectPatch {
  readonly name?: string
  readonly icon?: string
  readonly description?: string
}
