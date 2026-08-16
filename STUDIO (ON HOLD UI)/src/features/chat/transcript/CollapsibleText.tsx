import { useLayoutEffect, useRef, useState } from 'react'
import { Expand } from '@/components/icons'
import { cn } from '@/lib/utils'

/** Height cap while collapsed (px) — roughly nine lines. */
const COLLAPSED_MAX = 200

/**
 * Only collapse when the content meaningfully exceeds the cap. Without this a
 * message a few pixels too tall gets a toggle that reveals almost nothing.
 */
const OVERFLOW_SLOP = 28

/**
 * A user message's text, clamped when long.
 *
 * Past the cap it holds a fixed height behind a fade, with a Show more / Show
 * less toggle. The clamp animates real pixel height rather than a transform, so
 * the text never stretches or blurs mid-transition — it is measured on mount
 * and whenever the content changes.
 */
export function CollapsibleText({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)
  const [fullHeight, setFullHeight] = useState(0)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const height = element.scrollHeight
    setFullHeight(height)
    setOverflowing(height > COLLAPSED_MAX + OVERFLOW_SLOP)
  }, [text])

  const maxHeight = !overflowing ? undefined : expanded ? fullHeight : COLLAPSED_MAX

  return (
    <div className="flex flex-col">
      <div
        className="relative overflow-hidden"
        style={{ maxHeight, transition: 'max-height 0.3s cubic-bezier(0.16, 1, 0.3, 1)' }}
      >
        <p
          ref={ref}
          className="font-sans text-[13px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere] text-foreground"
        >
          {text}
        </p>

        {overflowing && !expanded && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-linear-to-t from-muted to-transparent"
          />
        )}
      </div>

      {overflowing && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-1.5 inline-flex items-center gap-1 self-start text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          {expanded ? 'Show less' : 'Show more'}
          <Expand
            size="xs"
            className={cn('transition-transform duration-200', expanded && 'rotate-180')}
          />
        </button>
      )}
    </div>
  )
}
