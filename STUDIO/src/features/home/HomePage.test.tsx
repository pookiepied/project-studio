/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { VoiceModeProvider } from '@/features/voice'
import type { TurnSettings } from '@/domain/conversation/types'
import { loadDefaultPermission, saveDefaultPermission } from '@/platform/execution-preference'

import { HomePage } from './HomePage'

/**
 * Where the first message of a conversation goes.
 *
 * It used to go to the workspace store's local demo turn: the POST was never
 * made, a demo reply typed itself into a record the conversation view does not
 * read, and the id that got created was one the harness had never heard of, so
 * the page it opened sat empty forever. Every conversation in the app began
 * that way, and only the second message onward was live.
 *
 * There is no harness in jsdom, so what this exercises is the refused path —
 * which is also the one that decided where the submission happens: the words
 * are still in the field the person typed them into, and nothing was created
 * for a send that never ran.
 */

const defaults: TurnSettings = { permission: 'ask', modelId: null, reasoningLevel: null }
const workspace = {
  beginConversation: vi.fn(),
  settings: defaults,
  // The send path reads the catalog to judge whether the turn's model can
  // see images; an empty catalog means "unknown", which passes.
  catalog: { phase: { status: 'ready' as const, error: null }, models: [] },
}
const go = vi.fn()
const contact = vi.fn()
const submitTurn = vi.fn()

vi.mock('@/stores/workspace', () => ({
  useWorkspace: () => workspace,
  // The composer's slash reads the compacting set; nothing here compacts.
  useLiveWork: () => ({ compacting: new Set<string>(), markCompacting: vi.fn(), bumpContext: vi.fn() }),
}))
vi.mock('@/stores/navigation', () => ({ useNavigation: () => ({ go }) }))
vi.mock('@/platform/harness/contact', () => ({ defaultContactFor: () => contact }))

// jsdom has no ResizeObserver; the composer's field measures itself with one.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  contact.mockResolvedValue({ kind: 'absent' })
  workspace.settings = defaults
  localStorage.clear()
})

contact.mockResolvedValue({ kind: 'absent' })

function field(): HTMLTextAreaElement {
  const box = screen.getByRole('textbox')
  if (!(box instanceof HTMLTextAreaElement)) throw new Error('the field is not a textarea')
  return box
}

describe('the composer that starts a conversation', () => {
  it('holds the words when the harness refuses the first turn', async () => {
    render(
      <VoiceModeProvider>
        <HomePage />
      </VoiceModeProvider>,
    )

    fireEvent.change(field(), { target: { value: 'the first thing anyone types' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(screen.getByText(/was not sent/)).toBeTruthy())
    expect(field().value).toBe('the first thing anyone types')
  })

  it('creates no conversation and opens no page for a send that was not taken', async () => {
    render(
      <VoiceModeProvider>
        <HomePage />
      </VoiceModeProvider>,
    )

    fireEvent.change(field(), { target: { value: 'this one bounces' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(screen.getByText(/was not sent/)).toBeTruthy())
    expect(workspace.beginConversation).not.toHaveBeenCalled()
    expect(go).not.toHaveBeenCalled()
    // Task 32's rule, kept intact across a page that has no transcript: the
    // field holds the words until a receipt says the harness took them.
    expect(field().value).toBe('this one bounces')
  })

  it.each(['auto', 'ask'] as const)('sends %s with the first turn and conversation record', async (mode) => {
    expect(await saveDefaultPermission('auto')).toBe(true)
    workspace.settings = { ...workspace.settings, permission: await loadDefaultPermission() }
    contact.mockResolvedValue({ kind: 'ready', client: { submitTurn } })
    submitTurn.mockResolvedValue({ ok: true, value: { offset: '1_0', submissionId: 'sub_first' } })
    render(<VoiceModeProvider><HomePage /></VoiceModeProvider>)

    const permission = screen.getByRole('button', { name: 'What Studio may do: Auto' })
    if (mode === 'ask') {
      fireEvent.click(permission)
      fireEvent.click(screen.getByRole('menuitemradio', { name: /^Ask/ }))
    }
    fireEvent.change(field(), { target: { value: 'start a new conversation' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(workspace.beginConversation).toHaveBeenCalledWith(expect.objectContaining({
      settings: expect.objectContaining({ permission: mode }),
    })))
    expect(submitTurn).toHaveBeenCalledWith('start a new conversation', expect.objectContaining({ permissionMode: mode }), [])
    expect(await loadDefaultPermission()).toBe('auto')
  })
})
