/** @vitest-environment jsdom */
import { useContext, useEffect } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RailProvider, useRail } from '@/stores/rail'
import { WorkspaceOverview, WorkspaceTaskDetail } from './WorkspaceOverview'
import type { WorkspaceTask } from './workspaceTasks'
import { ReplyConversation } from '@/features/chat/markdown/ReplyImage'

vi.mock('@/features/jobs/TasksSection', () => ({ TasksSection: () => null }))
vi.mock('@/features/chat/transcript/live/ToolGroups', () => ({ ToolGroups: () => null }))
vi.mock('@/features/changes/ChangesPanel', () => ({ ChangesPanel: () => null }))
vi.mock('@/features/chat/streaming', () => ({ StreamedMarkdown: () => <output aria-label="Reply owner">{useContext(ReplyConversation) ?? 'none'}</output> }))
afterEach(cleanup)

const history: WorkspaceTask[] = Array.from({ length: 100 }, (_, index) => ({ id: `task-${index}`, conversationId: 'conversation', title: `Review task ${index}`, status: index === 0 ? 'running' : 'completed', messages: [], calls: [], timestamp: null }))
function Content() {
  const { publishTasks, activeId } = useRail()
  useEffect(() => { publishTasks('conversation', history) }, [publishTasks])
  return <><output aria-label="Selected task">{activeId}</output><WorkspaceOverview onInspectAgent={() => undefined} /></>
}
describe('workspace overview', () => {
  it('scopes primary reply images without borrowing that scope for worker images', () => {
    const task: WorkspaceTask = { ...history[0], messages: [{ kind: 'assistant', id: 'message', submissionId: 'task-0', end: { state: 'complete' }, usage: null, model: null,
      segments: [{ kind: 'text', id: 'text', text: '![Chart](workspace/chart.png)' }] }] }
    const view = render(<WorkspaceTaskDetail task={task} />)
    expect(screen.getByLabelText('Reply owner').textContent).toBe('conversation')
    view.rerender(<WorkspaceTaskDetail task={task} worker />)
    expect(screen.getByLabelText('Reply owner').textContent).toBe('none')
  })

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
