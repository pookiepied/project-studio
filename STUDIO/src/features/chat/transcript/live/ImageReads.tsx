import { useState } from 'react'
import { Icons } from '@/components/icons'
import { MediaLightbox } from '@/features/artifacts/media/MediaLightbox'
import { DisclosureRow } from '@/features/chat/transcript/DisclosureRow'
import type { ToolCallView } from '@/features/chat/transcript/projection'
import { useAttachmentFrame } from '@/features/chat/useAttachmentFrame'
import type { BrowserFrame } from '@/domain/browser/steps'
import { isAttachmentReference } from '@/platform/harness'
import { isRecord } from '@/lib/guards'

export interface ReadImage {
  readonly id: string
  readonly title: string
  readonly frame: BrowserFrame
}

/** Only returned pixels count as a viewed image, never the requested filename. */
export function readImages(call: ToolCallView): readonly ReadImage[] {
  if (call.toolName !== 'read' || call.errorText !== null || !call.output?.present) return []
  const value: unknown = call.output.value
  if (isRecord(value) && value['isError'] === true) return []
  const content: unknown = isRecord(value) ? value['content'] : value
  if (!Array.isArray(content)) return []
  const input: unknown = call.input?.present ? call.input.value : null
  const path = isRecord(input) ? input['path'] ?? input['file_path'] : null
  const images: ReadImage[] = []
  for (const [index, block] of content.entries()) {
    if (!isRecord(block) || block['type'] !== 'image' ||
      typeof block['data'] !== 'string' || block['data'].length === 0 ||
      typeof block['mimeType'] !== 'string' || !/^image\/(png|jpeg|gif|webp)$/.test(block['mimeType'])) continue
    const data = block['data']
    const mimeType = block['mimeType']
    images.push({
      id: `${call.toolCallId}-${index}`,
      title: typeof path === 'string' ? path : `Image ${images.length + 1}`,
      frame: isAttachmentReference(data)
        ? { kind: 'attachment', id: data, mimeType }
        : { kind: 'inline', data, mimeType },
    })
  }
  return images
}

export function ImageReads({ images, conversationId, live }: {
  images: readonly ReadImage[]; conversationId: string; live: boolean
}) {
  const [open, setOpen] = useState(false)
  return <DisclosureRow leading={<Icons.image />} entering={live}
    label={images.length === 1 ? 'Viewed an image' : `Viewed ${images.length} images`}
    open={open} onToggle={() => setOpen((value) => !value)} flush>
    <div className="flex flex-wrap gap-2 py-1">
      {images.map((image) => <ReadThumbnail key={`${conversationId}:${image.id}`} image={image} conversationId={conversationId} />)}
    </div>
  </DisclosureRow>
}

function ReadThumbnail({ image, conversationId }: { image: ReadImage; conversationId: string }) {
  const src = useAttachmentFrame(conversationId, image.frame)
  const [open, setOpen] = useState(false)
  const [failed, setFailed] = useState(false)
  if (src === null || failed) return <span className="max-w-60 text-caption text-muted-foreground">
    Image preview unavailable: {image.title}
  </span>
  return <>
    <button type="button" aria-label={`Preview ${image.title}`} title={image.title}
      onClick={() => setOpen(true)}
      className="size-20 overflow-hidden rounded-lg border border-border bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <img src={src} alt={image.title} onError={() => setFailed(true)} className="size-full object-cover" />
    </button>
    <MediaLightbox open={open} onClose={() => setOpen(false)} title={image.title}
      video={false} output={{ url: src, ratio: null }} />
  </>
}
