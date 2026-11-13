/** @vitest-environment jsdom */
import { useEffect } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OverviewProvider, useOverview } from '@/stores/overview'
import type { PlanSnapshot } from '@/platform/harness'
import { SHELL } from '@/design/tokens'
import { OverviewPanel } from './OverviewPanel'

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

function Overview() {
  const { open, publishActivity, expand } = useOverview()
  useEffect(() => { publishActivity('a', { plan, agents: [], jobs: [], turns: [] }) }, [publishActivity])
  return <div><button onClick={expand}>Reopen</button><OverviewPanel open={open} /></div>
}

describe('the docked Overview', () => {
  it('aligns its title and close control with the conversation header row', () => {
    render(<OverviewProvider conversationId="a"><OverviewPanel open /></OverviewProvider>)
    const header = screen.getByRole('heading', { name: 'Overview' }).closest('header')
    expect(header?.style.height).toBe(`${SHELL.topStrip.height}px`)
    expect(screen.getByRole('button', { name: 'Collapse Overview' }).closest('header')).toBe(header)
  })
  it('lists activity, opens one thing, and steps back with Escape before collapsing', async () => {
    render(<OverviewProvider conversationId="a"><Overview /></OverviewProvider>)
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
      const { open, publishActivity } = useOverview()
      useEffect(() => { publishActivity('a', { plan: null, agents: [], jobs: [], turns: [] }) }, [publishActivity])
      return <OverviewPanel open={open} />
    }
    render(<OverviewProvider conversationId="a"><Idle /></OverviewProvider>)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.queryByRole('complementary')).toBeNull()
  })

  it('opens on request even with nothing in it, and says so', async () => {
    function Asked() {
      const { open, publishActivity, openOverview } = useOverview()
      useEffect(() => { publishActivity('a', { plan: null, agents: [], jobs: [], turns: [] }) }, [publishActivity])
      return <div><button onClick={openOverview}>Overview</button><OverviewPanel open={open} /></div>
    }
    render(<OverviewProvider conversationId="a"><Asked /></OverviewProvider>)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.queryByRole('complementary')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Overview' }))
    expect(await screen.findByText(/No plan, agents, commands or file changes/)).toBeTruthy()
  })
})
