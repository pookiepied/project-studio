/** @vitest-environment jsdom */
import { useEffect } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RailProvider, useRail } from '@/stores/rail'
import { WorkspaceOverview } from './WorkspaceOverview'
import type { WorkspaceTask } from './workspaceTasks'

vi.mock('@/features/jobs/TasksSection', () => ({ TasksSection: () => null }))
vi.mock('@/features/chat/transcript/live/ToolGroups', () => ({ ToolGroups: () => null }))
vi.mock('@/features/changes/ChangesPanel', () => ({ ChangesPanel: () => null }))
vi.mock('@/features/chat/streaming', () => ({ StreamedMarkdown: () => null }))
afterEach(cleanup)

const history: WorkspaceTask[] = Array.from({ length: 100 }, (_, index) => ({ id: `task-${index}`, conversationId: 'conversation', title: `Review task ${index}`, status: index === 0 ? 'running' : 'completed', messages: [], calls: [], timestamp: null }))
function Content() {
  const { publishTasks, activeId } = useRail()
  useEffect(() => { publishTasks('conversation', history) }, [publishTasks])
  return <><output aria-label="Selected task">{activeId}</output><WorkspaceOverview onInspectAgent={() => undefined} /></>
}
describe('workspace overview', () => {
  it('keeps active work discoverable and progressively reveals completed history', async () => {
    render(<RailProvider conversationId="conversation"><Content /></RailProvider>)
    await screen.findByRole('button', { name: /Review task 0 / })
    expect(screen.getAllByRole('button', { name: /Review task/ })).toHaveLength(31)
    expect(screen.queryByRole('button', { name: /Review task 1 / })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show 30 more' }))
    expect(screen.getAllByRole('button', { name: /Review task/ })).toHaveLength(61)
    fireEvent.click(screen.getByRole('button', { name: /Review task 99 / }))
    expect(screen.getByLabelText('Selected task').textContent).toBe('task-99')
    expect(screen.getAllByText('completed')).toHaveLength(60)
    expect(document.querySelector('progress')).toBeNull()
  })
})
