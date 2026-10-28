import { createContext, useContext, useEffect, useState } from 'react'
import { Icons } from '@/components/icons'
import { harnessBytesDataUrl } from '@/platform/harness'

/**
 * A picture a reply embeds: `![alt](address)`.
 *
 * Two kinds of address, and neither is loaded by the window itself. The
 * webview's policy allows `data:` pictures only, and a harness request carries
 * its credential as a header an `<img>` cannot send, so every picture arrives
 * as bytes through the harness and is shown as a `data:` URL -- the same road
 * a generated image already takes.
 *
 * - A web address is fetched by the harness (`/api/web/image`), so the host
 *   never learns from the window what a person is reading.
 * - A path -- `workspace/chart.png`, `C:\...\plot.png`, `file:///...` -- is a file
 *   the conversation saved, and the harness serves it only from the places
 *   that conversation works in (`/api/media/workspace`).
 *
 * Nothing here asks the model to embed anything. Whether a reply carries a
 * picture is the model's call; this only makes the ones it does carry show.
 */

/** The conversation a reply belongs to; a path means nothing without it. */
export const ReplyConversation = createContext<string | null>(null)

/** The scheme a local path is carried under, past the URL filters, to here. */
export const LOCAL_IMAGE = 'studio-file:'

const WEB = /^https?:\/\//i
const SCHEME = /^[a-z][a-z0-9+.-]*:/i
const DRIVE = /^[a-z]:[\\/]/i

/** Whether an image address in Markdown names a file rather than a resource. */
export function isLocalImage(url: string): boolean {
  if (DRIVE.test(url) || /^file:/i.test(url)) return true
  return url !== '' && !url.startsWith('#') && !url.startsWith('//') && !SCHEME.test(url)
}

interface MdastNode { type: string; url?: string; children?: MdastNode[] }

/**
 * Carries local image paths through as `studio-file:` addresses.
 *
 * Both URL filters downstream -- the sanitiser's protocol list and
 * react-markdown's own transform -- drop a Windows path (`C:` reads as a
 * scheme) or keep a relative one only to have the webview resolve it against
 * its own origin. Marked here, before either runs, the path reaches the
 * image component intact and the component decides what it may load.
 */
export function remarkReplyImages() {
  const walk = (node: MdastNode) => {
    if (node.type === 'image' && typeof node.url === 'string' && isLocalImage(node.url)) {
      node.url = LOCAL_IMAGE + encodeURIComponent(node.url)
    }
    node.children?.forEach(walk)
  }
  return walk
}

/** An address written outside Markdown (a card's `image`), marked as a Markdown one would be. */
export function replyImageSource(url: string): string {
  return isLocalImage(url) ? LOCAL_IMAGE + encodeURIComponent(url) : url
}

/** The harness path an image's bytes are read from, or null for none. */
function harnessPath(src: string, conversationId: string | null): string | null {
  if (src.startsWith(LOCAL_IMAGE)) {
    if (conversationId === null) return null
    try {
      const path = decodeURIComponent(src.slice(LOCAL_IMAGE.length))
      return `/api/media/workspace/${encodeURIComponent(conversationId)}?path=${encodeURIComponent(path)}`
    } catch {
      // An unreadable model address costs its picture, not the conversation.
      return null
    }
  }
  if (WEB.test(src)) return `/api/web/image?url=${encodeURIComponent(src)}`
  return null
}

/**
 * `fill` sets the picture into a box its parent sized -- a card's image well
 * -- covering it, instead of on its own line at its own size.
 */
export function ReplyImage({ src, alt, fill = false }: { src?: string; alt?: string; fill?: boolean }) {
  const conversationId = useContext(ReplyConversation)
  const path = src === undefined ? null : harnessPath(src, conversationId)
  const [state, setState] = useState<{ path: string | null; url: string | null }>({ path: null, url: null })

  useEffect(() => {
    if (path === null) return
    let cancelled = false
    // The kind is read off the bytes: neither an address nor a filename is
    // a reliable witness, and the URL this builds must say the truth.
    void harnessBytesDataUrl(path, 'image/png', { sniff: true }).then((url) => {
      if (!cancelled) setState({ path, url })
    })
    return () => { cancelled = true }
  }, [path])

  const label = alt?.trim() ?? ''
  if (path !== null && state.path === path && state.url !== null) {
    return <img src={state.url} alt={label} loading="lazy" className={fill ? 'size-full object-cover' : 'studio-reply-image'} style={fill ? { borderRadius: 0 } : undefined} />
  }
  if (path !== null && state.path !== path) {
    return (
      <span role="img" aria-label={label === '' ? 'Loading image' : `Loading image: ${label}`} className={fill ? 'block size-full' : 'studio-reply-image-pending'}>
        {fill ? null : <span className="studio-shimmer">{label === '' ? 'Loading image' : label}</span>}
      </span>
    )
  }
  return (
    <span role="img" aria-label={label === '' ? 'Image unavailable' : `Image unavailable: ${label}`} className={fill ? 'flex size-full items-center justify-center text-muted-foreground' : 'studio-reply-image-missing'}>
      <Icons.image size="xs" />
      {fill ? null : <span>{label === '' ? 'Image unavailable' : label}</span>}
    </span>
  )
}
