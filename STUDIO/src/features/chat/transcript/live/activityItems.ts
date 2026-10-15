import type { TranscriptItem } from '@/features/chat/transcript/projection'

export type ActivityItem = TranscriptItem & { readonly tailMessageId?: string }

// Retain memo boundaries for history when an unrelated live item changes.
const joins = new WeakMap<ActivityItem, WeakMap<TranscriptItem, ActivityItem>>()

/** Provider message boundaries do not split one submission's conversation UI. */
export function activityItems(items: readonly TranscriptItem[]): ActivityItem[] {
  const result: ActivityItem[] = []
  for (const item of items) {
    const previous = result[result.length - 1]
    if (item.kind === 'assistant' && previous?.kind === 'assistant'
      && item.submissionId !== null && item.submissionId === previous.submissionId
      && previous.end.state === 'complete'
      && item.end.state !== 'failed' && item.end.state !== 'aborted') {
      const cached = joins.get(previous)?.get(item)
      const joined: ActivityItem = cached ?? {
        ...previous,
        segments: [...previous.segments, ...item.segments],
        end: item.end,
        tailMessageId: item.id,
      }
      if (cached === undefined) {
        const next = joins.get(previous) ?? new WeakMap<TranscriptItem, ActivityItem>()
        next.set(item, joined)
        joins.set(previous, next)
      }
      result[result.length - 1] = joined
    } else {
      result.push(item)
    }
  }
  return result
}
