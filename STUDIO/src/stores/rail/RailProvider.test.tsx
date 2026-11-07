/** @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { AgentTask, BackgroundJob, PlanSnapshot } from '@/platform/harness'
import { RailProvider, useRail, type Activity } from './RailProvider'

let wide = true
beforeEach(() => {
  localStorage.clear()
  wide = true
  vi.stubGlobal('matchMedia', () => ({ matches: wide, addEventListener() {}, removeEventListener() {} }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const agent = (id: string, status: AgentTask['status'] = 'running'): AgentTask => ({
  id, agentName: 'reviewer', parentConversationId: 'a', title: `Agent ${id}`, status, createdAt: 0, settledAt: null, resultSummary: null,
})
const job: BackgroundJob = { id: 'job', title: 'Client tests', command: 'pnpm test', state: 'running', exitCode: null, startedAt: 0, endedAt: null, output: '', dropped: 0 }
const plan = (count: number): PlanSnapshot => ({
  conversationId: 'a', damaged: false,
  items: Array.from({ length: count }, (_, index) => ({ id: String(index), text: `Item ${String(index)}`, status: 'pending', position: index })) as unknown as PlanSnapshot['items'],
})
const activity = (overrides: Partial<Activity> = {}): Activity => ({ plan: null, agents: [], jobs: [], turns: [], ...overrides })

function mount(scope: { current: string | null }) {
  const wrapper = ({ children }: { children: ReactNode }) => <RailProvider conversationId={scope.current}>{children}</RailProvider>
  return renderHook(() => useRail(), { wrapper })
}

describe('the workspace holds activity, per conversation', () => {
  it('keeps each conversation its own activity, browser and open view', async () => {
    const scope = { current: 'a' as string | null }
    const { result, rerender } = mount(scope)
    act(() => {
      result.current.publishActivity('a', activity({ agents: [agent('one')] }))
      result.current.showBrowser('a', { family: 'browser', url: 'https://a.test', title: 'A', frame: null, steps: [] })
    })
    await waitFor(() => expect(result.current.open).toBe(true))
    act(() => result.current.show({ kind: 'agent', agentId: 'one' }))
    expect(result.current.view).toEqual({ kind: 'agent', agentId: 'one' })

    scope.current = 'b'; rerender()
    expect(result.current.activity.agents).toEqual([])
    expect(result.current.browser).toBeNull()
    expect(result.current.view).toBeNull()
    expect(result.current.open).toBe(false)

    scope.current = 'a'; rerender()
    expect(result.current.browser?.url).toBe('https://a.test')
    expect(result.current.view).toEqual({ kind: 'agent', agentId: 'one' })

    scope.current = null; rerender()
    expect(result.current.open).toBe(false)
  })

  it('falls back to the list when what was open is no longer reported', async () => {
    const { result } = mount({ current: 'a' })
    act(() => result.current.publishActivity('a', activity({ agents: [agent('one')], jobs: [job] })))
    act(() => result.current.show({ kind: 'agent', agentId: 'one' }))
    act(() => result.current.publishActivity('a', activity({ jobs: [job] })))
    expect(result.current.view).toBeNull()
  })

  it('counts an empty plan as no plan', () => {
    const { result } = mount({ current: 'a' })
    act(() => result.current.publishActivity('a', activity({ plan: plan(0) })))
    expect(result.current.collapsed).toBe(false)
    expect(result.current.open).toBe(false)
    act(() => result.current.publishActivity('a', activity({ plan: plan(2) })))
    act(() => result.current.show({ kind: 'plan' }))
    expect(result.current.view).toEqual({ kind: 'plan' })
  })

  it('does not notify consumers when the same activity is published again', async () => {
    let renders = 0
    const wrapper = ({ children }: { children: ReactNode }) => <RailProvider conversationId="a">{children}</RailProvider>
    const { result } = renderHook(() => { renders += 1; return useRail() }, { wrapper })
    const agents = [agent('one')]
    act(() => result.current.publishActivity('a', activity({ agents })))
    await waitFor(() => expect(result.current.open).toBe(true))
    const before = renders
    act(() => result.current.publishActivity('a', activity({ agents })))
    expect(renders).toBe(before)
  })
})

describe('where the workspace draws', () => {
  it('has no docked column in a window too narrow for one', async () => {
    wide = false
    const { result } = mount({ current: 'a' })
    act(() => result.current.publishActivity('a', activity({ jobs: [job] })))
    await waitFor(() => expect(result.current.activity.jobs).toHaveLength(1))
    expect(result.current.docked).toBe(false)
    expect(result.current.open).toBe(false)
  })

  it('keeps a manual collapse through updates, switches and reload', async () => {
    const scope = { current: 'a' as string | null }
    const first = mount(scope)
    act(() => first.result.current.publishActivity('a', activity({ jobs: [job] })))
    await waitFor(() => expect(first.result.current.open).toBe(true))
    act(() => first.result.current.closeAll())
    act(() => first.result.current.publishActivity('a', activity({ jobs: [job], agents: [agent('two')] })))
    expect(first.result.current.open).toBe(false)
    await waitFor(() => expect(localStorage.getItem('studio.sideWorkspace.collapsed')).toBe('true'))
    first.unmount()

    const next = mount(scope)
    act(() => next.result.current.publishActivity('a', activity({ jobs: [job] })))
    await waitFor(() => expect(next.result.current.collapsed).toBe(true))
    expect(next.result.current.open).toBe(false)
    act(() => next.result.current.show({ kind: 'jobs' }))
    expect(next.result.current.open).toBe(true)
    expect(next.result.current.view).toEqual({ kind: 'jobs' })
  })
})
