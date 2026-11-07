/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { VoiceModeProvider } from '@/features/voice'
import { Composer } from './Composer'
import { clearDraft } from './drafts'

/**
 * A take's words live in the real field, so they wrap and grow the box as typed
 * text does. An overlay of a fixed height clipped the second line. The hook is
 * stubbed: what is under test is what the composer does with each stage.
 */

type Take = { stage: string; transcript: string; onTake: (text: string) => void }

const take = vi.hoisted<Take>(() => ({ stage: 'idle', transcript: '', onTake: () => undefined }))

vi.mock('@/features/voice', async (actual) => ({
  ...(await actual<typeof import('@/features/voice')>()),
  TextLanding: ({ text }: { text: string }) => <p data-testid="landing">{text}</p>,
  useDictation: ({ onTake }: { onTake: (text: string) => void }) => {
    take.onTake = onTake
    return {
      stage: take.stage,
      transcript: take.transcript,
      elapsedMs: 0,
      denied: false,
      note: null,
      start: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      stop: vi.fn(),
      cancel: vi.fn(),
      mic: { onFrame: () => () => undefined },
    }
  },
}))

vi.mock('@/stores/workspace', () => ({
  useWorkspace: () => ({
    settings: { permission: 'ask' },
    setSettings: vi.fn(),
    conversations: [],
    setConversationPermission: vi.fn(),
  }),
  useLiveWork: () => ({ compacting: new Set<string>(), markCompacting: vi.fn(), bumpContext: vi.fn() }),
}))

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  },
)
Element.prototype.scrollIntoView = () => undefined

const composer = () => (
  <VoiceModeProvider>
    <Composer conversationId="cnv_take" placeholder="Reply" onSend={() => Promise.resolve({ ok: true })} />
  </VoiceModeProvider>
)

const box = (): HTMLTextAreaElement => {
  const found = document.querySelector('textarea')
  if (!found) throw new Error('no field')
  return found
}

beforeEach(() => {
  take.stage = 'idle'
  take.transcript = ''
  clearDraft('cnv_take')
})

afterEach(cleanup)

describe('words during a take', () => {
  it('shows them in the field, which cannot be typed in meanwhile', () => {
    const { rerender } = render(composer())

    take.stage = 'recording'
    take.transcript = 'First words.'
    rerender(composer())

    expect(box().value).toBe('First words.')
    expect(box().closest('[inert]')).not.toBeNull()
  })

  it('follows a draft, and leaves the draft as it was if the take is cancelled', () => {
    const { rerender } = render(composer())
    fireEvent.change(box(), { target: { value: 'Typed first.' } })

    take.stage = 'recording'
    take.transcript = 'Then spoken.'
    rerender(composer())
    expect(box().value).toBe('Typed first. Then spoken.')

    take.stage = 'idle'
    rerender(composer())
    expect(box().value).toBe('Typed first.')
  })

  it('keeps the newest words in view once the field scrolls', () => {
    const { rerender } = render(composer())
    Object.defineProperty(box(), 'scrollHeight', { configurable: true, value: 900 })

    take.stage = 'recording'
    take.transcript = 'A long take.'
    rerender(composer())

    expect(box().scrollTop).toBe(900)
  })

  it('gives the slot to the prompt until there are words', async () => {
    const { rerender } = render(composer())

    take.stage = 'recording'
    rerender(composer())
    expect(screen.getByText("Go ahead, I'm listening")).toBeTruthy()

    take.transcript = 'First words.'
    rerender(composer())
    await waitFor(() => expect(screen.queryByText("Go ahead, I'm listening")).toBeNull())
  })
})

describe('the end of a take', () => {
  it('keeps words already on screen without landing them again', () => {
    const { rerender } = render(composer())
    take.stage = 'recording'
    take.transcript = 'Already showing.'
    rerender(composer())

    take.stage = 'idle'
    act(() => take.onTake('Already showing.'))
    rerender(composer())

    expect(box().value).toBe('Already showing.')
    expect(screen.queryByTestId('landing')).toBeNull()
  })

  it('lands a short take that never reached the screen', () => {
    const { rerender } = render(composer())
    take.stage = 'processing'
    rerender(composer())

    take.stage = 'idle'
    act(() => take.onTake('Short.'))
    rerender(composer())

    expect(screen.getByTestId('landing').textContent).toBe('Short.')
  })
})
