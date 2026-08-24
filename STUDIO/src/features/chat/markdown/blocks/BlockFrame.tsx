import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * The preview frame: a thing the reader takes away, shown inside a reply.
 *
 * Code and writing-as-an-object live here — tier three of the content
 * hierarchy (see `RULES.md`). Their shared contract is *preview*: the content
 * is shown to be recognised and copied, not to be worked in, so past
 * `previewHeight` it is held at the cap behind a fade and that is the whole of
 * the interaction. There is no expansion to bring back and no scroller to
 * wander into. The full text is one copy away, and the transcript keeps
 * moving.
 *
 * Two boxes, not one. An outer card carries the shadow and the padding, and an
 * inner panel carries the content on a surface of its own. The caption sits
 * between the inner panel's bottom edge and the card's, on the card's
 * background, with no rule between them — the gap is the separation.
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
 * chewed edge comes from — the browser clips on a pixel grid while the border
 * radius is antialiased, so the fill ends a fraction inside the curve and the
 * corner reads as cut rather than turned. With two boxes the inner panel's
 * *background* is the rounded shape, and its padding means text never reaches
 * the corner in the first place. Nothing is clipped, so nothing is chewed —
 * which is also why the clip only switches on while the preview cap is holding.
 */
export function BlockFrame({
  label,
  meta,
  actions,
  previewHeight,
  flush = false,
  children,
}: {
  /** What this block is: a path for code, a name for prose. Left of the caption. */
  label: ReactNode
  /** Secondary detail — a line range, a word count. Right of the caption. */
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
  /**
   * The preview cap, in px. Content taller than this is held at the cap and
   * faded; shorter content is untouched. Omitted, the block never caps.
   */
  previewHeight?: number
  /**
   * The child paints to the panel's edges and supplies its own padding.
   *
   * Needed by anything that fills the panel — the highlighter pads itself, and
   * a padded child inside the frame's padding is twice the gutter.
   */
  flush?: boolean
  children: ReactNode
}) {
  const body = useRef<HTMLDivElement>(null)
  const [full, setFull] = useState(0)

  // Measured before paint, so a block that caps is capped on its very first
  // frame. In an effect instead, every long block would render at full height
  // and then visibly clamp.
  useLayoutEffect(() => {
    const element = body.current
    if (!element || previewHeight === undefined) return

    const measure = () => setFull(element.scrollHeight)
    measure()

    // Height is a function of width, and this column changes width without the
    // content changing: the sidebar animates, the window resizes.
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [previewHeight, children])

  const capped = previewHeight !== undefined && full > previewHeight + 24

  return (
    <div className="my-5 w-full min-w-0 rounded-block bg-surface-raised p-2 shadow-lifted">
      <div
        className="relative min-w-0 rounded-block-inner bg-code-surface"
        style={{
          maxHeight: capped ? previewHeight : undefined,
          // Only while capped. Left on permanently it would clip the corners of
          // the very panel whose corners this construction exists to protect.
          overflow: capped ? 'hidden' : undefined,
          ...(capped
            ? {
                maskImage: 'linear-gradient(to bottom, #000 calc(100% - 4.5rem), transparent)',
                WebkitMaskImage: 'linear-gradient(to bottom, #000 calc(100% - 4.5rem), transparent)',
              }
            : null),
        }}
      >
        <div ref={body} className={cn('min-w-0', flush ? undefined : 'py-3')}>
          {children}
        </div>
      </div>

      {/* On the card, outside the panel. No border: the gap is the separation. */}
      <div className="flex h-8 items-center gap-2 px-2">
        <span className="min-w-0 truncate text-micro text-muted-foreground">{label}</span>

        <div className="ml-auto flex shrink-0 items-center gap-1">
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
