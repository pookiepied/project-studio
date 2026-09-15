import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { StudioMark } from '@/components/brand'
import { EASE_OUT, SPLASH } from '@/design/tokens'

/**
 * One pass of the preload animation: the tiles assembling (`StudioMark`'s
 * entrance, the last tile's delay plus its duration) and a moment complete.
 * A splash still waiting when a pass ends plays it again.
 */
const PASS_MS = 1_800

/**
 * The preload screen: the brand, arriving.
 *
 * Plays once at startup, over the shell that has already painted beneath it.
 * The surface is the app's own, so the splash never reads as a different
 * program taking the window — it is the same object, still waking up. The
 * tiles assemble on the mark's own clock (`StudioMark`'s entrance); this
 * component owns only the container's slow settle and the exit fade that hands
 * the window over.
 */
export function SplashScreen({
  waiting = false,
}: {
  /**
   * The store has not answered yet. The preload animation plays once and
   * then stood still for as long as the store was loading, and a still mark
   * over a harness that was starting read as a window that had hung. While
   * waiting, the same animation plays again: each pass the assembled mark
   * leaves and the tiles assemble once more, until the store answers and the
   * splash lifts on the pass it is in. Nothing new is drawn for the wait -
   * the preload animation is the wait.
   */
  waiting?: boolean
}) {
  const [pass, setPass] = useState(0)
  useEffect(() => {
    if (!waiting) return
    const timer = window.setInterval(() => setPass((current) => current + 1), PASS_MS)
    return () => window.clearInterval(timer)
  }, [waiting])

  return (
    <motion.div
      aria-hidden
      className="fixed inset-0 z-[100] flex items-center justify-center bg-surface"
      exit={{ opacity: 0, transition: { duration: SPLASH.exitDuration, ease: EASE_OUT } }}
    >
      {/* The mark leaves before the surface does.

          Fading the whole splash as one flat layer is what made the handover
          feel like a cut: the brand and the ground it sits on disappeared at
          exactly the same rate, so there was no moment of *departure*, just an
          image being switched off. Letting the mark rise and go first, and the
          surface follow, gives the exit an order — the thing you were looking
          at leaves, then the room it was in. It costs 200ms and it is the whole
          difference between a transition and a flash. */}
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{
          opacity: 0,
          scale: 1.04,
          transition: { duration: SPLASH.markExitDuration, ease: EASE_OUT },
        }}
        transition={{ duration: 0.8, ease: EASE_OUT }}
        className="text-foreground"
      >
        {/* 88, not 112: the mark was drawn for a taller window, and on the
            720px default it filled a sixth of the height — the splash read
            as a poster rather than a boot state. One step down keeps the
            staircase legible while giving the mark the same margin of quiet
            around it the home greeting has. */}
        {/* Keyed by the pass: a new key is the animation from the start,
            and `wait` lets the finished mark leave before the next pass
            assembles, so the replay reads as the animation looping rather
            than the tiles snapping back to nothing. */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={pass}
            exit={{ opacity: 0, transition: { duration: 0.22, ease: EASE_OUT } }}
          >
            <StudioMark entrance size={88} />
          </motion.div>
        </AnimatePresence>
      </motion.div>
    </motion.div>
  )
}
