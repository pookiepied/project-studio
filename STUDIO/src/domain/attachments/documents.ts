import type { ImageRejection } from '@/domain/attachments/images'

/**
 * The rules a document has to pass to ride on a turn.
 *
 * A document is not an image: the engine carries pictures on the message and
 * nothing else, so a document is uploaded to the harness ahead of the words
 * and announced to the model by a signal. What the composer decides at pick
 * time is the same as for a picture - what the harness will take, before a
 * byte is read - and the harness's own reader has the last word on whether
 * the bytes are the format the name claims.
 *
 * Which kinds: the four the harness reads page by page (PDF, Word,
 * PowerPoint, Excel) and plain text in its common spellings. Decided by the
 * name's extension rather than the picker's mime, because operating systems
 * disagree about a `.md` and agree about a `.pdf`, and the harness judges the
 * bytes anyway.
 */

/** How many documents one turn may carry. */
export const MAX_DOCUMENTS_PER_TURN = 5
/** The harness's own ceiling for one document. */
export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024

const DOCUMENT_EXTENSIONS: ReadonlyMap<string, string> = new Map([
  ['pdf', 'application/pdf'],
  ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['txt', 'text/plain'],
  ['md', 'text/markdown'],
  ['markdown', 'text/markdown'],
  ['csv', 'text/csv'],
  ['tsv', 'text/tab-separated-values'],
  ['json', 'application/json'],
  ['xml', 'application/xml'],
  ['yaml', 'application/x-yaml'],
  ['yml', 'application/x-yaml'],
  ['log', 'text/plain'],
])

/** The picker's `accept`, spelled from the same list so the two cannot drift. */
export const DOCUMENT_ACCEPT = [...DOCUMENT_EXTENSIONS.keys()].map((extension) => `.${extension}`).join(',')

/** The mime the harness is told, from the name; null for a name outside the list. */
export function documentMimeOf(fileName: string): string | null {
  const dot = fileName.lastIndexOf('.')
  if (dot <= 0) return null
  return DOCUMENT_EXTENSIONS.get(fileName.slice(dot + 1).toLowerCase()) ?? null
}

/**
 * Splits a haul into documents worth uploading and files to say no to,
 * with the same shape of refusal the picture rules give, so the composer's
 * one rejections line reads both. `alreadyHeld` is what the composer
 * carries, so the cap counts the turn, not the click.
 */
export function pickDocumentFiles(
  files: readonly File[],
  alreadyHeld = 0,
): { accepted: readonly File[]; rejections: readonly ImageRejection[] } {
  const accepted: File[] = []
  const rejections: ImageRejection[] = []
  const room = Math.max(0, MAX_DOCUMENTS_PER_TURN - alreadyHeld)
  for (const file of files) {
    if (documentMimeOf(file.name) === null) {
      rejections.push({
        filename: file.name,
        reason: 'Not a document that can be attached (PDF, Word, PowerPoint, Excel, or plain text).',
      })
      continue
    }
    if (file.size > MAX_DOCUMENT_BYTES) {
      rejections.push({ filename: file.name, reason: 'Over 50 MB - too large to send.' })
      continue
    }
    if (accepted.length >= room) {
      rejections.push({
        filename: file.name,
        reason: `A turn carries at most ${MAX_DOCUMENTS_PER_TURN} documents.`,
      })
      continue
    }
    accepted.push(file)
  }
  return { accepted, rejections }
}
