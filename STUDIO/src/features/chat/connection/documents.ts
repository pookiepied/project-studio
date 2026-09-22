import { documentMimeOf } from '@/domain/attachments/documents'
import { base64OfBytes } from '@/lib/base64'
import {
  createHarnessClient,
  resolveHarnessAddress,
  type HarnessClient,
  type HarnessFailure,
  type SeamFailure,
} from '@/platform/harness'

/**
 * Uploading a message's documents ahead of its words.
 *
 * The engine carries pictures on the message and nothing else, so a
 * document goes to the harness first - one request per file, the file's
 * bytes as base64 - and the message follows; the harness announces the
 * uploads to the model when that message's response starts. This is the
 * one place that order is kept, for the first turn and every later one.
 *
 * ---- Taking them back ---------------------------------------------------
 *
 * A send is two steps, and the second can fail: the words refused, the
 * harness gone between the upload and the message. A document left
 * uploaded then would be announced with the NEXT message the person sends,
 * which may be about something else. So the outcome hands back a way to
 * remove what went up, and the callers use it whenever the message did not
 * go. A removal that itself fails is let go: the document sits in the
 * conversation's folder and is named on the next message, which is the
 * honest state and not a lie.
 */

export type UploadOutcome =
  | { readonly ok: true; readonly ids: readonly string[]; readonly takeBack: () => Promise<void> }
  | { readonly ok: false; readonly error: SeamFailure }

const NOT_RUNNING: SeamFailure = {
  kind: 'no-harness',
  message: 'The harness is not running, so the documents cannot be sent.',
}

export async function uploadDocuments(
  conversationId: string,
  documents: readonly File[],
  client?: HarnessClient,
): Promise<UploadOutcome> {
  const nothing: UploadOutcome = { ok: true, ids: [], takeBack: () => Promise.resolve() }
  if (documents.length === 0) return nothing
  const harness = client ?? (await connect())
  if (harness === null) return { ok: false, error: NOT_RUNNING }
  const ids: string[] = []
  const takeBack = async () => {
    await Promise.all(ids.map((id) => harness.removeDocument(conversationId, id)))
  }
  for (const document of documents) {
    let bytes: Uint8Array
    try {
      bytes = new Uint8Array(await document.arrayBuffer())
    } catch {
      await takeBack()
      return { ok: false, error: { kind: 'rejected', message: `${document.name} could not be read.` } }
    }
    const sent = await harness.uploadDocument(conversationId, {
      fileName: document.name,
      mimeType: documentMimeOf(document.name) ?? document.type ?? 'application/octet-stream',
      data: base64OfBytes(bytes),
    })
    if (!sent.ok) {
      await takeBack()
      return { ok: false, error: seamFailureOf(sent.error, document.name) }
    }
    ids.push(sent.value.id)
  }
  return { ok: true, ids, takeBack }
}

async function connect(): Promise<HarnessClient | null> {
  const address = await resolveHarnessAddress()
  return address === null ? null : createHarnessClient(address)
}

/** The client's failure in the composer's vocabulary, with the file named. */
function seamFailureOf(failure: HarnessFailure, fileName: string): SeamFailure {
  switch (failure.kind) {
    case 'not-reachable':
      return { kind: 'unreachable', message: failure.message }
    case 'unauthorized':
    case 'harness-error':
      return { kind: 'refused', status: failure.status, message: `${fileName}: ${failure.message}` }
    case 'malformed-response':
      return { kind: 'malformed', message: failure.message }
  }
}
