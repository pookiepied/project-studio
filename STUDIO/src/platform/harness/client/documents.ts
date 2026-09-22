import {
  parseConversationDocumentEnvelope,
  type ConversationDocument,
} from '../contracts'
import type { HarnessResult, Requester } from './request'

/**
 * `/api/conversations/:id/documents`: the files a message brings that are
 * not pictures. Uploaded ahead of the words, one request per file, as
 * base64 in JSON - the one body the transport carries - and taken back by
 * id when the message they were for never went.
 */

/** A fifty-megabyte file as base64 takes a while to travel; the request waits for it. */
const UPLOAD_BUDGET_MS = 120_000

export interface DocumentUpload {
  readonly fileName: string
  readonly mimeType: string
  /** The bytes, base64, with or without a `data:` prefix. */
  readonly data: string
}

export interface DocumentClient {
  uploadDocument(conversationId: string, upload: DocumentUpload): Promise<HarnessResult<ConversationDocument>>
  removeDocument(conversationId: string, documentId: string): Promise<HarnessResult<void>>
}

function documentsPath(conversationId: string): string {
  return `/api/conversations/${encodeURIComponent(conversationId)}/documents`
}

export function documentClient({ json, empty }: Requester): DocumentClient {
  return {
    uploadDocument(conversationId, upload) {
      return json('POST', documentsPath(conversationId), upload, parseConversationDocumentEnvelope, UPLOAD_BUDGET_MS)
    },
    removeDocument(conversationId, documentId) {
      return empty('DELETE', `${documentsPath(conversationId)}/${encodeURIComponent(documentId)}`)
    },
  }
}
