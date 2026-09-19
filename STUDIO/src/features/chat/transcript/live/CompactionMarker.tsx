import { memo, useState } from 'react'
import { Icons } from '@/components/icons'
import { Markdown } from '@/features/chat/markdown/Markdown'
import { formatTokens } from '@/domain/turn/context'
import { DisclosureRow } from '@/features/chat/transcript/DisclosureRow'
import type { TranscriptItem } from '@/features/chat/transcript/projection'

type CompactionItem = Extract<TranscriptItem, { kind: 'compaction' }>

/**
 * Where the conversation was compacted.
 *
 * One line in the transcript's own quiet voice - "Conversation compacted ·
 * 172k" - standing where the cut happened, with the summary the model now
 * reads behind a disclosure. The messages above it are still on the page,
 * because they are still in the log; what changed is what the model
 * remembers, and this row is where that memory begins. It is not styled as
 * a failure or a warning: a compaction is the ordinary course of a long
 * conversation, and the row's job is to be found when a person wonders why
 * the model no longer recalls something above it.
 */
export const CompactionMarker = memo(function CompactionMarker({ item }: { item: CompactionItem }) {
  const [open, setOpen] = useState(false)
  return (
    <DisclosureRow
      className="studio-message"
      leading={<Icons.compaction size="sm" />}
      label={
        <span>
          Conversation compacted
          {item.tokensBefore > 0 ? (
            <span className="text-muted-foreground/70"> · {formatTokens(item.tokensBefore)} folded into a summary</span>
          ) : null}
        </span>
      }
      open={open}
      onToggle={() => setOpen((current) => !current)}
    >
      <div className="max-w-[72ch] text-caption text-muted-foreground">
        <Markdown text={item.summary} />
      </div>
    </DisclosureRow>
  )
})
