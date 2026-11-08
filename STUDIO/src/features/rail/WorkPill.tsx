import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Icons } from '@/components/icons'
import { IconButton } from '@/components/primitives'
import { RollingNumber, SwapText } from '@/components/motion/Rolling'
import { DURATION, EASE_AWAY, EASE_SETTLE } from '@/design/tokens'
import type { RecordedChange } from '@/features/changes/recordedChanges'
import { hasPlan, type Activity, type ActivityView, type BrowserActivity, type TurnChanges } from '@/stores/rail'
import { activityRows, agentLive, jobLive, linesOf, planFinished } from './Activity'

/** How long the finished state stays before the pill goes. */
export const DONE_LINGER_MS = 10_000

export type PillPhase = 'working' | 'done' | 'hidden'

/**
 * Whether there is something specific going on worth a pill: a plan under
 * way, an agent, a command, the browser, or files this turn is changing.
 *
 * A turn that is only thinking or writing words is not one - the transcript
 * already shows that, and a pill that says "Working" adds nothing to it.
 */
export function isWorking(activity: Activity, browser: BrowserActivity | null, turnRunning: boolean, current: TurnChanges | null = null): boolean {
  const planLive = hasPlan(activity) && activity.plan !== null && !activity.plan.damaged && !planFinished(activity.plan.items)
  return planLive || activity.agents.some(agentLive) || activity.jobs.some(jobLive)
    || (browser !== null && browser.steps.some((step) => !step.settled))
    || (turnRunning && current !== null && current.changes.length > 0)
}

/**
 * The pill's phase: there while work is going, then "done" for a few
 * seconds, then gone. Opening a conversation where nothing is going shows no
 * pill at all - a "done" for work finished before you looked is not news.
 */
export function usePillPhase(working: boolean, resetKey: string): PillPhase {
  const [phase, setPhase] = useState<PillPhase>(working ? 'working' : 'hidden')
  const was = useRef(working)
  const key = useRef(resetKey)
  useEffect(() => {
    if (key.current !== resetKey) {
      key.current = resetKey
      was.current = working
      setPhase(working ? 'working' : 'hidden')
      return
    }
    if (working) { was.current = true; setPhase('working'); return }
    if (!was.current) return
    was.current = false
    setPhase('done')
    const timer = setTimeout(() => setPhase('hidden'), DONE_LINGER_MS)
    return () => clearTimeout(timer)
  }, [working, resetKey])
  return phase
}

/** The surface the pill and its card share, so one can become the other. */
const SURFACE = 'work-surface'
const MORPH = { duration: DURATION.slow, ease: EASE_SETTLE } as const

interface Stops {
  /** Stops a background command. */
  onStopJob: (jobId: string) => void
  stoppingJobId: string | null
  /** Stops an agent. */
  onStopAgent: (agentId: string) => void
  isStoppingAgent: (agentId: string) => boolean
}

/**
 * The one pill over the composer and the card it opens, as one surface.
 *
 * Clicked, the pill grows into the card where it stands, and the card
 * shrinks back into it: the same rounded surface changing size, its content
 * crossfading as it goes, rather than a second thing appearing over the first.
 */
export function WorkSurface({ phase, activity, browser, current, turnRunning, open, onToggle, onPick, onOpenChanges, onExpand, ...stops }: {
  phase: Exclude<PillPhase, 'hidden'>
  activity: Activity
  browser: BrowserActivity | null
  current: TurnChanges | null
  /** Whether the turn itself is still going: its files show only while it is. */
  turnRunning: boolean
  open: boolean
  onToggle: () => void
  onPick: (view: ActivityView) => void
  onOpenChanges: (changes: readonly RecordedChange[]) => void
  onExpand: () => void
} & Stops) {
  return (
    <div className="relative flex h-8 w-full justify-center">
      <AnimatePresence initial={false}>
        {open ? (
          <div key="card" className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center px-4">
            <motion.div
              layoutId={SURFACE}
              role="dialog"
              aria-label="This run"
              transition={MORPH}
              style={{ borderRadius: 22 }}
              className="pointer-events-auto w-80 max-w-full overflow-hidden bg-surface shadow-panel"
            >
              <motion.div
                layout="position"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: { duration: DURATION.base, delay: DURATION.fast } }}
                exit={{ opacity: 0, transition: { duration: DURATION.fast, ease: EASE_AWAY } }}
                className="max-h-[min(440px,55vh)] overflow-y-auto p-1.5"
              >
                <WorkCard
                  phase={phase} activity={activity} browser={browser} current={current} turnRunning={turnRunning}
                  onPick={onPick} onOpenChanges={onOpenChanges} onExpand={onExpand} {...stops}
                />
              </motion.div>
            </motion.div>
          </div>
        ) : (
          <WorkPill key="pill" phase={phase} activity={activity} browser={browser} current={current} turnRunning={turnRunning} onToggle={onToggle} />
        )}
      </AnimatePresence>
    </div>
  )
}

/**
 * The pill: the one most useful thing about the run, kept short.
 *
 * "Plan 2 of 4" while a plan is under way - the step itself is in the card,
 * because a pill that carries a sentence is a pill that keeps changing size.
 * Otherwise how many things are running. While the turn is changing files,
 * how many and by how many lines; once it ends, only that it is done, for a
 * few seconds. Every number rolls and every change of words slides, and the
 * pill eases to its new width rather than jumping to it.
 */
export function WorkPill({ phase, activity, browser, current, turnRunning, onToggle }: {
  phase: Exclude<PillPhase, 'hidden'>
  activity: Activity
  browser: BrowserActivity | null
  current: TurnChanges | null
  turnRunning: boolean
  onToggle: () => void
}) {
  const items = activity.plan?.items ?? []
  const planLive = hasPlan(activity) && !planFinished(items)
  const done = items.filter((item) => item.status === 'done').length
  const running = activity.agents.filter(agentLive).length + activity.jobs.filter(jobLive).length
    + (browser !== null && browser.steps.some((step) => !step.settled) ? 1 : 0)
  const lines = phase === 'working' && turnRunning && current !== null ? linesOf(current.changes) : null
  const files = lines !== null && lines.files > 0 ? lines : null

  let lead: { id: string; content: ReactNode } | null
  if (phase === 'done') {
    const plan = hasPlan(activity) && planFinished(items)
    lead = { id: plan ? 'plan-done' : 'done', content: <><Icons.check size="sm" /><span>{plan ? 'Plan complete' : 'Done'}</span></> }
  } else if (planLive) {
    lead = {
      id: 'plan',
      content: <><Icons.plan size="sm" /><span>Plan</span><span className="inline-flex items-center gap-1 text-foreground"><RollingNumber value={done} /><span className="text-muted-foreground">of</span><RollingNumber value={items.length} /></span></>,
    }
  } else if (running > 0) {
    lead = { id: 'running', content: <><LiveDot /><RollingNumber value={running} className="text-foreground" /><span>running</span></> }
  } else {
    lead = null
  }

  return (
    <motion.button
      layoutId={SURFACE}
      type="button"
      aria-expanded={false}
      aria-haspopup="dialog"
      onClick={onToggle}
      transition={MORPH}
      style={{ borderRadius: 16 }}
      className="studio-blur pointer-events-auto flex h-8 max-w-[calc(100%-32px)] items-center overflow-hidden px-3.5 text-caption text-muted-foreground shadow-lifted transition-colors duration-fast hover:text-foreground"
    >
      <motion.span
        layout="position"
        className="flex min-w-0 items-center gap-2 whitespace-nowrap"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: { duration: DURATION.base, delay: DURATION.fast } }}
        exit={{ opacity: 0, transition: { duration: DURATION.fast } }}
      >
        <AnimatePresence initial={false} mode="popLayout">
          {lead !== null ? (
            <motion.span key="lead" layout="position" className="flex items-center" exit={{ opacity: 0, transition: { duration: DURATION.fast } }}>
              <SwapText id={lead.id}>{lead.content}</SwapText>
            </motion.span>
          ) : null}
          {lead !== null && files !== null ? (
            <motion.span key="divider" layout="position" aria-hidden className="h-3.5 w-px shrink-0 bg-foreground/15"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: DURATION.fast } }} />
          ) : null}
          {files !== null ? (
            <motion.span key="files" layout="position" className="flex items-center gap-1.5"
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: DURATION.fast } }}
              transition={{ duration: DURATION.slow, ease: EASE_SETTLE }}>
              <span className="inline-flex items-center gap-1">
                <RollingNumber value={files.files} className="text-foreground" />
                <SwapText id={files.files === 1 ? 'file' : 'files'}>{files.files === 1 ? 'file' : 'files'}</SwapText>
              </span>
              <RollingCounts added={files.added} removed={files.removed} />
            </motion.span>
          ) : null}
        </AnimatePresence>
      </motion.span>
    </motion.button>
  )
}

/** Added and removed lines in the diff colours, each rolling to its new count. */
export function RollingCounts({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="inline-flex items-center gap-1 font-mono">
      <span className="inline-flex text-diff-add">+<RollingNumber value={added} /></span>
      <span className="inline-flex text-diff-del">-<RollingNumber value={removed} /></span>
    </span>
  )
}

function LiveDot() {
  return (
    <span aria-hidden className="relative flex size-1.5 shrink-0">
      <span className="absolute inset-0 animate-ping rounded-full bg-accent opacity-60" />
      <span className="relative size-1.5 rounded-full bg-accent" />
    </span>
  )
}

interface LiveRow {
  readonly key: string
  readonly view: ActivityView
  readonly mark: ReactNode
  readonly title: string
  readonly status: string
  readonly stop?: { readonly label: string; readonly busy: boolean; readonly onStop: () => void }
}

/** What is running, one short line each, with Stop where it can be stopped. */
function liveRows(activity: Activity, browser: BrowserActivity | null, stops: Stops): LiveRow[] {
  const rows: LiveRow[] = []
  for (const job of activity.jobs) {
    if (!jobLive(job)) continue
    const stopping = job.state === 'stopping' || stops.stoppingJobId === job.id
    rows.push({
      key: `job:${job.id}`, view: { kind: 'jobs' }, mark: <Icons.backgroundJobs size="sm" />, title: job.title ?? job.command,
      status: job.state === 'stopping' ? 'Stopping' : 'Running',
      stop: { label: `Stop ${job.title ?? job.command}`, busy: stopping, onStop: () => stops.onStopJob(job.id) },
    })
  }
  for (const agent of activity.agents) {
    if (!agentLive(agent)) continue
    rows.push({
      key: `agent:${agent.id}`, view: { kind: 'agent', agentId: agent.id }, mark: <Icons.agents size="sm" />, title: agent.title,
      status: agent.status === 'queued' ? 'Queued' : agent.status === 'waiting_for_user' ? 'Waiting for you' : 'Running',
      stop: { label: `Stop ${agent.title}`, busy: stops.isStoppingAgent(agent.id), onStop: () => stops.onStopAgent(agent.id) },
    })
  }
  const browserRow = activityRows({ plan: null, agents: [], jobs: [], turns: [] }, browser).find((row) => row.live)
  if (browserRow !== undefined) rows.push({ key: browserRow.key, view: browserRow.view, mark: browserRow.mark, title: browserRow.title, status: 'Running' })
  return rows
}

/**
 * What the pill opens: this run, and only this run, as plain short lines.
 *
 * No title bar and no ruled headings - a small label over each group is
 * enough to tell them apart. The plan's steps, the files the turn is
 * changing while it changes them, and what is still running, each with a
 * square Stop where it can be stopped. One button in the corner opens the
 * whole workspace; the pill, a click outside or Escape closes the card.
 */
export function WorkCard({ phase, activity, browser, current, turnRunning, onPick, onOpenChanges, onExpand, ...stops }: {
  phase: Exclude<PillPhase, 'hidden'>
  activity: Activity
  browser: BrowserActivity | null
  current: TurnChanges | null
  /** Files belong to the turn: once it ends they are the conversation's record, not this run's. */
  turnRunning: boolean
  onPick: (view: ActivityView) => void
  onOpenChanges: (changes: readonly RecordedChange[]) => void
  onExpand: () => void
} & Stops) {
  const items = activity.plan?.items ?? []
  const running = liveRows(activity, browser, stops)
  const lines = phase === 'working' && turnRunning && current !== null ? linesOf(current.changes) : null
  const files = lines !== null && lines.files > 0 && current !== null ? current.changes : null
  const done = items.filter((item) => item.status === 'done').length
  const plan = hasPlan(activity)
  const empty = !plan && files === null && running.length === 0

  return (
    <div className="relative flex flex-col pb-0.5">
      <div className="absolute right-0 top-0 z-10">
        <IconButton label="Open the workspace" size="sm" onClick={onExpand}><Icons.workspace size="sm" /></IconButton>
      </div>

      {empty ? (
        <p className="flex h-7 items-center gap-2 pl-2.5 pr-10 text-caption text-muted-foreground">
          <Icons.check size="sm" />
          <SwapText id={phase}>{phase === 'done' ? 'Everything finished' : 'Nothing running'}</SwapText>
        </p>
      ) : null}

      {plan ? (
        <Group label="Plan" first detail={<span className="inline-flex items-center"><RollingNumber value={done} /><span className="px-0.5">/</span><RollingNumber value={items.length} /></span>}>
          {items.map((item) => (
            <Row key={item.id}>
              <div className="flex min-h-7 items-start gap-2.5 px-2.5 py-[5px] text-caption">
                <span className="mt-[3px] flex size-3.5 shrink-0 items-center justify-center"><PlanMark status={item.status} /></span>
                <span className={item.status === 'running' ? 'studio-shimmer text-foreground' : item.status === 'pending' ? 'text-foreground/80' : 'text-muted-foreground'}>{item.text}</span>
              </div>
            </Row>
          ))}
        </Group>
      ) : null}

      {files !== null && lines !== null ? (
        <Group label="Files" first={!plan} detail={<RollingCounts added={lines.added} removed={lines.removed} />}>
          {files.map((change) => (
            <Row key={change.path}>
              <button type="button" onClick={() => onOpenChanges([change])} className="flex h-7 w-full items-center gap-3 rounded-[10px] px-2.5 text-left text-caption transition-colors duration-fast hover:bg-tint">
                <span className="min-w-0 flex-1 truncate text-foreground">{fileName(change.path)}</span>
                {change.diff === null ? <span className="shrink-0 text-micro text-muted-foreground">{change.action}</span>
                  : <span className="shrink-0 text-micro"><RollingCounts added={change.diff.added} removed={change.diff.removed} /></span>}
              </button>
            </Row>
          ))}
        </Group>
      ) : null}

      {running.length > 0 ? (
        <Group label="Running" first={!plan && files === null}>
          {running.map((row) => (
            <Row key={row.key}>
              <div className="flex h-7 items-center rounded-[10px] transition-colors duration-fast hover:bg-tint">
                <button type="button" onClick={() => onPick(row.view)} title={row.status} className="flex h-full min-w-0 flex-1 items-center gap-2.5 pl-2.5 pr-2 text-left text-caption">
                  <span className="flex shrink-0 text-muted-foreground">{row.mark}</span>
                  <span className="min-w-0 flex-1 truncate text-foreground">{row.title}</span>
                  {row.stop === undefined || row.stop.busy ? <span className="shrink-0 text-micro text-muted-foreground studio-shimmer">{row.status}</span> : null}
                </button>
                {row.stop !== undefined && !row.stop.busy ? (
                  <button
                    type="button"
                    aria-label={row.stop.label}
                    title="Stop"
                    onClick={row.stop.onStop}
                    className="mr-0.5 flex size-6 shrink-0 items-center justify-center rounded-[8px] text-muted-foreground transition-colors duration-fast hover:bg-danger/15 hover:text-danger"
                  >
                    <span aria-hidden className="size-2 rounded-[2px] bg-current" />
                  </button>
                ) : null}
              </div>
            </Row>
          ))}
        </Group>
      ) : null}
    </div>
  )
}

function fileName(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
}

/** A group's small label, with room for the corner button when it comes first. */
function Group({ label, detail, first = false, children }: { label: string; detail?: ReactNode; first?: boolean; children: ReactNode }) {
  return (
    <section aria-label={label} className={first ? 'flex flex-col' : 'mt-1.5 flex flex-col'}>
      <div className={first ? 'flex h-7 items-center gap-2 pl-2.5 pr-10 text-micro text-muted-foreground' : 'flex h-7 items-center gap-2 px-2.5 text-micro text-muted-foreground'}>
        <span className="flex-1">{label}</span>
        {detail === undefined ? null : <span className="shrink-0 tabular-nums">{detail}</span>}
      </div>
      <ul className="flex flex-col"><AnimatePresence initial={false}>{children}</AnimatePresence></ul>
    </section>
  )
}

function Row({ children }: { children: ReactNode }) {
  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: DURATION.fast } }}
      transition={{ duration: DURATION.base, ease: EASE_SETTLE }}
    >
      {children}
    </motion.li>
  )
}

function PlanMark({ status }: { status: string }) {
  if (status === 'done') return <span className="flex text-muted-foreground"><Icons.check size="sm" /></span>
  if (status === 'running') return <LiveDot />
  if (status === 'failed') return <span aria-hidden className="size-2 rounded-full bg-danger" />
  if (status === 'cancelled') return <span aria-hidden className="h-px w-2 bg-muted-foreground" />
  return <span aria-hidden className="size-2.5 rounded-full border border-foreground/25" />
}

/** The card's own motion when the pill itself is not there to grow from. */
export const PILL_ENTER = {
  initial: { opacity: 0, scale: 0.9, y: 8 },
  animate: { opacity: 1, scale: 1, y: 0, transition: { duration: DURATION.slow, ease: EASE_SETTLE } },
  exit: { opacity: 0, scale: 0.94, y: 6, transition: { duration: DURATION.base, ease: EASE_AWAY } },
} as const
