/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Sidebar } from './Sidebar'

/**
 * The left column holds conversations and projects on the app surfaces, and the
 * settings tree while Settings is the route (`SettingsNav`). The stores are
 * stubbed rather than mounted: what is under test here is what the column holds,
 * not the state machines behind it.
 */

const CONVERSATION = {
  id: 'cnv_1',
  title: 'A conversation being read',
  projectId: null,
  titleManual: false,
  pinned: false,
  archived: false,
  modelId: null,
  reasoningLevel: null,
  createdAt: 1_000,
  lastTurnAt: 2_000,
}

type Route = { kind: 'home' } | { kind: 'chat'; conversationId: string } | { kind: 'settings'; sectionId: string }

const navigation = {
  route: { kind: 'home' } as Route,
  toggleSidebar: vi.fn(),
  goHome: vi.fn(),
  openSettings: vi.fn(),
  leaveSettings: vi.fn(),
  setPaletteOpen: vi.fn(),
}

vi.mock('@/stores/navigation', () => ({ useNavigation: () => navigation }))

vi.mock('@/stores/workspace', () => ({
  useWorkspace: () => ({
    projects: [],
    conversations: [CONVERSATION],
    // Ready, so the column shows the list rather than its states; the states
    // themselves are held in `SidebarStates.test.tsx`.
    storePhase: { status: 'ready', error: null },
    ensureStore: vi.fn(async () => true),
    rename: vi.fn(),
    togglePin: vi.fn(),
    setArchived: vi.fn(),
    remove: vi.fn(),
  }),
  useLiveWork: () => ({ running: new Set<string>() }),
  useDetachConversation: () => vi.fn(),
}))

vi.mock('@/features/chat/connection/fork', () => ({
  useForkConversation: () => ({ forkWhole: vi.fn() }),
}))

afterEach(cleanup)

describe('the sidebar column while Settings is the route', () => {
  it('replaces the conversations with the settings tree', () => {
    navigation.route = { kind: 'settings', sectionId: 'general' }
    render(<Sidebar open compact={false} onNewProject={() => {}} />)

    expect(screen.getByRole('navigation', { name: 'Settings sections' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Application' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Account' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Providers' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Extensions' })).toBeTruthy()

    expect(screen.queryByText('A conversation being read')).toBeNull()
    expect(screen.queryByRole('button', { name: 'New conversation' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Settings' })).toBeNull()
  })

  it('leaves Settings from the Back control', () => {
    navigation.route = { kind: 'settings', sectionId: 'general' }
    render(<Sidebar open compact={false} onNewProject={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(navigation.leaveSettings).toHaveBeenCalledTimes(1)
  })
})

describe('the sidebar column on the app surfaces', () => {
  it('holds the conversations and no settings tree', () => {
    navigation.route = { kind: 'chat', conversationId: CONVERSATION.id }
    render(<Sidebar open compact={false} onNewProject={() => {}} />)

    expect(screen.getByText('A conversation being read')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'New conversation' })).toBeTruthy()
    expect(screen.queryByRole('navigation', { name: 'Settings sections' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
  })

  it('does not offer the unused Account shortcut', () => {
    navigation.route = { kind: 'chat', conversationId: CONVERSATION.id }
    render(<Sidebar open compact={false} onNewProject={() => {}} />)

    expect(screen.queryByRole('button', { name: 'Account' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy()
  })
})
