import { useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { StudioMark } from '@/components/brand'
import { EASE_OUT, SPLASH } from '@/design/tokens'

/**
 * Leave a beat after the starburst settles before replaying the entrance.
 */
const PASS_MS = 1_800

export function SplashScreen({
  waiting = false,
}: {
  /** Replay the entrance while the store loads, then fade into the app. */
  waiting?: boolean
}) {
  const reducedMotion = useReducedMotion()
  const [pass, setPass] = useState(0)
  useEffect(() => {
    if (!waiting || reducedMotion) return
    const timer = window.setInterval(() => setPass((current) => current + 1), PASS_MS)
    return () => window.clearInterval(timer)
  }, [waiting, reducedMotion])

  return (
    <motion.div
      aria-hidden
      className="studio-window-fill z-[100] flex items-center justify-center bg-surface"
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
        initial={{ opacity: 0, scale: reducedMotion ? 1 : 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{
          opacity: 0,
          scale: reducedMotion ? 1 : 1.04,
          transition: { duration: SPLASH.markExitDuration, ease: EASE_OUT },
        }}
        transition={{ duration: 0.8, ease: EASE_OUT }}
      >
        {/* Remount the mark after the previous pass fades. */}
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
