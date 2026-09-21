/**
 * The library as the harness records it: a file the person chose to keep
 * beyond one conversation, with what they said about it. The `subject` is
 * the person's own answer to "who or what is this" and is never a model's
 * guess; the tags and description may be either.
 */

import { isRecord } from '@/lib/guards'
import { finiteNumber, listOf, oneOf, text } from './guards'

export const LIBRARY_KINDS = ['image', 'document', 'audio', 'video', 'other'] as const
export type LibraryKind = (typeof LIBRARY_KINDS)[number]

export interface LibraryItem {
  readonly id: string
  readonly kind: LibraryKind
  readonly fileName: string
  readonly mimeType: string
  readonly byteLength: number
  readonly title: string
  readonly description: string
  readonly subject: string
  readonly tags: readonly string[]
  readonly sourceConversationId: string | null
  readonly createdAt: number
  readonly updatedAt: number
  /** Where the file lives on disk - shown, never read through. */
  readonly path: string
}

export interface LibraryListing {
  readonly items: readonly LibraryItem[]
  /** Every distinct subject in the library, for the filter. */
  readonly subjects: readonly string[]
  readonly directory: string
  readonly maxFileBytes: number
}

/** What the person or the model says about a file. */
export interface LibraryFacts {
  readonly title?: string
  readonly description?: string
  readonly subject?: string
  readonly tags?: readonly string[]
}

/** The model's proposal for a picture: never a subject. */
export interface LibraryDescription {
  readonly title: string
  readonly description: string
  readonly tags: readonly string[]
}

/** A string that may be empty: a description or subject nobody wrote yet. */
function words(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function tagList(value: unknown): readonly string[] | null {
  return listOf((tag) => (typeof tag === 'string' ? tag : null), value)
}

export function parseLibraryItem(value: unknown): LibraryItem | null {
  if (!isRecord(value)) return null
  const id = text(value['id'])
  const kind = oneOf(LIBRARY_KINDS, value['kind'])
  const fileName = text(value['fileName'])
  const mimeType = text(value['mimeType'])
  const byteLength = finiteNumber(value['byteLength'])
  const title = text(value['title'])
  const description = words(value['description'])
  const subject = words(value['subject'])
  const tags = tagList(value['tags'])
  const createdAt = finiteNumber(value['createdAt'])
  const updatedAt = finiteNumber(value['updatedAt'])
  const path = text(value['path'])
  const source = value['sourceConversationId']
  const sourceConversationId = source === null || source === undefined ? null : text(source)
  if (
    id === null ||
    kind === null ||
    fileName === null ||
    mimeType === null ||
    byteLength === null ||
    title === null ||
    description === null ||
    subject === null ||
    tags === null ||
    createdAt === null ||
    updatedAt === null ||
    path === null ||
    (sourceConversationId === null && source !== null && source !== undefined)
  ) {
    return null
  }
  return {
    id,
    kind,
    fileName,
    mimeType,
    byteLength,
    title,
    description,
    subject,
    tags,
    sourceConversationId,
    createdAt,
    updatedAt,
    path,
  }
}

export function parseLibraryListing(value: unknown): LibraryListing | null {
  if (!isRecord(value)) return null
  const items = listOf(parseLibraryItem, value['items'])
  const subjects = tagList(value['subjects'])
  const directory = text(value['directory'])
  const maxFileBytes = finiteNumber(value['maxFileBytes'])
  if (items === null || subjects === null || directory === null || maxFileBytes === null) return null
  return { items, subjects, directory, maxFileBytes }
}

/** The `{ item }` envelope the add, read and edit routes answer with. */
export function parseLibraryItemEnvelope(value: unknown): LibraryItem | null {
  if (!isRecord(value)) return null
  return parseLibraryItem(value['item'])
}

export function parseLibraryDescription(value: unknown): LibraryDescription | null {
  if (!isRecord(value)) return null
  const inner = value['description']
  if (!isRecord(inner)) return null
  const title = words(inner['title'])
  const description = words(inner['description'])
  const tags = tagList(inner['tags'])
  if (title === null || description === null || tags === null) return null
  return { title, description, tags }
}
