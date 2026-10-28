/** @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useBackgroundJobs } from './useBackgroundJobs'
import { useAgentTasks } from './useAgentTasks'
import type { AgentTask, BackgroundJob, HarnessResult } from '@/platform/harness'
import { parseBackgroundJob } from '@/platform/harness/contracts/jobs'

const surfaces = vi.hoisted(() => ({
  backgroundJobs: { list: vi.fn(), stop: vi.fn() },
  tasks: { list: vi.fn(), cancel: vi.fn() },
}))
vi.mock('@/stores/workspace', () => ({ useWorkspace: () => surfaces }))
afterEach(() => { cleanup(); vi.clearAllMocks() })
function deferred<T>() {
  let finish: (value: T) => void = () => undefined
  const promise = new Promise<T>((resolve) => { finish = resolve })
  return { promise, finish }
}
const job: BackgroundJob = { id: 'job', command: 'private command', state: 'running', exitCode: null, startedAt: 1, endedAt: null, output: 'private output', dropped: 0 }
const agent: AgentTask = { id: 'agent', agentName: 'worker', parentConversationId: 'a', title: 'Private task', status: 'running', createdAt: 1, settledAt: null, resultSummary: null }

describe('workspace asynchronous ownership', () => {
  it('ignores late job responses after switching conversations', async () => {
    const old = deferred<HarnessResult<readonly BackgroundJob[]>>()
    surfaces.backgroundJobs.list.mockImplementation((id: string) => id === 'a' ? old.promise : Promise.resolve({ ok: true, value: [] }))
    const { result, rerender } = renderHook(({ id }) => useBackgroundJobs(id), { initialProps: { id: 'a' } })
    rerender({ id: 'b' })
    await waitFor(() => expect(surfaces.backgroundJobs.list).toHaveBeenCalledWith('b'))
    await act(async () => { old.finish({ ok: true, value: [job] }); await old.promise })
    expect(result.current.jobs).toEqual([])
  })
  it('ignores late agent responses and refuses cancellation of another conversation task', async () => {
    const old = deferred<HarnessResult<readonly AgentTask[]>>()
    surfaces.tasks.list.mockImplementation((id: string) => id === 'a' ? old.promise : Promise.resolve({ ok: true, value: [] }))
    const { result, rerender } = renderHook(({ id }) => useAgentTasks({ conversationId: id }), { initialProps: { id: 'a' } })
    rerender({ id: 'b' })
    await act(async () => { old.finish({ ok: true, value: [agent] }); await old.promise })
    expect(result.current.tasks).toEqual([])
    await act(() => result.current.cancel('agent'))
    expect(surfaces.tasks.cancel).not.toHaveBeenCalled()
  })
  it('retains running state when a stop response contains no termination record', async () => {
    surfaces.backgroundJobs.list.mockResolvedValue({ ok: true, value: [job] })
    surfaces.backgroundJobs.stop.mockResolvedValue({ ok: true, value: null })
    const { result } = renderHook(() => useBackgroundJobs('a'))
    await waitFor(() => expect(result.current.jobs).toHaveLength(1))
    await act(() => result.current.stop('job'))
    expect(result.current.jobs[0]?.state).toBe('running')
  })
  it('preserves the backend stopping state without inventing an end timestamp', () => {
    expect(parseBackgroundJob({ ...job, state: 'stopping' })).toMatchObject({ state: 'stopping', endedAt: null })
  })
})
