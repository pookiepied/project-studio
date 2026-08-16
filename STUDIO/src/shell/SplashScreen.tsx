import { motion } from 'framer-motion'
import { StudioMark } from '@/components/brand'
import { EASE_OUT, SPLASH } from '@/design/tokens'

/**
 * The preload screen: the brand, arriving.
 *
 * Plays once at startup, over the shell that has already painted beneath it.
 * The surface is the app's own, so the splash never reads as a different
 * program taking the window -- it is the same object, still waking up. The
 * tiles assemble on the mark's own clock (`StudioMark`'s entrance); this
 * component owns only the container's slow settle and the exit fade that hands
 * the window over.
 */
export function SplashScreen() {
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
          surface follow, gives the exit an order -- the thing you were looking
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
        <StudioMark entrance size={112} />
      </motion.div>
    </motion.div>
  )
}
