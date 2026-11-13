import { useEffect, useState } from 'react'
import { Icons } from '@/components/icons'
import { Tooltip } from '@/components/primitives'
import { Deferred, lazyNamed } from '@/components/state'
import { useMediaViewerHost } from '@/features/artifacts/media/edits'
import type { TranscriptItem } from '@/features/chat/transcript/projection'
import { attachmentDataUrl } from '@/platform/harness'

const MediaLightbox = lazyNamed(() => import('@/features/artifacts/media/MediaLightbox'), 'MediaLightbox')
type Attachment = Extract<TranscriptItem, { kind: 'user' }>['attachments'][number]

/** Only local image pixels may bypass the authenticated attachment resolver. */
function inlinePicture(url: string | null | undefined): string | null {
  return url !== undefined && url !== null && /^data:image\/(?:png|jpeg|webp|gif|avif);base64,[a-z0-9+/=\s]+$/i.test(url) ? url : null
}

/** Sent images have no filename-based lookup: the conversation and canonical id own the bytes. */
export function UserImageAttachment({ attachment, conversationId, index }: {
  attachment: Attachment
  conversationId: string | null
  index: number
}) {
  const host = useMediaViewerHost()
  const [open, setOpen] = useState(false)
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState<{ conversationId: string; id: string; mediaType: string; url: string | null } | null>(null)
  const inline = inlinePicture(attachment.url)
  const id = attachment.id ?? null
  useEffect(() => {
    if (inline !== null || conversationId === null || id === null) return
    let live = true
    void attachmentDataUrl(conversationId, { id, mimeType: attachment.mediaType }).then(url => {
      if (live) setLoaded({ conversationId, id, mediaType: attachment.mediaType, url })
    })
    return () => { live = false }
  }, [conversationId, id, attachment.mediaType, inline])
  const current = loaded !== null && loaded.conversationId === conversationId && loaded.id === id && loaded.mediaType === attachment.mediaType
  const url = inline ?? (current ? loaded.url : null)
  const unavailable = failed || (current && loaded.url === null) || (inline === null && (id === null || conversationId === null))
  const title = attachment.filename?.trim() || `Image ${index + 1}`
  const output = url === null ? null : { url, mimeType: attachment.mediaType, ratio: null }
  return <>
    <Tooltip label={title}>
      <button type="button" aria-label={`Preview ${title}`} disabled={url === null || failed}
        className="relative flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-soft outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => {
          if (output === null) return
          if (host !== null) host.open({ output, title, video: false })
          else setOpen(true)
        }}>
        {url !== null && !failed ? <img src={url} alt={title} onError={() => setFailed(true)} className="size-full object-cover" />
          : <span className="flex max-w-full flex-col items-center gap-1 px-2 text-caption text-muted-foreground"
              aria-label={unavailable ? `Image preview unavailable: ${title}` : `Loading image: ${title}`}>
              <Icons.image size="sm" /><span className="w-full truncate">{attachment.filename ?? attachment.mediaType}</span>
            </span>}
      </button>
    </Tooltip>
    {open && output !== null ? <Deferred label="Image preview" fallback={null}>
      <MediaLightbox open onClose={() => setOpen(false)} title={title} video={false} output={output} />
    </Deferred> : null}
  </>
}
