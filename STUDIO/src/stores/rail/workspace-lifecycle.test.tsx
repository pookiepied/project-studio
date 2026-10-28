/** @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ReactNode } from 'react'
import { RailProvider, useRail, useWorkspaceTaskHistory } from './RailProvider'
import type { WorkspaceTask } from '@/features/rail/workspaceTasks'

beforeEach(() => localStorage.clear())
afterEach(cleanup)
const task = (conversationId: string): WorkspaceTask => ({ id: 'same-task-id', conversationId, title: 'Analyzing project files', status: 'running', messages: [], calls: [], timestamp: null })

describe('workspace lifecycle', () => {
  it('isolates entries and focus synchronously across conversation and non-chat routes', async () => {
    let scope: string | null = 'a'
    const wrapper = ({ children }: { children: ReactNode }) => <RailProvider conversationId={scope}>{children}</RailProvider>
    const { result, rerender } = renderHook(() => ({ rail: useRail(), tasks: useWorkspaceTaskHistory() }), { wrapper })
    act(() => {
      result.current.rail.openArtifact({ kind: 'search_results', id: 'same', title: 'Private A', status: 'done' }, 'a', 'A')
      result.current.rail.publishTasks('a', [task('a')])
    })
    await waitFor(() => expect(result.current.rail.open).toBe(true))
    scope = 'b'; rerender()
    expect(result.current.rail.entries).toEqual([])
    expect(result.current.tasks).toEqual([])
    expect(result.current.rail.activeId).toBeNull()
    act(() => result.current.rail.openArtifact({ kind: 'search_results', id: 'same', title: 'Private B', status: 'done' }, 'b', 'B'))
    scope = 'a'; rerender()
    expect(result.current.rail.entries[0]).toMatchObject({ artifact: { title: 'Private A' } })
    expect(result.current.rail.activeId).toBe('same')
    scope = null; rerender()
    expect(result.current.rail.open).toBe(false)
    expect(result.current.rail.entries).toEqual([])
    expect(result.current.tasks).toEqual([])
  })
  it('keeps manual collapse through updates, conversation switches and reload', async () => {
    let scope = 'a'
    const wrapper = ({ children }: { children: ReactNode }) => <RailProvider conversationId={scope}>{children}</RailProvider>
    const first = renderHook(() => useRail(), { wrapper })
    act(() => first.result.current.publishTasks('a', [task('a')]))
    await waitFor(() => expect(first.result.current.open).toBe(true))
    act(() => first.result.current.closeAll())
    act(() => first.result.current.showBrowser('a', 'A', { family: 'browser', url: null, title: null, frame: null, steps: [] }))
    act(() => first.result.current.publishTasks('b', [task('b')]))
    scope = 'b'; first.rerender()
    expect(first.result.current.open).toBe(false)
    await waitFor(() => expect(localStorage.getItem('studio.sideWorkspace.collapsed')).toBe('true'))
    first.unmount()
    const next = renderHook(() => useRail(), { wrapper })
    act(() => next.result.current.publishTasks('b', [task('b')]))
    await waitFor(() => expect(next.result.current.collapsed).toBe(true))
    expect(next.result.current.open).toBe(false)
    act(() => next.result.current.expand())
    expect(next.result.current.open).toBe(true)
  })
  it('does not notify shell consumers for transcript-only changes', async () => {
    let renders = 0
    const wrapper = ({ children }: { children: ReactNode }) => <RailProvider conversationId="a">{children}</RailProvider>
    const { result } = renderHook(() => { renders += 1; return useRail() }, { wrapper })
    act(() => result.current.publishTasks('a', [task('a')]))
    await waitFor(() => expect(result.current.open).toBe(true))
    const before = renders
    act(() => result.current.publishTasks('a', [{ ...task('a'), title: 'New activity' }]))
    expect(renders).toBe(before)
  })
})
