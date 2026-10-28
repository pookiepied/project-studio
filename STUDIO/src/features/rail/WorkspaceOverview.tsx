import { memo, useEffect, useState } from 'react'
import { Icons } from '@/components/icons'
import { useRail, useWorkspaceTaskHistory, type RailEntry } from '@/stores/rail'
import type { WorkspaceTask } from './workspaceTasks'
import { familyById, familyOf } from '@/features/chat/transcript/live/reportFamily'
import { ToolGroups } from '@/features/chat/transcript/live/ToolGroups'
import { StreamedMarkdown } from '@/features/chat/streaming'
import { ChangesPanel } from '@/features/changes/ChangesPanel'
import { recordedChanges } from '@/features/changes/recordedChanges'
import { TasksSection } from '@/features/jobs/TasksSection'
import type { AgentTask } from '@/platform/harness'
import { GenericToolDetails } from '@/features/chat/transcript/live/ToolResultPanel'
import { readableName } from '@/features/chat/transcript/live/toolResult'
import { useAttachmentFrame } from '@/features/chat/useAttachmentFrame'
import { cn } from '@/lib/cn'
import { activityTitle } from './workspaceTasks'

export function entryTitle(entry: RailEntry): string {
  if (entry.kind === 'artifact') return entry.artifact.title
  if (entry.kind === 'jobs') return 'Background work'
  if (entry.kind === 'changes') return 'File changes'
  if (entry.kind === 'plan') return 'Execution plan'
  return familyById(entry.family).label
}

function BrowserThumbnail({ entry }: { entry: Extract<RailEntry, { kind: 'browser' }> }) {
  const source = useAttachmentFrame(entry.conversationId, entry.frame)
  return source ? <span className="relative mt-3 block overflow-hidden rounded-lg bg-surface-sunken"><img src={source} alt="Latest recorded frame" className="aspect-video w-full object-contain" /><span className="absolute right-2 bottom-2 rounded bg-surface/90 px-1.5 py-0.5 text-micro text-muted-foreground">Latest frame</span></span> : null
}

function TaskTime({ timestamp }: { timestamp: string }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])
  const started = Date.parse(timestamp)
  if (!Number.isFinite(started)) return null
  const minutes = Math.max(0, Math.floor((now - started) / 60_000))
  const label = minutes === 0 ? 'just now' : minutes < 60 ? `${minutes}m ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ago` : `${Math.floor(minutes / 1440)}d ago`
  return <time dateTime={timestamp} title={new Date(started).toLocaleString()} className="text-micro text-muted-foreground">{label}</time>
}

function TaskIcon({ task }: { task: WorkspaceTask }) {
  const last = task.calls[task.calls.length - 1]
  const family = last && familyOf(last.toolName)
  if (family?.id === 'browser') return <Icons.browserUse />
  if (family?.id === 'computer') return <Icons.computerUse />
  if (last?.toolName === 'task') return <Icons.branch />
  if (last?.toolName === 'plan') return <Icons.plan />
  if (last && ['shell', 'jobs'].includes(last.toolName)) return <Icons.backgroundJobs />
  if (last && ['read', 'glob', 'grep'].includes(last.toolName)) return <Icons.search />
  if (last && ['write', 'edit', 'move', 'delete'].includes(last.toolName)) return <Icons.edit />
  return last ? <Icons.tools /> : <Icons.agents />
}

const TaskRow = memo(function TaskRow({ task, onSelect }: { task: WorkspaceTask; onSelect: (id: string) => void }) {
  const settled = task.calls.filter((call) => call.output !== null || call.errorText !== null).length
  const live = task.status === 'running' || task.status === 'queued'
  return <li>
    <button type="button" aria-label={`${task.title} \u2014 ${task.status}`} onClick={() => onSelect(task.id)} className={cn('group flex w-full items-center gap-3 text-left transition-colors focus-visible:outline focus-visible:outline-2', live ? 'rounded-xl bg-surface px-3 py-3 shadow-sm hover:bg-tint' : 'rounded-lg px-2 py-2.5 hover:bg-tint')}>
      <span className={cn('relative flex shrink-0 items-center justify-center text-ui text-muted-foreground', live ? 'size-[var(--control-lg)] rounded-xl bg-surface-sunken' : 'size-[var(--control-md)]')}>
        <TaskIcon task={task} />
        {live && task.calls.length > 0 ? <svg role="progressbar" aria-label="Recorded execution progress" aria-valuemin={0} aria-valuemax={task.calls.length} aria-valuenow={settled} viewBox="0 0 40 40" className="absolute -inset-0.5 size-[calc(var(--control-lg)+4px)] -rotate-90 text-foreground/45">
          <circle cx="20" cy="20" r="18" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.15" />
          <circle cx="20" cy="20" r="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" pathLength="100" strokeDasharray={`${Math.round(settled / task.calls.length * 100)} 100`} />
        </svg> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-ui font-medium">{task.title}</span>
        <span className="mt-0.5 flex items-center gap-2 text-micro text-muted-foreground">
          <span>{task.calls.length === 0 ? 'Primary agent' : `${task.calls.length} ${task.calls.length === 1 ? 'step' : 'steps'}`}</span>
          {task.timestamp ? <><span aria-hidden className="size-0.5 rounded-full bg-current opacity-40" /><TaskTime timestamp={task.timestamp} /></> : null}
        </span>
        {live && task.calls.length > 1 ? <span aria-hidden className="mt-2.5 flex items-center gap-1 text-muted-foreground">{task.calls.slice(-5).map((call, index) => <span key={call.toolCallId} title={activityTitle([call])} className="flex items-center gap-1">
          {index > 0 ? <span className="h-px w-2 bg-foreground/10" /> : null}<span className="flex size-[var(--control-xs)] items-center justify-center rounded-md bg-surface-sunken"><TaskIcon task={{ ...task, calls: [call] }} /></span>
        </span>)}</span> : null}
      </span>
      <span className="flex shrink-0 items-center gap-1.5 text-micro text-muted-foreground" title={task.status}>
        {live ? <><span aria-hidden className="size-1 rounded-full bg-foreground/60" /><span className="capitalize">{task.status}</span></> : <><span className="sr-only">{task.status}</span>{task.status === 'completed' ? <Icons.check /> : task.status === 'failed' ? <Icons.failed /> : <Icons.stop />}</>}
      </span>
    </button>
  </li>
})

export function WorkspaceOverview({ onInspectAgent }: { onInspectAgent: (task: AgentTask) => void }) {
  const { entries, focus, conversationId } = useRail()
  const tasks = useWorkspaceTaskHistory()
  const [limit, setLimit] = useState(30)
  const active = tasks.filter((task) => task.status === 'running' || task.status === 'queued')
  const history = tasks.filter((task) => task.status !== 'running' && task.status !== 'queued').slice().reverse()
  return <div className="flex flex-col gap-5 pt-1">
    {active.length > 0 ? <section aria-label="Active tasks"><ul className="flex flex-col gap-2">{active.map((task) => <TaskRow key={task.id} task={task} onSelect={focus} />)}</ul></section> : null}
    {entries.length > 0 ? <section aria-label="Workspace resources"><ul className="grid grid-cols-2 gap-2">
      {entries.slice(-limit).reverse().map((entry) => <li key={entry.id} className={entry.kind === 'browser' && !entry.recorded ? 'col-span-2' : undefined}><button type="button" onClick={() => focus(entry.id)} className="group flex h-full w-full flex-col items-start gap-2.5 rounded-xl bg-surface/65 p-3 text-left text-ui transition-colors hover:bg-surface">
        <span className="flex size-[var(--control-md)] shrink-0 items-center justify-center rounded-lg bg-surface-sunken text-muted-foreground">{entry.kind === 'browser' ? entry.family === 'computer' ? <Icons.computerUse /> : <Icons.browserUse /> : entry.kind === 'plan' ? <Icons.plan /> : entry.kind === 'jobs' ? <Icons.backgroundJobs /> : <Icons.artifact />}</span>
        <span className="min-w-0 w-full flex-1"><span className="block break-words font-medium">{entryTitle(entry)}</span>
          {entry.kind === 'browser' ? <span className="block text-micro text-muted-foreground">{entry.steps.length} recorded actions</span> : null}
          {entry.kind === 'browser' && !entry.recorded && active.some((task) => task.calls.some((call) => familyOf(call.toolName)?.id === entry.family)) ? <BrowserThumbnail entry={entry} /> : null}
        </span>
      </button></li>)}
    </ul>{entries.length > limit ? <button type="button" onClick={() => setLimit((value) => value + 30)} className="py-2 text-caption">Show more resources</button> : null}</section> : null}
    {conversationId ? <TasksSection key={conversationId} conversationId={conversationId} onInspect={onInspectAgent} /> : null}
    {history.length > 0 ? <section aria-label="Task history">
      <p className="flex items-center gap-2 px-2 pb-2 text-micro text-muted-foreground"><span>History</span><span className="rounded bg-tint px-1.5 tabular-nums">{history.length}</span><span aria-hidden className="h-px flex-1 bg-foreground/5" /></p>
      <ul>{history.slice(0, limit).map((task) => <TaskRow key={task.id} task={task} onSelect={focus} />)}</ul>
      {history.length > limit ? <button type="button" onClick={() => setLimit((value) => value + 30)} className="w-full py-2 text-caption text-muted-foreground hover:text-foreground">Show 30 more</button> : null}
    </section> : null}
    {tasks.length === 0 && entries.length === 0 ? <p className="px-2 text-caption text-muted-foreground">Conversation activity will appear here.</p> : null}
  </div>
}

export function WorkspaceTaskDetail({ task, worker = false }: { task: WorkspaceTask; worker?: boolean }) {
  const changes = recordedChanges(task.calls)
  return <div className="flex min-w-0 flex-col gap-4">
    <div className="text-micro text-muted-foreground"><span className="capitalize">{task.status}</span> / {worker ? 'Delegated agent' : 'Primary agent'}
      {task.timestamp ? <time className="block" dateTime={task.timestamp}>{new Date(task.timestamp).toLocaleString()}</time> : null}
      {task.messages.some((message) => message.usage?.totalTokens !== null && message.usage?.totalTokens !== undefined) ? <p>{task.messages.reduce((total, message) => total + (message.usage?.totalTokens ?? 0), 0).toLocaleString()} reported tokens</p> : null}
    </div>
    {task.status === 'queued' ? <p className="text-caption text-muted-foreground">Waiting for the current response. Queue controls are available below the conversation.</p> : null}
    {task.failureReason ? <p className="text-caption text-danger">{task.failureReason}</p> : null}
    {changes.length > 0 ? <details><summary className="cursor-pointer text-caption">Review {changes.length} changed files</summary><ChangesPanel changes={changes} conversationId={task.conversationId} /></details> : null}
    {task.messages.map((message) => <div key={message.id} className="flex min-w-0 flex-col gap-3">
      {message.segments.map((segment) => segment.kind === 'tools'
        ? worker ? <div key={segment.id}>{segment.groups.flatMap((group) => group.calls).map((call) => <details key={call.toolCallId}><summary className="cursor-pointer py-1 text-caption">{readableName(call.toolName)}</summary><GenericToolDetails call={call} live={task.status === 'running'} /></details>)}</div>
          : <ToolGroups key={segment.id} groups={segment.groups} live={task.status === 'running'} conversationId={task.conversationId} />
        : segment.kind === 'text' ? <div key={segment.id} className="studio-prose"><StreamedMarkdown text={segment.text} streaming={task.status === 'running'} /></div>
        : <details key={segment.id}><summary className="cursor-pointer text-caption text-muted-foreground">Recorded reasoning</summary><div className="studio-prose"><StreamedMarkdown text={segment.text} streaming={false} /></div></details>)}
      {message.end.state === 'failed' || message.end.state === 'aborted' ? <p className="text-caption text-danger">{message.end.reason ?? 'No further diagnostic information was recorded.'}</p> : null}
    </div>)}
  </div>
}
