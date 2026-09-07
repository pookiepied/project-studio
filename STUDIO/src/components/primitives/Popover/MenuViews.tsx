import { AnimatePresence, motion } from 'framer-motion'
import { DURATION, EASE_IN, EASE_OUT, SPRING_SNAPPY } from '@/design/tokens'
import type { ReactNode } from 'react'

/**
 * One menu, more than one page, and the movement between them.
 *
 * A menu that swaps its whole contents in a single frame reads as a different
 * menu appearing rather than as the same menu turning a page: nothing connects
 * what was there to what is there now, and the eye has to re-find its place
 * from scratch. The panel also jumped from one height to the other, so the
 * rows below the cursor moved without warning.
 *
 * So the pages slide in the direction you travelled - forward goes left, back
 * goes right - and the panel's own height follows. The distance is small on
 * purpose (twelve pixels, not a screen width): this is a page turn inside one
 * small surface, and a full slide would say the two pages are further apart
 * than they are.
 *
 * `mode="wait"` rather than an overlap. Two absolutely positioned pages
 * crossing over each other need the container's height pinned for the whole
 * transition, and a menu that is being scrolled while that happens fights the
 * scroll. Waiting costs one short beat and keeps the layout honest throughout.
 *
 * The global reduced-motion rule collapses the slide; the layout animation
 * goes with it, which leaves the plain swap this replaced - correct, and the
 * right thing to degrade to.
 */
export function MenuViews({
  view,
  depth,
  children,
}: {
  /** Which page is showing. Changing it is what runs the transition. */
  readonly view: string
  /**
   * How deep this page is. The direction comes from the change, not from the
   * names: a caller adding a third page gets the right movement for free,
   * and a caller that never nests passes 0 and gets a plain crossfade.
   */
  readonly depth: number
  readonly children: ReactNode
}) {
  return (
    <motion.div layout transition={SPRING_SNAPPY} className="overflow-hidden">
      <AnimatePresence mode="wait" initial={false} custom={depth}>
        <motion.div
          key={view}
          custom={depth}
          variants={VARIANTS}
          initial="enter"
          animate="settled"
          exit="leave"
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </motion.div>
  )
}

/** Twelve pixels: a page turn inside one panel, not a change of surface. */
const TRAVEL = 12

/**
 * Arriving and leaving take opposite curves. The house ease-out is
 * front-loaded, which reads well on a page arriving and reads as a cut on the
 * one it replaced - it is gone within a couple of frames and the rest of the
 * duration animates nothing. So the outgoing page eases in and the incoming
 * page eases out, and each carries its own transition because one prop on the
 * element cannot say two things.
 */
const VARIANTS = {
  enter: (depth: number) => ({
    opacity: 0,
    x: depth > 0 ? TRAVEL : -TRAVEL,
    transition: { duration: DURATION.fast, ease: EASE_OUT },
  }),
  settled: {
    opacity: 1,
    x: 0,
    transition: { duration: DURATION.fast, ease: EASE_OUT },
  },
  leave: (depth: number) => ({
    opacity: 0,
    x: depth > 0 ? -TRAVEL : TRAVEL,
    transition: { duration: DURATION.fast, ease: EASE_IN },
  }),
}
