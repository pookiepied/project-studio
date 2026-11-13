import { useEffect, useState } from 'react'
import { OverviewProvider, useOverview } from '@/stores/overview'
import { WorkspaceProvider } from '@/stores/workspace'
import { OverviewPanel } from '@/features/rail/OverviewPanel'
import { WorkSurface, type PillPhase } from '@/features/rail/WorkPill'
import type { AgentTask, BackgroundJob, PlanSnapshot } from '@/platform/harness'
import type { RecordedChange } from '@/features/changes/recordedChanges'
import type { TurnChanges } from '@/stores/overview'
import { ActivityMark } from '@/shell/sidebar/ActivityMark'
import { Section } from './Section'

const now = Date.now()
const plan: PlanSnapshot = {
  conversationId: 'workspace-specimen',
  damaged: false,
  items: [
    { id: 'p1', text: 'Scope the workspace to the conversation', status: 'done', position: 1 },
    { id: 'p2', text: 'Move viewers into the sheet', status: 'done', position: 2 },
    { id: 'p3', text: 'Draw the activity list', status: 'running', position: 3 },
    { id: 'p4', text: 'Check it in the compact window', status: 'pending', position: 4 },
  ] as unknown as PlanSnapshot['items'],
}
const agents: AgentTask[] = [
  { id: 'reviewer', agentName: 'reviewer', parentConversationId: 'workspace-specimen', title: 'Review the rail store', status: 'running', createdAt: now - 90_000, settledAt: null, resultSummary: null },
  { id: 'titler', agentName: 'titler', parentConversationId: 'workspace-specimen', title: 'Name the conversation', status: 'completed', createdAt: now - 600_000, settledAt: now - 598_000, resultSummary: 'Workspace scope fix' },
]
const jobs: BackgroundJob[] = [
  { id: 'tests', title: 'Studio client tests', command: 'pnpm test', state: 'running', exitCode: null, startedAt: now - 120_000, endedAt: null, output: '', dropped: 0 },
  { id: 'lint', title: 'Studio client lint', command: 'pnpm lint', state: 'exited', exitCode: 0, startedAt: now - 300_000, endedAt: now - 280_000, output: '', dropped: 0 },
]

const edited = (path: string, added: number, removed: number): RecordedChange =>
  ({ path, action: 'Edited', calls: [], diff: { added, removed } } as unknown as RecordedChange)
const turns: TurnChanges[] = [
  { id: 'earlier', at: new Date(now - 3_600_000).toISOString(), changes: [edited('src/stores/overview/OverviewProvider.tsx', 120, 64)] },
  { id: 'current', at: new Date(now - 60_000).toISOString(), changes: [edited('codex-ui-demo/PLAN.md', 6, 0), edited('codex-ui-demo/README.md', 5, 0)] },
]

function Specimens() {
  const rail = useOverview()
  const { publishActivity, showBrowser } = rail
  const [cardOpen, setCardOpen] = useState(false)
  // A run you can step through, so every change the pill animates can be seen.
  const [step, setStep] = useState(2)
  const [extra, setExtra] = useState(0)
  const [stopped, setStopped] = useState(false)
  const [phase, setPhase] = useState<Exclude<PillPhase, 'hidden'>>('working')
  const livePlan: PlanSnapshot = {
    ...plan,
    items: plan.items.map((item, index) => ({ ...item, status: index < step ? 'done' : index === step ? 'running' : 'pending' })) as unknown as PlanSnapshot['items'],
  }
  const liveJobs = jobs.map((job) => job.id === 'tests' && stopped ? { ...job, state: 'stopped' as const, endedAt: now } : job)
  const current: TurnChanges = { id: 'current', at: turns[1]?.at ?? null, changes: [
    edited('codex-ui-demo/PLAN.md', 6 + extra * 7, extra),
    edited('codex-ui-demo/README.md', 5, 0),
    ...(extra > 1 ? [edited('codex-ui-demo/src/App.tsx', 40 + extra * 3, 12)] : []),
  ] }
  useEffect(() => {
    publishActivity('workspace-specimen', { plan: livePlan, agents, jobs: liveJobs, turns: [turns[0], current] })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the specimen republishes on each step
  }, [publishActivity, step, extra, stopped])
  useEffect(() => {
    showBrowser('workspace-specimen', { family: 'browser', url: 'http://localhost:5173/sign-in', title: 'Sign in', frame: null, steps: [] })
  }, [showBrowser])
  const button = 'rounded-lg bg-tint px-3 py-1.5 text-caption'

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <span className="text-micro text-muted-foreground">The working mark: a conversation's row, and its title while it works</span>
        <div className="flex items-center gap-6 rounded-xl bg-surface p-4 shadow-panel">
          <span className="flex items-center gap-3 text-body text-muted-foreground"><ActivityMark size="var(--header-mark)" />Getting a detailed report…</span>
          <ActivityMark />
          <ActivityMark size={32} />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-micro text-muted-foreground">The pill over the composer, and the card it grows into</span>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={button} onClick={() => { setPhase('working'); setStep((value) => Math.min(value + 1, plan.items.length)) }}>Next plan step</button>
          <button type="button" className={button} onClick={() => { setPhase('working'); setExtra((value) => value + 1) }}>Change more lines</button>
          <button type="button" className={button} onClick={() => setStopped((value) => !value)}>{stopped ? 'Restart the tests' : 'Stop the tests'}</button>
          <button type="button" className={button} onClick={() => setPhase((value) => value === 'done' ? 'working' : 'done')}>{phase === 'done' ? 'Back to working' : 'Finish the run'}</button>
          <button type="button" className={button} onClick={() => { setStep(2); setExtra(0); setStopped(false); setPhase('working') }}>Reset</button>
        </div>
        <div className="relative flex h-[560px] flex-col items-center justify-end rounded-xl bg-surface p-4 shadow-panel">
          <WorkSurface
            phase={phase} activity={rail.activity} browser={rail.browser} current={current} turnRunning={phase === 'working'}
            open={cardOpen} onToggle={() => setCardOpen((value) => !value)}
            onPick={() => {}} onOpenChanges={() => {}} onExpand={() => {}}
            onStopJob={() => setStopped(true)} stoppingJobId={null} onStopAgent={() => {}} isStoppingAgent={() => false}
          />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-micro text-muted-foreground">Wide window: the docked column</span>
        <div className="relative flex h-[520px] overflow-hidden rounded-xl bg-surface text-foreground shadow-panel">
          <div className="flex min-w-0 flex-1 flex-col justify-center gap-3 p-8">
            <p className="text-title">The conversation's record.</p>
            <p className="max-w-72 text-caption text-muted-foreground">What is going now, what each turn changed, and what finished. In a compact window the same list opens in the sheet over the transcript.</p>
            <button type="button" className="w-fit rounded-lg bg-tint px-3 py-2 text-caption" onClick={rail.open ? rail.collapse : rail.expand}>{rail.open ? 'Collapse Overview' : 'Open Overview'}</button>
          </div>
          <OverviewPanel open={rail.open} />
        </div>
      </div>
    </div>
  )
}

export function OverviewSection() {
  return (
    <Section title="Overview" note="What the conversation is doing behind the reply. A pill and a list in the compact window; a docked column when there is room.">
      <WorkspaceProvider><OverviewProvider conversationId="workspace-specimen"><Specimens /></OverviewProvider></WorkspaceProvider>
    </Section>
  )
}
