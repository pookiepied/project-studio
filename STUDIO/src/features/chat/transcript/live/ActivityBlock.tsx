import { useState } from 'react'
import { Icons } from '@/components/icons'
import { cn } from '@/lib/cn'
import { DisclosureRow } from '@/features/chat/transcript/DisclosureRow'
import { ThinkingBlock } from '@/features/chat/transcript/ThinkingBlock'
import type { AssistantSegment } from '@/features/chat/transcript/projection'
import { ToolGroups, activityLabel } from './ToolGroups'
import { resultState } from './toolResult'
import { activitySummary } from './activitySummary'

type WorkSegment = Exclude<AssistantSegment, { kind: 'text' }>

export type ActivitySection =
  | Extract<AssistantSegment, { kind: 'text' }>
  | { readonly kind: 'activity'; readonly id: string; readonly segments: readonly WorkSegment[] }

/** Visible words separate activity; reasoning stays at its original place inside it. */
export function activitySections(segments: readonly AssistantSegment[]): ActivitySection[] {
  const sections: ActivitySection[] = []
  for (const segment of segments) {
    if (segment.kind === 'text') {
      if (segment.text.trim() !== '') sections.push(segment)
      continue
    }
    const last = sections[sections.length - 1]
    if (last?.kind === 'activity') {
      sections[sections.length - 1] = { ...last, segments: [...last.segments, segment] }
    } else {
      sections.push({ kind: 'activity', id: segment.id, segments: [segment] })
    }
  }
  return sections
}

export function ActivityBlock({
  segments,
  active,
  conversationId,
}: {
  segments: readonly WorkSegment[]
  active: boolean
  conversationId: string
}) {
  const [open, setOpen] = useState(false)
  const calls = segments.flatMap((segment) => segment.kind === 'tools'
    ? segment.groups.flatMap((group) => group.calls) : [])
  const unanswered = calls.filter((call) => call.errorText === null && !call.output?.present)
  const failed = calls.filter((call) => resultState(call) === 'failed').length
  const current = unanswered[unanswered.length - 1]
  const label = active
    ? current === undefined ? 'Working' : activityLabel(current)
    : activitySummary(calls)

  // Pure reasoning still uses its existing disclosure, without an empty tools wrapper.
  if (calls.length === 0) return <>{segments.map((segment) => segment.kind === 'thinking'
    ? <ThinkingBlock key={segment.id} text={segment.text} span={{ since: segment.startedAt, until: segment.updatedAt }} live={active} />
    : null)}</>

  return (
    <DisclosureRow
      className="my-1 min-w-0"
      leading={<Icons.run />}
      open={open}
      onToggle={() => setOpen((value) => !value)}
      flush
      chevron="hover"
      label={
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className={cn('min-w-0 [overflow-wrap:anywhere]', active && 'studio-shimmer')}>{label}</span>
          {failed > 0 ? <>{' '}<span className="shrink-0 text-danger">Some tools failed</span></> : null}
          {!active && unanswered.length > 0 ? <>{' '}<span className="shrink-0">Unfinished</span></> : null}
        </span>
      }
    >
      <div role="region" aria-label="Tool activity" tabIndex={0} className="studio-scroll-bounded flex max-h-[32rem] min-w-0 flex-col gap-1 overflow-auto overscroll-contain">
        {segments.map((segment, index) => segment.kind === 'tools'
          ? <ToolGroups key={segment.id} groups={segment.groups} live={active} conversationId={conversationId} />
          : <ThinkingBlock key={segment.id} text={segment.text} span={{ since: segment.startedAt, until: segment.updatedAt }} live={active && index === segments.length - 1} />)}
      </div>
    </DisclosureRow>
  )
}
