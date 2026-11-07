import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { paintStrokes, type MaskStroke } from '@/features/artifacts/media/edits'

/**
 * The brush over a picture in the viewer: what Erase and Edit area mark.
 *
 * Laid exactly over the `<img>` it is handed, measured from the element
 * rather than computed, so it stays on the picture through a resize. Strokes
 * are kept in the picture's own pixels - the mask is exported at the natural
 * size (`maskDataUrl`) - and drawn here scaled to the screen, in the accent,
 * on a translucent layer, so the picture shows through what is marked.
 *
 * The brush is a width on screen, converted to the picture's pixels as each
 * stroke begins: a brush that looks the same size on a small and a large
 * picture is the one a person can aim.
 */
export function MaskCanvas({
  image,
  strokes,
  onStrokes,
  brush,
  pin = false,
}: {
  image: HTMLImageElement | null
  strokes: readonly MaskStroke[]
  onStrokes: (next: readonly MaskStroke[]) => void
  /** Brush diameter in screen pixels. */
  brush: number
  /** One spot instead of strokes: a click places it, a second click moves it (Comment). */
  pin?: boolean
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  const drawing = useRef<MaskStroke | null>(null)
  const [, redraw] = useState(0)

  useLayoutEffect(() => {
    if (image === null) return
    const measure = () => {
      if (image.offsetWidth === 0) return
      setBox({ left: image.offsetLeft, top: image.offsetTop, width: image.offsetWidth, height: image.offsetHeight })
    }
    measure()
    image.addEventListener('load', measure)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(image)
    return () => {
      image.removeEventListener('load', measure)
      observer?.disconnect()
    }
  }, [image])

  const scale = image !== null && box !== null && image.naturalWidth > 0 ? box.width / image.naturalWidth : 1

  useEffect(() => {
    const element = canvas.current
    if (element === null || box === null) return
    const ratio = window.devicePixelRatio || 1
    element.width = Math.round(box.width * ratio)
    element.height = Math.round(box.height * ratio)
    const context = element.getContext('2d')
    if (context === null) return
    context.setTransform(ratio * scale, 0, 0, ratio * scale, 0, 0)
    context.clearRect(0, 0, element.width, element.height)
    const all = drawing.current === null ? strokes : [...strokes, drawing.current]
    // Solid here and translucent as a layer, so crossing strokes read as one
    // marked area rather than darkening where they overlap.
    paintStrokes(context, all, '#3aa8fe')
  })

  if (image === null || box === null) return null

  const at = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: (event.clientX - rect.left) / scale, y: (event.clientY - rect.top) / scale }
  }

  return (
    <canvas
      ref={canvas}
      aria-label={pin ? 'Click the spot to comment on' : 'Paint the area to change'}
      data-mask-canvas
      className="absolute cursor-crosshair touch-none rounded-[18px] opacity-55"
      style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
      onPointerDown={(event) => {
        event.stopPropagation()
        if (pin) {
          onStrokes([{ width: brush / scale, points: [at(event)] }])
          return
        }
        event.currentTarget.setPointerCapture?.(event.pointerId)
        drawing.current = { width: brush / scale, points: [at(event)] }
        redraw((n) => n + 1)
      }}
      onPointerMove={(event) => {
        const stroke = drawing.current
        if (stroke === null) return
        drawing.current = { ...stroke, points: [...stroke.points, at(event)] }
        redraw((n) => n + 1)
      }}
      onPointerUp={() => {
        const stroke = drawing.current
        drawing.current = null
        if (stroke !== null) onStrokes([...strokes, stroke])
      }}
      onPointerCancel={() => {
        drawing.current = null
        redraw((n) => n + 1)
      }}
    />
  )
}
