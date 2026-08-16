import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { DURATION, EASE_OUT } from '@/design/tokens'
import { Icons } from '@/components/icons'
import { cn } from '@/lib/cn'

/**
 * The frame every block in a reply sits in.
 *
 * Code, a rewritten paragraph, a diff -- they are the same object with
 * different contents: a quiet header naming what this is, a body, and a way to
 * fold it away when it is long. Sharing the frame is what stops the third one
 * from inventing its own padding, its own radius and its own idea of where the
 * copy button goes.
 *
 * ---- What made the old block look dated ----------------------------------
 *
 * A hard 1px border on the page, a grey header bar with a full-strength label,
 * and controls sitting visible at all times. That is a 2012 editor chrome, and
 * three things move it forward:
 *
 *   1. The block sits on a *sunken* surface with no border of its own. Depth
 *      comes from the ground changing, not from a line drawn around it. A
 *      border says "this is a widget"; a recessed panel says "this is inset
 *      into the page".
 *   2. Controls fade in on hover. They are there when you reach for them and
 *      absent when you are reading, which is most of the time. The space is
 *      reserved either way, so nothing moves when they arrive.
 *   3. Radius and spacing come from the shell's scale rather than from the
 *      block's own taste.
 *
 * ---- Collapsing ----------------------------------------------------------
 *
 * Long blocks fold to a preview behind a mask rather than a coloured overlay,
 * for the same reason the user bubble does: an overlay has to reproduce the
 * background it sits on, and it can only ever get close.
 */
export function BlockFrame({
  label,
  meta,
  actions,
  collapsedHeight,
  expandLabel,
  chrome = 'top',
  tone = 'sunken',
  children,
}: {
  /** What this block is. Left of the header, quiet. */
  label: ReactNode
  /** Secondary detail -- a line count, a language. Right of the label. */
  meta?: ReactNode
  /** Controls. Revealed on hover; their space is always reserved. */
  actions?: ReactNode
  /**
   * Fold past this height, in px. Omitted, the block never folds -- which is
   * right for anything short enough to take in at once.
   */
  collapsedHeight?: number
  expandLabel?: (hidden: boolean) => string
  /**
   * Which end the bar sits at.
   *
   * `bottom` is for blocks whose content should be the first thing your eye
   * lands on. A header pushes the content down and makes you read a label
   * before the thing the label names -- fine for a draft, where "Draft" is the
   * point, and wrong for code, where the first line is. At the bottom the same
   * information becomes a caption: available when you go looking for it,
   * silent when you are reading.
   */
  chrome?: 'top' | 'bottom'
  /**
   * `raised` lifts the block off the page with a shadow instead of recessing
   * it. Used where the block is the subject rather than an inclusion.
   */
  tone?: 'sunken' | 'raised'
  children: ReactNode
}) {
  const body = useRef<HTMLDivElement>(null)
  const [hovered, setHovered] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [full, setFull] = useState(0)

  // Measured before paint, so a block that needs folding is folded on its very
  // first frame. Measured in an effect instead, every long block in a reply
  // would render at full height and then visibly collapse.
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
  const bottom = chrome === 'bottom'

  const bar = (
    <div
      className={cn(
        'flex h-9 items-center gap-2 px-3.5',
        // A hairline between the caption and the content, but only at the
        // bottom, where the code runs right up to it. At the top the label sits
        // above whitespace and a rule there is a line for its own sake.
        bottom && 'border-t',
      )}
    >
      <span className="truncate text-micro font-medium text-muted-foreground">{label}</span>

      {/* Reserved, not conditional. Mounting the controls on hover would change
          the bar's height the first time the pointer arrived. */}
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <AnimatePresence initial={false}>
          {hovered && actions ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: DURATION.fast, ease: EASE_OUT }}
              className="flex items-center gap-0.5"
            >
              {actions}
            </motion.div>
          ) : null}
        </AnimatePresence>

        {meta ? (
          <span className="shrink-0 text-micro text-muted-foreground/70 tabular-nums">{meta}</span>
        ) : null}

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
      </div>
    </div>
  )

  return (
    <div
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      className={cn(
        'group/block my-5 w-full min-w-0 overflow-hidden rounded-2xl',
        tone === 'raised' ? 'bg-surface-raised shadow-lifted' : 'bg-surface-sunken',
      )}
    >
      {bottom ? null : bar}

      <div
        className="relative"
        style={{
          // `maxHeight` rather than `height`, so a block that has not been
          // measured yet renders at its natural size instead of at zero.
          maxHeight: folded ? collapsedHeight : undefined,
          overflow: folded ? 'hidden' : undefined,
          transition: `max-height ${DURATION.slow}s cubic-bezier(0.16, 1, 0.3, 1)`,
          ...(folded
            ? {
                maskImage: 'linear-gradient(to bottom, #000 calc(100% - 4rem), transparent)',
                WebkitMaskImage: 'linear-gradient(to bottom, #000 calc(100% - 4rem), transparent)',
              }
            : null),
        }}
      >
        <div ref={body} className={cn('min-w-0', bottom ? 'py-3.5' : 'pb-3')}>
          {children}
        </div>
      </div>

      {bottom ? bar : null}
    </div>
  )
}
