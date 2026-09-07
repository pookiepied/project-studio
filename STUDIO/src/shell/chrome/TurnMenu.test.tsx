/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
 * The picker is deliberately two surfaces: a short first level (the default,
 * the recents, the door) and the library dialog behind it, organised as
 * families first and a model's own facts one drill deeper. Most tests below
 * therefore walk that path: into a family, onto a model's row, into its
 * facts, and out through the explicit button.
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
  permissionMode: 'manual',
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

/** The menu's panel exists only while open; everything below needs it open.
 * The wait is for the panel itself, not a row in it: the trigger's own label
 * is often the same words, and the catalog may still be loading. */
async function openModelPanel() {
  fireEvent.click(screen.getByRole('button', { name: 'Turn settings' }))
  await screen.findByRole('menu')
}

/** The library is a dialog of its own now; this walks to it. */
async function openLibrary() {
  await openModelPanel()
  fireEvent.click(screen.getByText('Model library…'))
  await screen.findByRole('dialog', { name: 'Model library' })
  await screen.findByRole('textbox', { name: 'Search models' })
}

/** The family index inside the library - the rows that name the families. */
function familyIndex() {
  return within(screen.getByRole('navigation', { name: 'Model families' }))
}

/** Walks from the landing into a family's page through the index. */
async function openFamilyInLibrary(name: string | RegExp) {
  fireEvent.click(familyIndex().getByRole('button', { name: name }))
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
    expect(trigger.textContent).not.toContain('Default model')

    // The resting choice is still offered - named for what it is.
    await openModelPanel()
    expect(within(screen.getByRole('menu')).getByText('Default model')).toBeTruthy()
  })

  it('keeps the first level short: default, the door, reasoning - not every model', async () => {
    harnessConfigured()
    stubFetch(defaultRoute([REASONING_MODEL, FLAT_MODEL]))
    mountPicker()

    await openModelPanel()
    const menu = screen.getByRole('menu')
    // No connection groups, no model rows: choosing happens in the library.
    expect(menu.textContent).not.toContain('claude-sonnet-4.5')
    expect(menu.textContent).not.toContain('jamba-large-1.7')
    expect(menu.textContent).not.toContain('Work Anthropic')
    // The door is there, and so is the resting choice (queried inside the
    // panel: the trigger's own label reads similar words).
    expect(screen.getByText('Model library…')).toBeTruthy()
    expect(within(menu).getByText('Default model')).toBeTruthy()
  })

  it('organises the library by family: the landing names the vendor, its page lists the models', async () => {
    harnessConfigured()
    mountPicker()
    stubFetch(defaultRoute([REASONING_MODEL]))

    await openLibrary()
    // The landing is the catalog's shape, not its rows: one card for the
    // family, wearing the model's own author mark (resolved from the vendor
    // the connection draws from) and naming the connection that serves it.
    const card = await screen.findByRole('button', { name: /Work Anthropic/ })
    expect(card.textContent).toContain('Anthropic')
    expect(card.textContent).toContain('1 model')
    expect(document.querySelector('[data-provider="anthropic"]')).not.toBeNull()
    // No model rows on the landing: a library opens on its index, not a wall.
    expect(screen.queryByRole('button', { name: /claude-sonnet-4\.5/ })).toBeNull()

    // Into the family, the model is a row; onto the row, its own page.
    await openFamilyInLibrary(/Anthropic/)
    fireEvent.click(await screen.findByRole('button', { name: /claude-sonnet-4\.5/ }))
    await screen.findByText('Input price')
  })

  it('narrows the library as the search is typed, grouped by family, and says so when nothing matches', async () => {
    harnessConfigured()
    stubFetch(defaultRoute([REASONING_MODEL, FLAT_MODEL]))
    mountPicker()

    await openLibrary()
    fireEvent.change(screen.getByRole('textbox', { name: 'Search models' }), {
      target: { value: 'jamba' },
    })
    // The needle matches by name; the other model's row is gone. The family
    // header stays - the family still owns the one model that matched.
    expect(await screen.findByRole('button', { name: /jamba-large-1\.7/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /claude-sonnet/ })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Anthropic' })).toBeTruthy()

    fireEvent.change(screen.getByRole('textbox', { name: 'Search models' }), {
      target: { value: 'nothing at all' },
    })
    await screen.findByText(/No models match "nothing at all"/)
  })

  it('shows the facts a choice deserves: price, context, and what the model can do', async () => {
    harnessConfigured()
    stubFetch(defaultRoute([REASONING_MODEL]))
    mountPicker()

    await openLibrary()
    await openFamilyInLibrary(/Anthropic/)
    fireEvent.click(await screen.findByRole('button', { name: /claude-sonnet-4\.5/ }))

    // The wire record's own facts, shown rather than buried: prices per
    // million tokens, the context size, and the capability chips.
    await screen.findByText('Input price')
    expect(screen.getByText('Output price')).toBeTruthy()
    expect(screen.getByText('Context window')).toBeTruthy()
    expect(screen.getByText('Tool calling')).toBeTruthy()
    expect(screen.getByText('Vision')).toBeTruthy()

    // The back row is named for where it returns to, and it does return.
    fireEvent.click(screen.getByRole('button', { name: 'Anthropic' }))
    expect(await screen.findByRole('button', { name: /claude-sonnet-4\.5/ })).toBeTruthy()
  })

  it('hides the reasoning control entirely for a model that cannot reason', async () => {
    harnessConfigured()
    stubFetch(defaultRoute([FLAT_MODEL]))
    mountPicker()

    await openLibrary()
    fireEvent.change(screen.getByRole('textbox', { name: 'Search models' }), {
      target: { value: 'jamba' },
    })
    fireEvent.click(await screen.findByRole('button', { name: /jamba-large-1\.7/ }))
    await screen.findByText('Capabilities')
    // Present and inert would be a control that lies; it is absent instead.
    expect(screen.queryByText('Reasoning effort')).toBeNull()
  })

  it('settles a library pick through an index PATCH, applied only by the explicit button', async () => {
    harnessConfigured()
    const calls = stubFetch(defaultRoute([REASONING_MODEL]))
    mountPicker({ conversationId: 'cnv_1' })

    // Open the conversation first, so the picker is holding a record.
    fireEvent.click(screen.getByText('open chat'))

    await openLibrary()
    await openFamilyInLibrary(/Anthropic/)
    // Opening a model's page writes nothing: the facts appear, the dial rests
    // on medium, and the index is untouched until the button.
    fireEvent.click(await screen.findByRole('button', { name: /claude-sonnet-4\.5/ }))
    await screen.findByText('Reasoning effort')
    expect(
      calls.filter((call) => call.method === 'PATCH' && call.url.endsWith('/api/conversations/cnv_1')),
    ).toEqual([])
    const slider = screen.getByRole('slider', { name: 'Reasoning effort' })
    expect(slider.getAttribute('aria-valuetext')).toBe('Medium')

    fireEvent.click(screen.getByRole('button', { name: 'Use this model' }))
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

  it('offers the last three explicit picks before the library, most recent first', async () => {
    harnessConfigured()
    const calls = stubFetch(defaultRoute([FLAT_MODEL, ANOTHER_FLAT, THIRD_FLAT, FOURTH_FLAT]))
    mountPicker({ conversationId: 'cnv_1' })
    fireEvent.click(screen.getByText('open chat'))

    // Four picks, three seats: the oldest falls off the list entirely.
    for (const name of ['jamba-large-1\\.7', 'vox-small-1', 'kappa-mini', 'delta-pro']) {
      await openLibrary()
      await openFamilyInLibrary(/Anthropic/)
      fireEvent.click(await screen.findByRole('button', { name: new RegExp(name) }))
      fireEvent.click(screen.getByRole('button', { name: 'Use this model' }))
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
    await screen.findByText('Recent')
    const menu = screen.getByRole('menu')
    expect(menu.textContent).toContain('delta-pro')
    expect(menu.textContent).toContain('kappa-mini')
    expect(menu.textContent).toContain('vox-small-1')
    expect(menu.textContent).not.toContain('jamba-large-1.7')

    // A recent is one click, not two: choosing it settles the same PATCH the
    // library path would, with no trip through the dialog. The four picks'
    // patches came before it; the last one is the recent's.
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
    fireEvent.click(within(screen.getByRole('menu')).getByText('Default model'))
    await openModelPanel()
    expect(screen.queryByText('Recent')).toBeNull()
  })

  it('keeps the recents honest: a model the catalog no longer has stops appearing', async () => {
    harnessConfigured()
    const calls = stubFetch(defaultRoute([FLAT_MODEL]))
    const view = mountPicker({ conversationId: 'cnv_1' })
    fireEvent.click(screen.getByText('open chat'))

    await openLibrary()
    await openFamilyInLibrary(/Anthropic/)
    fireEvent.click(await screen.findByRole('button', { name: /jamba-large-1\.7/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Use this model' }))
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
    expect(screen.queryByText('Recent')).toBeNull()
  })

  it('offers only the model levels as steps of one dial, resting on medium', async () => {
    harnessConfigured()
    stubFetch(defaultRoute([REASONING_MODEL]))
    mountPicker()

    await openLibrary()
    await openFamilyInLibrary(/Anthropic/)
    fireEvent.click(await screen.findByRole('button', { name: /claude-sonnet-4\.5/ }))

    // One dial in the details pane, whose steps are the model's own levels:
    // six stops for this model, resting on medium, with no Default step.
    const slider = screen.getByRole('slider', { name: 'Reasoning effort' })
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

    // The dial is part of the pick: applying carries the dragged level out.
    // (No conversation is open here, so the choice settles on the window's
    // settings; reopening the reasoning panel shows where it landed.)
    fireEvent.click(screen.getByRole('button', { name: 'Use this model' }))
    fireEvent.click(screen.getByRole('button', { name: 'Turn settings' }))
    // The menu item's accessible name carries its hint ("Reasoning X-high").
    fireEvent.click(screen.getByRole('menuitem', { name: /^Reasoning/ }))
    // Scoped to the menu: the dialog's own dial may still be on its way out.
    const settled = within(screen.getByRole('menu')).getByRole('slider', { name: 'Reasoning effort' })
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
    await openModelPanel()

    expect(await screen.findByText('200k context window')).toBeTruthy()
  })

  it('draws the bar on a conversation, and nothing to fill off one', async () => {
    harnessConfigured()
    stubFetch(defaultRoute([FLAT_MODEL]))
    mountPicker({ conversationId: 'cnv_1' })
    fireEvent.click(await screen.findByText('open chat'))

    await pickRecent('anthropic/jamba-large-1.7', 'jamba-large-1.7')
    await openModelPanel()
    expect(screen.getByRole('meter', { name: 'Context used' })).toBeTruthy()

    // Home has a composer and therefore a model, but no transcript - so there
    // is a window to name and nothing yet occupying it.
    cleanup()
    stubFetch(defaultRoute([FLAT_MODEL]))
    mountPicker()
    await pickRecent('anthropic/jamba-large-1.7', 'jamba-large-1.7')
    await openModelPanel()
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

    await openModelPanel()

    expect(await screen.findByText('No model chosen')).toBeTruthy()
    expect(screen.getByRole('meter', { name: 'Context used' })).toBeTruthy()
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
