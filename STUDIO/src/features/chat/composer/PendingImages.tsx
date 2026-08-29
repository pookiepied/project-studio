import { Icons } from '@/components/icons'
import type { TurnImageWire } from '@/platform/harness'

/**
 * The images this turn will carry, resting above the field.
 *
 * A thumbnail rather than a chip on purpose: the attachment is the message's
 * content, not metadata about it, and the person composing is the only one
 * who can see what the model will see — so the strip shows exactly what will
 * travel, at a size where a wrong pick is noticeable. The bytes are already
 * base64 in memory, so the preview is the same string the submission will
 * carry, under a data URL — no second copy of the pixels exists.
 *
 * The strip lives inside the frame, above the field, because the images are
 * part of THIS message the way the words are; the top strip carries session
 * facts and has no place for per-message content.
 */
export function PendingImages({
  images,
  onRemove,
}: {
  images: readonly TurnImageWire[]
  onRemove: (index: number) => void
}) {
  if (images.length === 0) return null
  return (
    <div className="mb-2 flex flex-wrap gap-2">
      {images.map((image, index) => (
        <figure
          key={`${image.filename ?? ''}-${index}`}
          className="group relative size-16 shrink-0"
        >
          {/* eslint-disable-next-line @typescript-eslint/no-unnecessary-condition */}
          <img
            src={`data:${image.mimeType};base64,${image.data}`}
            alt={image.filename ?? 'Attached image'}
            className="size-16 rounded-md object-cover ring-1 ring-border"
            draggable={false}
          />
          <button
            type="button"
            aria-label={`Remove ${image.filename ?? 'image'}`}
            onClick={() => onRemove(index)}
            className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full border bg-surface-raised text-muted-foreground shadow-raised transition-colors duration-fast hover:bg-tint hover:text-foreground"
          >
            <Icons.close size="sm" />
          </button>
        </figure>
      ))}
    </div>
  )
}
