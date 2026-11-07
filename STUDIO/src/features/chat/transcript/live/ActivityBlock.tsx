import { useState } from 'react'
import { useArriving } from '@/components/motion/Arrive'
import { Tooltip } from '@/components/primitives'
import { cn } from '@/lib/cn'
import { DisclosureRow } from '@/features/chat/transcript/DisclosureRow'
import { ThinkingBlock } from '@/features/chat/transcript/ThinkingBlock'
import type { AssistantSegment, ToolCallView, ToolGroupView } from '@/features/chat/transcript/projection'
import { ToolGroups, activityLabel } from './ToolGroups'
import { activityState } from './activitySummary'
import { familyOf } from './reportFamily'
import { webKind } from './webCall'
import { mediaKind } from './mediaCall'
import { toolPresentation } from './toolPresentation'
import { ROW_GAP_CLASS, ROW_GAP_MARGIN } from './rowGap'

type WorkSegment = Exclude<AssistantSegment, { kind: 'text' }>

export type ActivitySection =
  | Extract<AssistantSegment, { kind: 'text' }>
  | { readonly kind: 'artifact'; readonly id: string; readonly call: ToolCallView }
  | { readonly kind: 'activity'; readonly id: string; readonly segments: readonly WorkSegment[] }

/** Visible words and standalone artifacts separate activity in execution order. */
export function activitySections(segments: readonly AssistantSegment[]): ActivitySection[] {
  const sections: ActivitySection[] = []
  for (const segment of segments) {
    if (segment.kind === 'text') {
      if (segment.text.trim() !== '') sections.push(segment)
      continue
    }
    const append = (work: WorkSegment) => {
      const last = sections[sections.length - 1]
      if (last?.kind === 'activity') {
        sections[sections.length - 1] = { ...last, segments: [...last.segments, work] }
      } else {
        sections.push({ kind: 'activity', id: work.id, segments: [work] })
      }
    }
    if (segment.kind !== 'tools' || !segment.groups.some((group) =>
      group.calls.some((call) => {
        const presentation = toolPresentation(call.toolName)
        return presentation.artifact !== null || presentation.activity === 'none'
      }))) {
      append(segment)
      continue
    }
    let buffered: ToolGroupView[] = []
    let id = segment.id
    let afterArtifact = false
    const flush = () => {
      if (buffered.length > 0) append({ ...segment, id, groups: buffered })
      buffered = []
    }
    for (const group of segment.groups) {
      for (const call of group.calls) {
        const presentation = toolPresentation(call.toolName)
        if (presentation.activity !== 'none') {
          if (buffered.length === 0 && afterArtifact) id = call.toolCallId
          const last = buffered[buffered.length - 1]
          if (last?.id === group.id) buffered[buffered.length - 1] = { ...last, calls: [...last.calls, call] }
          else buffered.push({ ...group, calls: [call] })
        }
        if (presentation.artifact !== null) {
          flush()
          sections.push({ kind: 'artifact', id: call.toolCallId, call })
          afterArtifact = true
        }
      }
    }
    flush()
  }
  return sections
}

export function ActivityBlock({
  segments,
  active,
  conversationId,
  textBefore = false,
  textAfter = false,
  rowBefore = false,
}: {
  segments: readonly WorkSegment[]
  active: boolean
  conversationId: string
  /** Only boundaries with visible prose need separation. */
  textBefore?: boolean
  textAfter?: boolean
  /** Another row stands directly above; see `rowGap.ts`. */
  rowBefore?: boolean
}) {
  const [open, setOpen] = useState(false)
  const arriving = useArriving()
  const calls = segments.flatMap((segment) => segment.kind === 'tools'
    ? segment.groups.flatMap((group) => group.calls) : [])
  const state = activityState(calls, active)
  const current = state.current
  const label = current === undefined ? state.summary
    : familyOf(current.toolName) !== null || webKind(current.toolName) !== null || mediaKind(current.toolName) !== null
      ? state.running : activityLabel(current)

  // Pure reasoning still uses its existing disclosure, without an empty tools
  // wrapper - and the same margins against words that the tool disclosure
  // takes, so a thought between two paragraphs is not set flush against the
  // one above it. It used to be, unseen, because a thought rarely stood alone
  // between words; once a question call left the activity block for its own
  // slot, every thought before a question did.
  //
  // Between two rows it takes the one row gap and nothing else. It used to
  // keep a bottom margin of its own, and a question row beside it had none, so
  // a thought above a question stood apart while a question above a thought
  // sat tight - the gap depended on which kind came first.
  if (calls.length === 0) return (
    <div className={cn('flex min-w-0 flex-col', ROW_GAP_CLASS, textBefore && 'mt-4', textAfter && 'mb-4', rowBefore && ROW_GAP_MARGIN)}>
      {segments.map((segment) => segment.kind === 'thinking'
        ? <ThinkingBlock key={segment.id} text={segment.text} span={{ since: segment.startedAt, until: segment.updatedAt }} live={active} />
        : null)}
    </div>
  )

  return (
    <DisclosureRow
      className={cn('min-w-0', textBefore && 'mt-4', textAfter && 'mb-4', rowBefore && ROW_GAP_MARGIN)}
      entering={arriving}
      leading={<state.mark />}
      open={open}
      onToggle={() => setOpen((value) => !value)}
      flush
      chevron="hover"
      label={
        <span className="flex min-w-0 items-center gap-2">
          {/* One line at any length: a running command is the label here, and a
              wrapped one pushes the whole list down and back as it changes. */}
          <Tooltip label={label ?? ''} overflowOnly className="min-w-0"><span className={cn('min-w-0 truncate', active && 'studio-shimmer')}>{label}</span></Tooltip>
          {state.failed > 0 ? <>{' '}<span className="shrink-0 text-danger">Some tools failed</span></> : null}
          {state.unfinished ? <>{' '}<span className="shrink-0">Unfinished</span></> : null}
        </span>
      }
    >
      {/* One gap between any two rows, whichever kinds they are, and the same from
          the title to the first row: 8px with the disclosure's own 6px plus this
          2px. The rows carry no outer margins, because a margin on one kind of
          row makes the gap depend on which row came first. `ToolGroups` repeats
          this gap for the rows inside it. */}
      <div role="region" aria-label="Tool activity" className={cn('flex min-w-0 flex-col pt-0.5', ROW_GAP_CLASS)}>
        {segments.map((segment, index) => segment.kind === 'tools'
          ? <ToolGroups key={segment.id} groups={segment.groups} live={active} conversationId={conversationId} />
          : <ThinkingBlock key={segment.id} text={segment.text} span={{ since: segment.startedAt, until: segment.updatedAt }} live={active && index === segments.length - 1} />)}
      </div>
    </DisclosureRow>
  )
}
