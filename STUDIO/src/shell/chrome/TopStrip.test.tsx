/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'

import { NavigationProvider, useNavigation } from '@/stores/navigation'
import { WorkspaceProvider } from '@/stores/workspace/WorkspaceProvider'
import { KNOWN_VENDOR, modelFor } from '@/features/settings/providers/harness.fixtures'
import { TopStrip } from './TopStrip'

const native = vi.hoisted(() => ({
  desktop: false,
  closeWindow: vi.fn(async () => {}),
  minimizeWindow: vi.fn(async () => {}),
  toggleMaximizeWindow: vi.fn(async () => {}),
}))

vi.mock('@/platform/tauri', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/platform/tauri')>(),
  isTauri: () => native.desktop,
  closeWindow: native.closeWindow,
  minimizeWindow: native.minimizeWindow,
  toggleMaximizeWindow: native.toggleMaximizeWindow,
}))

/**
 * The header. On a narrow window the sidebar is a drawer over the page: its left
 * end and Personalize stand down while the drawer is out, and the right end stays
 * live so the panel button can close it.
 */

const BASE_URL = 'http://127.0.0.1:4319'

const MODEL = modelFor(KNOWN_VENDOR.id, 'claude-sonnet-4.5', ['medium'])

const CONVERSATION = {
  id: 'cnv_1',
  title: 'A conversation with a title long enough to matter',
  projectId: null,
  titleManual: false,
  pinned: false,
  archived: false,
  modelId: null,
  reasoningLevel: null,
  permissionMode: 'ask',
  createdAt: 1_000,
  lastTurnAt: 2_000,
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  vi.stubEnv('VITE_HARNESS_BASE_URL', BASE_URL)
  vi.stubEnv('VITE_HARNESS_TOKEN', 'a-test-credential')
  const fetch: typeof globalThis.fetch = async (input) => {
    const url = input instanceof URL ? input.toString() : typeof input === 'string' ? input : input.url
    if (url.includes('/models')) return jsonResponse([MODEL])
    if (url.includes('/defaults')) return jsonResponse({})
    if (url.includes('/connections')) return jsonResponse([KNOWN_VENDOR])
    if (url.includes('/conversations')) return jsonResponse([CONVERSATION])
    if (url.includes('/projects')) return jsonResponse([])
    return jsonResponse([])
  }
  vi.stubGlobal('fetch', fetch)
})

afterEach(() => {
  cleanup()
  native.desktop = false
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

/** Opens the chat route before the strip under test reads the store. */
function ChatOpener({ conversationId }: { conversationId: string }) {
  const { openChat } = useNavigation()
  const [opened, setOpened] = useState(false)
  if (opened) return null
  return (
    <button
      type="button"
      onClick={() => {
        openChat(conversationId)
        setOpened(true)
      }}
    >
      open chat
    </button>
  )
}

function mountStrip(props: { compact?: boolean; standard?: boolean; sidebarShown?: boolean; onOpenOverview?: () => void; workspaceOpen?: boolean; onToggleWorkspace?: () => void }) {
  return render(
    <NavigationProvider>
      <WorkspaceProvider>
        <ChatOpener conversationId="cnv_1" />
        <TopStrip {...props} />
      </WorkspaceProvider>
    </NavigationProvider>,
  )
}

function openChatRoute(): void {
  fireEvent.click(screen.getByRole('button', { name: 'open chat' }))
}

describe('the strip under a floating sidebar', () => {
  it('stands its left end and Personalize down while the drawer covers them', async () => {
    mountStrip({ compact: true, sidebarShown: true })
    openChatRoute()
    await screen.findByRole('button', { name: 'Show sidebar' })
    expect(screen.queryByText(CONVERSATION.title)).toBeNull()
    expect(screen.queryByRole('switch', { name: 'Personalize' })).toBeNull()
  })

  it('shows them again while the drawer is away', async () => {
    mountStrip({ compact: true, sidebarShown: false })
    openChatRoute()
    await screen.findByText(CONVERSATION.title)
    expect(screen.getByRole('switch', { name: 'Personalize' })).toBeTruthy()
  })

  it('keeps them beside a resident column, which covers nothing', async () => {
    mountStrip({ compact: false, sidebarShown: true })
    openChatRoute()
    await screen.findByText(CONVERSATION.title)
    expect(screen.getByRole('switch', { name: 'Personalize' })).toBeTruthy()
  })
})

describe('the selector', () => {
  it('lets a long title shrink rather than run under Personalize', () => {
    mountStrip({})
    const selector = screen.getByRole('button', { name: /^Conversations\. Current:/ })
    expect(selector.parentElement?.className).toContain('min-w-0')
  })

  it('names a new conversation on home', () => {
    mountStrip({})
    expect(screen.getByText('New conversation')).toBeTruthy()
  })

  it('finds a conversation and opens it', async () => {
    mountStrip({})
    fireEvent.click(screen.getByRole('button', { name: /^Conversations\. Current:/ }))
    fireEvent.change(await screen.findByRole('searchbox', { name: 'Search conversations' }), { target: { value: 'long enough' } })
    fireEvent.click(await screen.findByRole('menuitemradio', { name: CONVERSATION.title }))
    expect(await screen.findByRole('button', { name: `Conversations. Current: ${CONVERSATION.title}` })).toBeTruthy()
  })

  it('says so when nothing matches', async () => {
    mountStrip({})
    fireEvent.click(screen.getByRole('button', { name: /^Conversations\. Current:/ }))
    fireEvent.change(await screen.findByRole('searchbox', { name: 'Search conversations' }), { target: { value: 'zzz' } })
    expect((await screen.findByRole('status')).textContent).toContain('zzz')
  })
})

describe('the controls', () => {
  it.each([false, true])('keeps Standard controls before the title with a resident sidebar shown: %s', (sidebarShown) => {
    native.desktop = true
    mountStrip({ compact: false, sidebarShown })
    const selector = screen.getByRole('button', { name: /^Conversations\. Current:/ })
    const controls = screen.getByRole('group', { name: 'Window controls' })
    expect(within(controls).getAllByRole('button')).toHaveLength(3)
    expect(controls.compareDocumentPosition(selector) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Close' })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Maximize' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show sidebar' }))
    expect(screen.getByRole('button', { name: 'Hide sidebar' })).toBeTruthy()
  })

  it('keeps the Standard controls when Overview makes the sidebar float', () => {
    native.desktop = true
    mountStrip({ compact: true, standard: true })
    expect(screen.getByRole('group', { name: 'Window controls' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Minimize' })).toBeTruthy()
  })

  it('keeps Compact window controls at the right of the title', () => {
    native.desktop = true
    mountStrip({ compact: true })
    const selector = screen.getByRole('button', { name: /^Conversations\. Current:/ })
    const close = screen.getByRole('button', { name: 'Close' })
    expect(selector.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Maximize' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Minimize' })).toBeNull()
    expect(screen.queryByRole('group', { name: 'Window controls' })).toBeNull()
  })

  it('shows Personalize and capture as not yet working', () => {
    mountStrip({})
    expect(screen.getByRole('switch', { name: 'Personalize' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Screen capture is coming soon' }).hasAttribute('disabled')).toBe(true)
  })

  it('offers no conversation actions before there is a conversation', async () => {
    mountStrip({})
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    expect(await screen.findByRole('menuitem', { name: /Settings/ })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'Rename' })).toBeNull()
  })

  it('opens Overview from the menu while it is folded', async () => {
    const onOpenOverview = vi.fn()
    mountStrip({ onOpenOverview })
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Overview' }))
    expect(onOpenOverview).toHaveBeenCalledOnce()
  })

  it('names the central work area separately from the activity overview', () => {
    const onToggleWorkspace = vi.fn()
    mountStrip({ onToggleWorkspace })
    fireEvent.click(screen.getByRole('button', { name: 'Show Workspace' }))
    expect(onToggleWorkspace).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: 'Show File Viewer' })).toBeNull()
  })

  it('renames the open conversation where its title stood', async () => {
    mountStrip({})
    openChatRoute()
    await screen.findByText(CONVERSATION.title)
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }))
    expect((await screen.findByDisplayValue(CONVERSATION.title))).toBeTruthy()
  })
})
