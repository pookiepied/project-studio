export type FloatingSide = 'top' | 'bottom' | 'right'
export type FloatingAlign = 'start' | 'center' | 'end'

interface Bounds {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

export interface FloatingViewport extends Bounds {
  readonly edge: number
}

/** Coordinates use the same viewport space as getBoundingClientRect. */
export function floatingViewport(): FloatingViewport {
  const visual = window.visualViewport
  return {
    left: visual?.offsetLeft ?? 0,
    top: visual?.offsetTop ?? 0,
    width: visual?.width ?? window.innerWidth,
    height: visual?.height ?? window.innerHeight,
    edge: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--floating-edge')) || 8,
  }
}

export function placeFloating({ anchor, panel, viewport, side, align = 'start', gap = 6 }: {
  anchor: Bounds
  panel: Pick<Bounds, 'width' | 'height'>
  viewport: FloatingViewport
  side: FloatingSide
  align?: FloatingAlign
  gap?: number
}) {
  const maxWidth = Math.max(0, viewport.width - viewport.edge * 2)
  const maxHeight = Math.max(0, viewport.height - viewport.edge * 2)
  const width = Math.min(panel.width, maxWidth)
  const height = Math.min(panel.height, maxHeight)
  const bottom = anchor.top + anchor.height
  const right = anchor.left + anchor.width
  const below = viewport.top + viewport.height - bottom - gap - viewport.edge
  const above = anchor.top - viewport.top - gap - viewport.edge
  let resolved = side
  if (side === 'bottom' && height > below && above > below) resolved = 'top'
  if (side === 'top' && height > above && below > above) resolved = 'bottom'

  const preferredLeft = resolved === 'right' ? right + gap
    : align === 'end' ? right - width
    : align === 'center' ? anchor.left + (anchor.width - width) / 2 : anchor.left
  const preferredTop = resolved === 'right' ? anchor.top + (anchor.height - height) / 2
    : resolved === 'bottom' ? bottom + gap : anchor.top - height - gap
  const minLeft = viewport.left + viewport.edge
  const minTop = viewport.top + viewport.edge
  return {
    left: Math.max(minLeft, Math.min(preferredLeft, viewport.left + viewport.width - width - viewport.edge)),
    top: Math.max(minTop, Math.min(preferredTop, viewport.top + viewport.height - height - viewport.edge)),
    side: resolved,
    maxWidth,
    maxHeight,
  }
}

/** Shared observation keeps an open surface attached during scroll and preference changes. */
export function observeFloating(anchor: Element | null, panel: Element | null, place: () => void): () => void {
  window.addEventListener('resize', place)
  window.addEventListener('scroll', place, true)
  const visual = window.visualViewport
  visual?.addEventListener('resize', place)
  visual?.addEventListener('scroll', place)
  const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(place)
  if (anchor) observer?.observe(anchor)
  if (panel) observer?.observe(panel)
  return () => {
    window.removeEventListener('resize', place)
    window.removeEventListener('scroll', place, true)
    visual?.removeEventListener('resize', place)
    visual?.removeEventListener('scroll', place)
    observer?.disconnect()
  }
}
