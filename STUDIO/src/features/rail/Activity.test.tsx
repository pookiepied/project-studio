/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentTask, BackgroundJob, PlanSnapshot } from '@/platform/harness'
import type { RecordedChange } from '@/features/changes/recordedChanges'
import type { Activity } from '@/stores/rail'
import { ActivityList, activityRows, linesOf, planFinished } from './Activity'
import { DONE_LINGER_MS, WorkCard, WorkPill, isWorking, usePillPhase } from './WorkPill'

vi.mock('@/features/plans/PlanPanel', () => ({ PlanPanel: () => null }))
vi.mock('@/features/jobs/JobsPanel', () => ({ JobsPanel: () => null }))
vi.mock('./BrowserPanel', () => ({ BrowserPanel: () => null }))
vi.mock('./AgentActivity', () => ({ AgentActivity: () => null }))

afterEach(() => { cleanup(); vi.useRealTimers() })

type Item = PlanSnapshot['items'][number]
const item = (id: string, status: Item['status'], text = `Item ${id}`): Item =>
  ({ id, text, status, position: Number(id) } as unknown as Item)
const plan = (items: Item[]): PlanSnapshot => ({ conversationId: 'a', damaged: false, items })
const agent = (status: AgentTask['status']): AgentTask => ({
  id: `agent-${status}`, agentName: 'code_reviewer', parentConversationId: 'a', title: `Review (${status})`, status, createdAt: 0, settledAt: null, resultSummary: null,
})
const job = (overrides: Partial<BackgroundJob>): BackgroundJob => ({
  id: 'job', title: null, command: 'pnpm dev', state: 'running', exitCode: null, startedAt: 0, endedAt: null, output: '', dropped: 0, ...overrides,
})
const change = (path: string, added: number, removed: number): RecordedChange =>
  ({ path, action: 'Edited', calls: [], diff: { added, removed } } as unknown as RecordedChange)
const activity = (overrides: Partial<Activity> = {}): Activity => ({ plan: null, agents: [], jobs: [], turns: [], ...overrides })

describe('the workspace rows', () => {
  it('leads a command with its title and keeps the line beside the state', () => {
    const [row] = activityRows(activity({ jobs: [job({ title: 'Studio client dev server' })] }), null)
    expect(row?.title).toBe('Studio client dev server')
    expect(row?.detail).toBe('Running · pnpm dev')
    const [untitled] = activityRows(activity({ jobs: [job({})] }), null)
    expect(untitled?.title).toBe('pnpm dev')
  })

  it('groups what is going, what each turn changed, and what finished; opens the one picked', () => {
    const rows = activityRows(activity({
      agents: [agent('running'), agent('completed')],
      jobs: [job({ state: 'exited', exitCode: 1 })],
      turns: [{ id: 'turn-1', at: null, changes: [change('a.ts', 4, 1), change('b.ts', 2, 0)] }],
    }), null)
    const onPick = vi.fn()
    render(<ActivityList rows={rows} onPick={onPick} />)
    expect(screen.getByRole('region', { name: 'Now' }).textContent).toContain('Review (running)')
    expect(screen.getByRole('region', { name: 'Changes' }).textContent).toContain('2 files changed')
    const finished = screen.getByRole('region', { name: 'Finished' }).textContent ?? ''
    expect(finished).toContain('Review (completed)')
    expect(finished).toContain('Exited with 1')
    fireEvent.click(screen.getByText('2 files changed'))
    expect(onPick).toHaveBeenCalledWith({ kind: 'changes', turnId: 'turn-1' })
  })

  it('moves a finished plan from Now to Finished', () => {
    expect(activityRows(activity({ plan: plan([item('1', 'done'), item('2', 'running')]) }), null)[0]?.group).toBe('now')
    expect(activityRows(activity({ plan: plan([item('1', 'done'), item('2', 'cancelled')]) }), null)[0]?.group).toBe('finished')
  })

  it('counts lines across files, and a file with no proven diff as a file', () => {
    expect(linesOf([change('a.ts', 10, 2), change('b.ts', 3, 0), { path: 'c.ts', action: 'Created', calls: [], diff: null }]))
      .toEqual({ files: 3, added: 13, removed: 2 })
  })

  it('calls a plan finished once every item has an outcome, and not before', () => {
    expect(planFinished([item('1', 'done'), item('2', 'cancelled'), item('3', 'failed')])).toBe(true)
    expect(planFinished([item('1', 'done'), item('2', 'pending')])).toBe(false)
    expect(planFinished([])).toBe(false)
  })
})

describe('the pill', () => {
  it('works while something specific is going, not while a turn only writes words', () => {
    expect(isWorking(activity(), null, true)).toBe(false)
    expect(isWorking(activity(), null, true, { id: 't', at: null, changes: [change('a.ts', 1, 0)] })).toBe(true)
    expect(isWorking(activity(), null, false, { id: 't', at: null, changes: [change('a.ts', 1, 0)] })).toBe(false)
    expect(isWorking(activity({ plan: plan([item('1', 'pending')]) }), null, false)).toBe(true)
    expect(isWorking(activity({ jobs: [job({})] }), null, false)).toBe(true)
    expect(isWorking(activity({ plan: plan([item('1', 'done')]), jobs: [job({ state: 'exited', exitCode: 0 })] }), null, false)).toBe(false)
  })

  it('says done for a few seconds after the work ends, then goes; nothing on opening an idle conversation', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(({ working, key }) => usePillPhase(working, key), { initialProps: { working: false, key: 'a' } })
    expect(result.current).toBe('hidden')
    rerender({ working: true, key: 'a' })
    expect(result.current).toBe('working')
    rerender({ working: false, key: 'a' })
    expect(result.current).toBe('done')
    act(() => { vi.advanceTimersByTime(DONE_LINGER_MS) })
    expect(result.current).toBe('hidden')
    rerender({ working: true, key: 'a' })
    rerender({ working: false, key: 'b' })
    expect(result.current).toBe('hidden')
  })

  it("says only how far the plan has got, then this turn's files; once done, only that", async () => {
    const view = render(<WorkPill phase="working" activity={activity({ plan: plan([item('1', 'done'), item('2', 'running', 'Write the store')]) })} browser={null}
      current={{ id: 't', at: null, changes: [change('a.ts', 11, 0), change('b.ts', 0, 0)] }} turnRunning onToggle={() => {}} />)
    const text = view.container.textContent ?? ''
    expect(text).toContain('Plan')
    expect(text).toContain('1of2')
    expect(text).not.toContain('Write the store')
    expect(text).toContain('2files')
    expect(text).toContain('+11')
    view.rerender(<WorkPill phase="done" activity={activity({ plan: plan([item('1', 'done')]) })} browser={null}
      current={{ id: 't', at: null, changes: [change('a.ts', 11, 0)] }} turnRunning={false} onToggle={() => {}} />)
    expect(screen.getByText('Plan complete')).toBeTruthy()
    await waitFor(() => expect(view.container.textContent).not.toContain('+11'))
  })
})

describe('the card', () => {
  const stops = () => ({ onStopJob: vi.fn(), stoppingJobId: null, onStopAgent: vi.fn(), isStoppingAgent: () => false })
  it('lists what is running on one line each, with Stop on a command and an agent', () => {
    const handlers = stops()
    render(<WorkCard phase="working" activity={activity({ jobs: [job({ id: 'srv', title: 'Showcase server' })], agents: [agent('running')] })} browser={null}
      current={null} turnRunning onPick={() => {}} onOpenChanges={() => {}} onExpand={() => {}} {...handlers} />)
    fireEvent.click(screen.getByRole('button', { name: 'Stop Showcase server' }))
    expect(handlers.onStopJob).toHaveBeenCalledWith('srv')
    fireEvent.click(screen.getByRole('button', { name: 'Stop Review (running)' }))
    expect(handlers.onStopAgent).toHaveBeenCalledWith('agent-running')
  })

  it('opens the whole workspace from one button, with no list of everything in the card', () => {
    const onExpand = vi.fn()
    render(<WorkCard phase="working" activity={activity({ jobs: [job({ state: 'exited', exitCode: 0, title: 'Old lint' })] })} browser={null}
      current={null} turnRunning onPick={() => {}} onOpenChanges={() => {}} onExpand={onExpand} {...stops()} />)
    expect(screen.queryByText('Old lint')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Open the workspace' }))
    expect(onExpand).toHaveBeenCalled()
  })
})

describe('the card after the turn', () => {
  it("drops the turn's files once the turn ends, even while a server keeps running", () => {
    const props = { phase: 'working' as const, activity: activity({ jobs: [job({ title: 'File share server' })] }), browser: null,
      current: { id: 't', at: null, changes: [change('main.py', 128, 0)] }, onPick: () => {}, onOpenChanges: () => {}, onExpand: () => {},
      onStopJob: () => {}, stoppingJobId: null, onStopAgent: () => {}, isStoppingAgent: () => false }
    const view = render(<WorkCard {...props} turnRunning />)
    expect(screen.getByText('main.py')).toBeTruthy()
    view.rerender(<WorkCard {...props} turnRunning={false} />)
    expect(screen.queryByRole('region', { name: 'Files' })).toBeNull()
    expect(screen.getByText('File share server')).toBeTruthy()
  })
})
