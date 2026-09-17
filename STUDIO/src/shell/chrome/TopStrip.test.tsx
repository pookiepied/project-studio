/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'

import { NavigationProvider, useNavigation } from '@/stores/navigation'
import { WorkspaceProvider } from '@/stores/workspace/WorkspaceProvider'
import { KNOWN_VENDOR, modelFor } from '@/features/settings/providers/harness.fixtures'
import { TopStrip } from './TopStrip'

/**
 * What the floating sidebar does to the strip.
 *
 * On a narrow window the sidebar is a drawer over the page, and the strip is
 * page furniture: its toggle would sit under the drawer's brand band, and its
 * centred title would paint on top of the drawer's rows - the two reported
 * overlaps. While the drawer is out, the toggle rides to the drawer's right
 * edge and the title stands down. A resident column (the desktop reading)
 * takes space instead of covering anything, so there it must change nothing.
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
  permissionMode: 'manual',
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

function mountStrip(props: { compact?: boolean; sidebarShown?: boolean }) {
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
  it('hides the centred title while the drawer covers the strip', async () => {
    mountStrip({ compact: true, sidebarShown: true })
    openChatRoute()
    await screen.findByRole('button', { name: 'Turn settings' })
    expect(screen.queryByText(CONVERSATION.title)).toBeNull()
  })

  it('rides the toggle to the drawer\'s right edge, out from under its brand band', async () => {
    mountStrip({ compact: true, sidebarShown: true })
    openChatRoute()
    await screen.findByRole('button', { name: 'Turn settings' })

    const toggle = screen.getByRole('button', { name: 'Show sidebar' })
    // Framer carries the shift on the cluster as a transform; jsdom has no
    // animation clock, so the value is read off the first settled frame.
    const cluster = toggle.closest('div') ?? toggle
    const shifted = await vi.waitFor(() => {
      const transform = cluster.style.transform
      expect(transform).toContain('236')
      return transform
    })
    expect(shifted).toBeTruthy()
  })

  it('changes nothing while the drawer is away, whatever the width', async () => {
    mountStrip({ compact: true, sidebarShown: false })
    openChatRoute()
    await screen.findByRole('button', { name: 'Turn settings' })
    expect(screen.getByText(CONVERSATION.title)).toBeTruthy()
  })

  it('keeps the resident reading on the desktop: title shown, toggle where it was', async () => {
    mountStrip({ compact: false, sidebarShown: true })
    openChatRoute()
    await screen.findByRole('button', { name: 'Turn settings' })
    expect(screen.getByText(CONVERSATION.title)).toBeTruthy()

    // The store's own column is closed here, so the toggle reads "show"; the
    // assertion is about its position, not its label.
    const toggle = screen.getByRole('button', { name: 'Show sidebar' })
    const cluster = toggle.closest('div') ?? toggle
    expect(cluster.style.transform).not.toContain('236')
  })
})
