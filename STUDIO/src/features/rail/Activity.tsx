import type { ReactNode } from 'react'
import { Icons } from '@/components/icons'
import { PlanPanel } from '@/features/plans/PlanPanel'
import { JobsPanel } from '@/features/jobs/JobsPanel'
import { ChangesPanel } from '@/features/changes/ChangesPanel'
import type { RecordedChange } from '@/features/changes/recordedChanges'
import { BrowserPanel } from './BrowserPanel'
import { AgentActivity } from './AgentActivity'
import { familyById } from '@/features/chat/transcript/live/reportFamily'
import { readableName } from '@/features/chat/transcript/live/toolResult'
import { hasPlan, sameView, useOverview, type Activity, type ActivityView, type BrowserActivity, type TurnChanges } from '@/stores/overview'
import type { AgentTask, BackgroundJob, PlanSnapshot } from '@/platform/harness'
import { cn } from '@/lib/cn'

/**
 * Overview's rows, and the one thing each opens.
 *
 * One list for both sizes of window: the docked column draws it as its first
 * page, and the compact window draws it in the sheet. It is the conversation's
 * record: what is going now, what each turn changed, and what has finished -
 * the plan, the agents, the commands - for as long as the harness reports it.
 */

export interface ActivityRow {
  readonly key: string
  readonly view: ActivityView
  readonly mark: ReactNode
  readonly title: string
  readonly detail: ReactNode
  readonly live: boolean
  readonly failed: boolean
  readonly group: 'now' | 'changes' | 'finished'
}

const AGENT_LIVE = new Set(['running', 'queued', 'waiting_for_user'])

export function agentLive(task: AgentTask): boolean {
  return AGENT_LIVE.has(task.status)
}

export function jobLive(job: BackgroundJob): boolean {
  return job.state === 'running' || job.state === 'stopping'
}

/** Every item has an outcome: nothing is waiting or running. */
export function planFinished(items: PlanSnapshot['items']): boolean {
  return items.length > 0 && items.every((item) => item.status === 'done' || item.status === 'cancelled' || item.status === 'failed')
}

export function agentStatus(task: AgentTask): string {
  if (task.status === 'running') return 'Running'
  if (task.status === 'queued') return 'Queued'
  if (task.status === 'waiting_for_user') return 'Waiting for you'
  if (task.status === 'cancelled') return 'Stopped'
  if (task.status === 'failed') return 'Failed'
  if (task.status === 'unknown') return 'Unknown'
  return 'Finished'
}

function jobStatus(job: BackgroundJob): string {
  if (job.state === 'running') return 'Running'
  if (job.state === 'stopping') return 'Stopping'
  if (job.state === 'stopped') return 'Stopped'
  if (job.state === 'failed') return 'Could not start'
  return job.exitCode === 0 ? 'Finished' : `Exited with ${String(job.exitCode)}`
}

/** What a set of changes amounts to, in lines. */
export interface Lines {
  readonly files: number
  readonly added: number
  readonly removed: number
}

export function linesOf(changes: readonly RecordedChange[]): Lines {
  return changes.reduce<Lines>(
    (total, change) => ({ files: total.files + 1, added: total.added + (change.diff?.added ?? 0), removed: total.removed + (change.diff?.removed ?? 0) }),
    { files: 0, added: 0, removed: 0 },
  )
}

/** "+11 -0", in the diff colours. */
export function LineCounts({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="inline-flex items-center gap-1 font-mono tabular-nums">
      <span className="text-diff-add">+{added}</span>
      <span className="text-diff-del">-{removed}</span>
    </span>
  )
}

export function filesChanged(files: number): string {
  return files === 1 ? '1 file changed' : `${String(files)} files changed`
}

export function turnTime(turn: TurnChanges): string {
  if (turn.at === null) return 'Earlier'
  const at = new Date(turn.at)
  return Number.isNaN(at.getTime()) ? 'Earlier' : at.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function activityRows(activity: Activity, browser: BrowserActivity | null): ActivityRow[] {
  const rows: ActivityRow[] = []
  if (hasPlan(activity) && activity.plan !== null) {
    const items = activity.plan.items
    const done = items.filter((item) => item.status === 'done').length
    const live = !planFinished(items)
    rows.push({
      key: 'plan', view: { kind: 'plan' }, mark: <Icons.plan />, title: 'Plan',
      detail: `${String(done)} of ${String(items.length)} done`, live, failed: false, group: live ? 'now' : 'finished',
    })
  }
  for (const agent of activity.agents) {
    const live = agentLive(agent)
    rows.push({
      key: `agent:${agent.id}`, view: { kind: 'agent', agentId: agent.id }, mark: <Icons.agents />, title: agent.title,
      detail: `${readableName(agent.agentName)} · ${agentStatus(agent)}`,
      live, failed: agent.status === 'failed', group: live ? 'now' : 'finished',
    })
  }
  for (const job of activity.jobs) {
    const live = jobLive(job)
    rows.push({
      key: `job:${job.id}`, view: { kind: 'jobs' }, mark: <Icons.backgroundJobs />, title: job.title ?? job.command,
      detail: job.title === null ? jobStatus(job) : `${jobStatus(job)} · ${job.command}`, live,
      failed: job.state === 'failed' || (job.state === 'exited' && job.exitCode !== 0), group: live ? 'now' : 'finished',
    })
  }
  if (browser !== null) {
    const family = familyById(browser.family)
    const last = browser.steps[browser.steps.length - 1]
    const live = browser.steps.some((step) => !step.settled)
    rows.push({
      key: 'browser', view: { kind: 'browser' }, mark: family.id === 'computer' ? <Icons.computerUse /> : <Icons.browserUse />,
      title: browser.title === null || browser.title === '' ? family.label : browser.title,
      detail: last === undefined ? family.nowhere : [last.verb, last.subject].filter(Boolean).join(' '),
      live, failed: false, group: live ? 'now' : 'finished',
    })
  }
  for (const turn of [...activity.turns].reverse()) {
    const lines = linesOf(turn.changes)
    rows.push({
      key: `changes:${turn.id}`, view: { kind: 'changes', turnId: turn.id }, mark: <Icons.edit />, title: filesChanged(lines.files),
      detail: <span className="inline-flex items-center gap-2">{turnTime(turn)}<LineCounts added={lines.added} removed={lines.removed} /></span>,
      live: false, failed: false, group: 'changes',
    })
  }
  return rows
}

const GROUPS: readonly { id: ActivityRow['group']; label: string }[] = [
  { id: 'now', label: 'Now' },
  { id: 'changes', label: 'Changes' },
  { id: 'finished', label: 'Finished' },
]

export function ActivityRowButton({ row, onPick, selected = false }: { row: ActivityRow; onPick: (view: ActivityView) => void; selected?: boolean }) {
  return (
    <button
      type="button"
      aria-current={selected ? 'true' : undefined}
      onClick={() => onPick(row.view)}
      className={cn(
        'flex w-full items-center gap-3 rounded-[14px] px-2.5 py-2 text-left transition-colors duration-fast hover:bg-tint',
        selected && 'bg-tint',
      )}
    >
      <span className="flex size-[var(--control-md)] shrink-0 items-center justify-center rounded-lg bg-surface-sunken text-muted-foreground">{row.mark}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-ui text-foreground">{row.title}</span>
        <span className={cn('truncate text-micro', row.failed ? 'text-danger' : 'text-muted-foreground', row.live && 'studio-shimmer')}>{row.detail}</span>
      </span>
    </button>
  )
}

/** The activity overview: what is going, what each turn changed, what finished. */
export function ActivityList({ rows, onPick, selected = null }: {
  rows: readonly ActivityRow[]
  onPick: (view: ActivityView) => void
  selected?: ActivityView | null
}) {
  if (rows.length === 0) return <p className="px-2.5 py-2 text-caption text-muted-foreground">No plan, agents, commands or file changes in this conversation yet.</p>
  return (
    <div className="flex flex-col gap-1">
      {GROUPS.map((group) => {
        const members = rows.filter((row) => row.group === group.id)
        if (members.length === 0) return null
        return (
          <section key={group.id} aria-label={group.label} className="flex flex-col">
            <h3 className="px-2.5 pb-1 pt-2 text-micro text-muted-foreground">{group.label}</h3>
            <ul className="flex flex-col">
              {members.map((row) => <li key={row.key}><ActivityRowButton row={row} onPick={onPick} selected={sameView(selected, row.view)} /></li>)}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

/** The name of one thing in Overview, for a header. */
export function viewTitle(view: ActivityView, activity: Activity, browser: BrowserActivity | null): string {
  if (view.kind === 'plan') return 'Plan'
  if (view.kind === 'jobs') return 'Commands'
  if (view.kind === 'browser') return browser === null ? 'Browser' : familyById(browser.family).label
  if (view.kind === 'changes') {
    const turn = activity.turns.find((item) => item.id === view.turnId)
    return turn === undefined ? 'Changes' : `Changes · ${turnTime(turn)}`
  }
  return activity.agents.find((agent) => agent.id === view.agentId)?.title ?? 'Agent'
}

/** One thing in Overview, looked at on its own. */
export function ActivityBody({ view, conversationId }: { view: ActivityView; conversationId: string }) {
  const { activity, browser } = useOverview()
  if (view.kind === 'plan') return <PlanPanel conversationId={conversationId} />
  if (view.kind === 'jobs') return <JobsPanel conversationId={conversationId} />
  if (view.kind === 'browser') {
    return browser === null
      ? <p className="text-caption text-muted-foreground">The browser has closed.</p>
      : <BrowserPanel entry={browser} />
  }
  if (view.kind === 'changes') {
    const turn = activity.turns.find((item) => item.id === view.turnId)
    return turn === undefined
      ? <p className="text-caption text-muted-foreground">These changes are no longer in the conversation.</p>
      : <ChangesPanel changes={turn.changes} conversationId={conversationId} />
  }
  const agent = activity.agents.find((item) => item.id === view.agentId)
  return agent === undefined
    ? <p className="text-caption text-muted-foreground">This agent is no longer reported.</p>
    : <AgentActivity task={agent} conversationId={conversationId} />
}
