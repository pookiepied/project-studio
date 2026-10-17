import { findCatalogModel, type CatalogModel } from '@/domain/models/catalog'
import { base64OfBytes } from '@/lib/base64'
import type { SeamFailure, TurnImageWire } from '@/platform/harness'

/**
 * The rules an image has to pass to ride on a turn, and the two checks that
 * are ours to make: what the wire accepts, and what the model can see.
 *
 * ---- Why the rules live on the webview side ------------------------------
 *
 * The harness already refuses what it cannot carry (each image's base64 is
 * capped there), but a refusal after a 10MB upload has spent the trip is the
 * worst possible place to learn a file was too big. These rules run at pick
 * time, before a byte is encoded, so what is rejected is rejected with the
 * file still in hand.
 *
 * ---- Why bytes, never paths ----------------------------------------------
 *
 * An attachment is deliberately outside the conversation sandbox's read
 * roots, the file tools only read text, and every tool call is permissioned:
 * there is no path the model could follow to see the picture. So the picture
 * travels itself — read at pick time, base64 in the submission, persisted by
 * the harness, and re-sent to the provider on every later turn, because a
 * stateless API has no other way of seeing an image twice. The `<attachments>`
 * manifest the harness appends to the message gives the model stable image
 * ids to refer to, but the pixels arrive with the message.
 *
 * ---- Why one rule and not one per provider -------------------------------
 *
 * Every provider accepts at least these four formats, and no provider we
 * serve accepts fewer than five images per request. Per-provider headroom
 * (Anthropic takes a hundred, Google thousands) is a ceiling we do not need
 * to chase in the UI; the plan document carries the full matrix. The defaults
 * here are the honest intersection, tightened by our own transport: ten
 * megabytes of binary encodes just under Flue's fourteen-million-character
 * base64 ceiling with the JSON wrapper still to spend.
 */
const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const
export type ImageMimeType = (typeof IMAGE_MIME_TYPES)[number]

/** How many images one turn may carry. */
export const MAX_IMAGES_PER_TURN = 5

/** The largest single image, in bytes after decoding — not the base64 length. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024

/** Why a picked file did not become an attachment. */
export interface ImageRejection {
  readonly filename: string
  readonly reason: string
}

/** Some file managers omit MIME; the bytes are still verified before sending. */
export function imageMimeOf(file: Pick<File, 'name' | 'type'>): ImageMimeType | null {
  if (sniffable(file.type)) return file.type as ImageMimeType
  if (file.type !== '') return null
  const extension = file.name.split('.').pop()?.toLowerCase()
  return extension === 'png' ? 'image/png' : extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg'
    : extension === 'webp' ? 'image/webp' : extension === 'gif' ? 'image/gif' : null
}

/**
 * Reads the file's own header, not the name it arrived with: an operating
 * system labels a file by extension, and the submission must be true to the
 * bytes. Anything that is not one of the four formats reads as null.
 */
export function sniffImageMime(bytes: Uint8Array): ImageMimeType | null {
  if (bytes.length < 12) return null
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png'
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return 'image/gif'
  }
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp'
  }
  return null
}

/**
 * Splits the picker's haul into files worth reading and files to say no to.
 * `alreadyHeld` is what the composer carries, so the cap counts the turn,
 * not the click. Type and size are judged before anything is read; the room
 * runs out silently in the rejections list, which the composer shows.
 */
export function pickImageFiles(
  files: readonly File[],
  alreadyHeld = 0,
): { accepted: readonly File[]; rejections: readonly ImageRejection[] } {
  const accepted: File[] = []
  const rejections: ImageRejection[] = []
  const room = Math.max(0, MAX_IMAGES_PER_TURN - alreadyHeld)
  for (const file of files) {
    const mime = imageMimeOf(file)
    if (mime === null) {
      rejections.push({ filename: file.name, reason: 'Images only (PNG, JPEG, WebP, or GIF).' })
      continue
    }
    if (file.size > MAX_IMAGE_BYTES) {
      rejections.push({ filename: file.name, reason: 'Over 10 MB — too large to send.' })
      continue
    }
    if (accepted.length >= room) {
      rejections.push({
        filename: file.name,
        reason: `A turn carries at most ${MAX_IMAGES_PER_TURN} images.`,
      })
      continue
    }
    accepted.push(file)
  }
  return { accepted, rejections }
}

function sniffable(type: string): boolean {
  return (IMAGE_MIME_TYPES as readonly string[]).includes(type)
}

/**
 * Reads one accepted file into the submission shape, trusting nothing the
 * name implied: the header decides the mime type, so a text file renamed
 * `.png` is refused here rather than refused again by the provider.
 */
export async function readImageFile(file: File): Promise<TurnImageWire | ImageRejection> {
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await file.arrayBuffer())
  } catch {
    return { filename: file.name, reason: 'Could not be read.' }
  }
  const mime = sniffImageMime(bytes)
  if (mime === null) {
    return { filename: file.name, reason: 'Not a readable image (PNG, JPEG, WebP, or GIF).' }
  }
  return {
    type: 'image',
    data: base64OfBytes(bytes),
    mimeType: mime,
    filename: file.name,
  }
}

/**
 * The one send-time rule the composer cannot check alone: whether the model
 * this turn is addressed to can see at all.
 *
 * Known-unsupported refuses before the POST, with the model's own name —
 * a text-only model would otherwise take the whole turn and fail on the
 * provider's doorstep, with the message and its images trapped in a refusal
 * the composer cannot tell from a network fault. Null model (the settled
 * default) and unknown models pass: the provider's own answer is the truth
 * there, and it arrives as a turn failure either way.
 */
export function visionRefusal(
  modelId: string | null,
  imageCount: number,
  models: readonly CatalogModel[],
): SeamFailure | null {
  if (imageCount === 0) return null
  const model = findCatalogModel(models, modelId)
  if (model === undefined || model.capability.vision !== 'unsupported') return null
  return {
    kind: 'rejected',
    message:
      imageCount === 1
        ? `${model.name} cannot see images. Send this turn without it, or pick a model with vision in the model library.`
        : `${model.name} cannot see images. Send this turn without them, or pick a model with vision in the model library.`,
  }
}
