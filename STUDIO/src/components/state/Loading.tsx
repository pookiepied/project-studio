import type { CSSProperties } from 'react'
import { motion } from 'framer-motion'
import { WorkingDots } from '@/components/state/WorkingDots'
import { DURATION, EASE_OUT } from '@/design/tokens'
import { cn } from '@/lib/cn'

/**
 * A wait, drawn once for the whole app.
 *
 * Three dots breathing where the content will be - the same dots a running
 * tool step and the dictation strip show, so every wait in the app is the
 * one wait. It replaces the skeletons: rows of grey bars shaped like the
 * content to come, which held its space well and were refused for what they
 * are, a picture of content that is not there. It is also not the brand
 * mark, which is the app's face and not its hourglass.
 *
 * It arrives late (`SHOW_AFTER`). Most reads here are to a process on this
 * machine and land in a few frames; an indicator that showed for those
 * frames would be the only thing seen of the read, a flash that says
 * "loading" about something already loaded. So nothing is drawn until the
 * wait is long enough to be one. And it leaves quickly, fading under the
 * content that replaces it when it is inside an `AnimatePresence`.
 *
 * A whole surface about to be filled keeps its page empty and shows the
 * wait on its chrome instead (`LoadingLine`); the dots are for a list or a
 * pane, a part of a page that is waiting.
 *
 * The region announces itself once, through `role="status"` and the label;
 * the dots themselves are decoration. A caller that already owns the status
 * region passes no label and gets the dots alone.
 */

/** How long a wait is invisible before the dots show, in seconds. */
export const SHOW_AFTER = 0.15

export function Loading({
  label,
  className,
  style,
  immediate = false,
}: {
  /** What is loading, spoken: "Loading conversations". Omit inside a region that already says so. */
  label?: string
  className?: string
  style?: CSSProperties
  /** Show at once - for a wait already known to be long, or a specimen. */
  immediate?: boolean
}) {
  return (
    <motion.div
      role={label === undefined ? undefined : 'status'}
      aria-label={label}
      aria-hidden={label === undefined ? true : undefined}
      className={cn('flex items-center justify-center py-6 text-muted-foreground', className)}
      style={style}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: DURATION.fast, ease: EASE_OUT } }}
      transition={{ duration: DURATION.base, ease: EASE_OUT, delay: immediate ? 0 : SHOW_AFTER }}
    >
      <WorkingDots size="md" />
    </motion.div>
  )
}
