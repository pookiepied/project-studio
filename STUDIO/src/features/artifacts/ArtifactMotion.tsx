import type { CSSProperties, ReactNode } from 'react'
import { motion } from 'framer-motion'
import { DURATION, EASE_OUT, LOOP, staggerDelay } from '@/design/tokens'
import { cn } from '@/lib/cn'

/**
 * The motion every artifact shares.
 *
 * Artifacts fill in over time — results arrive one at a time, a timeline grows
 * a step, an image resolves — and if each kind animates that differently the
 * transcript stops feeling like one app. So the arrival of a row is defined
 * once, here, and every artifact uses it.
 *
 * Nothing loops except the two indicators that mean "still working", and those
 * stop the moment it is not.
 */

/**
 * A list whose children arrive in sequence.
 *
 * The stagger is capped in `staggerDelay`, which matters more than it sounds:
 * a search returning twenty results with an uncapped 25ms stagger would take
 * half a second to finish drawing, and the last row would read as lag rather
 * than as sequence.
 */
export function AnimatedList({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={cn('flex flex-col', className)}>{children}</div>
}

export function AnimatedItem({
  index = 0,
  children,
  className,
  style,
}: {
  index?: number
  children: ReactNode
  className?: string
  /** Layout the parent computes per item - a frame's share of its row. */
  style?: CSSProperties
}) {
  return (
    <motion.div
      // 4px, not 12. These rows arrive *while you are reading the rows above
      // them*, so a long travel is movement in the corner of the eye competing
      // with text. The fade carries the arrival; the offset only says which
      // direction it came from.
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DURATION.base, ease: EASE_OUT, delay: staggerDelay(index) }}
      className={cn('min-w-0', className)}
      style={style}
    >
      {children}
    </motion.div>
  )
}

/**
 * The soft pulse on an artifact that is still working.
 *
 * On the icon's own container rather than on the artifact frame: pulsing the
 * whole card would mean the text inside it changes contrast while you are
 * trying to read it, which is the single most common way a "loading" animation
 * makes an interface worse.
 */
export function WorkingHalo({ working, children }: { working: boolean; children: ReactNode }) {
  return (
    <span className="relative flex size-7 shrink-0 items-center justify-center rounded-lg bg-selected text-muted-foreground">
      {working ? (
        <motion.span
          aria-hidden
          className="absolute inset-0 rounded-lg bg-current opacity-10"
          animate={{ opacity: [0.05, 0.16, 0.05], scale: [1, 1.06, 1] }}
          transition={LOOP.sweep}
        />
      ) : null}
      <span className="relative flex items-center">{children}</span>
    </span>
  )
}
