/** @vitest-environment jsdom */
import { useEffect } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RailProvider, useRail } from '@/stores/rail'
import { SideRail } from './SideRail'

vi.mock('./WorkspaceOverview', () => ({
  WorkspaceOverview: () => <p>Task overview</p>,
  WorkspaceTaskDetail: () => <p>Task transcript</p>,
  entryTitle: () => 'Resource',
}))
vi.mock('./AgentInspector', () => ({ AgentInspector: () => null }))
vi.mock('@/features/artifacts', () => ({ renderArtifact: () => null }))
vi.mock('@/features/jobs', () => ({ BackgroundWorkPanel: () => null }))
vi.mock('@/features/plans', () => ({ PlanPanel: () => null }))
vi.mock('./BrowserPanel', () => ({ BrowserPanel: () => null }))
vi.mock('@/features/changes/ChangesPanel', () => ({ ChangesPanel: () => null }))

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function Workspace() {
  const { open, publishTasks, focus, expand } = useRail()
  useEffect(() => { publishTasks('a', [{ id: 'task', conversationId: 'a', title: 'Checking the project', status: 'completed', messages: [], calls: [], timestamp: null }]) }, [publishTasks])
  return <div><button onClick={() => focus('task')}>Inspect task</button><button onClick={expand}>Reopen</button><SideRail open={open} /></div>
}

describe('workspace surface', () => {
  it('returns from a focused task with Escape before collapsing and can reopen', async () => {
    render(<RailProvider conversationId="a"><Workspace /></RailProvider>)
    await screen.findByText('Task overview')
    fireEvent.click(screen.getByText('Inspect task'))
    expect(screen.getByText('Task transcript')).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('complementary'), { key: 'Escape' })
    expect(screen.getByText('Task overview')).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('complementary'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull())
    fireEvent.click(screen.getByText('Reopen'))
    await screen.findByText('Task overview')
  })
})
