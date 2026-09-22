/**
 * A projection from a history snapshot: the same walk the live turn takes,
 * over the parts the snapshot already holds, so a replay builds the same ids
 * the live turn grew.
 */

import { isRecord } from '@/lib/guards'
import type { ConversationMessageFacts, ConversationSnapshotFacts } from '@/platform/harness'
import type {
  AssistantSegment,
  ToolGroupView,
  TranscriptItem,
  UserAttachmentView,
  UserDocumentView,
} from './shapes'
import { emptyAssistant } from './segments'
import { fileOf, pushCall, readPathOf } from './rows'
import { settleSubmissionFailure } from './settlement'

/**
 * Builds items from a whole materialized conversation — the history view's
 * answer, or a reset chunk's identical payload. Replaces everything: a
 * snapshot IS the state, not a patch on it.
 *
 * Consecutive parts of a kind share a segment, so the shape a live turn
 * grew into is the shape a snapshot replays into. A message is complete
 * only when none of its parts says `streaming`; a call whose part never got
 * past `input-available` stays visibly pending.
 */
export function seededFrom(snapshot: ConversationSnapshotFacts): TranscriptItem[] {
  const items: TranscriptItem[] = []

  for (const message of snapshot.messages) {
    // 2.0 records runtime advisories (an aborted or interrupted submission's
    // terminal marker, the recovery signals around a materialized partial
    // stream) as `system` messages. They are diagnostics, not chat: the
    // failure a person needs is already carried by the settlement below,
    // which renders as the `submission-failed` card. The reader accepts the
    // role only so a stop control press does not make the whole snapshot
    // unparseable; nothing system-shaped becomes a transcript item - with
    // one exception that is not an item either: the documents signal, which
    // the harness appends right after the user message that brought the
    // files, becomes that message's chips.
    if (message.role === 'system') {
      attachDocuments(items, message)
      continue
    }
    if (message.role === 'user') {
      const texts: string[] = []
      const attachments: UserAttachmentView[] = []
      for (const part of message.parts) {
        if (part.kind === 'text') texts.push(part.text)
        else if (part.kind === 'file')
          attachments.push({ mediaType: part.mediaType, filename: part.filename, size: part.size })
      }
      items.push({
        kind: 'user',
        id: message.id,
        submissionId: message.submissionId,
        text: texts.join('\n\n'),
        attachments,
        documents: [],
        timestamp: message.timestamp,
      })
      continue
    }

    const base = emptyAssistant(message)
    const segments: AssistantSegment[] = []
    let textRuns = 0
    let thinkingRuns = 0
    // The live walk's memory, mirrored part for part: the file run this
    // message still has open, and where its row lives.
    let openFileRun: { segmentIndex: number; groupIndex: number; file: string } | null = null

    for (const part of message.parts) {
      if (part.kind === 'text') {
        segments.push({
          kind: 'text',
          id: `${message.id}#text-${textRuns}`,
          text: part.text,
        })
        textRuns += 1
      } else if (part.kind === 'reasoning') {
        segments.push({
          kind: 'thinking',
          id: `${message.id}#think-${thinkingRuns}`,
          text: part.text,
          // A snapshot is history. Nobody here watched these words arrive,
          // and the wire stores no span for them, so none is claimed.
          startedAt: null,
          updatedAt: null,
        })
        thinkingRuns += 1
        // Thinking is the one sentence that closes a file run: the events on
        // either side of it happened apart, and the replay must say so.
        openFileRun = null
      } else if (part.kind === 'tool') {
        // The live walk's rules, mirrored exactly, so ids and shapes match a
        // replay to the character: a mutating call continues the open run
        // wherever its row sits -- written narration may have fallen since --
        // and a read of the run's own file keeps it; everything else closed
        // it on arrival and opens a row at the end of the story.
        const input = part.input ?? null
        const file = fileOf(part.toolName, input)
        if (file !== null && openFileRun !== null && file === openFileRun.file) {
          const home = segments[openFileRun.segmentIndex]
          if (home !== undefined && home.kind === 'tools') {
            const group = home.groups[openFileRun.groupIndex]
            if (group !== undefined) {
              const merged: ToolGroupView = {
                ...group,
                calls: [
                  ...group.calls,
                  {
                    toolCallId: part.toolCallId,
                    toolName: part.toolName,
                    input,
                    output: part.output ?? null,
                    errorText: part.errorText ?? null,
                  },
                ],
              }
              const groups = [...home.groups]
              groups[openFileRun.groupIndex] = merged
              segments[openFileRun.segmentIndex] = { ...home, groups }
              continue
            }
          }
        }
        if (file === null) {
          const path = readPathOf(part.toolName, input)
          const transparent = openFileRun !== null && path !== null && path === openFileRun.file
          if (!transparent) openFileRun = null
        } else {
          openFileRun = null
        }
        const last = segments[segments.length - 1]
        const existing = last !== undefined && last.kind === 'tools' ? last : undefined
        const segment =
          existing ??
          ({ kind: 'tools', id: `${message.id}#tools-${segments.length}`, groups: [] } as const)
        const pushed = pushCall(segment.groups, segment.id, {
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          input,
          output: part.output ?? null,
          errorText: part.errorText ?? null,
        })
        const nextSegment = { ...segment, groups: pushed.rows }
        if (existing !== undefined) {
          segments[segments.length - 1] = nextSegment
        } else {
          segments.push(nextSegment)
        }
        const opened = pushed.rows[pushed.row]
        if (opened !== undefined && opened.file !== null) {
          openFileRun = {
            segmentIndex: segments.length - 1,
            groupIndex: pushed.row,
            file: opened.file,
          }
        }
      }
    }

    const stillWriting = message.parts.some(
      (part) =>
        (part.kind === 'text' || part.kind === 'reasoning') && part.state === 'streaming',
    )
    items.push({
      ...base,
      segments,
      end: stillWriting ? { state: 'stopped' } : { state: 'complete' },
    })
  }

  // Settlements are facts about how submissions ended, and history carries
  // them precisely so a cold start knows what a crash knew. The live rule —
  // open tail takes the outcome, finished work stays finished, empty retry
  // attempts withdraw — applies here through the same function.
  //
  // A submission's records are recognised two ways: 2.0 stamps
  // `submissionId` on a snapshot's assistant messages (measured on a live
  // harness), so matching by id finds them; the position fallback - the
  // assistant messages between THIS settlement's user message and the next
  // one - stands for records that predate the stamp, and is what rescued the
  // cold start that once rendered four empty complete bubbles.
  for (const settlement of snapshot.settlements) {
    if (settlement.outcome === 'completed') continue

    let turnStart = -1
    let turnEnd = items.length
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index]
      if (item === undefined) continue
      if (turnStart === -1) {
        if (item.kind === 'user' && item.submissionId === settlement.submissionId) {
          turnStart = index
        }
        continue
      }
      if (item.kind === 'user') {
        turnEnd = index
        break
      }
    }

    const submissionId = settlement.submissionId
    const outcome = settlement.outcome
    settleSubmissionFailure(
      items,
      submissionId,
      (item, index) =>
        item.submissionId === submissionId ||
        (turnStart !== -1 && index > turnStart && index < turnEnd),
      outcome,
      settlement.error.message,
    )
  }

  // A compaction marker stands after the projected message it followed, or
  // at the top when it followed none. The messages above it stay: the log
  // is still the log, and the marker says where the model's memory begins.
  for (const compaction of snapshot.compactions) {
    const marker: TranscriptItem = {
      kind: 'compaction',
      id: compaction.id,
      summary: compaction.summary,
      tokensBefore: compaction.tokensBefore,
      timestamp: compaction.timestamp,
    }
    const anchor =
      compaction.afterMessageId === null
        ? -1
        : items.findIndex((item) => item.id === compaction.afterMessageId)
    items.splice(anchor + 1, 0, marker)
  }

  return items
}

/** The tag the harness gives the signal that names a message's documents. */
const DOCUMENTS_SIGNAL = 'attached_documents'

/**
 * The documents a signal names, read from its `documents` attribute - a
 * JSON list the harness wrote for exactly this reader. Anything that is not
 * that shape reads as no documents: the model still got its note, and a
 * chip nobody can trust is worse than none.
 */
export function documentsOfSignal(message: ConversationMessageFacts): readonly UserDocumentView[] {
  if (message.role !== 'system' || message.signal?.tagName !== DOCUMENTS_SIGNAL) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(message.signal.attributes['documents'] ?? '')
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const documents: UserDocumentView[] = []
  for (const entry of parsed) {
    if (!isRecord(entry)) continue
    const id = entry['id']
    const fileName = entry['fileName']
    const mimeType = entry['mimeType']
    const byteLength = entry['byteLength']
    const pageCount = entry['pageCount']
    const unit = entry['unit']
    if (typeof id !== 'string' || typeof fileName !== 'string' || typeof mimeType !== 'string') continue
    if (typeof byteLength !== 'number' || typeof pageCount !== 'number') continue
    documents.push({
      id,
      fileName,
      mimeType,
      byteLength,
      pageCount,
      unit: unit === 'slide' || unit === 'sheet' ? unit : 'page',
    })
  }
  return documents
}

/**
 * Puts a documents signal's files on the last user message before it, in
 * place. The signal follows the message it belongs to - the harness appends
 * it when that message's response starts - so the last user item is the
 * right one; with no user item yet there is nothing to hang them on.
 */
export function attachDocuments(items: TranscriptItem[], message: ConversationMessageFacts): void {
  const documents = documentsOfSignal(message)
  if (documents.length === 0) return
  for (let at = items.length - 1; at >= 0; at -= 1) {
    const item = items[at]
    if (item?.kind !== 'user') continue
    items[at] = { ...item, documents: [...item.documents, ...documents] }
    return
  }
}
