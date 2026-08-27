/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { VoiceModeProvider } from '@/features/voice'
import { Composer } from './Composer'

// The composer reads the workspace store for the demo transport's status and
// send; a stub keeps this test about the live receipt mechanics alone. The
// permission control beside the field needs one real mode id to render.
vi.mock('@/stores/workspace', () => ({
  useWorkspace: () => ({
    status: 'idle',
    send: vi.fn(() => 'demo-conversation'),
    stop: vi.fn(),
    settings: { permission: 'manual' },
    setSettings: vi.fn(),
  }),
}))

type Receipt = { readonly ok: boolean }

afterEach(() => {
  cleanup()
})

// jsdom has no ResizeObserver; the field measures itself with one.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)

function renderComposer(onSend: (text: string) => Promise<Receipt>, busy?: boolean) {
  return render(
    <VoiceModeProvider>
      <Composer
        conversationId="cnv_1"
        placeholder="Reply"
        onSend={onSend}
        {...(busy === undefined ? {} : { busy })}
      />
    </VoiceModeProvider>,
  )
}

function type(text: string): void {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: text } })
}

const field = (): string => {
  const box = screen.getByRole('textbox')
  if (!(box instanceof HTMLTextAreaElement)) throw new Error('the field is not a textarea')
  return box.value
}

describe('the field holds its words until the harness takes them', () => {
  it('keeps the typed text when the harness refuses the send', async () => {
    // The Part C failure: an optimistic clear turned a refused POST into a
    // silent swallow. The refusal is answered somewhere visible; the words
    // must still be here to send again.
    const onSend = vi.fn(async () => ({ ok: false }))
    renderComposer(onSend)

    type('please answer this')
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(onSend).toHaveBeenCalledWith('please answer this'))
    expect(field()).toBe('please answer this')
  })

  it('clears only once the receipt says the harness took the message', async () => {
    const onSend = vi.fn(async () => ({ ok: true }))
    renderComposer(onSend)

    type('hello')
    expect(field()).toBe('hello')
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(field()).toBe(''))
    expect(onSend).toHaveBeenCalledTimes(1)
  })

  it('is busy from send to receipt, so one message cannot be POSTed twice', async () => {
    // Held in a property, not a bare `let`: the assignment happens inside the
    // promise executor's callback, and control-flow narrowing would call the
    // variable `never` here — the same pattern useConversation.test.tsx uses.
    const holder: { settle: ((receipt: Receipt) => void) | null } = { settle: null }
    const onSend = vi.fn(
      () =>
        new Promise<Receipt>((resolve) => {
          holder.settle = resolve
        }),
    )
    renderComposer(onSend)

    type('one copy only')
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(onSend).toHaveBeenCalled())

    // Still in flight: the control reads Stop, and clicking it cannot start
    // a second POST — a duplicate turn is the one thing a retry here would
    // manufacture.
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(onSend).toHaveBeenCalledTimes(1)

    if (holder.settle === null) throw new Error('unreachable')
    holder.settle({ ok: true })
    await waitFor(() => expect(field()).toBe(''))
  })
  it('stays busy from send to receipt even when the page passes a busy of its own', () => {
    // ChatPage passes `busy={phase.status === 'streaming'}` — a BOOLEAN, and
    // `false` for the whole POST round trip, because the turn has not started
    // streaming yet. A guard written as `busyOverride ?? sending` never
    // reaches `sending` when the caller always supplies a boolean, so the
    // in-flight lock existed only in tests that omitted the prop. Two clicks
    // then mean two POSTs, and an identical resend is a SECOND TURN by
    // design — the harness pins that and deduplicates nothing.
    const holder: { settle: ((receipt: Receipt) => void) | null } = { settle: null }
    const onSend = vi.fn(
      () =>
        new Promise<Receipt>((resolve) => {
          holder.settle = resolve
        }),
    )
    renderComposer(onSend, false)

    type('one copy only')
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(onSend).toHaveBeenCalledTimes(1)

    // The field still holds the words, so a second click is a live path.
    fireEvent.click(screen.getByRole('button', { name: /Send|Stop/ }))
    expect(onSend).toHaveBeenCalledTimes(1)
  })
})
