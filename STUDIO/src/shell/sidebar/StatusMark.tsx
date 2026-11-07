import { Icons } from '@/components/icons'
import { ActivityMark } from '@/shell/sidebar/ActivityMark'
import type { ConversationStatus } from '@/stores/status'

export const STATUS_LABELS: Readonly<Record<ConversationStatus, string>> = {
  running: 'Working',
  input: 'Needs your answer',
  done: 'Finished',
}

/**
 * A conversation's status, at the end of its row.
 *
 * Three shapes rather than one shape in three colours, so they can be told apart
 * at this size and without colour: a turning ring, a solid dot, a check.
 */
export function StatusMark({ status }: { status: ConversationStatus }) {
  if (status === 'running') return <ActivityMark />

  const label = STATUS_LABELS[status]
  return status === 'input' ? (
    <span role="img" aria-label={label} title={label} className="block size-2 shrink-0 rounded-full bg-accent" />
  ) : (
    <span role="img" aria-label={label} title={label} className="flex shrink-0 items-center text-muted-foreground">
      <Icons.check />
    </span>
  )
}
