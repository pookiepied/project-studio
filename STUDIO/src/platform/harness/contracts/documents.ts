/**
 * A document a conversation carries, as the upload route answers: what the
 * composer's chip shows and what taking it back needs. The engine carries
 * pictures on the message and nothing else, so a document is uploaded
 * ahead of the words and announced to the model by the harness; this is the
 * upload's receipt.
 */
import { isRecord } from '@/lib/guards'
import { finiteNumber, flag, listOf, oneOf, text } from './guards'

export const PAGE_UNITS = ['page', 'slide', 'sheet'] as const
export type PageUnit = (typeof PAGE_UNITS)[number]

export interface ConversationDocument {
  readonly id: string
  readonly fileName: string
  readonly mimeType: string
  readonly byteLength: number
  /** How many pages, slides or sheets the harness read; 1 for plain text. */
  readonly pageCount: number
  readonly unit: PageUnit
  /** One-based numbers of the pages with no text layer. */
  readonly emptyPages: readonly number[]
  /** Whether the model has already been told of it. */
  readonly announced: boolean
}

export function parseConversationDocument(value: unknown): ConversationDocument | null {
  if (!isRecord(value)) return null
  const id = text(value['id'])
  const fileName = text(value['fileName'])
  const mimeType = text(value['mimeType'])
  const byteLength = finiteNumber(value['byteLength'])
  const pageCount = finiteNumber(value['pageCount'])
  const unit = oneOf(PAGE_UNITS, value['unit'])
  const emptyPages = listOf(finiteNumber, value['emptyPages'])
  const announced = flag(value['announced'])
  if (
    id === null ||
    fileName === null ||
    mimeType === null ||
    byteLength === null ||
    pageCount === null ||
    unit === null ||
    emptyPages === null ||
    announced === null
  ) {
    return null
  }
  return { id, fileName, mimeType, byteLength, pageCount, unit, emptyPages, announced }
}

/** The `{ document }` envelope the upload route answers with. */
export function parseConversationDocumentEnvelope(value: unknown): ConversationDocument | null {
  if (!isRecord(value)) return null
  return parseConversationDocument(value['document'])
}
