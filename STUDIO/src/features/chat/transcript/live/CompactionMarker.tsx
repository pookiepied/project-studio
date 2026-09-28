import { memo } from 'react'
import { Icons } from '@/components/icons'
import { formatTokens } from '@/domain/turn/context'
import type { TranscriptItem } from '@/features/chat/transcript/projection'

type CompactionItem = Extract<TranscriptItem, { kind: 'compaction' }>

/**
 * Where the conversation was compacted.
 *
 * One line in the transcript's own quiet voice — "Conversation compacted ·
 * 172k folded into a summary" — standing where the cut happened, and nothing
 * else. The messages above it are still on the page, because they are still
 * in the log; what changed is what the model remembers, and this row is
 * where that memory begins. It is not styled as a failure or a warning: a
 * compaction is the ordinary course of a long conversation, and the row's
 * job is to be found when a person wonders why the model no longer recalls
 * something above it.
 *
 * ---- Why there is nothing behind it ---------------------------------------
 *
 * The summary used to sit behind a disclosure on this row. It is the model's
 * working state — the text the harness folded the earlier turns into so the
 * next request fits the window — and a disclosure invited the reader into a
 * document that was never written for them, in the one place of the page
 * whose only job is to be read past. The row says what happened and how much
 * moved; the summary itself lives in the conversation's record, where the
 * things that read it live too. A row that is a statement rather than a
 * control: no tab stop, no chevron, no body.
 */
export const CompactionMarker = memo(function CompactionMarker({ item }: { item: CompactionItem }) {
  return (
    <div className="studio-message flex items-center gap-1.5 text-caption text-muted-foreground">
      <Icons.compaction size="sm" />
      <span>
        Conversation compacted
        {item.tokensBefore > 0 ? (
          <span className="text-muted-foreground/70">
            {' '}
            · {formatTokens(item.tokensBefore)} folded into a summary
          </span>
        ) : null}
      </span>
    </div>
  )
})
