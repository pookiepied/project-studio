import { useCallback, useRef } from 'react'
import { base64OfBytes } from '@/lib/base64'
import {
  createHarnessClient,
  resolveHarnessAddress,
  type HarnessClient,
  type HarnessFailure,
} from '@/platform/harness'

/**
 * The library's own connection to the harness.
 *
 * Its own rather than the workspace's bound client, the way the Settings
 * panes connect: the library is reached from the composer, from an
 * artifact card and from Settings, none of which should have to thread a
 * store through for one request. The address is resolved once per mount.
 */

export const NO_HARNESS: HarnessFailure = {
  kind: 'not-reachable',
  message: 'The harness is not running.',
  timedOut: false,
}

export function useLibraryClient(): () => Promise<HarnessClient | null> {
  const client = useRef<HarnessClient | null>(null)
  return useCallback(async () => {
    if (client.current) return client.current
    const address = await resolveHarnessAddress()
    if (address === null) return null
    client.current = createHarnessClient(address)
    return client.current
  }, [])
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
