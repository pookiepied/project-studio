import { createContext, useContext, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { ENTER } from '@/design/tokens'

/**
 * How anything arrives in the conversation.
 *
 * A message sent, a reply's first words, a thought, a tool row, an artifact
 * — every one of them used to enter its own way: one faded, one rose, one
 * appeared fully drawn between frames, and the column read as things being
 * pasted in rather than as a conversation happening. So there is one
 * entrance, the house `ENTER` — a fade with a breath of rise on the
 * surface clock — and everything that lands in the column comes in on it.
 *
 * ---- Only what is happening now moves --------------------------------------
 *
 * A replayed history is not arriving; it was already here. Playing the
 * entrance on every row of a reopened conversation would be a hundred things
 * settling at once, which is the opposite of calm. So the entrance plays
 * only inside a turn that is live, and the turn says so once, through
 * `Arriving`, for everything beneath it — an artifact three components down
 * inside a markdown block does not need to be told by hand.
 */

const ArrivingContext = createContext(false)

/** Marks a subtree as arriving now: everything that mounts inside plays. */
export function Arriving({ live, children }: { live: boolean; children: ReactNode }) {
  return <ArrivingContext.Provider value={live}>{children}</ArrivingContext.Provider>
}

/** Whether the subtree is arriving now; what `Arrive` reads by default. */
export function useArriving(): boolean {
  return useContext(ArrivingContext)
}

export function Arrive({
  play,
  className,
  children,
}: {
  /** Force the entrance on or off; absent, the subtree's own answer. */
  play?: boolean
  className?: string
  children: ReactNode
}) {
  const arriving = useArriving()
  const plays = play ?? arriving
  return (
    <motion.div
      className={className}
      initial={plays ? ENTER.initial : false}
      animate={ENTER.animate}
      transition={ENTER.transition}
    >
      {children}
    </motion.div>
  )
}
