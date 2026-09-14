import type { CSSProperties } from 'react'
import { motion } from 'framer-motion'
import { DURATION, EASE_OUT, LOOP } from '@/design/tokens'
import { SHOW_AFTER } from '@/components/state/Loading'
import { cn } from '@/lib/cn'

/**
 * A wait, as a hairline: one pixel along an edge of the chrome, with a soft
 * light travelling its length.
 *
 * For a surface that is about to be filled - a conversation opening - the
 * dots (`Loading`) stood in the middle of the empty page and read as a
 * widget waiting for its content. A page about to show words wants to stay
 * a page: empty, then the words. So the wait moves to the chrome, on the
 * edge the content will arrive under, the way a browser's page-load bar
 * sits under its toolbar. Nothing is in the reader's way, and nothing is
 * pretending to be content.
 *
 * Same manners as the dots: invisible until the wait has lasted
 * `SHOW_AFTER`, gone quickly when the content comes. The light is the house
 * sweep (`LOOP.sweep`), in the foreground colour at a whisper.
 */
export function LoadingLine({
  label,
  className,
  style,
}: {
  /** What is loading, spoken: "Loading the conversation". */
  label: string
  className?: string
  style?: CSSProperties
}) {
  return (
    <motion.div
      role="status"
      aria-label={label}
      className={cn('pointer-events-none h-px overflow-hidden', className)}
      style={style}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: DURATION.fast, ease: EASE_OUT } }}
      transition={{ duration: DURATION.base, ease: EASE_OUT, delay: SHOW_AFTER }}
    >
      <motion.span
        aria-hidden
        className="block h-full w-2/5"
        style={{
          background:
            'linear-gradient(90deg, transparent, color-mix(in oklab, var(--foreground) 45%, transparent) 50%, transparent)',
        }}
        animate={{ x: ['-100%', '250%'] }}
        transition={{ ...LOOP.sweep, ease: 'easeInOut' }}
      />
    </motion.div>
  )
}
