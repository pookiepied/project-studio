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
      {/* The fade is a mask on the text, not a coloured panel over it.
          It used to be an absolutely-positioned gradient whose `from` colour
          tried to reproduce the bubble's fill: `color-mix(in oklch,
          var(--surface), var(--foreground) 8%)`. That can never be right. The
          bubble is `bg-selected`, which is `--foreground` at 8% *alpha*,
          composited by the browser in sRGB -- while `color-mix(in oklch, ...)`
          interpolates in a different space entirely. Two different
          computations of "the same" colour, so the band was always a shade
          off, and it showed as a pale seam across the bottom of the bubble.
          That is the artifact.

          A mask has no colour to get wrong. It fades the text itself to
          transparent and lets the real background show through, whatever the
          bubble is filled with and whatever the theme does to it. It also
          removes a stacking layer that sat over the glyphs, which is what was
          shifting their antialiasing and making the clamped text render subtly
          differently from unclamped text. */}
      <div
        className="relative overflow-hidden"
        style={{
          maxHeight,
          transition: armed ? 'max-height 0.3s cubic-bezier(0.16, 1, 0.3, 1)' : undefined,
          ...(overflowing && !expanded
            ? {
                maskImage: 'linear-gradient(to bottom, #000 calc(100% - 3.5rem), transparent)',
                WebkitMaskImage: 'linear-gradient(to bottom, #000 calc(100% - 3.5rem), transparent)',
              }
            : null),
        }}
      >
        <p
          ref={body}
          className="studio-selectable text-body whitespace-pre-wrap [overflow-wrap:anywhere]"
        >
          {text}
        </p>

      </div>

      {overflowing ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-1.5 inline-flex items-center gap-1 self-start text-caption text-muted-foreground transition-colors hover:text-foreground"
        >
          {expanded ? 'Show less' : 'Show more'}
          <Icons.expand
            className={cn('transition-transform duration-base', expanded && 'rotate-180')}
          />
        </button>
      ) : null}
    </div>
  )
}
