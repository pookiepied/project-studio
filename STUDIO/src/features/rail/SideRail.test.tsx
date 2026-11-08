/** @vitest-environment jsdom */
import { useEffect } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RailProvider, useRail } from '@/stores/rail'
import type { PlanSnapshot } from '@/platform/harness'
import { SideRail } from './SideRail'

vi.mock('@/features/plans/PlanPanel', () => ({ PlanPanel: () => <p>The plan, in full</p> }))
vi.mock('@/features/jobs/JobsPanel', () => ({ JobsPanel: () => null }))
vi.mock('./BrowserPanel', () => ({ BrowserPanel: () => null }))
vi.mock('./AgentActivity', () => ({ AgentActivity: () => null }))

const plan: PlanSnapshot = {
  conversationId: 'a', damaged: false,
  items: [
    { id: 'one', text: 'Read', status: 'done', position: 1 },
    { id: 'two', text: 'Write', status: 'pending', position: 2 },
  ] as unknown as PlanSnapshot['items'],
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function Workspace() {
  const { open, publishActivity, expand } = useRail()
  useEffect(() => { publishActivity('a', { plan, agents: [], jobs: [], turns: [] }) }, [publishActivity])
  return <div><button onClick={expand}>Reopen</button><SideRail open={open} /></div>
}

describe('the docked workspace', () => {
  it('lists activity, opens one thing, and steps back with Escape before collapsing', async () => {
    render(<RailProvider conversationId="a"><Workspace /></RailProvider>)
    const row = await screen.findByRole('button', { name: /Plan/ })
    expect(screen.getByText('1 of 2 done')).toBeTruthy()
    fireEvent.click(row)
    expect(screen.getByText('The plan, in full')).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('complementary'), { key: 'Escape' })
    expect(screen.getByText('1 of 2 done')).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('complementary'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull())
    fireEvent.click(screen.getByText('Reopen'))
    await screen.findByText('1 of 2 done')
  })

  it('keeps no history: a conversation with nothing going on has no column', async () => {
    function Idle() {
      const { open, publishActivity } = useRail()
      useEffect(() => { publishActivity('a', { plan: null, agents: [], jobs: [], turns: [] }) }, [publishActivity])
      return <SideRail open={open} />
    }
    render(<RailProvider conversationId="a"><Idle /></RailProvider>)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.queryByRole('complementary')).toBeNull()
  })

  it('opens on request even with nothing in it, and says so', async () => {
    function Asked() {
      const { open, publishActivity, openOverview } = useRail()
      useEffect(() => { publishActivity('a', { plan: null, agents: [], jobs: [], turns: [] }) }, [publishActivity])
      return <div><button onClick={openOverview}>Workspace</button><SideRail open={open} /></div>
    }
    render(<RailProvider conversationId="a"><Asked /></RailProvider>)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.queryByRole('complementary')).toBeNull()
    fireEvent.click(screen.getByText('Workspace'))
    expect(await screen.findByText(/No plan, agents, commands or file changes/)).toBeTruthy()
  })
})
