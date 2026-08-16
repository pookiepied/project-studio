import { motion } from 'framer-motion'
import { cn } from '@/lib/cn'
import type { ArtifactStatus } from '@/domain/artifacts/types'

/**
 * A step's state, as one dot.
 *
 * Four states and one shape. The alternative -- a tick, a spinner, a cross, a
 * hollow circle -- puts four different silhouettes in a vertical column, and a
 * column of mixed silhouettes cannot be scanned: the eye stops at each one to
 * identify it instead of running down the list. Same dot, different fill, and
 * the only one that moves is the one happening now.
 */
export function StatusDot({
  status = 'pending',
  className,
}: {
  status?: ArtifactStatus
  className?: string
}) {
  const base = cn('size-1.5 shrink-0 rounded-full', className)

  if (status === 'running') {
    return (
      <motion.span
        aria-hidden
        className={cn(base, 'bg-foreground')}
        animate={{ opacity: [0.35, 1, 0.35] }}
        transition={{ duration: 1.2, ease: 'easeInOut', repeat: Infinity }}
      />
    )
  }

  return (
    <span
      aria-hidden
      className={cn(
        base,
        status === 'done' && 'bg-foreground/55',
        status === 'failed' && 'bg-danger',
        // Cancelled and pending are both "did not happen", drawn as an outline
        // so the column reads as unfinished without implying failure.
        (status === 'pending' || status === 'cancelled') &&
          'border border-muted-foreground/50 bg-transparent',
      )}
    />
  )
}
