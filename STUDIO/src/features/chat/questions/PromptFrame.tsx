import { AnimatePresence, motion } from 'framer-motion'
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import { DURATION, EASE_IN, EASE_OUT } from '@/design/tokens'

/**
 * The surface a stopped run is answered on, standing where the composer was.
 *
 * ---- Why it owns the height ------------------------------------------------
 *
 * One call can ask up to four questions, each with two to four answers, and a
 * permission card is another shape again. Swapping one for the next used to
 * change the card's height in a single frame, and the transcript above it
 * jumped with it. The frame measures what it holds and eases to that height,
 * so a new question grows or shrinks the card rather than replacing it.
 *
 * It also opens from the composer's own height (`fromHeight`), so the card
 * reads as the composer turning into the question rather than one box leaving
 * and another arriving.
 *
 * ---- Why the content crossfades --------------------------------------------
 *
 * `contentKey` names what is on the card: the question's id. When it changes
 * the old content fades out over the new one while the height eases, rather
 * than the whole card leaving and entering again for every question.
 *
 * `overflow: clip` with a margin, not `hidden`: rows wear a highlight that
 * reaches the padding's edge and the clip margin keeps their corners while the
 * height is still easing.
 */
export function PromptFrame({
  contentKey,
  fromHeight = null,
  children,
}: {
  readonly contentKey: string
  /** The composer's height at the moment it gave way, or null to open from nothing. */
  readonly fromHeight?: number | null
  readonly children: ReactNode
}) {
  const inner = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number | null>(null)

  useLayoutEffect(() => {
    const element = inner.current
    if (!element) return
    const measure = () => setHeight(element.offsetHeight)
    measure()
    // Absent in the test DOM; the card simply holds its first height there.
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <motion.div
      className="studio-prompt-card"
      initial={{ opacity: 0, height: fromHeight ?? 'auto' }}
      animate={{ opacity: 1, height: height ?? 'auto' }}
      exit={{ opacity: 0, transition: { duration: DURATION.fast, ease: EASE_IN } }}
      transition={{
        height: { type: 'spring', stiffness: 420, damping: 40, mass: 0.9 },
        opacity: { duration: DURATION.base, ease: EASE_OUT },
      }}
    >
      <div ref={inner} className="studio-prompt-card-inner">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={contentKey}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0, transition: { duration: DURATION.slow, ease: EASE_OUT, delay: 0.06 } }}
            exit={{ opacity: 0, y: -4, transition: { duration: DURATION.fast, ease: EASE_IN } }}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.div>
  )
}
