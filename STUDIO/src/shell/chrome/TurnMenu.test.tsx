/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'

import { NavigationProvider, useNavigation } from '@/stores/navigation'
import { WorkspaceProvider } from '@/stores/workspace/WorkspaceProvider'
import { KNOWN_VENDOR, modelFor } from '@/features/settings/providers/harness.fixtures'
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
 *
 * Browsing and searching are read-only until the user selects a model row.
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
const ANOTHER_FLAT = modelFor(KNOWN_VENDOR.id, 'vox-small-1')
const THIRD_FLAT = modelFor(KNOWN_VENDOR.id, 'kappa-mini')
const FOURTH_FLAT = modelFor(KNOWN_VENDOR.id, 'delta-pro')

const CONVERSATION = {
  id: 'cnv_1',
  title: 'A held conversation',
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
    // A `Request` stringifies to "[object Request]"; its url is what these
    // assertions are about.
    const url =
      input instanceof URL ? input.toString() : typeof input === 'string' ? input : input.url
    const method = init?.method ?? 'GET'
    calls.push({ url, method, body: typeof init?.body === 'string' ? init.body : null })
    return route(url, method)
  }
  vi.stubGlobal('fetch', fetch)
  return calls
}

/** The index and the catalog, served the way the harness serves them.
 *
 * `defaults` is the Chat slot as Settings writes it: the harness routes a
 * conversation with no model of its own through the stable alias, and that
 * alias resolves to exactly this. Empty is a machine where nobody set one. */
function defaultRoute(models: unknown, defaults: unknown = {}, connections: unknown = [KNOWN_VENDOR]): Route {
  return (url, method) => {
    if (url.includes('/models')) return jsonResponse(models)
    if (url.includes('/defaults')) return jsonResponse(defaults)
    if (url.includes('/connections')) return jsonResponse(connections)
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
        <SettingsProbe />
      </WorkspaceProvider>
    </NavigationProvider>,
  )
}

function SettingsProbe() {
  const { route } = useNavigation()
  return route.kind === 'settings' ? <p>Settings section: {route.sectionId}</p> : null
}

/** The menu's panel exists only while open; everything below needs it open.
 * The wait is for the panel itself, not a row in it: the trigger's own label
 * is often the same words, and the catalog may still be loading. */
async function openModelPanel() {
  fireEvent.click(screen.getByRole('button', { name: 'Turn settings' }))
  await screen.findByRole('searchbox', { name: 'Search models' })
}

async function openProviders() {
  await openModelPanel()
  fireEvent.click(await screen.findByRole('menuitem', { name: 'More models' }))
  return within(await screen.findByRole('menu', { name: 'More models' }))
}

async function openContextPanel() {
  await openModelPanel()
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Context window' }))
  await screen.findByRole('button', { name: 'Context window' })
}

async function selectProviderModel(name: string | RegExp) {
  const providers = await openProviders()
  fireEvent.click(await providers.findByRole('menuitem', { name: 'Work Anthropic' }))
  fireEvent.click(await providers.findByRole('menuitemradio', { name }))
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
    stubFetch(defaultRoute([], {}, []))
    mountPicker()

    await openModelPanel()
    await screen.findByText(/No connections yet/)
    expect(screen.getByText('Open Settings')).toBeTruthy()
    // The panel offers no invented rows beside the sentence. (The trigger's
    // own label legitimately reads "Choose a model" - nothing is selected,
    // and the picker says so.)
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

  it('says "Choose a model" while nothing is picked, not a default dressed as a choice', async () => {
    harnessConfigured()
    stubFetch(defaultRoute([REASONING_MODEL]))
    mountPicker()

    const trigger = screen.getByRole('button', { name: 'Turn settings' })
    expect(trigger.textContent).toContain('Choose a model')
    expect(trigger.textContent).not.toContain('Default')

    // The resting choice is still offered - named for what it is.
    await openModelPanel()
    expect(await screen.findByRole('menuitemradio', { name: 'Default' })).toBeTruthy()
  })

  it('keeps the first level to three shortcuts and the provider entry', async () => {
    harnessConfigured()
    stubFetch(defaultRoute([REASONING_MODEL, FLAT_MODEL, THIRD_FLAT, FOURTH_FLAT]))
    mountPicker()

    await openModelPanel()
    await screen.findByRole('menuitem', { name: 'More models' })
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(4)
    expect(screen.queryByRole('menuitemradio', { name: 'delta-pro' })).toBeNull()
    expect(screen.queryByText('Work Anthropic')).toBeNull()
  })

  it('shows providers first and selects a model directly from the connection', async () => {
    harnessConfigured()
    stubFetch(defaultRoute([REASONING_MODEL]))
    mountPicker()

    const providers = await openProviders()
    const row = await providers.findByRole('menuitem', { name: 'Work Anthropic' })
    expect(row.querySelector('[data-provider="anthropic"][data-mark="logo"]')).not.toBeNull()
    expect(providers.queryByRole('menuitemradio')).toBeNull()
    fireEvent.click(row)
    const model = await providers.findByRole('menuitemradio', { name: 'claude-sonnet-4.5' })
    expect(providers.queryByText(/Input price|Output price|Capabilities|Vision/)).toBeNull()
    fireEvent.click(model)
    expect(screen.getByRole('button', { name: 'Turn settings' }).textContent).toContain('claude-sonnet-4.5')
  })

  it('narrows the picker as the search is typed and says so when nothing matches', async () => {
    harnessConfigured()
    stubFetch(defaultRoute([REASONING_MODEL, FLAT_MODEL]))
    mountPicker()

    await openModelPanel()
    await screen.findByRole('menuitem', { name: 'More models' })
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search models' }), {
      target: { value: 'jamba' },
    })
    // The needle matches by name; the other model's row is gone. The
    // connection heading stays - it still serves the one model that matched.
    expect(await screen.findByRole('menuitemradio', { name: /jamba-large-1\.7/ })).toBeTruthy()
    expect(screen.queryByRole('menuitemradio', { name: /claude-sonnet/ })).toBeNull()
    expect(screen.getByRole('region', { name: 'Work Anthropic' })).toBeTruthy()

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search models' }), {
      target: { value: 'nothing at all' },
    })
    await screen.findByText(/No models match "nothing at all"/)
  })

  it('opens provider settings without making a model pick', async () => {
    harnessConfigured()
    const calls = stubFetch(defaultRoute([REASONING_MODEL]))
    mountPicker()

    const providers = await openProviders()
    fireEvent.click(providers.getByRole('menuitem', { name: 'Manage providers' }))
    expect(await screen.findByText('Settings section: models')).toBeTruthy()
    expect(calls.some((call) => call.method === 'PATCH')).toBe(false)
  })

  it('offers the same model name independently through each connection', async () => {
    harnessConfigured()
    const other = { ...KNOWN_VENDOR, id: 'other', catalogProvider: 'openrouter', displayName: 'Second provider' }
    const calls = stubFetch(defaultRoute([REASONING_MODEL, { ...REASONING_MODEL, connectionId: other.id }], {}, [KNOWN_VENDOR, other]))
    mountPicker({ conversationId: 'cnv_1' })
    fireEvent.click(screen.getByText('open chat'))

    await openModelPanel()
    await screen.findByRole('menuitem', { name: 'More models' })
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'claude-sonnet' } })
    expect(screen.getAllByRole('menuitemradio', { name: 'claude-sonnet-4.5' })).toHaveLength(2)
    const second = within(screen.getByRole('region', { name: 'Second provider' }))
    fireEvent.click(second.getByRole('menuitemradio', { name: 'claude-sonnet-4.5' }))
    await waitFor(() => {
      const patch = calls.find((call) => call.method === 'PATCH')
      expect(JSON.parse(patch?.body ?? '{}').modelId).toBe('openrouter/claude-sonnet-4.5')
    })
  })

  it('shows temporary chat as unavailable without mutating a conversation', async () => {
    harnessConfigured()
    const calls = stubFetch(defaultRoute([REASONING_MODEL]))
    mountPicker({ conversationId: 'cnv_1' })
    fireEvent.click(screen.getByText('open chat'))
    await openModelPanel()
    const control = screen.getByRole<HTMLButtonElement>('switch', { name: 'Temporary chat' })
    expect(control.disabled).toBe(true)
    expect(control.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(control)
    expect(calls.some((call) => ['PATCH', 'POST', 'DELETE'].includes(call.method))).toBe(false)
  })

  it('keeps hidden models and disabled providers out of direct search and browsing', async () => {
    harnessConfigured()
    const disabled = { ...KNOWN_VENDOR, id: 'off', catalogProvider: 'openrouter', displayName: 'Disabled provider', enabled: false }
    const hidden = { ...FLAT_MODEL, hidden: true }
    stubFetch(defaultRoute([
      REASONING_MODEL,
      hidden,
      { ...THIRD_FLAT, connectionId: disabled.id },
    ], {}, [KNOWN_VENDOR, disabled]))
    localStorage.setItem('studio.recent-models', JSON.stringify(['anthropic/jamba-large-1.7']))
    mountPicker()

    const providers = await openProviders()
    expect(providers.queryByRole('menuitem', { name: 'Disabled provider' })).toBeNull()
    fireEvent.click(providers.getByRole('menuitem', { name: 'Work Anthropic' }))
    await providers.findByRole('menuitemradio', { name: 'claude-sonnet-4.5' })
    expect(providers.queryByRole('menuitemradio', { name: 'jamba-large-1.7' })).toBeNull()
    fireEvent.click(providers.getByRole('button', { name: 'All providers' }))
    fireEvent.click(providers.getByRole('button', { name: 'Providers' }))
    const search = screen.getByRole('searchbox')
    for (const query of ['jamba', 'kappa']) {
      fireEvent.change(search, { target: { value: query } })
      expect(await screen.findByText(`No models match "${query}".`)).toBeTruthy()
    }
  })

  it('hides the reasoning control entirely for a model that cannot reason', async () => {
    harnessConfigured()
    stubFetch(defaultRoute([FLAT_MODEL]))
    mountPicker()

    await selectProviderModel('jamba-large-1.7')
    await openModelPanel()
    await screen.findByRole('menuitem', { name: 'Context window' })
    expect(screen.queryByRole('menuitem', { name: /^Reasoning/ })).toBeNull()
  })

  it('clears an unsupported effort when the new model is selected', async () => {
    harnessConfigured()
    const calls = stubFetch(defaultRoute([REASONING_MODEL, FLAT_MODEL]))
    mountPicker({ conversationId: 'cnv_1' })
    fireEvent.click(screen.getByText('open chat'))
    await selectProviderModel('claude-sonnet-4.5')
    await openModelPanel()
    fireEvent.click(await screen.findByRole('menuitem', { name: /^Reasoning/ }))
    const slider = await screen.findByRole('slider', { name: 'Reasoning effort' })
    fireEvent.change(slider, { target: { value: '5' } })
    await waitFor(() => expect(calls.some((call) =>
      call.method === 'PATCH' && JSON.parse(call.body ?? '{}').reasoningLevel === 'max',
    )).toBe(true))

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    await selectProviderModel('jamba-large-1.7')
    await waitFor(() => {
      const patch = calls.filter((call) => call.method === 'PATCH').at(-1)
      expect(JSON.parse(patch?.body ?? '{}')).toEqual({
        modelId: 'anthropic/jamba-large-1.7',
        reasoningLevel: null,
      })
    })
  })

  it('settles a pick through an index PATCH only after selecting a model row', async () => {
    harnessConfigured()
    const calls = stubFetch(defaultRoute([REASONING_MODEL]))
    mountPicker({ conversationId: 'cnv_1' })

    // Open the conversation first, so the picker is holding a record.
    fireEvent.click(screen.getByText('open chat'))

    const providers = await openProviders()
    fireEvent.click(await providers.findByRole('menuitem', { name: 'Work Anthropic' }))
    const model = await providers.findByRole('menuitemradio', { name: 'claude-sonnet-4.5' })
    expect(
      calls.filter((call) => call.method === 'PATCH' && call.url.endsWith('/api/conversations/cnv_1')),
    ).toEqual([])
    fireEvent.click(model)
    await waitFor(() => {
      const patch = calls.find(
        (call) => call.method === 'PATCH' && call.url.endsWith('/api/conversations/cnv_1'),
      )
      expect(patch).toBeDefined()
      // The body is the harness contract's own vocabulary: the runtime
      // reference and the reasoning choice, never a synonym for either. An
      // untouched dial stays absent and the harness rests it on medium.
      expect(JSON.parse(patch?.body ?? '{}')).toEqual({
        modelId: 'anthropic/claude-sonnet-4.5',
        reasoningLevel: null,
      })
    })

    // The pick lands in the trigger at once, wearing the model's own name.
    expect(screen.getByRole('button', { name: 'Turn settings' }).textContent).toContain(
      'claude-sonnet-4.5',
    )
  })

  it('offers the last three explicit picks after the provider entry, most recent first', async () => {
    harnessConfigured()
    const calls = stubFetch(defaultRoute([FLAT_MODEL, ANOTHER_FLAT, THIRD_FLAT, FOURTH_FLAT]))
    mountPicker({ conversationId: 'cnv_1' })
    fireEvent.click(screen.getByText('open chat'))

    // Four picks, three seats: the oldest falls off the list entirely.
    for (const name of ['jamba-large-1\\.7', 'vox-small-1', 'kappa-mini', 'delta-pro']) {
      await selectProviderModel(new RegExp(name))
      const plain = name.replace('\\.', '.')
      await waitFor(() => {
        expect(
          calls.some(
            (call) =>
              call.method === 'PATCH' &&
              JSON.parse(call.body ?? '{}').modelId === `anthropic/${plain}`,
          ),
        ).toBe(true)
      })
    }

    await openModelPanel()
    await screen.findByRole('menuitem', { name: 'More models' })
    const menu = screen.getByRole('menu', { name: '' })
    expect(menu.textContent).toContain('delta-pro')
    expect(menu.textContent).toContain('kappa-mini')
    expect(menu.textContent).toContain('vox-small-1')
    expect(menu.textContent).not.toContain('jamba-large-1.7')
    expect(within(menu).getAllByRole('menuitemradio').map((row) => row.textContent)).toEqual([
      'Default', 'delta-pro', 'kappa-mini', 'vox-small-1',
    ])

    // A recent settles the same PATCH as a model selected through a provider.
    fireEvent.click(within(menu).getByText('kappa-mini'))
    await waitFor(() => {
      const patch = calls
        .filter((call) => call.method === 'PATCH' && call.url.endsWith('/api/conversations/cnv_1'))
        .at(-1)
      expect(JSON.parse(patch?.body ?? '{}')).toEqual({
        modelId: 'anthropic/kappa-mini',
        reasoningLevel: null,
      })
    })
  })

  it('keeps the recents honest: choosing the default records nothing', async () => {
    harnessConfigured()
    stubFetch(defaultRoute([FLAT_MODEL]))
    mountPicker({ conversationId: 'cnv_1' })
    fireEvent.click(screen.getByText('open chat'))

    // Choosing the harness's default is the resting state, not a pick; it
    // must not enter a list of names.
    await openModelPanel()
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Default' }))
    await openModelPanel()
    expect(localStorage.getItem('studio.recent-models')).toBeNull()
  })

  it('keeps the recents honest: a model the catalog no longer has stops appearing', async () => {
    harnessConfigured()
    const calls = stubFetch(defaultRoute([FLAT_MODEL]))
    const view = mountPicker({ conversationId: 'cnv_1' })
    fireEvent.click(screen.getByText('open chat'))

    await selectProviderModel('jamba-large-1.7')
    await waitFor(() => {
      expect(calls.some((call) => call.method === 'PATCH')).toBe(true)
    })

    // A fresh surface, and a harness that no longer offers the model: the
    // remembered name does not offer a row that cannot be sent to.
    view.unmount()
    stubFetch(defaultRoute([]))
    mountPicker({ conversationId: 'cnv_1' })
    fireEvent.click(screen.getByText('open chat'))

    await openModelPanel()
    expect(await screen.findByText(/No chat models available/)).toBeTruthy()
    expect(screen.queryByRole('menuitemradio', { name: 'jamba-large-1.7' })).toBeNull()
  })

  it('offers only the model levels as steps of one dial, resting on medium', async () => {
    harnessConfigured()
    stubFetch(defaultRoute([REASONING_MODEL]))
    mountPicker()

    await selectProviderModel('claude-sonnet-4.5')
    await openModelPanel()
    fireEvent.click(await screen.findByRole('menuitem', { name: /^Reasoning/ }))

    // One dial in the details pane, whose steps are the model's own levels:
    // six stops for this model, resting on medium, with no Default step.
    const slider = await screen.findByRole('slider', { name: 'Reasoning effort' })
    expect(slider.getAttribute('max')).toBe('5')
    expect(slider.getAttribute('aria-valuetext')).toBe('Medium')
    expect(screen.getByText('The everyday balance.')).toBeTruthy()
    expect(screen.queryByText("The provider's own default")).toBeNull()

    // Dragging to the top end names Max; one below it names X-high - the
    // level the old vocabulary was missing entirely.
    fireEvent.change(slider, { target: { value: '5' } })
    expect(screen.getByText('Max')).toBeTruthy()
    fireEvent.change(slider, { target: { value: '4' } })
    expect(screen.getByText('X-high')).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    await openModelPanel()
    const row = await screen.findByRole('menuitem', { name: /^Reasoning/ })
    expect(row.textContent).toContain('X-high')
    fireEvent.click(row)
    const settled = await screen.findByRole('slider', {
      name: 'Reasoning effort',
    })
    expect(settled.getAttribute('aria-valuetext')).toBe('X-high')
  })
})

/**
 * The context, where the model is.
 *
 * A fill is a fraction and the model is its denominator, so the window, the
 * name and the bar are one statement here rather than a ring in one corner
 * and a name in another. What is pinned: the window is stated under the name
 * a turn would actually use, the bar exists only where there is a transcript
 * to measure, and the strip stays quiet until the figure is worth reading.
 */
describe('the window the turn is measured against', () => {
  /** Picks a model in one click through the recents shortcut. */
  async function pickRecent(id: string, name: string) {
    localStorage.setItem('studio.recent-models', JSON.stringify([id]))
    await openModelPanel()
    fireEvent.click(within(screen.getByRole('menu')).getByText(name))
  }

  it('states the selected model window under its name', async () => {
    harnessConfigured()
    stubFetch(defaultRoute([FLAT_MODEL]))
    mountPicker({ conversationId: 'cnv_1' })
    fireEvent.click(await screen.findByText('open chat'))

    await pickRecent('anthropic/jamba-large-1.7', 'jamba-large-1.7')
    await openContextPanel()
    expect(await screen.findByText('200k context window')).toBeTruthy()
  })

  it('draws the bar on a conversation, and nothing to fill off one', async () => {
    harnessConfigured()
    stubFetch(defaultRoute([FLAT_MODEL]))
    mountPicker({ conversationId: 'cnv_1' })
    fireEvent.click(await screen.findByText('open chat'))

    await pickRecent('anthropic/jamba-large-1.7', 'jamba-large-1.7')
    await openContextPanel()
    expect(screen.getByRole('meter', { name: 'Context used' })).toBeTruthy()

    // Home has a composer and therefore a model, but no transcript - so there
    // is a window to name and nothing yet occupying it.
    cleanup()
    stubFetch(defaultRoute([FLAT_MODEL]))
    mountPicker()
    await pickRecent('anthropic/jamba-large-1.7', 'jamba-large-1.7')
    await openContextPanel()
    expect(screen.getByText('200k context window')).toBeTruthy()
    expect(screen.queryByRole('meter', { name: 'Context used' })).toBeNull()
  })

  it('draws the bar for a conversation riding the harness default', async () => {
    // The people most likely never to open this menu are the ones who never
    // named a model, and hiding the bar from them would hide it from exactly
    // the conversations nobody is watching the cost of.
    harnessConfigured()
    stubFetch(defaultRoute([FLAT_MODEL]))
    mountPicker({ conversationId: 'cnv_1' })
    fireEvent.click(await screen.findByText('open chat'))

    await openContextPanel()

    expect(await screen.findByText('No model chosen')).toBeTruthy()
    expect(screen.getByRole('meter', { name: 'Context used' })).toBeTruthy()
  })

  it('starts with search even when there is no selected model to describe', async () => {
    harnessConfigured()
    stubFetch(defaultRoute([FLAT_MODEL]))
    mountPicker()

    await openModelPanel()

    expect(await screen.findByRole('menuitemradio', { name: 'Default' })).toBeTruthy()
    expect(screen.getByRole('menu').querySelector('input, [role="separator"]')?.tagName).toBe('INPUT')
    expect(screen.queryByRole('menuitem', { name: 'Context window' })).toBeNull()
  })

  it('keeps context details behind a disclosure and names unavailable categories', async () => {
    harnessConfigured()
    stubFetch(defaultRoute([FLAT_MODEL]))
    mountPicker({ conversationId: 'cnv_1' })
    fireEvent.click(await screen.findByText('open chat'))

    await openContextPanel()
    await screen.findByRole('meter', { name: 'Context used' })
    expect(screen.queryByRole('group', { name: 'Context breakdown' })).toBeNull()
    for (const category of ['System prompt', 'Tools', 'Files', 'Conversation', 'Memory']) {
      expect(screen.getByText(category)).toBeTruthy()
    }
    expect(screen.getByText('Memory').nextElementSibling?.textContent).toBe('N/A')
    fireEvent.click(screen.getByRole('button', { name: 'Breakdown' }))
    expect(await screen.findByRole('group', { name: 'Context breakdown' })).toBeTruthy()
  })

  it('keeps the percentage off the strip until it is news', async () => {
    harnessConfigured()
    stubFetch(defaultRoute([FLAT_MODEL]))
    mountPicker({ conversationId: 'cnv_1' })
    fireEvent.click(await screen.findByText('open chat'))

    await pickRecent('anthropic/jamba-large-1.7', 'jamba-large-1.7')

    // Nothing has been sent, so the window is empty and the trigger says only
    // what it always said: which model. A "0%" here would be a number the
    // reader is invited to watch, and watching it is never the work.
    const trigger = screen.getByRole('button', { name: 'Turn settings' })
    expect(trigger.textContent).toContain('jamba-large-1.7')
    expect(trigger.textContent).not.toContain('%')
  })
})

/**
 * The model a conversation reaches when it names none of its own.
 *
 * The harness has always resolved this: no model on the conversation means
 * the stable alias, and the alias means the Chat slot from Settings. The
 * client loaded that slot at startup and never read it again, so the picker
 * said "Choose a model" about a conversation whose model was chosen, the
 * meter divided by a stand-in window, and the reasoning dial vanished
 * because "no model named" was being read as "no levels".
 */
describe('the Chat default, as the chat page sees it', () => {
  const CHAT_DEFAULT = { textGeneration: { connectionId: KNOWN_VENDOR.id, modelId: 'kappa-mini' } }

  it('names the model the turn will actually reach', async () => {
    harnessConfigured()
    stubFetch(defaultRoute([THIRD_FLAT], CHAT_DEFAULT))
    mountPicker({ conversationId: 'cnv_1' })
    fireEvent.click(await screen.findByText('open chat'))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Turn settings' }).textContent).toContain(
        'kappa-mini',
      ),
    )
  })

  it('says the name came from Settings, so the pin it is not is not implied', async () => {
    harnessConfigured()
    stubFetch(defaultRoute([THIRD_FLAT], CHAT_DEFAULT))
    mountPicker({ conversationId: 'cnv_1' })
    fireEvent.click(await screen.findByText('open chat'))

    await openContextPanel()
    expect(await screen.findByText(/Following the Chat default/)).toBeTruthy()
  })

  it('gives the dial back, which absence had taken away', async () => {
    // The consequence with teeth: a conversation on the default could not set
    // reasoning at all, because no model resolved meant no levels to offer.
    harnessConfigured()
    stubFetch(
      defaultRoute([REASONING_MODEL], {
        textGeneration: { connectionId: KNOWN_VENDOR.id, modelId: 'claude-sonnet-4.5' },
      }),
    )
    mountPicker({ conversationId: 'cnv_1' })
    fireEvent.click(await screen.findByText('open chat'))

    await openModelPanel()

    expect(await screen.findByRole('menuitem', { name: /^Reasoning/ })).toBeTruthy()
  })

  it('measures against the default model own window, not the stand-in', async () => {
    harnessConfigured()
    stubFetch(defaultRoute([THIRD_FLAT], CHAT_DEFAULT))
    mountPicker({ conversationId: 'cnv_1' })
    fireEvent.click(await screen.findByText('open chat'))

    await openContextPanel()
    expect(await screen.findByText('200k context window')).toBeTruthy()
  })

  it('still says nothing is chosen when nothing is', async () => {
    harnessConfigured()
    stubFetch(defaultRoute([THIRD_FLAT]))
    mountPicker({ conversationId: 'cnv_1' })
    fireEvent.click(await screen.findByText('open chat'))

    await openContextPanel()
    expect(await screen.findByText('No model chosen')).toBeTruthy()
    expect(screen.queryByText(/Following the Chat default/)).toBeNull()
  })
})

describe('the recents shortcut', () => {
  it('draws the check on the recent that is in force', async () => {
    // These rows and "Default" are one radio group over one question.
    // Filtering the current answer out of the group, which this did for a
    // day, left a check column that could never fill on any recent - a
    // reserved space meaning nothing, and no way to confirm the row you just
    // clicked was the row that took effect.
    harnessConfigured()
    stubFetch(defaultRoute([THIRD_FLAT, FOURTH_FLAT]))
    localStorage.setItem(
      'studio.recent-models',
      JSON.stringify(['anthropic/kappa-mini', 'anthropic/delta-pro']),
    )
    mountPicker({ conversationId: 'cnv_1' })
    fireEvent.click(await screen.findByText('open chat'))

    await openModelPanel()
    await screen.findByRole('menuitem', { name: 'More models' })
    fireEvent.click(within(screen.getByRole('menu')).getByText('kappa-mini'))

    await openModelPanel()
    const menu = within(screen.getByRole('menu'))
    const chosen = await menu.findByRole('menuitemradio', { name: /kappa-mini/ })
    expect(chosen.getAttribute('aria-checked')).toBe('true')
    expect(chosen.lastElementChild?.querySelector('svg')).not.toBeNull()
    expect(chosen.firstElementChild?.querySelector('[data-provider]')).not.toBeNull()
    expect(
      menu.getByRole('menuitemradio', { name: /delta-pro/ }).getAttribute('aria-checked'),
    ).toBe('false')
  })

  it('checks the default row instead while a conversation is only following', async () => {
    // Nothing in the list is the answer here, and every recent showing an
    // empty check is the correct reading of "not this one".
    harnessConfigured()
    stubFetch(defaultRoute([THIRD_FLAT]))
    localStorage.setItem('studio.recent-models', JSON.stringify(['anthropic/kappa-mini']))
    mountPicker({ conversationId: 'cnv_1' })
    fireEvent.click(await screen.findByText('open chat'))

    await openModelPanel()
    const menu = within(screen.getByRole('menu'))

    expect(
      (await menu.findByRole('menuitemradio', { name: 'Default' })).getAttribute(
        'aria-checked',
      ),
    ).toBe('true')
    expect(
      menu.getByRole('menuitemradio', { name: /kappa-mini/ }).getAttribute('aria-checked'),
    ).toBe('false')
  })
})

describe('the picker on the way out', () => {
  it('clears search with a Studio icon and returns focus without replacing the field', async () => {
    harnessConfigured()
    stubFetch(defaultRoute([FLAT_MODEL]))
    mountPicker()

    await openModelPanel()
    await screen.findByRole('menuitem', { name: 'More models' })
    const search = screen.getByRole('searchbox')
    fireEvent.change(search, { target: { value: 'jamba' } })
    await screen.findByRole('region', { name: 'Work Anthropic' })
    const clear = screen.getByRole('button', { name: 'Clear search' })
    expect(clear.querySelector('.studio-icon')).not.toBeNull()
    fireEvent.click(clear)
    expect(screen.getByRole('searchbox')).toBe(search)
    expect(search).toHaveProperty('value', '')
    expect(document.activeElement).toBe(search)
    expect(screen.queryByRole('region', { name: 'Work Anthropic' })).toBeNull()
    expect(await screen.findByRole('menuitem', { name: 'More models' })).toBeTruthy()
  })

  it('applies a unique search match with Enter and clears the query on reopen', async () => {
    harnessConfigured()
    stubFetch(defaultRoute([FLAT_MODEL]))
    mountPicker({ conversationId: 'cnv_1' })
    fireEvent.click(await screen.findByText('open chat'))

    await openModelPanel()
    await screen.findByRole('menuitem', { name: 'More models' })
    const search = screen.getByRole('searchbox', { name: 'Search models' })
    expect(document.activeElement).toBe(search)
    fireEvent.change(search, {
      target: { value: 'jamba' },
    })
    fireEvent.keyDown(search, { key: 'Enter' })
    const trigger = screen.getByRole('button', { name: 'Turn settings' })
    expect(trigger.textContent).toContain('jamba-large-1.7')
    expect(document.activeElement).toBe(trigger)
    await waitFor(() => expect(screen.queryByRole('searchbox')).toBeNull())
    await openModelPanel()
    expect(screen.getByRole('searchbox', { name: 'Search models' })).toHaveProperty('value', '')
  })
})

describe('the menu on the way out of a pick', () => {
  /**
   * A pick both settles the choice and closes the menu, and the closing half
   * is an exit animation - which can only play on an element that is still
   * mounted. If a pick ever tears the panel down in the same commit (a
   * remount above it, a portal whose owner unmounts), the exit is skipped
   * outright and the menu vanishes on the click. That is invisible to every
   * other test here, because they all assert on what the pick wrote.
   */
  it('leaves the panel standing so its exit has something to play on', async () => {
    harnessConfigured()
    stubFetch(defaultRoute([REASONING_MODEL]))
    mountPicker({ conversationId: 'cnv_1' })
    fireEvent.click(await screen.findByRole('button', { name: 'open chat' }))

    await openModelPanel()
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Default' }))

    expect(screen.queryAllByRole('menu')).toHaveLength(1)
  })
})

describe('the name in the strip, when the answer changes', () => {
  /**
   * The trigger is where a pick shows up, and it used to show up as the label
   * being different from one frame to the next - nothing tying the new words
   * to the click. Worst on a long name, where truncation can leave the only
   * visible difference a couple of letters before the ellipsis.
   *
   * The name and its mark are now keyed on the model, so a pick remounts them
   * and the new pair rises into place. Two things have to hold together: the
   * new name is there at once (the choice took effect, and a label that goes
   * blank while it animates would say otherwise), and it is still arriving
   * rather than already arrived.
   */
  it('brings the new name in under its own motion rather than swapping it', async () => {
    harnessConfigured()
    stubFetch(defaultRoute([FLAT_MODEL]))
    mountPicker({ conversationId: 'cnv_1' })
    fireEvent.click(await screen.findByText('open chat'))

    const trigger = screen.getByRole('button', { name: 'Turn settings' })
    expect(trigger.textContent).toContain('Choose a model')

    localStorage.setItem('studio.recent-models', JSON.stringify(['anthropic/jamba-large-1.7']))
    await openModelPanel()
    fireEvent.click(within(screen.getByRole('menu')).getByText('jamba-large-1.7'))

    // Immediately: the answer, not a gap where the answer will be.
    await waitFor(() => {
      expect(trigger.textContent).toContain('jamba-large-1.7')
    })
    expect(trigger.textContent).not.toContain('Choose a model')

    // And it arrived under motion. One frame in it is partly there; a plain
    // swap would read 1 here from the very first frame.
    await act(async () => {
      await new Promise((resolve) => {
        requestAnimationFrame(() => resolve(null))
      })
    })
    const name = within(trigger).getByText('jamba-large-1.7').parentElement as HTMLElement
    expect(Number(name.style.opacity)).toBeLessThan(1)

    await waitFor(() => {
      expect(Number(name.style.opacity)).toBe(1)
    })
  })
})
