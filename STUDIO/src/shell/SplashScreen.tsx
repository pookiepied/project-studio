import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { StudioMark } from '@/components/brand'
import { EASE_OUT, SPLASH } from '@/design/tokens'

/**
 * How long the mark's entrance takes: the last tile's delay plus its own
 * duration (`tileMotion` in `StudioMark`). After this the entrance is over,
 * and a splash still waiting has nothing left to play unless told to.
 */
const ENTRANCE_MS = 1_200

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
   * The store has not answered yet. The mark's entrance plays once and then
   * stops, and a splash held past it with a still mark read as a window that
   * had hung - the harness was starting under it, and nothing said so. Once
   * the entrance is done, a waiting splash hands the mark its busy shimmer,
   * the same one the strip shows while a turn runs, so the wait is visibly a
   * wait. It is the same mark throughout: the shimmer is the entrance's
   * tiles continuing to move, not a spinner arriving beside them.
   */
  waiting?: boolean
}) {
  const [entered, setEntered] = useState(false)
  useEffect(() => {
    const timer = window.setTimeout(() => setEntered(true), ENTRANCE_MS)
    return () => window.clearTimeout(timer)
  }, [])
  const busy = waiting && entered

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
        <StudioMark entrance={!busy} busy={busy} size={88} />
      </motion.div>
    </motion.div>
  )
}
