import { base64OfBytes } from '@/lib/base64'
import type { HarnessFailure } from '@/platform/harness'

/**
 * The library's shared pieces: the failure it answers with when the harness
 * is not running, the base64 helpers for the bytes that cross the dialog,
 * and the shape of what the composer hands it. The harness connection is
 * `useHarnessClient` from the platform — the same one the Settings panes
 * use, since none of these callers should have to thread a store through
 * for one request.
 */

export const NO_HARNESS: HarnessFailure = {
  kind: 'not-reachable',
  message: 'The harness is not running.',
  timedOut: false,
}

/** A file's bytes as the base64 the harness takes. */
export async function base64OfFile(file: File): Promise<string> {
  return base64OfBytes(new Uint8Array(await file.arrayBuffer()))
}

/** The base64 half of a `data:` URL, or the string itself when it is bare. */
export function base64OfDataUrl(url: string): string {
  const comma = url.startsWith('data:') ? url.indexOf(',') : -1
  return comma === -1 ? url : url.slice(comma + 1)
}

/** What a picture the composer holds, or a generated one, hands the dialog. */
export interface KeepCandidate {
  readonly fileName: string
  readonly mimeType: string
  /** Base64, bare. */
  readonly data: string
  readonly sourceConversationId: string | null
}
