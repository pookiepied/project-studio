/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'

import { NavigationProvider, useNavigation } from '@/stores/navigation'
import { WorkspaceProvider } from '@/stores/workspace/WorkspaceProvider'
import { KNOWN_VENDOR, modelFor } from '@/features/settings/connections/harness.fixtures'
import { TurnMenu } from './TurnMenu'

/**
 * The model picker, against the wire contract.
 *
 * Like the settings pane's tests, nothing here mocks a module of ours: the
 * harness is a stubbed `fetch` answering the same bodies the routes serve, so
 * what is exercised is the catalog load, the states it can arrive in, and -
 * the whole point of the task - the writes a pick makes: the index PATCH that
 * settles a conversation's model and reasoning, carrying exactly what the
 * harness contract names.
 */

const BASE_URL = 'http://127.0.0.1:4319'

const REASONING_MODEL = modelFor(KNOWN_VENDOR.id, 'claude-sonnet-4.5', [
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
])
const FLAT_MODEL = modelFor(KNOWN_VENDOR.id, 'jamba-large-1.7')

const CONVERSATION = {
  id: 'cnv_1',
  title: 'A held conversation',
  projectId: null,
  titleManual: false,
  pinned: false,
  archived: false,
  modelId: null,
  reasoningLevel: null,
  createdAt: 1_000,
  lastTurnAt: 2_000,
}

interface Call {
  readonly url: string
  readonly method: string
  readonly body: string | null
}

type Route = (url: string, method: string) => Response

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function stubFetch(route: Route): Call[] {
  const calls: Call[] = []
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = input instanceof URL ? input.toString() : String(input)
    const method = init?.method ?? 'GET'
    calls.push({ url, method, body: typeof init?.body === 'string' ? init.body : null })
    return route(url, method)
  }
  vi.stubGlobal('fetch', fetch)
  return calls
}

/** The index and the catalog, served the way the harness serves them. */
function defaultRoute(models: unknown): Route {
  return (url, method) => {
    if (url.includes('/models')) return jsonResponse(models)
    if (url.includes('/defaults')) return jsonResponse({})
    if (url.includes('/connections')) return jsonResponse([KNOWN_VENDOR])
    if (url.includes('/conversations') && method === 'GET') {
      return jsonResponse([CONVERSATION])
    }
    if (url.includes('/conversations') && method === 'PATCH') {
      return jsonResponse({ ...CONVERSATION })
    }
    if (url.includes('/projects')) return jsonResponse([])
    return jsonResponse([])
  }
}

function harnessConfigured() {
  vi.stubEnv('VITE_HARNESS_BASE_URL', BASE_URL)
  vi.stubEnv('VITE_HARNESS_TOKEN', 'a-test-credential')
}

/** Opens the conversation the picker should settle its choices onto. */
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

function mountPicker(options: { conversationId?: string } = {}) {
  return render(
    <NavigationProvider>
      <WorkspaceProvider>
        {options.conversationId !== undefined ? (
          <ChatOpener conversationId={options.conversationId} />
        ) : null}
        <TurnMenu />
      </WorkspaceProvider>
    </NavigationProvider>,
  )
}

/** The menu's panel exists only while open; everything below needs it open. */
async function openModelPanel() {
  fireEvent.click(screen.getByRole('button', { name: 'Turn settings' }))
  await screen.findByText('Studio default')
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('the model picker', () => {
  it('names the no-connections state instead of showing models that do not exist', async () => {
    harnessConfigured()
    stubFetch(defaultRoute([]))
    mountPicker()

    await openModelPanel()
    await screen.findByText(/No connections yet/)
    expect(screen.getByText('Open Settings')).toBeTruthy()
    // The panel offers no invented rows beside the sentence. (The trigger's
    // own label legitimately reads "Studio default" - it is the harness's
    // default the conversation rides on until a connection exists.)
    const menu = screen.getByRole('menu')
    expect(menu.textContent).not.toContain('claude-sonnet-4.5')
    expect(menu.textContent).not.toContain('Work Anthropic')
  })

  it('names the no-harness state', async () => {
    vi.stubEnv('VITE_HARNESS_BASE_URL', undefined)
    vi.stubEnv('VITE_HARNESS_TOKEN', undefined)
    stubFetch(defaultRoute([]))
    mountPicker()

    await openModelPanel()
    await screen.findByText(/No harness is running/)
  })

  it('groups models under their connection and marks each model with its author', async () => {
    harnessConfigured()
    mountPicker()
    stubFetch(defaultRoute([REASONING_MODEL]))

    await openModelPanel()
    await screen.findByText('Work Anthropic')
    // The panel renders in a portal, so the mark is queried on the document.
    // The row's mark is the model's own author, resolved from the vendor the
    // connection draws from - while the group header wears the connection's
    // own vendor.
    expect(document.body.querySelector('[data-provider="anthropic"]')).not.toBeNull()
    expect(screen.getByText('claude-sonnet-4.5')).toBeTruthy()
  })

  it('hides the reasoning control entirely for a model that cannot reason', async () => {
    harnessConfigured()
    stubFetch(defaultRoute([FLAT_MODEL]))
    mountPicker()

    await openModelPanel()
    await screen.findByText('jamba-large-1.7')
    // Present and inert would be a control that lies; it is absent instead.
    expect(screen.queryByText('Reasoning')).toBeNull()
  })

  it('settles a pick onto the conversation through an index PATCH', async () => {
    harnessConfigured()
    const calls = stubFetch(defaultRoute([REASONING_MODEL]))
    mountPicker({ conversationId: 'cnv_1' })

    // Open the conversation first, so the picker is holding a record.
    fireEvent.click(screen.getByText('open chat'))

    await openModelPanel()
    fireEvent.click(await screen.findByText('claude-sonnet-4.5'))

    await waitFor(() => {
      const patch = calls.find(
        (call) => call.method === 'PATCH' && call.url.endsWith('/api/conversations/cnv_1'),
      )
      expect(patch).toBeDefined()
      // The body is the harness contract's own vocabulary: the runtime
      // reference and the reasoning choice, never a synonym for either.
      expect(JSON.parse(patch?.body ?? '{}')).toEqual({
        modelId: 'anthropic/claude-sonnet-4.5',
        reasoningLevel: 'default',
      })
    })

    // The pick lands in the trigger at once, wearing the model's own name.
    expect(screen.getByRole('button', { name: 'Turn settings' }).textContent).toContain(
      'claude-sonnet-4.5',
    )
  })

  it('offers Default first and the model levels as steps of one dial', async () => {
    harnessConfigured()
    stubFetch(defaultRoute([REASONING_MODEL]))
    mountPicker()

    await openModelPanel()
    // The reasoning control belongs to a selected model: pick one first. The
    // pick closes the menu, so it is reopened before reading its steps.
    fireEvent.click(await screen.findByText('claude-sonnet-4.5'))
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Turn settings' }))
    fireEvent.click(await screen.findByText('Reasoning'))

    // One dial, whose steps are Default then the model's own levels: seven
    // stops for this model, resting on Default.
    const slider = screen.getByRole('slider', { name: 'Reasoning effort' })
    expect(slider.getAttribute('max')).toBe('6')
    expect(slider.getAttribute('aria-valuetext')).toBe('Default')
    expect(screen.getByText("The provider's own default")).toBeTruthy()

    // Dragging to the top end names Max; one below it names X-high - the
    // level the old vocabulary was missing entirely.
    fireEvent.change(slider, { target: { value: '6' } })
    expect(screen.getByText('Max')).toBeTruthy()
    fireEvent.change(slider, { target: { value: '5' } })
    expect(screen.getByText('X-high')).toBeTruthy()
  })
})
