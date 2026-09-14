import { useEffect, useState } from 'react'
import { harnessBytesDataUrl, pictureMime } from '@/platform/harness'
import type { MediaOutput } from '@/domain/artifacts/media'

/**
 * What the element is handed: the URL as given, or the harness's bytes
 * resolved to a `data:` URL. Null until there is something.
 *
 * A generated output is a path the harness serves, fetched through the same
 * resolver the browser frames use, so a picture on another device arrives
 * through the paired listener like everything else. No file is written on
 * this side and no vendor URL is ever known to it. The resolver remembers
 * what it resolved, so the frame and the lightbox asking for the same path
 * cost one fetch between them.
 */
export function useMediaSource(output: MediaOutput | null, video: boolean): string | null {
  const path = output?.path ?? null
  const mimeType = output?.mimeType ?? null
  const [resolved, setResolved] = useState<string | null>(null)

  useEffect(() => {
    if (path === null) return
    let cancelled = false
    setResolved(null)
    const mime = video ? videoMime(mimeType) : pictureMime(mimeType ?? '')
    void harnessBytesDataUrl(path, mime).then((url) => {
      if (!cancelled) setResolved(url)
    })
    return () => {
      cancelled = true
    }
  }, [path, mimeType, video])

  if (output?.url !== undefined) return output.url
  return path === null ? null : resolved
}

/** The mime a `<video>` may be handed; anything else is shown as mp4. */
export function videoMime(mimeType: string | null): string {
  return mimeType !== null && /^video\/[a-z0-9.+-]+$/i.test(mimeType) ? mimeType : 'video/mp4'
}
