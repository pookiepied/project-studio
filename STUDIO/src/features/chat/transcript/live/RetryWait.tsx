import { memo } from 'react'
import { Icons } from '@/components/icons'
import type { RetryWaitFacts } from '@/features/chat/useConversation'

/**
 * The wait between a refused attempt and the retry the harness scheduled.
 *
 * Before Task 29 these seconds were indistinguishable from a stall — the
 * wire said nothing, so the screen could only pulse. Everything here is the
 * signal's own facts: which attempt failed, out of how many, how long the
 * harness said it would wait, and the provider's sentence for why. It says
 * what is happening, not that everything is fine, and it disappears the
 * moment generation resumes or the turn settles — never on a local timer,
 * because a guess about the wait would be exactly the invention the wire
 * signal exists to replace.
 */
export const RetryWait = memo(function RetryWait({ retrying }: { retrying: RetryWaitFacts }) {
  const seconds = Math.max(1, Math.round(retrying.delayMs / 1000))
  return (
    <div className="studio-message flex flex-col items-start gap-0.5" role="status">
      <div className="inline-flex items-center gap-1.5 text-caption text-muted-foreground">
        <Icons.failed size="sm" className="animate-pulse" />
        <span>
          Attempt {retrying.attempt} of {retrying.maxRetries + 1} failed — waiting {seconds}s
          before trying again
        </span>
      </div>
      {retrying.detail !== null ? (
        <p className="max-w-[60ch] break-words pl-(--row-label-inset) text-caption text-muted-foreground/80">
          {retrying.detail}
        </p>
      ) : null}
    </div>
  )
})
