/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Sidebar } from './Sidebar'

/**
 * One list at a time.
 *
 * The left column holds where you can go. On the app surfaces that is
 * conversations and projects; while Settings is the route it is the settings
 * tree, in the same column, at the same width, with a way back at the top --
 * and the conversations are off the screen, because a column showing both
 * lists is the second-nav-column mistake this task exists to end.
 *
 * The stores are stubbed rather than mounted: what is under test here is which
 * list the column holds, not the state machines behind either list. The
 * settings route is reached exactly as the shortcut and the palette reach it,
 * through the navigation store's own shape of the route.
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
  sidebarOpen: true,
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
    running: new Set<string>(),
    rename: vi.fn(),
    togglePin: vi.fn(),
    setArchived: vi.fn(),
    remove: vi.fn(),
  }),
  useDetachConversation: () => vi.fn(),
}))

vi.mock('@/features/chat/fork', () => ({
  useForkConversation: () => ({ forkWhole: vi.fn() }),
}))

vi.mock('@/stores/rail', () => ({
  useRail: () => ({ open: false, width: 420 }),
}))

// jsdom has no matchMedia; the column reads the breakpoint with it.
vi.stubGlobal('matchMedia', () => ({
  matches: false,
  addEventListener: () => {},
  removeEventListener: () => {},
}))

afterEach(cleanup)

describe('the sidebar column while Settings is the route', () => {
  it('holds the settings tree -- groups and rows -- and a way back at the top', () => {
    navigation.route = { kind: 'settings', sectionId: 'general' }
    render(<Sidebar onNewProject={() => {}} />)

    expect(screen.getByRole('navigation', { name: 'Settings sections' })).toBeTruthy()
    // Group headings are the tree's `<p>` labels. One group shares its name
    // with a row inside it -- Account, which is filed under itself -- so the
    // query names the heading kind, not just the words.
    for (const group of ['Application', 'Account', 'Models', 'Extensions', 'Agent', 'Coding', 'Archived']) {
      expect(
        screen.getByText((_content, element) => element?.tagName === 'P' && _content === group),
      ).toBeTruthy()
    }
    expect(screen.getByRole('button', { name: 'Providers' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy()
  })

  it('holds no conversations, no project controls and no footer shortcuts', () => {
    navigation.route = { kind: 'settings', sectionId: 'general' }
    render(<Sidebar onNewProject={() => {}} />)

    expect(screen.queryByText('A conversation being read')).toBeNull()
    expect(screen.queryByText('Conversations')).toBeNull()
    expect(screen.queryByRole('button', { name: 'New conversation' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Settings' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Sidebar options' })).toBeNull()
    // Account the row is the tree's own; Account the footer shortcut is gone.
    expect(screen.getAllByRole('button', { name: 'Account' })).toHaveLength(1)
  })
})

describe('the sidebar column on the app surfaces', () => {
  it('holds the conversations and no settings tree', () => {
    navigation.route = { kind: 'chat', conversationId: CONVERSATION.id }
    render(<Sidebar onNewProject={() => {}} />)

    expect(screen.getByText('A conversation being read')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'New conversation' })).toBeTruthy()
    expect(screen.queryByRole('navigation', { name: 'Settings sections' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
  })
})
