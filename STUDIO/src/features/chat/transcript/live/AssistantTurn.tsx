import { Icons } from '@/components/icons'
import { StreamedMarkdown, useSmoothText } from '@/features/chat/streaming'
import {
  classifyFailureKind,
  failureRemedy,
} from '@/features/chat/transcript/failure-kind'
import { ThinkingBlock } from '@/features/chat/transcript/ThinkingBlock'
import { ToolGroups } from '@/features/chat/transcript/live/ToolGroups'
import type {
  AssistantSegment,
  MessageEnd,
  TranscriptItem,
} from '@/features/chat/transcript/projection'

/**
 * One assistant message of the live conversation, segments in wire order.
 *
 * The rule that outranks everything here: **how the message ended comes from
 * the log, never from silence.** A message with no completion fact renders
 * unfinished — a quiet "stopped" line under it — whatever stopped it: an
 * abort, a crash, a provider that gave up mid-sentence. Only
 * `message-completed` (or a snapshot's own `done` states) lets it read as
 * finished.
 *
 * The text reveal is paced by `useSmoothText`, exactly as the demo surface
 * does it; only the last segment of the last unfinished message is live, so
 * nothing above the caret ever re-renders per frame.
 */
export function AssistantTurn({
  item,
  live,
}: {
  item: Extract<TranscriptItem, { kind: 'assistant' }>
  /** This message is the newest one and its turn has not settled yet. */
  live: boolean
}) {
  // Only the final text run may pace its reveal. Everything else — history
  // replayed at a reattach, earlier runs of this same message — must be on
  // the page the moment it arrives; a transcript that retypes itself is
  // telling the reader a story about timing that never happened.
  const lastIndex = item.segments.length - 1
  return (
    <div className="flex min-w-0 flex-col">
      {item.segments.map((segment, index) => (
        <Segment
          key={segment.id}
          segment={segment}
          growing={live && index === lastIndex && segment.kind === 'text'}
          live={live}
        />
      ))}
      <EndLine end={item.end} />
    </div>
  )
}

function Segment({
  segment,
  growing,
  live,
}: {
  segment: AssistantSegment
  growing: boolean
  live: boolean
}) {
  switch (segment.kind) {
    case 'thinking':
      // Collapsed by default, positioned where it occurred. No duration is
      // carried per segment on the wire, so none is claimed.
      return <ThinkingBlock thinking={{ text: segment.text, seconds: null }} live={live} />
    case 'text':
      return <TextSegment segment={segment} growing={growing} />
    case 'tools':
      return <ToolGroups groups={segment.groups} />
  }
}

/**
 * One written run, revealed smoothly while it is the one being written.
 *
 * Whether this specific run is still growing is not decidable locally —
 * growth is "a newer delta kept landing in this run", which only the parent
 * knows by position — so every text run of a live turn paces its own tail,
 * and `useSmoothText` settles instantly once the text stops changing.
 */
function TextSegment({
  segment,
  growing,
}: {
  segment: Extract<AssistantSegment, { kind: 'text' }>
  /** This run is the one the turn is currently writing. */
  growing: boolean
}) {
  const shown = useSmoothText(segment.text, growing)
  const revealing = shown.length < segment.text.length

  return (
    <div className="studio-prose min-w-0">
      <StreamedMarkdown text={shown} streaming={growing || revealing} />
      {growing || revealing ? (
        <span
          aria-hidden
          className="ml-0.5 inline-block h-[0.95em] w-[2px] translate-y-[0.15em] animate-pulse rounded-full bg-foreground/70 align-baseline"
        />
      ) : null}
    </div>
  )
}

/**
 * The honest ending. Complete says nothing at all — a finished reply needs
 * no footnote about having finished. Everything else names what happened,
 * because a turn that died must never be mistaken for one that landed. The
 * settlement's own sentence rides under a failed or aborted line when the
 * wire carried one; when it did not, nothing is invented — the outcome
 * alone is the fact.
 */
function EndLine({ end }: { end: MessageEnd }) {
  if (end.state === 'complete') return null
  const copy = {
    stopped: { text: 'Stopped before finishing', icon: Icons.stop },
    failed: { text: 'This turn failed', icon: Icons.failed },
    aborted: { text: 'Aborted', icon: Icons.stop },
  }[end.state]
  const reason = end.state === 'stopped' ? null : end.reason
  // A provider failure gets the remedy line when its sentence names one; an
  // abort is the person's own act and needs no advice appended to it.
  const remedy = end.state === 'failed' ? failureRemedy(classifyFailureKind(reason)) : null
  return (
    <div className="mt-1 flex flex-col items-start gap-0.5">
      <div className="inline-flex items-center gap-1.5 text-caption text-muted-foreground">
        {end.state === 'failed' ? (
          <copy.icon size="sm" className="text-destructive" />
        ) : (
          <copy.icon size="sm" />
        )}
        <span>{copy.text}</span>
      </div>
      {reason !== null ? (
        <p className="max-w-[60ch] break-words pl-[calc(0.375rem+0.875rem)] text-caption text-muted-foreground/80">
          {reason}
        </p>
      ) : null}
      {remedy !== null ? (
        <p className="max-w-[60ch] break-words pl-[calc(0.375rem+0.875rem)] text-caption text-muted-foreground/80">
          {remedy}
        </p>
      ) : null}
    </div>
  )
}
