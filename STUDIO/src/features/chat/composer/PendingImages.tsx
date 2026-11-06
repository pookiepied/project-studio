import { Icons } from '@/components/icons'
import { IconButton } from '@/components/primitives'
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
  onKeep,
}: {
  images: readonly TurnImageWire[]
  onRemove: (index: number) => void
  /**
   * "Keep in the library": the offer the brief asks for on every upload -
   * a control beside the thumbnail, not a question in the way of sending. The
   * picture rides on the message whether or not it is kept.
   */
  onKeep?: (index: number) => void
}) {
  if (images.length === 0) return null
  return (
    <div className="mb-2 flex flex-wrap gap-2">
      {images.map((image, index) => (
        <figure
          key={`${image.filename ?? ''}-${index}`}
          className="flex shrink-0 flex-col items-center gap-0.5"
        >
          <img
            src={`data:${image.mimeType};base64,${image.data}`}
            alt={image.filename ?? 'Attached image'}
            className="size-16 rounded-md object-cover ring-1 ring-border"
            draggable={false}
          />
          <div className="flex gap-0.5">
            {onKeep !== undefined ? (
              <IconButton
                label={`Keep ${image.filename ?? 'image'} in the library`}
                size="xs"
                onClick={() => onKeep(index)}
              >
                <Icons.keep size="sm" />
              </IconButton>
            ) : null}
            <IconButton
              label={`Remove ${image.filename ?? 'image'}`}
              size="xs"
              onClick={() => onRemove(index)}
            >
              <Icons.close size="sm" />
            </IconButton>
          </div>
        </figure>
      ))}
    </div>
  )
}
