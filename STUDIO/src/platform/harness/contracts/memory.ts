/**
 * Studio's memory as the harness records it: the person's profile, the
 * memory switch, and the short statements saved across conversations. A
 * `project` memory belongs to one project and is seen only in that
 * project's conversations; `personal` ones are seen everywhere.
 */

import { isRecord } from '@/lib/guards'
import { finiteNumber, flag, listOf, oneOf, text } from './guards'

export const MEMORY_KINDS = ['fact', 'preference', 'instruction', 'event'] as const
export type MemoryKind = (typeof MEMORY_KINDS)[number]

export const MEMORY_SCOPES = ['personal', 'project'] as const
export type MemoryScope = (typeof MEMORY_SCOPES)[number]

export type MemoryPriority = 1 | 2 | 3

export interface MemoryItem {
  readonly id: string
  readonly scope: MemoryScope
  readonly projectId: string | null
  readonly kind: MemoryKind
  readonly content: string
  readonly tags: readonly string[]
  readonly priority: MemoryPriority
  readonly author: 'model' | 'user'
  readonly sourceConversationId: string | null
  readonly createdAt: number
  readonly updatedAt: number
}

export interface MemoryListing {
  readonly items: readonly MemoryItem[]
  readonly total: number
}

export interface MemoryProfile {
  readonly name: string
  readonly preferredName: string
  readonly about: string
  readonly replyStyle: string
}

export interface MemorySettings {
  readonly enabled: boolean
}

/** One entry of a batch write: applied, or refused with the harness's reason. */
export type MemoryEntryResult =
  | { readonly ok: true; readonly item: MemoryItem | null; readonly existed: boolean }
  | { readonly ok: false; readonly error: string }

function words(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function nullableId(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null
  const parsed = text(value)
  return parsed === null ? undefined : parsed
}

export function parseMemoryItem(value: unknown): MemoryItem | null {
  if (!isRecord(value)) return null
  const id = text(value['id'])
  const scope = oneOf(MEMORY_SCOPES, value['scope'])
  const kind = oneOf(MEMORY_KINDS, value['kind'])
  const content = text(value['content'])
  const tags = listOf((tag) => (typeof tag === 'string' ? tag : null), value['tags'])
  const priority = value['priority']
  const author = value['author'] === 'user' ? 'user' : value['author'] === 'model' ? 'model' : null
  const projectId = nullableId(value['projectId'])
  const sourceConversationId = nullableId(value['sourceConversationId'])
  const createdAt = finiteNumber(value['createdAt'])
  const updatedAt = finiteNumber(value['updatedAt'])
  if (
    id === null || scope === null || kind === null || content === null || tags === null ||
    (priority !== 1 && priority !== 2 && priority !== 3) || author === null ||
    projectId === undefined || sourceConversationId === undefined ||
    createdAt === null || updatedAt === null
  ) {
    return null
  }
  return { id, scope, projectId, kind, content, tags, priority, author, sourceConversationId, createdAt, updatedAt }
}

export function parseMemoryListing(value: unknown): MemoryListing | null {
  if (!isRecord(value)) return null
  const items = listOf(parseMemoryItem, value['items'])
  const total = finiteNumber(value['total'])
  return items === null || total === null ? null : { items, total }
}

export function parseMemoryProfile(value: unknown): MemoryProfile | null {
  if (!isRecord(value) || !isRecord(value['profile'])) return null
  const profile = value['profile']
  const name = words(profile['name'])
  const preferredName = words(profile['preferredName'])
  const about = words(profile['about'])
  const replyStyle = words(profile['replyStyle'])
  if (name === null || preferredName === null || about === null || replyStyle === null) return null
  return { name, preferredName, about, replyStyle }
}

export function parseMemorySettings(value: unknown): MemorySettings | null {
  if (!isRecord(value) || !isRecord(value['settings'])) return null
  const enabled = flag(value['settings']['enabled'])
  return enabled === null ? null : { enabled }
}

function parseEntry(value: unknown): MemoryEntryResult | null {
  if (!isRecord(value)) return null
  if (value['ok'] === false) {
    const error = text(value['error'])
    return error === null ? null : { ok: false, error }
  }
  if (value['ok'] !== true) return null
  const item = value['item'] === undefined ? null : parseMemoryItem(value['item'])
  if (value['item'] !== undefined && item === null) return null
  return { ok: true, item, existed: value['existed'] === true }
}

export function parseMemoryBatch(value: unknown): readonly MemoryEntryResult[] | null {
  if (!isRecord(value)) return null
  return listOf(parseEntry, value['results'])
}
