import {
  parseMemoryBatch,
  parseMemoryListing,
  parseMemoryProfile,
  parseMemorySettings,
  type MemoryEntryResult,
  type MemoryKind,
  type MemoryListing,
  type MemoryPriority,
  type MemoryProfile,
  type MemoryScope,
  type MemorySettings,
} from '../contracts'
import type { HarnessResult, Requester } from './request'

/**
 * `/api/memory`: the person's profile and every saved memory, as the
 * Personalization pane edits them. Writes take lists and answer entry by
 * entry, so a batch delete of twenty memories is one request.
 */

export const MEMORY_PATH = '/api/memory'

export interface MemoryQuery {
  readonly query?: string
  readonly kind?: MemoryKind
  readonly scope?: MemoryScope
  readonly limit?: number
}

export interface MemoryDraft {
  readonly content: string
  readonly kind: MemoryKind
  readonly scope?: MemoryScope
  /** Required when `scope` is `project`. */
  readonly projectId?: string | null
  readonly priority?: MemoryPriority
  readonly tags?: readonly string[]
}

export interface MemoryEdit {
  readonly id: string
  readonly content?: string
  readonly kind?: MemoryKind
  readonly scope?: MemoryScope
  readonly projectId?: string | null
  readonly priority?: MemoryPriority
  readonly tags?: readonly string[]
}

export interface MemoryClient {
  listMemories(query?: MemoryQuery): Promise<HarnessResult<MemoryListing>>
  saveMemories(drafts: readonly MemoryDraft[]): Promise<HarnessResult<readonly MemoryEntryResult[]>>
  editMemories(edits: readonly MemoryEdit[]): Promise<HarnessResult<readonly MemoryEntryResult[]>>
  forgetMemories(ids: readonly string[]): Promise<HarnessResult<readonly MemoryEntryResult[]>>
  readMemoryProfile(): Promise<HarnessResult<MemoryProfile>>
  saveMemoryProfile(profile: Partial<MemoryProfile>): Promise<HarnessResult<MemoryProfile>>
  readMemorySettings(): Promise<HarnessResult<MemorySettings>>
  saveMemorySettings(settings: MemorySettings): Promise<HarnessResult<MemorySettings>>
}

function listingPath(query: MemoryQuery): string {
  const parameters = new URLSearchParams()
  if (query.query !== undefined && query.query !== '') parameters.set('query', query.query)
  if (query.kind !== undefined) parameters.set('kind', query.kind)
  if (query.scope !== undefined) parameters.set('scope', query.scope)
  if (query.limit !== undefined) parameters.set('limit', String(query.limit))
  const search = parameters.toString()
  return search === '' ? `${MEMORY_PATH}/items` : `${MEMORY_PATH}/items?${search}`
}

export function memoryClient({ json }: Requester): MemoryClient {
  return {
    listMemories(query = {}) {
      return json('GET', listingPath(query), undefined, parseMemoryListing)
    },
    saveMemories(drafts) {
      return json('POST', `${MEMORY_PATH}/items`, { items: drafts }, parseMemoryBatch)
    },
    editMemories(edits) {
      return json('PATCH', `${MEMORY_PATH}/items`, { changes: edits }, parseMemoryBatch)
    },
    forgetMemories(ids) {
      return json('POST', `${MEMORY_PATH}/items/forget`, { ids }, parseMemoryBatch)
    },
    readMemoryProfile() {
      return json('GET', `${MEMORY_PATH}/profile`, undefined, parseMemoryProfile)
    },
    saveMemoryProfile(profile) {
      return json('PUT', `${MEMORY_PATH}/profile`, profile, parseMemoryProfile)
    },
    readMemorySettings() {
      return json('GET', `${MEMORY_PATH}/settings`, undefined, parseMemorySettings)
    },
    saveMemorySettings(settings) {
      return json('PUT', `${MEMORY_PATH}/settings`, settings, parseMemorySettings)
    },
  }
}
