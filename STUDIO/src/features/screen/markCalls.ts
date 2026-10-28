import { computerAction } from '@/features/chat/transcript/live/computerCall'
import type { TranscriptItem } from '@/features/chat/transcript/projection'
import { markCommandOf, type MarkCommand } from '@/domain/screen/marks'

/** Every answered mark call in the transcript, oldest first, by call id. */
export function markCalls(items: readonly TranscriptItem[]): readonly { readonly id: string; readonly command: MarkCommand }[] {
  const found: { id: string; command: MarkCommand }[] = []
  for (const item of items) {
    if (item.kind !== 'assistant') continue
    for (const segment of item.segments) {
      if (segment.kind !== 'tools') continue
      for (const group of segment.groups) {
        for (const call of group.calls) {
          if (computerAction(call.toolName) !== 'mark' || call.output === null || !call.output.present) continue
          const command = markCommandOf(call.output.value)
          if (command !== null) found.push({ id: call.toolCallId, command })
        }
      }
    }
  }
  return found
}

/**
 * The mark calls not yet shown, newest last. A set already past its expiry
 * is dropped here: reopening a conversation must not replay the marks of a
 * call that ended minutes ago.
 */
export function freshMarkCommands(
  items: readonly TranscriptItem[],
  shown: ReadonlySet<string>,
  now: number,
): readonly { readonly id: string; readonly command: MarkCommand }[] {
  return markCalls(items).filter(({ id, command }) =>
    !shown.has(id) && (command.kind === 'clear' || command.set.expiresAt > now))
}
