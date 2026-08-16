import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Icons } from '@/components/icons'
import { cn } from '@/lib/cn'

/** Height cap while collapsed, in px. Roughly nine lines. */
const COLLAPSED_MAX = 190

/**
 * Only collapse when the content meaningfully exceeds the cap. Without this a
 * message a few pixels too tall gets a toggle that reveals almost nothing.
 */
const SLOP = 28

/**
 * A user message's text, clamped when long.
 *
 * This is the fix for the bubble that eats the screen when someone pastes a
 * wall of text. Past the cap it holds a fixed height behind a fade, with a
 * toggle underneath.
 *
 * The clamp animates real pixel height rather than a transform: a scaled
 * element blurs its own text mid-transition, and the height has to be measured
 * anyway to know whether a toggle is needed at all.
 */
export function CollapsibleText({ text }: { text: string }) {
  const body = useRef<HTMLParagraphElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)
  const [fullHeight, setFullHeight] = useState(0)
  /**
   * The clamp is not animated until the first measurement has been applied.
   *
   * Measuring takes a paint: the paragraph renders unclamped, and only then does
   * the layout effect cap it. With a transition already armed that first cap is
   * a visible 0.3s collapse on every message that mounts -- the "glitch" on
   * paste. Armed one frame later, the cap lands as the message's initial state
   * and only a real toggle animates.
   */
  const [armed, setArmed] = useState(false)

  useLayoutEffect(() => {
    const element = body.current
    if (!element) return

    const measure = () => {
      const height = element.scrollHeight
      setFullHeight(height)
      setOverflowing(height > COLLAPSED_MAX + SLOP)
    }

    measure()

    // Height is a function of width, and the width of this column changes
    // without the text changing: the sidebar animates its own width, and the
    // window resizes. Measuring on `text` alone left `fullHeight` stale, so an
    // expanded bubble clipped its last lines and a collapsed one kept a toggle
    // it no longer needed.
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [text])

  useEffect(() => {
    const frame = requestAnimationFrame(() => setArmed(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  const maxHeight = !overflowing ? undefined : expanded ? fullHeight : COLLAPSED_MAX

  return (
    <div className="flex flex-col">
      <div
        className="relative overflow-hidden"
        style={{
          maxHeight,
          transition: armed ? 'max-height 0.3s cubic-bezier(0.16, 1, 0.3, 1)' : undefined,
        }}
      >
        <p
          ref={body}
          className="studio-selectable text-body whitespace-pre-wrap [overflow-wrap:anywhere]"
        >
          {text}
        </p>

        {overflowing && !expanded ? (
          <div
            aria-hidden
            // Fades to the bubble's own rendered colour, not to the page behind
            // it: the gradient lives inside the bubble, and fading to the
            // surface colour would draw a pale band across the bottom of a grey
            // bubble. `color-mix` composites `selected` over `surface` so the
            // stop equals the bubble's fill whatever the theme.
            className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-[color-mix(in_oklch,var(--surface),var(--foreground)_8%)] to-transparent"
          />
        ) : null}
      </div>

      {overflowing ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-1.5 inline-flex items-center gap-1 self-start text-caption text-muted-foreground transition-colors hover:text-foreground"
        >
          {expanded ? 'Show less' : 'Show more'}
          <Icons.expand
            className={cn('transition-transform duration-200', expanded && 'rotate-180')}
          />
        </button>
      ) : null}
    </div>
  )
}
