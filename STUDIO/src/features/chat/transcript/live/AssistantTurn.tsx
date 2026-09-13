import { memo, useState } from 'react'
import { Icons } from '@/components/icons'
import { StreamedMarkdown, useSmoothText } from '@/features/chat/streaming'
import { ReadAloud } from '@/features/voice/ReadAloud'
import {
  classifyFailureKind,
  failureRemedy,
} from '@/domain/failures/failure-kind'
import { MessageActions } from '@/features/chat/transcript/MessageActions'
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
 * finished. The one message that line is withheld from is the one still
 * being written, which has not reached an ending to report; see `live`.
 *
 * The text reveal is paced by `useSmoothText`, exactly as the demo surface
 * does it; only the last segment of the last unfinished message is live, so
 * nothing above the caret ever re-renders per frame.
 *
 * ---- The action row -------------------------------------------------------
 *
 * The one row the gallery's replies carry, and the same three verbs: copy,
 * branch from here, read aloud — no retry, on purpose (redoing a turn that
 * touched a workspace is the person's call through their own tooling, not a
 * button), and no model name, because the transcript names its model nowhere
 * by design. Revealed on hover, always mounted so nothing jumps when it fades
 * in, and withheld from the message still being written — an unfinished
 * answer is not yet a thing to act on.
 */
export const AssistantTurn = memo(function AssistantTurn({
  item,
  live,
  conversationId,
  turnInFlight = false,
  onBranch,
}: {
  item: Extract<TranscriptItem, { kind: 'assistant' }>
  /**
   * This message is the one being written right now: the newest, unfinished,
   * with its turn producing. Not merely "a turn is running" — a turn that has
   * been admitted and has produced nothing is not writing this message, and
   * the caret and the ending below both depend on the narrower reading.
   */
  live: boolean
  /** The conversation the tool calls ran in, which keys their attachments. */
  conversationId: string
  /**
   * The submission this message belongs to is still in flight. A message can
   * be complete while its run is not — parked on a question the person has
   * not answered, a permission the kernel wants, more content still owed —
   * and the action row must not surface in that window: copy under a run
   * still owing its next word offers an answer that has not finished
   * arriving, and the row below the tools read as stray furniture exactly
   * there. Settles with the submission, so everything said before it keeps
   * its verbs.
   */
  turnInFlight?: boolean
  /** Forks the conversation with everything up to and including this answer. */
  onBranch?: (messageId: string) => void
}) {
  const [hovered, setHovered] = useState(false)
  const written = writtenRuns(item)
  // Only the final text run may pace its reveal. Everything else — history
  // replayed at a reattach, earlier runs of this same message — must be on
  // the page the moment it arrives; a transcript that retypes itself is
  // telling the reader a story about timing that never happened.
  const lastIndex = item.segments.length - 1
  return (
    <div
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      className="studio-message flex min-w-0 flex-col"
    >
      {item.segments.map((segment, index) => (
        <Segment
          key={segment.id}
          segment={segment}
          growing={live && index === lastIndex && segment.kind === 'text'}
          live={live}
          conversationId={conversationId}
        />
      ))}
      {/* An ending is reported once there is one to report.
          `end` is `stopped` from `message-started` until `message-completed`
          arrives, and that default is right: how a message ended comes from
          the log, never from silence, and a message with no completion fact
          has not completed. What was wrong was rendering the CONCLUSION while
          the message has not reached its ending yet — every live reply
          carried a stop icon and "Stopped before finishing" underneath the
          text it was still writing. `live` is the seam because it is exactly
          the parent's judgement that this message is the one being written
          right now (phase `streaming`, newest, unfinished). `stopped` is
          named rather than implied: a failed or an aborted ending is a fact
          the log carried, and no reading of "live" may swallow one. */}
      {live && item.end.state === 'stopped' ? null : <EndLine end={item.end} />}
      <MessageActions
        visible={hovered && !live && !turnInFlight}
        copyPayload={written}
        actions={
          onBranch === undefined
            ? []
            : [{ id: 'branch', label: 'Branch from here', icon: Icons.fork, run: () => onBranch(item.id) }]
        }
        after={written.trim() === '' ? null : <ReadAloud text={written} />}
      />
    </div>
  )
})

/** The turn's written runs in wire order — what copy and the voice both carry. */
function writtenRuns(item: Extract<TranscriptItem, { kind: 'assistant' }>): string {
  return item.segments
    .filter((segment) => segment.kind === 'text')
    .map((segment) => segment.text)
    .join('\n\n')
}

function Segment({
  segment,
  growing,
  live,
  conversationId,
}: {
  segment: AssistantSegment
  growing: boolean
  live: boolean
  conversationId: string
}) {
  switch (segment.kind) {
    case 'thinking':
      // Collapsed by default, positioned where it occurred. The duration is
      // the REASONING's own span — first of this run's deltas to last — and
      // not the wait in front of it. The silence before a model produces
      // anything is partly the provider's latency and partly hidden thinking
      // nobody here can see, and counting it as reasoning was what made the
      // number mean nothing. Nothing owns that silence now: the transcript
      // draws no row until this run exists.
      return (
        <ThinkingBlock
          text={segment.text}
          span={{ since: segment.startedAt, until: segment.updatedAt }}
          live={live}
        />
      )
    case 'text':
      return <TextSegment segment={segment} growing={growing} />
    case 'tools':
      return (
        <ToolGroups groups={segment.groups} live={live} conversationId={conversationId} />
      )
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
          <copy.icon size="sm" className="text-danger" />
        ) : (
          <copy.icon size="sm" />
        )}
        <span>{copy.text}</span>
      </div>
      {reason !== null ? (
        // Under the row's label, not its mark: the inset is the row's own
        // arithmetic (one `sm` mark across, plus its gap), stated once as
        // `--row-label-inset` rather than restated here.
        <p className="max-w-[60ch] break-words pl-(--row-label-inset) text-caption text-muted-foreground/80">
          {reason}
        </p>
      ) : null}
      {remedy !== null ? (
        <p className="max-w-[60ch] break-words pl-(--row-label-inset) text-caption text-muted-foreground/80">
          {remedy}
        </p>
      ) : null}
    </div>
  )
}
