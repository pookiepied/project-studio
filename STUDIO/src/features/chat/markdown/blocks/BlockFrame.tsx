import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { DURATION } from '@/design/tokens'
import { Icons } from '@/components/icons'
import { cn } from '@/lib/cn'

/**
 * The frame every block in a reply sits in.
 *
 * Two boxes, not one. An outer card carries the shadow and the padding, and an
 * inner panel carries the content on a surface of its own. The caption sits
 * between the inner panel's bottom edge and the card's, on the card's
 * background, with no rule between them -- the gap is the separation.
 *
 * ---- Why the nesting is the whole design ---------------------------------
 *
 * It looks like decoration and it is doing three jobs.
 *
 * It says what kind of thing this is. An inset panel on a card is the same
 * construction the media artifacts use for an image, and code is the same sort
 * of object: a thing produced, sitting in a holder, with a caption under it.
 *
 * It gives the caption somewhere to live that is not a bar. A header or a
 * footer strip needs a border to separate it, and a border across a block this
 * size is a heavy line for a small job. Set on the card *outside* the panel,
 * the caption is separated by whitespace, which costs nothing.
 *
 * And it fixes the corners. A single box has to clip its content to keep its
 * radius, and `overflow: hidden` against a rounded corner is where the harsh,
 * chewed edge comes from -- the browser clips on a pixel grid while the border
 * radius is antialiased, so the fill ends a fraction inside the curve and the
 * corner reads as cut rather than turned. With two boxes the inner panel's
 * *background* is the rounded shape, and its padding means text never reaches
 * the corner in the first place. Nothing is clipped, so nothing is chewed.
 */
export function BlockFrame({
  label,
  meta,
  actions,
  collapsedHeight,
  expandLabel,
  children,
}: {
  /** What this block is: a path for code, a name for prose. Left of the caption. */
  label: ReactNode
  /** Secondary detail -- a line range, a word count. Right of the caption. */
  meta?: ReactNode
  /**
   * Controls. Always visible.
   *
   * They used to fade in on hover, on the reasoning that a reader should not
   * see chrome they are not reaching for. That was wrong for these: copy is the
   * single most common thing anyone does to a code block, and a control you
   * have to discover by hovering is one most people never find. They are quiet
   * enough at rest to sit there permanently.
   */
  actions?: ReactNode
  /** Fold past this height, in px. Omitted, the block never folds. */
  collapsedHeight?: number
  expandLabel?: (folded: boolean) => string
  children: ReactNode
}) {
  const body = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [full, setFull] = useState(0)

  // Measured before paint, so a block that needs folding is folded on its very
  // first frame. In an effect instead, every long block would render at full
  // height and then visibly collapse.
  useLayoutEffect(() => {
    const element = body.current
    if (!element || collapsedHeight === undefined) return

    const measure = () => setFull(element.scrollHeight)
    measure()

    // Height is a function of width, and this column changes width without the
    // content changing: the sidebar animates, the window resizes.
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [collapsedHeight, children])

  const foldable = collapsedHeight !== undefined && full > collapsedHeight + 24
  const folded = foldable && !expanded

  return (
    <div className="my-5 w-full min-w-0 rounded-block bg-surface-raised p-2 shadow-lifted">
      <div
        className="relative min-w-0 rounded-block-inner bg-code-surface"
        style={{
          maxHeight: folded ? collapsedHeight : undefined,
          // Only while folded. Left on permanently it would clip the corners of
          // the very panel whose corners this construction exists to protect.
          overflow: folded ? 'hidden' : undefined,
          transition: `max-height ${DURATION.slow}s cubic-bezier(0.16, 1, 0.3, 1)`,
          ...(folded
            ? {
                maskImage: 'linear-gradient(to bottom, #000 calc(100% - 4.5rem), transparent)',
                WebkitMaskImage: 'linear-gradient(to bottom, #000 calc(100% - 4.5rem), transparent)',
              }
            : null),
        }}
      >
        <div ref={body} className="min-w-0 py-3">
          {children}
        </div>
      </div>

      {/* On the card, outside the panel. No border: the gap is the separation. */}
      <div className="flex h-8 items-center gap-2 px-2">
        <span className="min-w-0 truncate text-micro text-muted-foreground">{label}</span>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          {foldable ? (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-micro text-muted-foreground transition-colors duration-fast hover:bg-tint hover:text-foreground"
            >
              {expandLabel ? expandLabel(folded) : folded ? 'Expand' : 'Collapse'}
              <Icons.expand
                className={cn('transition-transform duration-base', !folded && 'rotate-180')}
              />
            </button>
          ) : null}

          {actions}

          {meta ? (
            <span className="shrink-0 pl-0.5 text-micro text-muted-foreground/70 tabular-nums">
              {meta}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  )
}
