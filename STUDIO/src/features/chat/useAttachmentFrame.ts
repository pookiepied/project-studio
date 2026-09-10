import { useEffect, useMemo, useState } from 'react'

import { attachmentDataUrl, pictureMime } from '@/platform/harness'
import type { BrowserFrame } from '@/features/chat/transcript/live/browserCall'

/**
 * The `<img src>` for a frame, resolved.
 *
 * An inline frame is already base64 and needs no work; an attachment
 * reference names bytes the harness holds, and the fetch is async — so this
 * hook exists, because a renderer cannot await and a `data:` URL built from
 * an id is precisely the broken image this task is named for. `null` means
 * "no picture yet", which the renderers show as a card without its frame,
 * never as a broken one.
 *
 * Lives in chat because the frame vocabulary is the transcript's; the rail's
 * panel imports it for the same reason it imports nothing else from here —
 * the two surfaces render the same browser, and two resolution paths would
 * eventually disagree about when a picture is missing.
 */
export function useAttachmentFrame(
  conversationId: string,
  frame: BrowserFrame | null,
): string | null {
  const inlineUrl = useMemo(
    // Clamped for the same reason the fetched path is: the mime rides in from
    // a tool result, which an MCP server we did not write also produces.
    () =>
      frame?.kind === 'inline'
        ? `data:${pictureMime(frame.mimeType)};base64,${frame.data}`
        : null,
    [frame],
  )
  const [resolved, setResolved] = useState<string | null>(null)
  const referenceId = frame?.kind === 'attachment' ? frame.id : null
  const referenceMime = frame?.kind === 'attachment' ? frame.mimeType : null

  useEffect(() => {
    if (referenceId === null || referenceMime === null) return
    let cancelled = false
    setResolved(null)
    void attachmentDataUrl(conversationId, { id: referenceId, mimeType: referenceMime }).then(
      (url) => {
        if (!cancelled) setResolved(url)
      },
    )
    return () => {
      cancelled = true
    }
  }, [conversationId, referenceId, referenceMime])

  return referenceId === null ? inlineUrl : resolved
}
