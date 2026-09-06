import { memo } from 'react'
import { Icons } from '@/components/icons'
import {
  classifyFailureKind,
  failureRemedy,
} from '@/features/chat/transcript/failure-kind'
import type { TranscriptItem } from '@/features/chat/transcript/projection'

type FailedItem = Extract<TranscriptItem, { kind: 'submission-failed' }>

/**
 * One failed or aborted submission, standing where its contentless retry
 * attempts were withdrawn.
 *
 * This is the thing a rate-limited turn becomes instead of four empty
 * bubbles: one line naming the outcome, and under it the provider's own
 * sentence — the words the harness carried back and Task 25's parser used
 * to drop. When the settlement arrived with no error object at all, the
 * reason line says so rather than inventing a cause; a failure with no
 * sentence is still a failure.
 */
export const SubmissionFailed = memo(function SubmissionFailed({ item }: { item: FailedItem }) {
  const headline =
    item.outcome === 'aborted' ? 'This turn was aborted' : 'This turn failed'
  const remedy = failureRemedy(classifyFailureKind(item.reason))
  return (
    <div className="studio-message flex flex-col items-start gap-0.5">
      <div className="inline-flex items-center gap-1.5 text-caption text-muted-foreground">
        <Icons.failed size="sm" className="text-danger" />
        <span>{headline}</span>
      </div>
      <p
        className={`max-w-[60ch] break-words pl-(--row-label-inset) text-caption ${
          item.reason === null ? 'italic text-muted-foreground/60' : 'text-muted-foreground/80'
        }`}
      >
        {item.reason ?? 'No reason arrived with the failure.'}
      </p>
      {remedy !== null ? (
        <p className="max-w-[60ch] break-words pl-(--row-label-inset) text-caption text-muted-foreground/80">
          {remedy}
        </p>
      ) : null}
    </div>
  )
})
