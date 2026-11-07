import { createContext, useContext } from 'react'
import type { MediaOutput } from '@/domain/artifacts/media'
import type { TurnImageWire } from '@/platform/harness'

/**
 * Editing a generated picture, as a message.
 *
 * ---- Why a message and not a feature -------------------------------------
 *
 * Every image vendor Studio speaks to edits from input images and a prompt
 * (`ImageGenerationInput.inputImages`); none takes a mask as a mask. So an
 * edit is nothing the harness needs to learn: the viewer sends an ordinary
 * message - the picture attached, a fixed sentence beside it - and the model
 * hands the attachment to its image tool the way it would for a picture the
 * person dropped in. The message shows in the transcript as theirs, with the
 * thumbnails, and goes through the one submission path every turn takes, so
 * there is no new boundary to instrument and nothing an edit can do that a
 * typed message could not.
 *
 * ---- Where an edit is marked ----------------------------------------------
 *
 * Erase and Edit area need a "where". The strokes are not drawn onto the
 * picture: they go as a second image, white where the person painted and
 * black elsewhere, the size of the first. The original stays clean, the
 * marked area is unambiguous, and a model that has never heard of masks
 * still reads "the area marked in the second image" correctly.
 */

/** Sends one edit as a message. Absent where nothing can be sent from (a gallery, the showcase). */
export interface MediaEditing {
  readonly send: (text: string, images: readonly TurnImageWire[]) => Promise<{ readonly ok: boolean }>
}

export const MediaEditContext = createContext<MediaEditing | null>(null)

export function useMediaEditing(): MediaEditing | null {
  return useContext(MediaEditContext)
}

/** The ratios Change ratio offers, as the image tool names them. */
export const EDIT_RATIOS = ['1:1', '4:3', '3:4', '16:9', '9:16'] as const
export type EditRatio = (typeof EDIT_RATIOS)[number]

/** The fixed sentences. Kept here, one place, so a test can hold them still. */
export const EDIT_PROMPTS = {
  removeBackground:
    'Remove the background from this image. Keep every foreground subject unchanged and fully intact, ' +
    'with clean, smooth edges. Make the background transparent.',
  ratio: (ratio: EditRatio) =>
    `Change this image to a ${ratio} aspect ratio. Keep the subject and style unchanged; ` +
    'extend the scene naturally where new space is needed rather than stretching or cropping the subject.',
  erase: 'Remove the area marked in the second image from the first image, and fill it so it matches its surroundings.',
  area: (instruction: string) =>
    `In the first image, change only the area marked in the second image: ${instruction.trim()} ` +
    'Leave everything outside the marked area unchanged.',
  point: (instruction: string) =>
    `In the first image, at the spot marked in the second image: ${instruction.trim()} ` +
    'Leave the rest of the image unchanged.',
} as const

/**
 * The picture open in the viewer, as the page that shows it is told.
 *
 * Where a page hosts the viewer (`MediaViewerHostContext`), a frame asks it
 * to open rather than opening its own overlay: the chat page lays the viewer
 * over the transcript and keeps the composer under it, so what is typed while
 * the picture is open goes with the picture. Without a host - the showcase -
 * the frame opens the overlay (`MediaLightbox`).
 */
export interface ViewerSpec {
  readonly output: MediaOutput
  readonly title: string
  readonly model?: string | null
  readonly video: boolean
  readonly onKeep?: () => void
}

export interface MediaViewerHost {
  readonly open: (spec: ViewerSpec) => void
}

export const MediaViewerHostContext = createContext<MediaViewerHost | null>(null)

export function useMediaViewerHost(): MediaViewerHost | null {
  return useContext(MediaViewerHostContext)
}

/** What the viewer hands the composer's send: the words as sent, and the pictures before the composer's own. */
export type PreparedEdit =
  | { readonly text: string; readonly images: readonly TurnImageWire[] }
  | { readonly refusal: string }

export interface MediaViewerHandle {
  /** The composer's words, turned into the edit the viewer's state describes. */
  readonly prepare: (text: string) => PreparedEdit
}

/**
 * A `data:` URL as the wire's image: its base64 and its type. Null for
 * anything the submission would refuse - not base64, or not one of the four
 * picture formats every provider takes.
 */
export function wireOfDataUrl(url: string, filename: string): TurnImageWire | null {
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/s.exec(url)
  if (match === null) return null
  const [, mimeType, data] = match
  if (mimeType === undefined || data === undefined) return null
  return { type: 'image', data, mimeType, filename }
}

/** A stroke, in the picture's own pixels. */
export interface MaskStroke {
  readonly width: number
  readonly points: readonly { readonly x: number; readonly y: number }[]
}

/**
 * The strokes as a mask: white where painted, black everywhere else, at the
 * picture's natural size. A PNG data URL, or null when there is nothing
 * painted or no canvas to paint it on.
 */
export function maskDataUrl(strokes: readonly MaskStroke[], width: number, height: number): string | null {
  if (strokes.every((stroke) => stroke.points.length === 0) || width < 1 || height < 1) return null
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width)
  canvas.height = Math.round(height)
  const context = canvas.getContext('2d')
  if (context === null) return null
  context.fillStyle = '#000'
  context.fillRect(0, 0, canvas.width, canvas.height)
  paintStrokes(context, strokes, '#fff')
  return canvas.toDataURL('image/png')
}

/** Draws strokes as round-capped lines; one point is a dot. */
export function paintStrokes(context: CanvasRenderingContext2D, strokes: readonly MaskStroke[], colour: string): void {
  context.strokeStyle = colour
  context.fillStyle = colour
  context.lineCap = 'round'
  context.lineJoin = 'round'
  for (const stroke of strokes) {
    const [first, ...rest] = stroke.points
    if (first === undefined) continue
    if (rest.length === 0) {
      context.beginPath()
      context.arc(first.x, first.y, stroke.width / 2, 0, Math.PI * 2)
      context.fill()
      continue
    }
    context.lineWidth = stroke.width
    context.beginPath()
    context.moveTo(first.x, first.y)
    for (const point of rest) context.lineTo(point.x, point.y)
    context.stroke()
  }
}
