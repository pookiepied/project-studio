import {
  parseLibraryDescription,
  parseLibraryItemEnvelope,
  parseLibraryListing,
  type LibraryDescription,
  type LibraryFacts,
  type LibraryItem,
  type LibraryKind,
  type LibraryListing,
} from '../contracts'
import type { HarnessResult, Requester } from './request'

/**
 * `/api/library`: the files the person keeps beyond one conversation. The
 * bytes travel as base64 in JSON, the same way a turn's images do, so what
 * the composer already holds can be kept without a second read.
 */

export const LIBRARY_PATH = '/api/library'

export interface LibraryQuery {
  readonly query?: string
  readonly kind?: LibraryKind
  readonly subject?: string
  readonly tag?: string
  readonly limit?: number
}

export interface LibraryAddition extends LibraryFacts {
  readonly fileName: string
  readonly mimeType: string
  /** The bytes, base64, with or without a `data:` prefix. */
  readonly data: string
  readonly sourceConversationId?: string | null
}

/** Describing a picture can take the model a while; the request waits for it. */
const DESCRIBE_BUDGET_MS = 50_000

export interface LibraryClient {
  listLibraryItems(query?: LibraryQuery): Promise<HarnessResult<LibraryListing>>
  addLibraryItem(addition: LibraryAddition): Promise<HarnessResult<LibraryItem>>
  updateLibraryItem(id: string, facts: LibraryFacts): Promise<HarnessResult<LibraryItem>>
  removeLibraryItem(id: string): Promise<HarnessResult<void>>
  /** The model's proposal for a picture's title, description and tags. */
  describeImage(image: {
    readonly data: string
    readonly mimeType: string
    readonly hint?: string
  }): Promise<HarnessResult<LibraryDescription>>
}

/** The harness path a thumbnail or preview is fetched from. */
export function libraryBytesPath(id: string): string {
  return `${LIBRARY_PATH}/${encodeURIComponent(id)}/bytes`
}

function listingPath(query: LibraryQuery): string {
  const parameters = new URLSearchParams()
  if (query.query !== undefined && query.query !== '') parameters.set('query', query.query)
  if (query.kind !== undefined) parameters.set('kind', query.kind)
  if (query.subject !== undefined && query.subject !== '') parameters.set('subject', query.subject)
  if (query.tag !== undefined && query.tag !== '') parameters.set('tag', query.tag)
  if (query.limit !== undefined) parameters.set('limit', String(query.limit))
  const search = parameters.toString()
  return search === '' ? LIBRARY_PATH : `${LIBRARY_PATH}?${search}`
}

export function libraryClient({ json, empty }: Requester): LibraryClient {
  return {
    listLibraryItems(query = {}) {
      return json('GET', listingPath(query), undefined, parseLibraryListing)
    },
    addLibraryItem(addition) {
      return json('POST', LIBRARY_PATH, addition, parseLibraryItemEnvelope)
    },
    updateLibraryItem(id, facts) {
      return json('PUT', `${LIBRARY_PATH}/${encodeURIComponent(id)}`, facts, parseLibraryItemEnvelope)
    },
    removeLibraryItem(id) {
      return empty('DELETE', `${LIBRARY_PATH}/${encodeURIComponent(id)}`)
    },
    describeImage(image) {
      return json('POST', `${LIBRARY_PATH}/describe`, image, parseLibraryDescription, DESCRIBE_BUDGET_MS)
    },
  }
}
